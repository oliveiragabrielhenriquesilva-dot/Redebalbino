'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {matchCourse,enrichCourse,distributionContent,referralPage,FAQ}=require('../apps/conecta/public/conteudos');
const semi=(name,grau='Bacharelado')=>({id:'test',name,grau,modalidade:'semipresencial'});
test('vínculo distingue formação, modalidade e segunda licenciatura',()=>{
 assert.equal(matchCourse(semi('Educação Física','Licenciatura')).grupo.nome,'Licenciaturas');assert.equal(matchCourse(semi('Educação Física')).grupo.nome,'Educação Física');
 assert.equal(matchCourse({...semi('Engenharia de Software'),modalidade:'ead'}).ead,true);assert.equal(matchCourse(semi('História','Segunda Licenciatura')),null);
 assert.equal(matchCourse(semi('Letras Português – Inglês','Licenciatura')).grupo.anos,5);assert.equal(matchCourse(semi('Nutrição')),null);
});
test('preenche campos existentes preservando dados originais sem mutar o catálogo',()=>{
 const original={...semi('Engenharia Civil'),resumo:'Resumo atual',laboratorio:'Laboratório existente',pricing:{price:100}};const c=enrichCourse(original);
 assert.match(c.resumo,/Resumo atual/);assert.match(c.resumo,/Modelo semipresencial/);assert.match(c.aoVivo,/Teams/);assert.match(c.sincronas,/3 horas/);assert.match(c.presencialTeorico,/agendamento/);assert.match(c.laboratorio,/Laboratório existente/);assert.match(c.particularidades,/TCC/);assert.match(c.frequencia,/registro de frequência/);assert.equal(original.resumo,'Resumo atual');assert.equal(original.sincronas,undefined);assert.equal(c.pricing,original.pricing);
});
test('distribuição usa quadros do próprio curso e sinaliza anos sem informação',()=>{
 const farm=enrichCourse(semi('Farmácia'));assert.match(farm.particularidades,/estágio curricular supervisionado/);
 assert.match(distributionContent(farm),/Não há quadro semanal específico/);assert.match(distributionContent(semi('Psicopedagogia')),/Não há quadro semanal específico/);
 const original={...semi('Nutrição'),aoVivo:'Orientação existente'};assert.deepEqual(enrichCourse(original),original);assert.equal(distributionContent(original),'');
});
test('exceções EAD não recebem aulas ao vivo; HTML escapa conteúdo',()=>{
 const c={name:'Ciência da Criatividade',modalidade:'ead'};assert.match(enrichCourse(c).aoVivo,/não há aulas ao vivo/);assert.doesNotMatch(distributionContent(c),/<td>Aulas ao vivo<\/td>/);
 assert.match(distributionContent({...semi('Engenharia Civil'),name:'Engenharia Civil'}),/Polo de Apoio/);
});
test('FAQ mantém elegibilidade, pagamento e distinção da campanha interna',()=>{
 const html=referralPage();assert.equal(FAQ.length,17);for(const text of ['R$100','segunda mensalidade','7 dias úteis','5%','14h','dia 25','dia 10','titularidade','SOCIEDADE EDUCACIONAL LEONARDO DA VINCI LTDA','colaboradores'])assert(html.toLowerCase().includes(text.toLowerCase()),text);
 assert.match(html,/distinto das campanhas internas/);assert.match(html,/99439-7722/);assert.match(html,/não informa uma data de vigência/);
});
test('não cria menu, card, seção ou aba pedagógica: conteúdo ocupa os tópicos existentes',()=>{
 const base=path.join(__dirname,'../'),html=fs.readFileSync(base+'apps/conecta/public/index.html','utf8'),app=fs.readFileSync(base+'apps/conecta/public/app.js','utf8');
 assert.doesNotMatch(html,/data-mode="pedagogy"|id="pedagogicalHub"/);assert.doesNotMatch(app,/panels.push\(\['pedagogico'/);assert.match(app,/BalbinoConteudos.enrichCourse\(original\)/);assert.match(app,/key==='distribuicao'\?window.BalbinoConteudos.distributionContent/);
 for(const title of ['Sobre o curso','Aulas e práticas','Frequência e particularidades','Regras gerais de 2027'])assert(app.includes(title));assert.match(html,/data-mode="referral"/);
 assert(html.indexOf('/conecta/conteudos.js')<html.indexOf('/conecta/app.js'));assert.match(fs.readFileSync(base+'server.js','utf8'),/\['\/conteudos.js', \['conteudos.js'/);
});
