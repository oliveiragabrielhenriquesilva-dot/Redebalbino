'use strict';
const crypto=require('node:crypto'),DATA=require('./data/precos-regionais.json');
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const REGION6=new Set(['franca','batatais','itapira','ituverava','sao joaquim da barra','ribeirao preto','mogi mirim','mogi guacu']);
function regionForPole(name){const n=norm(name).replace(/ sp$| mg$/,'');if(n==='monte siao')return 3;if(REGION6.has(n)||n==='ribeirao preto ipiranga')return 6;return null;}
const rowCode=row=>row.code||'POS_'+crypto.createHash('sha256').update(norm(row.name)).digest('hex').slice(0,16);
const TABLES=DATA.tables.map(table=>({...table,index:new Map(table.rows.map(row=>[rowCode(row),row]))}));
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function actorContext(db,actor,requested){
 let accounts={};try{accounts=JSON.parse(actor.accounts_json||'{}');}catch{}
 const account=String(accounts.matriculas||''),match=account.match(/^@tutor:(\d+)$/);
 let admin=!!actor.is_admin,poleId=null;
 if(match){
  const tutor=db.prepare('SELECT id,ativo,polo_origem_id FROM tutores WHERE id=?').get(Number(match[1]));
  if(tutor?.ativo){const ids=db.prepare('SELECT polo_id FROM tutor_polos WHERE tutor_id=?').all(tutor.id).map(r=>Number(r.polo_id));poleId=ids.includes(Number(tutor.polo_origem_id))?Number(tutor.polo_origem_id):ids.length===1?ids[0]:null;}
 }else if(account&&account!=='@admin'){
  const user=db.prepare('SELECT papel,polo_id FROM usuarios WHERE ativo=1 AND login=? COLLATE NOCASE').get(account);
  if(user){admin=admin||user.papel==='admin';poleId=user.polo_id;}
 }
 const poles=db.prepare('SELECT id,nome FROM polos WHERE ativo=1 ORDER BY nome').all().filter(p=>regionForPole(p.nome));
 if(admin){if(requested){if(!/^\d+$/.test(String(requested)))fail(400,'Polo inválido.');poleId=Number(requested);if(!poles.some(p=>p.id===poleId))fail(400,'Polo sem tabela cadastrada.');}}
 else if(requested&&Number(requested)!==Number(poleId))fail(403,'A tabela é definida pelo polo cadastrado no seu acesso.');
 const pole=poles.find(p=>p.id===poleId)||null;
 return {admin,pole,region:pole?regionForPole(pole.nome):null,poles:admin?poles:pole?[pole]:[],blockedReason:pole?'':admin?'Selecione o polo para consultar os valores.':'Seu acesso está sem polo válido definido. Solicite o vínculo ao administrador antes de simular.'};
}
function catalogWithRegionalCourses(catalog){
 const original=catalog.courses.map(c=>({...c,pricing:null,pricingOptions:[]}));
 const used=new Set(catalog.courses.flatMap(c=>[c.pricing?.code,...(c.pricingOptions||[]).map(o=>o.code)]).filter(Boolean));
 for(const table of DATA.tables.filter(t=>t.region===6))for(const row of table.rows){
  if(row.code&&used.has(row.code))continue;
  const key=rowCode(row);
  if(original.some(c=>c.id==='regional-'+key))continue;
  const degree=table.kind==='pos'?'Pós-graduação':table.kind==='tecnico'?'Técnico':/^Licenciatura/i.test(row.name)?'Licenciatura':/^Bacharelado/i.test(row.name)?'Bacharelado':/^Superior/i.test(row.name)?'Tecnólogo':'Graduação';
  original.push({id:'regional-'+key,name:row.name,modalidade:table.kind==='semi'?'semipresencial':'ead',grau:degree,area:table.kind==='pos'?'Pós-graduação':table.kind==='tecnico'?'Cursos técnicos':'Graduação',duracao:row.months?row.months+' meses':'',resumo:'Curso presente na tabela oficial de valores de 25/11/2026. Consulte a oferta e a matriz aplicável antes da matrícula.',academicSource:false,regionalKind:table.kind,regionalCode:key,pricing:null,pricingOptions:[]});
 }
 return original;
}
function snapshot(db,actor,requested,catalog){
 const context=actorContext(db,actor,requested),courses=catalogWithRegionalCourses(catalog),tables=TABLES.filter(t=>t.region===context.region);
 const sourceById=new Map(catalog.courses.map(c=>[c.id,c]));
 for(const c of courses){
  const source=sourceById.get(c.id),codes=new Set([source?.pricing?.code,...(source?.pricingOptions||[]).map(o=>o.code),c.regionalCode].filter(Boolean));
  for(const table of tables)for(const code of codes){
   const row=table.index.get(code);if(!row)continue;
   c.pricingOptions.push({code,name:row.name,price:row.price,punctual:row.punctual,degree:c.grau,modalidade:c.modalidade,region:table.region,process:table.process,year:table.year,months:row.months,installments:row.installments,sourceDate:table.date,source:context.pole.nome+' · Região '+table.region+' · Processo '+table.process+'/'+table.year+' · 25/11/2026'});
  }
  c.pricing=c.pricingOptions[0]||null;
 }
 return {date:DATA.date,context,courses};
}
module.exports={regionForPole,actorContext,snapshot,catalogWithRegionalCourses};
