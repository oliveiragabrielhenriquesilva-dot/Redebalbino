'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../apps/oportunidades/public/requests');
const response=value=>({ok:true,status:200,json:async()=>value});
function controlled(){const calls=[];const fetcher=(url,options)=>new Promise((resolve,reject)=>{const call={url,options,resolve,reject};calls.push(call);options.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelada','AbortError')),{once:true});});return {calls,fetcher};}
test('consultas iguais em andamento usam uma única requisição',async()=>{
 const c=controlled(),api=create({fetcher:c.fetcher});const a=api.json('/painel?produto=1'),b=api.json('/painel?produto=1');assert.equal(a,b);assert.equal(c.calls.length,1);c.calls[0].resolve(response({total:3}));assert.deepEqual(await b,{total:3});
});
test('troca de filtro cancela leitura antiga e conserva a resposta nova',async()=>{
 const c=controlled(),api=create({fetcher:c.fetcher});const a=api.json('/painel?polo=1');const rejected=assert.rejects(a,{name:'AbortError'});const b=api.json('/painel?polo=2');assert.equal(c.calls[0].options.signal.aborted,true);c.calls[1].resolve(response({polo:2}));assert.deepEqual(await b,{polo:2});await rejected;
});
test('detalhes de candidatos diferentes substituem a consulta anterior',async()=>{
 const c=controlled(),api=create({fetcher:c.fetcher});const a=api.json('/api/oportunidades/1');const rejected=assert.rejects(a,{name:'AbortError'});const b=api.json('/api/oportunidades/2');c.calls[1].resolve(response({id:2}));assert.equal((await b).id,2);await rejected;
});
test('timeout limita apenas leitura; gravações não são reenviadas',async()=>{
 const c=controlled(),api=create({fetcher:c.fetcher,timeoutMs:5});await assert.rejects(api.json('/painel'),{name:'TimeoutError'});
 const save=api.json('/lead',{method:'PUT',body:'{}'});assert.equal(c.calls[1].options.signal,undefined);c.calls[1].resolve(response({ok:true}));await save;assert.equal(c.calls.length,2);
});
test('HTML carrega o gerenciador de requisições antes da aplicação',()=>{
 const fs=require('node:fs'),path=require('node:path');const html=fs.readFileSync(path.join(__dirname,'../apps/oportunidades/public/index.html'),'utf8');assert.ok(html.indexOf('/oportunidades/requests.js')>0);assert.ok(html.indexOf('/oportunidades/requests.js')<html.indexOf('/oportunidades/app.js'));
});
