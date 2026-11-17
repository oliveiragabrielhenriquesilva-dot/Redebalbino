'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {render}=require('../apps/matriculas/public/graficos');
test('gráficos preservam valores, metas ausentes e dados escapados',()=>{
 const html=render({usaMeta:true,porPolo:[{nome:'Franca <teste>',qtd:12,meta:10},{nome:'Itapira',qtd:0,meta:null}],porProduto:[],porDia:[{data:'2026-11-17',qtd:7},{data:'2026-11-16',qtd:5}]});
 assert.match(html,/Franca &lt;teste&gt;/);assert.match(html,/12 realizada\(s\) de 10 da meta/);assert.match(html,/sem meta cadastrada/);assert.match(html,/width:100%/);assert.match(html,/120%/);assert.match(html,/meta superada/);
 assert.ok(html.indexOf('16/11/2026')<html.indexOf('17/11/2026'));assert.doesNotMatch(html,/NaN|Infinity|undefined/);
});
test('filtros sem comparação não desenham metas e recorte vazio é explícito',()=>{
 const html=render({usaMeta:false,porPolo:[{nome:'Polo',qtd:5,meta:99}],porProduto:[],porDia:[]});
 assert.doesNotMatch(html,/rb-chart-target/);assert.match(html,/Nenhuma matrícula confirmada/);assert.match(html,/Sem dados neste recorte/);
});
