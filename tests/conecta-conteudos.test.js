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
 const original={...semi('Nutrição'),aoVivo:'Orientação existente'};assert.match(enrichCourse(original).aoVivo,/Orientação existente/);assert.match(enrichCourse(original).frequencia,/75%/);assert.equal(distributionContent(original),'');
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

const {enrichBlocks,TRAINING,appliesTraining,PED}=require('../apps/conecta/public/conteudos');
test('treinamento esclarece simultaneidade, frequência e oferta sem prometer turnos',()=>{
 const c=enrichCourse(semi('Pedagogia','Licenciatura'));
 assert.match(c.resumo,/concomitante/);assert.match(c.sincronas,/75%/);assert.match(c.sincronas,/não precisa ir ao polo/);assert.match(c.sincronas,/não recuperam faltas/);assert.match(c.sincronas,/pode existir apenas uma opção/);
 assert.doesNotMatch(c.frequencia,/não define um percentual/);assert.match(c.aoVivo,/ficam gravadas/);assert.match(c.aoVivo,/Aulas conceituais/);assert.match(c.presencialTeorico,/roteiro/);assert.match(c.particularidades,/5ª semana do módulo seguinte/);
});
test('SUB pendente e transição substituem regras antigas sem criar novos tópicos',()=>{
 const input=Array.from({length:10},(_,i)=>({id:'b'+(i+1),title:'Tópico '+i,body:'antigo'})),copy=JSON.stringify(input),blocks=enrichBlocks(input);
 assert.equal(blocks.length,10);assert.equal(JSON.stringify(input),copy);assert.deepEqual(blocks.map(b=>b.title),input.map(b=>b.title));
 assert.match(blocks[5].body,/ainda estavam em definição/);assert.doesNotMatch(blocks[5].body,/Agendamento: 4ª/);assert.match(blocks[3].body,/Não há uma semana fixa/);assert.match(blocks[2].body,/digitada pelo próprio aluno/);assert.match(blocks[2].body,/Semana de Conhecimentos Gerais/);assert.match(blocks[7].body,/não envie o material restrito/);assert.match(blocks[0].body,/plano de transição/);
 assert.deepEqual(enrichBlocks(blocks),blocks);
});
test('treinamento não se estende a técnicos, pós ou modalidade desconhecida',()=>{
 for(const c of [{name:'Técnico em Segurança do Trabalho',modalidade:'ead'},{name:'MBA',nivel:'Pós-graduação',modalidade:'ead'},{name:'Curso',modalidade:'naoinformada'}]){assert.equal(appliesTraining(c),false);assert.deepEqual(enrichCourse(c),c);}
 assert.equal(appliesTraining({name:'Automação Industrial',grau:'Tecnólogo',modalidade:'semipresencial'}),true);
});
test('grade específica preservada e janela de provas atualizada',()=>{
 const before=JSON.stringify(PED.grupos);const html=distributionContent(semi('Farmácia'));assert.match(html,/Semanas 9 e 10 · conforme agendamento/);assert.equal(JSON.stringify(PED.grupos),before);
 const industrial=enrichCourse(semi('Automação Industrial','Tecnólogo'));assert.match(industrial.aoVivo,/Não há aulas ao vivo indicadas/);assert.doesNotMatch(industrial.aoVivo,/Anos em que a atividade está prevista/);
});
test('catálogo inteiro preserva preço e argumentário e elimina o detalhamento EaD inconsistente',()=>{
 const zlib=require('node:zlib'),dir=path.join(__dirname,'../apps/conecta/data'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));const catalog=JSON.parse(zlib.gunzipSync(Buffer.from(m.parts.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join(''),'base64')));
 for(const original of catalog.courses){const before=JSON.stringify(original),c=enrichCourse(original);assert.equal(JSON.stringify(original),before);assert.equal(c.pricing,original.pricing);assert.equal(c.argumentario,original.argumentario);if(appliesTraining(c)){assert.match(c.resumo,/concomitante/);assert.match(c.particularidades,/5ª semana/);assert.doesNotMatch(c.resumo,/10% \(5% em carga horária de prova e 15% de extensão\)/);}}
});
