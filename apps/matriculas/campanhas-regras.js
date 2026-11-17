'use strict';
const crypto=require('node:crypto');
module.exports=function({db,all,get,run,tx,falha,registrar}){
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 if(!all('PRAGMA table_info(campanhas)').some(c=>c.name==='config_avancada'))db.exec('ALTER TABLE campanhas ADD COLUMN config_avancada TEXT');
 db.exec(`CREATE TABLE IF NOT EXISTS campanha_validacoes(campanha_id INTEGER NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,matricula_id INTEGER NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,numero_candidato TEXT,atendimento TEXT NOT NULL DEFAULT 'nao_informado',pagamento TEXT NOT NULL DEFAULT 'pendente',comprovante_ref TEXT,comprovante BLOB,comprovante_nome TEXT,comprovante_mime TEXT,comprovante_hash TEXT,por_login TEXT,atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),PRIMARY KEY(campanha_id,matricula_id));`);
 function config(c){try{return typeof c.config_avancada==='string'?JSON.parse(c.config_avancada):c.config_avancada||null;}catch{return null;}}
 function normalizar(c){
  if(c.config_avancada===undefined)return undefined;
  if(c.config_avancada===null)return null;
  const x=c.config_avancada;if(!x||typeof x!=='object'||!Array.isArray(x.faixas)||!x.faixas.length||x.faixas.length>30)falha(400,'Informe as faixas da campanha.');
  const fs=x.faixas.map(f=>({qtd:Number(f.qtd),valor:Number(f.valor)})).sort((a,b)=>a.qtd-b.qtd);
  if(fs.some((f,i)=>!Number.isInteger(f.qtd)||f.qtd<1||f.qtd>100000||!Number.isFinite(f.valor)||f.valor<0||f.valor>1000000||(i&&f.qtd===fs[i-1].qtd)))falha(400,'Faixas inválidas: quantidades únicas e prêmios positivos.');
  const adicional=Number(x.adicional||0);if(!Number.isFinite(adicional)||adicional<0||adicional>1000000)falha(400,'Adicional inválido.');
  if(x.validar_elegibilidade&&!(Array.isArray(c.produtos)?c.produtos.length:String(c.produtos||'').trim()))falha(400,'Selecione explicitamente os produtos elegíveis.');
  if(c.beneficiario==='polo')falha(400,'Campanhas por faixas são por colaborador.');
  return {faixas:fs.map(f=>({...f,valor:Math.round(f.valor*100)/100})),adicional:Math.round(adicional*100)/100,por_colaborador:true,validar_elegibilidade:!!x.validar_elegibilidade};
 }
 function premio(x,qtd){
  let base=null;for(const f of x.faixas)if(qtd>=f.qtd)base=f;
  const ultima=x.faixas[x.faixas.length-1],proxima=x.faixas.find(f=>f.qtd>qtd);
  const cents=base?Math.round(base.valor*100)+(qtd>ultima.qtd?(qtd-ultima.qtd)*Math.round(x.adicional*100):0):0;
  return {valor:cents/100,falta:proxima?proxima.qtd-qtd:1};
 }
 function validacoes(id){return new Map(all('SELECT campanha_id,matricula_id,numero_candidato,atendimento,pagamento,comprovante_ref,comprovante_nome,comprovante_mime,por_login,atualizado_em,CASE WHEN comprovante IS NOT NULL THEN 1 ELSE 0 END tem_arquivo FROM campanha_validacoes WHERE campanha_id=?',id).map(v=>[v.matricula_id,v]));}
 function motivos(c,l,v){
  const x=config(c);if(!x?.validar_elegibilidade)return [];
  const ps=String(c.produtos||'').split(',').map(Number),ms=[];
  if(!ps.includes(l.produto_id))ms.push('Produto fora da campanha');
  if(!l.tutor_id)ms.push('Matriculador não informado');
  if(!v?.numero_candidato?.trim())ms.push('Número do candidato não informado');
  if(v?.atendimento==='autonoma')ms.push('Matrícula 100% pelo candidato — não elegível');
  else if(v?.atendimento!=='assistida')ms.push('Participação do colaborador não conferida');
  if(v?.pagamento==='cancelada')ms.push('Matrícula cancelada');
  else if(v?.pagamento!=='confirmado')ms.push('Pagamento não confirmado');
  if(!v?.tem_arquivo&&!v?.comprovante_ref)ms.push('Comprovante não anexado ou referenciado');
  return ms;
 }
 function salvarValidacao(cid,mid,c,u){
  const ca=get('SELECT * FROM campanhas WHERE id=?',cid),ma=get('SELECT * FROM matriculas WHERE id=?',mid);if(!ca||!ma)falha(404,'Campanha ou matrícula não encontrada.');
  if(ma.data<ca.inicio||ma.data>ca.fim)falha(400,'Matrícula fora do período da campanha.');
  const polos=String(ca.polos||'').split(',').map(Number).filter(Boolean),polo=ma.tutor_polo_id||ma.polo_id;if(polos.length&&!polos.includes(polo))falha(400,'Matrícula fora dos polos da campanha.');
  const numero=String(c.numero_candidato||'').trim().slice(0,80),atendimento=String(c.atendimento||'nao_informado'),pagamento=String(c.pagamento||'pendente'),ref=String(c.comprovante_ref||'').trim().slice(0,1000)||null;
  if(!['assistida','autonoma','nao_informado'].includes(atendimento)||!['confirmado','pendente','cancelada'].includes(pagamento))falha(400,'Situação de elegibilidade inválida.');
  if(ref&&!/^https:\/\//i.test(ref))falha(400,'Use um link HTTPS para o comprovante já publicado.');
  const anterior=get('SELECT * FROM campanha_validacoes WHERE campanha_id=? AND matricula_id=?',cid,mid)||{};let arquivo=anterior.comprovante||null,nome=anterior.comprovante_nome||null,mime=anterior.comprovante_mime||null,hash=anterior.comprovante_hash||null;
  if(c.arquivo){
   nome=String(c.arquivo.nome||'comprovante').replace(/[\r\n"\\/]/g,'_').slice(0,150);mime=String(c.arquivo.tipo||'');
   if(!['application/pdf','image/jpeg','image/png'].includes(mime))falha(400,'Anexe PDF, JPEG ou PNG.');
   const texto=String(c.arquivo.base64||'');if(texto.length>7e6||!/^[A-Za-z0-9+/]+={0,2}$/.test(texto))falha(400,'Arquivo inválido ou maior que 5 MB.');arquivo=Buffer.from(texto,'base64');
   if(!arquivo.length||arquivo.length>5*1024*1024)falha(400,'O comprovante deve ter até 5 MB.');
   const ok=mime==='application/pdf'?arquivo.subarray(0,5).toString()==='%PDF-':mime==='image/png'?arquivo.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):arquivo[0]===255&&arquivo[1]===216&&arquivo[2]===255;
   if(!ok)falha(400,'O conteúdo do arquivo não corresponde ao formato.');hash=crypto.createHash('sha256').update(arquivo).digest('hex');
  }
  return tx(()=>{run(`INSERT INTO campanha_validacoes(campanha_id,matricula_id,numero_candidato,atendimento,pagamento,comprovante_ref,comprovante,comprovante_nome,comprovante_mime,comprovante_hash,por_login) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(campanha_id,matricula_id) DO UPDATE SET numero_candidato=excluded.numero_candidato,atendimento=excluded.atendimento,pagamento=excluded.pagamento,comprovante_ref=excluded.comprovante_ref,comprovante=excluded.comprovante,comprovante_nome=excluded.comprovante_nome,comprovante_mime=excluded.comprovante_mime,comprovante_hash=excluded.comprovante_hash,por_login=excluded.por_login,atualizado_em=datetime('now','localtime')`,cid,mid,numero,atendimento,pagamento,ref,arquivo,nome,mime,hash,u.login);registrar(u,'conferiu incentivo',`Campanha #${cid}, matrícula #${mid}`);return {ok:true};});
 }
 function modelo(){
  if(get("SELECT 1 FROM config WHERE chave='campanha_incentivo_20261117'"))return;
  const produtos=all('SELECT id,nome FROM produtos WHERE ativo=1').filter(p=>['graduacao','ead'].includes(norm(p.nome))||norm(p.nome).startsWith('semi ')).map(p=>p.id);if(!produtos.length)return;
  tx(()=>{let id=get('SELECT id FROM campanhas WHERE nome=?','Incentivo — 17/11/2026')?.id;
   if(!id)id=Number(run("INSERT INTO campanhas(nome,inicio,fim,tipo,qtd,valor,adicional,produtos,beneficiario,config_avancada,obs) VALUES(?, '2026-11-17','2026-11-17','escalonada',4,100,25,?,'tutor',?,?)",'Incentivo — 17/11/2026',produtos.join(','),JSON.stringify({faixas:[{qtd:2,valor:30},{qtd:3,valor:75},{qtd:4,valor:100}],adicional:25,por_colaborador:true,validar_elegibilidade:true}),'Somente Graduação e Semi. Comprovante obrigatório. Matrículas 100% pelo candidato não contam.').lastInsertRowid);
   run('INSERT INTO config(chave,valor) VALUES(?,?)','campanha_incentivo_20261117',String(id));});
 }
 modelo();return {config,normalizar,premio,validacoes,motivos,salvarValidacao};
};
