'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');

test('HTTP: importar acompanhamento recalcula cards e painel da ação sem intervenção manual',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acao-import-http-'));process.env.MATRICULAS_DATA_DIR=dir;
 const {db,servidor}=require('../apps/matriculas/server');
 try{
  const password=crypto.randomBytes(24).toString('hex'),salt=crypto.randomBytes(16).toString('hex'),hash=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
  db.prepare('INSERT INTO usuarios(id,nome,login,senha_hash,papel) VALUES(801,?,?,?,?)').run('Teste','teste-import',hash,'admin');
  db.exec("INSERT INTO ciclos(id,nome) VALUES(801,'Teste HTTP');INSERT INTO polos(id,nome) VALUES(801,'Franca');INSERT INTO tutores(id,nome,apelidos) VALUES(801,'Beatriz','Bia'),(802,'Emilly',NULL);INSERT INTO tutor_polos VALUES(801,801),(802,801);");
  await new Promise(r=>servidor.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+servidor.address().port;let cookie='';
  async function request(route,body,method=body?'POST':'GET'){
   const res=await fetch(root+route,{method,headers:{'Content-Type':'application/json',Origin:root,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));if(route==='/api/login')cookie=res.headers.get('set-cookie').split(';')[0];return data;
  }
  await request('/api/login',{login:'teste-import',senha:password});
  const prefix='/api/ma/oportunidades',lead={identificador:'HTTP-LEAD',nome:'Lead HTTP',cpf:'52998224725',curso_cod:'ESPRE_PED',polo_fonte:'Franca',status_origem:'LEAD'};
  await request(prefix+'/importar',{ciclo:801,confirmado:true,linhas:[lead]});
  const acao=await request(prefix+'/acoes',{ciclo:801,nome:'Ação HTTP',inicio:'2026-11-17',confirmado:true,linhas:[{aba:'Bia',cpf:lead.cpf,curso_cod:'ESPRE_PED'},{aba:'Emilly',cpf:lead.cpf,curso_cod:'ESPRE_PED'}]});
  assert.equal((await request(prefix+'/acoes/'+acao.id)).kpis.atendidos,0);
  const input={ciclo:801,confirmado:true,arquivo:'acompanhamento.xlsx',linhas:[{...lead,status_origem:'QUALIFICADO',ultimo_atendimento:'17/11/2026',responsavel_origem:'Beatriz Carvalhaes Vila Nova',interacoes:1}]};
  const result=await request(prefix+'/importar',input);assert.equal(result.acoes.acoes_atualizadas,1);
  const d=await request(prefix+'/acoes/'+acao.id);assert.equal(d.kpis.atendidos,1);assert.equal(d.kpis.taxa_atendimento,50);assert.equal(d.por_tutora.find(t=>t.id===801).atendidos,1);assert.equal(d.por_tutora.find(t=>t.id===802).atendidos,0);assert.ok(d.linhas.every(r=>r.status_origem==='QUALIFICADO'));
  await request(prefix+'/importar',input);assert.equal((await request(prefix+'/acoes/'+acao.id)).kpis.atendidos,1);assert.equal((await request(prefix+'/acoes?ciclo=801')).acoes[0].taxa_atendimento,50);
 }finally{if(servidor.listening)await new Promise(r=>servidor.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
