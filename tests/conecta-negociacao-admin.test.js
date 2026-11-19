'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const create=require('../apps/conecta/negociacao');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-policy-'));fs.mkdirSync(path.join(dir,'matriculas'));const file=path.join(dir,'matriculas','matriculas.db'),db=new DatabaseSync(file);
db.exec(`CREATE TABLE config(chave TEXT PRIMARY KEY,valor TEXT);CREATE TABLE produtos(id INTEGER PRIMARY KEY,nome TEXT,ativo INTEGER,ordem INTEGER);CREATE TABLE ma_lista_cursos(curso_cod TEXT,curso_nome TEXT,produto_id INTEGER);CREATE TABLE cursos(nome TEXT,apelidos TEXT,produto_id INTEGER,ativo INTEGER);INSERT INTO produtos VALUES(1,'Graduação',1,1),(2,'Semi - Licenciatura',1,2),(3,'Semi - Bacharel em Educação Física',1,3),(4,'Pós',0,4);INSERT INTO ma_lista_cursos VALUES('ESPRE_PED','Pedagogia',2),('ESPRE_BEDU','Educação Física',3);`);
const catalog={courses:[{id:'a',name:'Administração',modalidade:'ead'},{id:'p',name:'Pedagogia',modalidade:'semipresencial',grau:'Licenciatura',pricing:{code:'ESPRE_PED'}},{id:'e',name:'Educação Física',modalidade:'semipresencial',grau:'Bacharelado',pricing:{code:'ESPRE_BEDU'}},{id:'u',name:'Sem vínculo',modalidade:'semipresencial'}]};
const service=create(db,catalog),admin={id:1,name:'Administrador',is_admin:true};
const payload=()=>{const s=service.snapshot();return {revision:s.revision,products:{1:3500,2:4000,3:0},courses:{u:2},messageTemplate:s.messageTemplate};};
test('usa produtos existentes e códigos cadastrados; curso desconhecido não recebe padrão',()=>{const s=service.snapshot();assert.equal(s.products.length,4);assert.equal(s.courses.find(c=>c.id==='p').productId,2);assert.equal(s.courses.find(c=>c.id==='e').productId,3);assert.equal(s.courses.find(c=>c.id==='u').productId,null);assert.equal(s.products[0].discountBps,null);});
test('salva percentuais e modelo com persistência central; zero é diferente de sem padrão',()=>{const body=payload();body.messageTemplate='Olá, {curso}! Mensalidade: {mensalidade}. Pontualidade: {pontualidade}%.';const s=service.save(body,admin);assert.equal(s.products.find(p=>p.id===3).discountBps,0);assert.equal(s.courses.find(c=>c.id==='u').productId,2);const second=new DatabaseSync(file);assert.equal(create(second,catalog).snapshot().messageTemplate,body.messageTemplate);second.close();});
test('bloqueia não administrador, produto inativo, percentual inválido, campo desconhecido e versão antiga',()=>{
 assert.throws(()=>service.save(payload(),{is_admin:false}),e=>e.status===403);
 for(const body of [{...payload(),products:{1:10001}},{...payload(),products:{4:4000}},{...payload(),courses:{u:999}},{...payload(),messageTemplate:'{campo_inexistente}'}])assert.throws(()=>service.save(body,admin),e=>e.status===400);
 assert.throws(()=>service.save({...payload(),revision:'old'},admin),e=>e.status===409);
});
test('rota real exige sessão, protege gravação por papel e origem; permite consulta autenticada',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');const ctx={URL,DatabaseSync,fs,path,RUNTIME:dir,portal:{current:req=>req.actor},sameOrigin:req=>!req.headers.origin||new URL(req.headers.origin).host===req.headers.host,readJson:async req=>req.body,readConectaData:()=>Buffer.from(JSON.stringify(catalog)),jsonReply:(_res,status,data)=>({status,data}),require:p=>{assert.equal(p,'./apps/conecta/negociacao');return create;}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function portalApi('),source.indexOf('const INFORMA_FILES')),ctx);
 const call=(method,actor,body,origin='https://redebalbino.com.br')=>ctx.portalApi({method,actor,body,headers:{host:'redebalbino.com.br',origin}},{},new URL('https://redebalbino.com.br/api/portal/conecta-negociacao'));
 assert.equal((await call('GET',null)).status,401);assert.equal((await call('GET',{is_admin:false})).status,200);assert.equal((await call('PUT',{is_admin:false},payload())).status,403);assert.equal((await call('PUT',admin,payload(),'https://other.example')).status,403);assert.equal((await call('PUT',admin,payload())).status,200);
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
