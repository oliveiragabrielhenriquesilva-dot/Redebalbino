'use strict';
const crypto=require('node:crypto');
const {DEFAULT_MATRIX_MESSAGE,MATRIX_FIELDS}=require('./public/conteudos');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const name=x=>norm(x).replace(/^(graduacao|bacharelado|licenciatura|superior de tecnologia|tecnologo|tecnologia) em /,'').replace(/ (bacharelado|licenciatura)$/,'');
const DEFAULT_MESSAGE=['Olá! 😊 Vamos retomar seu interesse no curso de *{curso}* na UniCesumar:', '', '🎓 *Curso:* {curso}', '📚 *Modalidade:* {modalidade}', '*Formação:* {formacao}', '⏳ *Duração:* {duracao}', '', '💰 *Mensalidade com pagamento até o vencimento: {mensalidade}*', 'Valor calculado com {desconto_negociacao}% de desconto de negociação e, depois, {pontualidade}% de pontualidade sobre o valor já descontado.', '*Sem pontualidade:* {valor_sem_pontualidade}.', '', 'A oferta, a disponibilidade no polo e as condições de ingresso precisam ser confirmadas antes da matrícula.', 'Quer que eu te ajude com os próximos passos?'].join('\n');
const MESSAGE_FIELDS=['curso','modalidade','formacao','duracao','mensalidade','valor_sem_pontualidade','desconto_negociacao','pontualidade'];
module.exports=function(db,catalog){
 const exists=table=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
 const revision=text=>crypto.createHash('sha256').update(text||'').digest('hex');
 function current(){const raw=db.prepare("SELECT valor FROM config WHERE chave='conecta_negociacao'").get()?.valor||'';let value={};try{value=JSON.parse(raw||'{}');}catch{fail(500,'Configuração de negociação inválida.');}return {raw,value};}
 function snapshot(){
  const {raw,value}=current(),products=db.prepare('SELECT id,nome,ativo FROM produtos ORDER BY ordem,nome').all(),active=new Set(products.filter(p=>p.ativo).map(p=>p.id));
  const mapped=exists('ma_lista_cursos')?db.prepare('SELECT curso_cod,curso_nome,produto_id FROM ma_lista_cursos WHERE produto_id IS NOT NULL').all():[];
  const registered=exists('cursos')?db.prepare('SELECT nome,apelidos,produto_id FROM cursos WHERE ativo=1 AND produto_id IS NOT NULL').all():[];
  const resolve=c=>{
   const codes=new Set([c.pricing?.code,...(c.pricingOptions||[]).map(p=>p.code)].filter(Boolean).map(v=>String(v).toUpperCase()));
   const exact=[...new Set(mapped.filter(r=>codes.has(String(r.curso_cod).toUpperCase())&&active.has(r.produto_id)).map(r=>r.produto_id))];if(exact.length===1)return exact[0];if(exact.length>1)return null;
   if(c.modalidade==='ead'){const ead=products.filter(p=>p.ativo&&['graduacao','ead'].includes(norm(p.nome)));return ead.length===1?ead[0].id:null;}
   const degree=norm(c.grau),target=name(c.name),candidates=registered.filter(r=>active.has(r.produto_id)&&[r.nome,...String(r.apelidos||'').split(/[,;\n]/)].some(n=>name(n)===target));
   const ids=[...new Set(candidates.filter(r=>{const label=norm(r.nome+' '+products.find(p=>p.id===r.produto_id)?.nome);if(degree.includes('licenciatura'))return label.includes('licenciatura')&&!label.includes('bacharel');if(degree.includes('bacharel')&&target==='educacao fisica')return label.includes('bacharel');return !label.includes('licenciatura');}).map(r=>r.produto_id))];return ids.length===1?ids[0]:null;
  };
  return {adminPricingRegion:value.adminPricingRegion===3?3:6,matrixMessageTemplate:value.matrixMessageTemplate||DEFAULT_MATRIX_MESSAGE,matrixMessageFields:MATRIX_FIELDS,messageTemplate:value.messageTemplate||DEFAULT_MESSAGE,messageFields:MESSAGE_FIELDS,revision:revision(raw),updatedAt:value.updatedAt||null,updatedBy:value.updatedBy||null,products:products.map(p=>({...p,discountBps:value.products?.[p.id]??null})),courses:catalog.courses.map(c=>{const automatic=resolve(c),override=value.courses?.[c.id],productId=override&&active.has(override)?override:automatic;return {id:c.id,name:c.name,degree:c.grau,modality:c.modalidade,productId,automaticProductId:automatic,override:override||null};})};
 }
 function save(body,actor){
  if(!actor?.is_admin)fail(403,'Apenas administradores podem configurar os descontos.');
  if(!body||typeof body!=='object'||!body.products||typeof body.products!=='object'||Array.isArray(body.products)||!body.courses||typeof body.courses!=='object'||Array.isArray(body.courses))fail(400,'Configuração inválida.');
  if(typeof body.messageTemplate!=='string'||!body.messageTemplate.trim()||body.messageTemplate.length>6000)fail(400,'Informe uma mensagem padrão de até 6.000 caracteres.');
  const invalid=[...body.messageTemplate.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]).filter(k=>!MESSAGE_FIELDS.includes(k));if(invalid.length)fail(400,'Campo de mensagem desconhecido: '+invalid.join(', '));
  const saved=current().value,matrixMessageTemplate=body.matrixMessageTemplate===undefined?(saved.matrixMessageTemplate||DEFAULT_MATRIX_MESSAGE):body.matrixMessageTemplate;
  if(typeof matrixMessageTemplate!=='string'||!matrixMessageTemplate.trim()||matrixMessageTemplate.length>6000)fail(400,'Informe uma mensagem da grade de até 6.000 caracteres.');
  const invalidMatrix=[...matrixMessageTemplate.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]).filter(k=>!MATRIX_FIELDS.includes(k));
  if(invalidMatrix.length)fail(400,'Campo da grade desconhecido: '+invalidMatrix.join(', '));
  if(!matrixMessageTemplate.includes('{grade_curricular}'))fail(400,'Mantenha o campo {grade_curricular} na mensagem da grade.');
  const adminPricingRegion=body.adminPricingRegion===undefined?(saved.adminPricingRegion===3?3:6):body.adminPricingRegion;
  if(![3,6].includes(adminPricingRegion))fail(400,'Tabela administrativa inválida.');
  const before=snapshot(),active=new Set(before.products.filter(p=>p.ativo).map(p=>p.id)),courseIds=new Set(catalog.courses.map(c=>c.id)),products={},courses={};
  for(const [key,value] of Object.entries(body.products)){if(!active.has(Number(key)))fail(400,'Produto não encontrado ou inativo.');if(value===null)continue;if(!Number.isInteger(value)||value<0||value>10000)fail(400,'Informe descontos de 0 a 100%, com até duas casas decimais.');products[key]=value;}
  for(const [key,value] of Object.entries(body.courses)){if(!courseIds.has(key))fail(400,'Curso não encontrado.');if(value===null)continue;if(!Number.isInteger(value)||!active.has(value))fail(400,'Vínculo com produto inválido.');courses[key]=value;}
  db.exec('BEGIN IMMEDIATE');try{const now=current();if(body.revision!==revision(now.raw))fail(409,'Outro administrador alterou a configuração. Reabra a tela para atualizar.');const text=JSON.stringify({adminPricingRegion,matrixMessageTemplate:matrixMessageTemplate.trim(),products,courses,messageTemplate:body.messageTemplate.trim(),updatedAt:new Date().toISOString(),updatedBy:String(actor.name||actor.username||actor.id)});db.prepare("INSERT INTO config(chave,valor) VALUES('conecta_negociacao',?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor").run(text);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return snapshot();
 }
 return {snapshot,save};
};
