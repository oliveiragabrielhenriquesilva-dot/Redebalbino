'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campanhas-'));process.env.MATRICULAS_DATA_DIR=dir;
const {db,premio,resultadoCampanha,salvarCampanha,campanhasRegras:r}=require('../server');
const admin={id:1,login:'admin',papel:'admin'};
db.exec(`INSERT INTO categorias(id,nome) VALUES(901,'Teste'); INSERT INTO produtos(id,nome,categoria_id) VALUES(901,'Grad teste',901),(902,'Pós teste',901); INSERT INTO polos(id,nome) VALUES(901,'Polo A'),(902,'Polo B'); INSERT INTO tutores(id,nome) VALUES(901,'Tutora teste'); INSERT INTO tutor_polos(tutor_id,polo_id) VALUES(901,901),(901,902); INSERT INTO ciclos(id,nome) VALUES(901,'Teste'); INSERT INTO origens(id,nome) VALUES(901,'Digital teste'); INSERT INTO usuarios(id,nome,login,senha_hash,papel) VALUES(901,'Teste','teste','x:y','admin');`);
admin.id=901;
const cfg={faixas:[{qtd:2,valor:30},{qtd:3,valor:75},{qtd:4,valor:100}],adicional:25,validar_elegibilidade:true};
const id=salvarCampanha(null,{nome:'Incentivo teste',inicio:'2026-11-17',fim:'2026-11-17',tipo:'escalonada',produtos:[901],beneficiario:'tutor',config_avancada:cfg},admin);
const get=()=>db.prepare('SELECT * FROM campanhas WHERE id=?').get(id);
for(let n=1;n<=7;n++)db.prepare(`INSERT INTO matriculas(id,ciclo_id,data,polo_id,tutor_id,produto_id,origem_id,aluno,cpf) VALUES(?,901,'2026-11-17',?,901,?,901,?,?)`).run(900+n,n%2?901:902,n===7?902:901,'Aluno '+n,'cpf'+n);
test('todas as faixas e adicional são valores totais por colaborador',()=>{assert.deepEqual(Array.from({length:8},(_,n)=>premio(get(),n).valor),[0,0,30,75,100,125,150,175]);assert.equal(premio({tipo:'escalonada',qtd:4,valor:100,adicional:25},3).valor,0);});
test('pendências aparecem na auditoria sem prêmio; soma entre polos apenas após conferência',()=>{
 let cp=resultadoCampanha(get(),admin,true);assert.equal(cp.total_matriculas,0);assert.equal(cp.matriculas.length,7);assert(cp.matriculas[0].motivos.includes('Número do candidato não informado'));
 for(let n=1;n<=7;n++)r.salvarValidacao(id,900+n,{numero_candidato:'C'+n,atendimento:n===6?'autonoma':'assistida',pagamento:'confirmado',comprovante_ref:'https://example.com/comprovante'},admin);
 cp=resultadoCampanha(get(),admin,true);assert.equal(cp.total_matriculas,5);assert.equal(cp.total_premio,125);assert.equal(cp.ranking.filter(g=>g.qtd).length,1);assert.match(cp.matriculas.find(x=>x.id===906).motivos.join(' '),/100%/);assert.match(cp.matriculas.find(x=>x.id===907).motivos.join(' '),/Produto fora/);
 const scoped=resultadoCampanha(get(),{papel:'visualizador',polo_id:901},true);assert(scoped.matriculas.every(x=>x.polo_destino_id===901));
});
test('pagamento pendente, cancelamento e comprovante ausente impedem contagem',()=>{
 r.salvarValidacao(id,901,{numero_candidato:'C1',atendimento:'assistida',pagamento:'cancelada'},admin);
 const row=resultadoCampanha(get(),admin,true).matriculas.find(x=>x.id===901);assert.equal(row.conta,false);assert(row.motivos.includes('Matrícula cancelada'));assert(row.motivos.includes('Comprovante não anexado ou referenciado'));
 assert.throws(()=>r.salvarValidacao(id,902,{arquivo:{nome:'x.pdf',tipo:'application/pdf',base64:Buffer.from('fake').toString('base64')}},admin),/conteúdo/);
 assert.throws(()=>r.normalizar({config_avancada:{...cfg,faixas:[{qtd:2,valor:30},{qtd:2,valor:75}]},produtos:[901]}),/Faixas/);
 assert.throws(()=>r.normalizar({config_avancada:cfg,produtos:[]}),/produtos/);
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
