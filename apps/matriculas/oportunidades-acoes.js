'use strict';
const crypto = require('node:crypto');

module.exports = function criarAcoes({db,all,get,run,tx,falha,norm,hojeISO,cicloValido,permissoes,carregarBase,cpfNormalizado,mascaraCpf,evento,nomeResponsavel,lerResponsavel,cursoFonte}) {
 db.exec(`CREATE TABLE IF NOT EXISTS ma_op_acoes (
 id INTEGER PRIMARY KEY, ciclo_id INTEGER NOT NULL REFERENCES ciclos(id), nome TEXT NOT NULL,
 supervisora TEXT, inicio TEXT NOT NULL, fim TEXT, arquivo TEXT, hash TEXT NOT NULL,
 criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), criado_por TEXT,
 pendencias TEXT NOT NULL DEFAULT '[]', UNIQUE(ciclo_id,hash));
 CREATE TABLE IF NOT EXISTS ma_op_acao_leads (
 acao_id INTEGER NOT NULL REFERENCES ma_op_acoes(id), oportunidade_id INTEGER NOT NULL REFERENCES ma_oportunidades(id),
 tutor_id INTEGER NOT NULL REFERENCES tutores(id), aba TEXT NOT NULL, ra_inicial TEXT NOT NULL,
 PRIMARY KEY(acao_id,oportunidade_id));
 CREATE INDEX IF NOT EXISTS ix_op_acao_lead ON ma_op_acao_leads(oportunidade_id,acao_id);`);
 const exigir = u => {if(!permissoes(u).definir_responsavel)falha(403,'Seu acesso não pode distribuir leads em ações.');};
 const dataValida = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const fonteCodigo = r => cursoFonte(r.curso_cod,r.curso_nome).codigo;
 function analisar(c,u) {
  exigir(u);const ciclo=cicloValido(c.ciclo),nome=String(c.nome||'').trim().slice(0,160),inicio=String(c.inicio||hojeISO()),fim=String(c.fim||'');
  if(!nome)falha(400,'Informe o nome da ação.');
  if(!dataValida(inicio)||inicio>hojeISO()||(fim&&(!dataValida(fim)||fim<inicio)))falha(400,'Confira o período da ação. O início não pode ser futuro.');
  if(!Array.isArray(c.linhas)||!c.linhas.length||c.linhas.length>20000)falha(400,'Envie as linhas das abas da planilha.');
  const {base}=carregarBase(ciclo,u),porCpf=new Map();
  for(const r of base){const cpf=cpfNormalizado(r.cpf).valor;if(cpf){const a=porCpf.get(cpf)||[];a.push(r);porCpf.set(cpf,a);}}
  const tutores=all('SELECT id,nome,apelidos FROM tutores WHERE ativo=1');
  const polosTutora=new Map();for(const r of all('SELECT tutor_id,polo_id FROM tutor_polos')){const ps=polosTutora.get(r.tutor_id)||[];ps.push(r.polo_id);polosTutora.set(r.tutor_id,ps);}
  const tutorPorAba=new Map();
  for(const aba of new Set(c.linhas.map(r=>String(r.aba||'').trim()))){
   const manual=c.tutores?.[aba];let candidates;
   if(manual){candidates=tutores.filter(t=>String(t.id)===String(manual));}
   else candidates=tutores.filter(t=>[t.nome,...String(t.apelidos||'').split(/[,;\n]/)].some(n=>norm(n)===norm(aba)));
   tutorPorAba.set(aba,candidates.length===1?candidates[0]:null);
  }
  const linhas=c.linhas.map((l,i)=>{
   const aba=String(l.aba||'').trim().slice(0,100),cpf=cpfNormalizado(l.cpf).valor,t=tutorPorAba.get(aba),codigo=String(l.curso_cod||'').trim().toUpperCase();
   let matches=cpf?porCpf.get(cpf)||[]:[];
   // CPF e curso identificam a inscrição; não troca de curso quando o CPF tem outra oportunidade.
   if(codigo)matches=matches.filter(r=>fonteCodigo(r)===codigo);
   const r=matches.length===1?matches[0]:null;
   return {linha:Number(l.linha)||i+2,aba,nome:String(l.nome||'').slice(0,180),cpf:mascaraCpf(cpf),curso:codigo,
    tutor_id:t?.id||null,tutora:t?.nome||'',oportunidade_id:r?.id||null,ra_inicial:r?.ra_situacao||null,
    motivo:!cpf?(String(l.cpf??'').trim()?'CPF inválido':'CPF não informado'):!t?'Vincule a aba a uma tutora cadastrada':!matches.length?'Lead não localizado neste processo e curso':matches.length>1?'Mais de uma inscrição corresponde ao CPF e curso':!r.polo_id?'Polo do lead não reconhecido':(polosTutora.get(t.id)||[]).length&&!(polosTutora.get(t.id)||[]).includes(r.polo_id)?'Tutora não vinculada ao polo deste lead':'',
    atual:r?.responsavel||'',polo:r?.polo||''};
  });
  const grupos=new Map();for(const r of linhas)if(r.oportunidade_id){const a=grupos.get(r.oportunidade_id)||[];a.push(r);grupos.set(r.oportunidade_id,a);}
  for(const group of grupos.values()){
   if(new Set(group.map(r=>r.tutor_id)).size>1)for(const r of group)r.motivo='Mesmo lead distribuído para tutoras diferentes';
   else for(const r of group.slice(1))r.motivo='Linha repetida na mesma distribuição';
  }
  const hash=crypto.createHash('sha256').update(JSON.stringify({nome:norm(nome),inicio,fim,linhas:c.linhas.map(r=>[String(r.aba||'').trim(),cpfNormalizado(r.cpf).valor,String(r.curso_cod||'').trim().toUpperCase()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).digest('hex');
  const existente=get('SELECT id,nome FROM ma_op_acoes WHERE ciclo_id=? AND hash=?',ciclo,hash);
  return {ciclo,nome,inicio,fim:fim||null,supervisora:String(c.supervisora||'').trim().slice(0,120),arquivo:String(c.arquivo||'').slice(0,180),hash,existente,
   linhas,totais:{linhas:linhas.length,vinculaveis:linhas.filter(r=>!r.motivo).length,pendentes:linhas.filter(r=>r.motivo).length},
   abas:[...tutorPorAba].map(([aba,t])=>({aba,tutor_id:t?.id||null,nome:t?.nome||''}))};
 }
 function previa(c,u){const a=analisar(c,u);const {hash,...out}=a;return out;}
 function criar(c,u){
  exigir(u);if(!c.confirmado)falha(400,'Revise a distribuição antes de criar a ação.');
  return tx(()=>{
   const a=analisar(c,u);if(a.existente)return {ok:true,id:a.existente.id,existente:true};
   const validos=a.linhas.filter(r=>!r.motivo);if(!validos.length)falha(400,'Nenhum lead pode ser vinculado. Revise as pendências.');
   const id=Number(run('INSERT INTO ma_op_acoes(ciclo_id,nome,supervisora,inicio,fim,arquivo,hash,criado_por,pendencias) VALUES(?,?,?,?,?,?,?,?,?)',a.ciclo,a.nome,a.supervisora,a.inicio,a.fim,a.arquivo,a.hash,u.login,JSON.stringify(a.linhas.filter(r=>r.motivo))).lastInsertRowid);
   for(const r of validos){
    const o=get('SELECT * FROM ma_oportunidades WHERE id=?',r.oportunidade_id),antes=nomeResponsavel(o);
    lerResponsavel({responsavel:'t:'+r.tutor_id});
    run('INSERT INTO ma_op_acao_leads(acao_id,oportunidade_id,tutor_id,aba,ra_inicial) VALUES(?,?,?,?,?)',id,o.id,r.tutor_id,r.aba,r.ra_inicial);
    run("UPDATE ma_oportunidades SET responsavel_id=NULL,responsavel_tutor_id=?,atualizado_por=?,atualizado_em=datetime('now','localtime') WHERE id=?",r.tutor_id,u.login,o.id);
    evento(o.id,'acao',antes,r.tutora,u,{detalhe:`Ação #${id}: ${a.nome}`});
   }
   return {ok:true,id,vinculados:validos.length,pendentes:a.totais.pendentes};
  });
 }
 function listar(q,u){
  const ciclo=cicloValido(q.ciclo),{base}=carregarBase(ciclo,u),ids=new Set(base.map(r=>r.id));
  const links=all('SELECT l.acao_id,l.oportunidade_id FROM ma_op_acao_leads l JOIN ma_op_acoes a ON a.id=l.acao_id WHERE a.ciclo_id=?',ciclo);
  const contagens=new Map();for(const l of links)if(ids.has(l.oportunidade_id))contagens.set(l.acao_id,(contagens.get(l.acao_id)||0)+1);
  return {acoes:all('SELECT id,nome,supervisora,inicio,fim,criado_em FROM ma_op_acoes WHERE ciclo_id=? ORDER BY id DESC',ciclo).filter(a=>permissoes(u).importar||contagens.has(a.id)).map(a=>({...a,total:contagens.get(a.id)||0}))};
 }
 function relatorio(id,u){
  const a=get('SELECT * FROM ma_op_acoes WHERE id=?',Number(id));if(!a)falha(404,'Ação não encontrada.');
  const {base}=carregarBase(a.ciclo_id,u),porId=new Map(base.map(r=>[r.id,r]));
  const links=all('SELECT l.*,t.nome tutora FROM ma_op_acao_leads l JOIN tutores t ON t.id=l.tutor_id WHERE l.acao_id=?',a.id).filter(l=>porId.has(l.oportunidade_id));
  if(!links.length&&!permissoes(u).importar)falha(404,'Ação não encontrada.');
  const fim=a.fim&&a.fim<hojeISO()?a.fim:hojeISO();
  const eventos=all(`SELECT e.oportunidade_id,e.data,e.autor_tutor_id,e.autor_nome FROM ma_oportunidade_atendimentos e JOIN ma_op_acao_leads l ON l.oportunidade_id=e.oportunidade_id WHERE l.acao_id=? AND e.anulado=0 AND e.data>=? AND e.data<=?`,a.id,a.inicio,fim);
  const atend=new Map();for(const e of eventos){const xs=atend.get(e.oportunidade_id)||[];xs.push(e);atend.set(e.oportunidade_id,xs);}
  const linhas=links.map(l=>{const r=porId.get(l.oportunidade_id),ats=atend.get(l.oportunidade_id)||[];return {
   id:r.id,nome:r.nome,cpf:mascaraCpf(r.cpf),curso:r.curso,polo:r.polo,tutor_id:l.tutor_id,tutora:l.tutora,aba:l.aba,
   atendido:ats.length>0,atendimentos:ats.length,atendido_pela_tutora:ats.some(e=>Number(e.autor_tutor_id)===l.tutor_id),
   ra_inicial:l.ra_inicial,ra_atual:r.ra_situacao,convertido_apos_inicio:l.ra_inicial!=='confirmado'&&r.ra_situacao==='confirmado',etapa:r.etapa};});
  const resumir=ls=>{const total=ls.length,atendidos=ls.filter(r=>r.atendido).length,ja=ls.filter(r=>r.ra_inicial==='confirmado').length,novos=ls.filter(r=>r.convertido_apos_inicio).length;
   return {total,atendidos,nao_atendidos:total-atendidos,taxa_atendimento:total?100*atendidos/total:null,ja_convertidos:ja,elegiveis:total-ja,novas_conversoes:novos,taxa_conversao:total>ja?100*novos/(total-ja):null,ra_confirmado:ls.filter(r=>r.ra_atual==='confirmado').length};};
  const por_tutora=[...new Set(links.map(l=>l.tutor_id))].map(id=>({id,nome:links.find(l=>l.tutor_id===id).tutora,...resumir(linhas.filter(r=>r.tutor_id===id))}));
  const {hash,pendencias,...acao}=a;
  return {acao,kpis:resumir(linhas),por_tutora,linhas,pendencias:permissoes(u).importar?JSON.parse(pendencias):[],ate:fim};
 }
 return {previa,criar,listar,relatorio};
};
