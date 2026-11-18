'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {matchCourse,courseContent,referralPage,pedagogicalHub,FAQ}=require('../apps/conecta/public/conteudos');
const semi=(name,grau='Bacharelado')=>({id:'test',name,grau,modalidade:'semipresencial'});
test('vínculo por modalidade e formação separa Educação Física, EAD e segunda licenciatura',()=>{
 assert.equal(matchCourse(semi('Educação Física','Licenciatura')).grupo.nome,'Licenciaturas');
 assert.equal(matchCourse(semi('Educação Física')).grupo.nome,'Educação Física');
 assert.equal(matchCourse({...semi('Engenharia de Software'),modalidade:'ead'}).ead,true);
 assert.equal(matchCourse(semi('História','Segunda Licenciatura')),null);
 assert.equal(matchCourse(semi('Letras Português – Inglês','Licenciatura')).grupo.anos,5);
 assert.equal(matchCourse(semi('Nutrição')),null);
});
test('jornadas preservam quadros por ano sem preencher semanas ausentes de outro curso',()=>{
 const farmacia=courseContent(semi('Farmácia'));
 assert.match(farmacia,/uma disciplina de estágio curricular supervisionado/i);
 assert.match(farmacia,/Não há quadro semanal específico deste ano/);
 assert.match(courseContent(semi('Engenharia Civil')),/encontro presencial adicional de 3 horas/);
 assert.match(courseContent(semi('Psicopedagogia')),/Não há quadro semanal específico/);
 const desconhecido=courseContent(semi('Nutrição'));assert.match(desconhecido,/não contém um quadro específico/);assert.doesNotMatch(desconhecido,/Semanas 1, 2, 3/);
});
test('exceções EAD não recebem aulas ao vivo; conteúdo escapa nomes',()=>{
 const c={name:'Ciência da Criatividade',modalidade:'ead'};
 assert.match(courseContent(c),/não há aulas ao vivo/);
 assert.doesNotMatch(courseContent(c),/<td>Aulas ao vivo<\/td>/);
 assert.match(courseContent({...c,name:'<img src=x onerror=alert(1)>'}),/&lt;img/);
});
test('FAQ inclui elegibilidade, segunda mensalidade, saque e distinção da campanha interna',()=>{
 const html=referralPage();assert.equal(FAQ.length,17);
 for(const text of ['R$100','segunda mensalidade','7 dias úteis','5%','14h','dia 25','dia 10','titularidade','SOCIEDADE EDUCACIONAL LEONARDO DA VINCI LTDA','não permite','colaboradores'])assert(html.toLowerCase().includes(text.toLowerCase()),text);
 assert.match(html,/distinto das campanhas internas/);assert.match(html,/99439-7722/);
 assert.match(html,/não informa uma data de vigência/);
});
test('busca e acesso por curso apontam para a aba pedagógica, sem confundir modalidades',()=>{
 const h=pedagogicalHub([semi('Educação Física'),{...semi('Marketing'),id:'c18',modalidade:'ead'}]);
 assert.match(h,/#curso=c18&aba=pedagogico/);assert.match(h,/data-learning-search/);
});
test('conteúdo tem rota autorizada e script carrega antes da aplicação',()=>{
 const base=path.join(__dirname,'../');const html=fs.readFileSync(base+'apps/conecta/public/index.html','utf8');
 assert(html.indexOf('/conecta/conteudos.js')<html.indexOf('/conecta/app.js'));
 const app=fs.readFileSync(base+'apps/conecta/public/app.js','utf8');
 assert.match(app,/params.get\('aba'\)==='pedagogico'/);assert.match(app,/#eu-indico/);assert.match(app,/#conexao-pedagogica/);
 const gateway=fs.readFileSync(base+'server.js','utf8');assert.match(gateway,/\['\/conteudos.js', \['conteudos.js'/);
});
