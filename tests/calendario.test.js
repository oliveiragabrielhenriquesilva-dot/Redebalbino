'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DATA,events,status}=require('../apps/conecta/public/calendario');
test('calendário contém apenas o módulo 54 e mantém prazos distintos de 5 e 10 semanas',()=>{
 assert.equal(DATA.module,'54/2026');assert.equal(events(5).length,25);assert.equal(events(10).length,16);
 const five=events(5),ten=events(10);
 const first=five.find(e=>e.id==='prova-1');assert.equal(first.start,'2026-10-26');assert.equal(first.end,'2026-10-31');assert.equal(first.discipline,'1ª disciplina');
 const second=five.find(e=>e.id==='prova-2');assert.equal(second.start,'2026-11-30');assert.equal(second.end,'2026-12-05');
 assert.equal(ten.find(e=>e.id==='prova').start,'2026-11-30');assert.equal(ten.some(e=>e.discipline==='1ª disciplina'),false);
 assert.equal(five.find(e=>e.id==='notas-sub-1').start,'2026-12-22');assert.equal(five.find(e=>e.id==='notas-sub-2').start,'2027-02-08');
 assert.equal(ten.find(e=>e.id==='copia-sub').end,'2027-02-16');
 for(const e of [...five,...ten]){assert.match(e.start,/^202[67]-\d\d-\d\d$/);assert.ok(e.end>=e.start);assert.equal(new Date(e.start+'T12:00:00Z').toISOString().slice(0,10),e.start);}
});
test('estado de um prazo inclui os dias de abertura e encerramento',()=>{
 const event={start:'2026-11-23',end:'2026-12-04'};
 assert.equal(status(event,'2026-11-22'),'Próximo');assert.equal(status(event,'2026-11-23'),'Em andamento');assert.equal(status(event,'2026-12-04'),'Em andamento');assert.equal(status(event,'2026-12-05'),'Encerrado');
});
test('navegação mostra módulo antes de abrir seu conteúdo e alterna duração',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const nodes=new Map();const box={innerHTML:'',querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',value:'',textContent:'',focus(){}});return nodes.get(selector)}};
 const location={hash:'#calendario-academico'};const context={Intl,Date,location,history:{replaceState(_a,_b,hash){location.hash=hash}}};context.globalThis=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps/conecta/public/calendario.js'),'utf8'),context);
 context.BalbinoCalendar.mount(box);assert.match(box.innerHTML,/Consultar datas/);assert.doesNotMatch(box.innerHTML,/role="tablist"/);
 context.BalbinoCalendar.route('#calendario-academico/54-2026');assert.match(box.innerHTML,/role="tablist"/);assert.match(box.innerHTML,/1ª e da 2ª disciplina/);assert.match(nodes.get('#cal-events').innerHTML,/26\/10\/2026/);
 box.onclick({target:{closest:()=>({dataset:{calWeeks:'10'}})}});assert.equal(location.hash,'#calendario-academico/54-2026/10-semanas');assert.match(box.innerHTML,/Prazos das disciplinas com duração de 10 semanas/);assert.doesNotMatch(nodes.get('#cal-events').innerHTML,/26\/10\/2026/);
});
