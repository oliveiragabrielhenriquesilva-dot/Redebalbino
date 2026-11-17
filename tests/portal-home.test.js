'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { entries, access, destination } = require('../public/catalogo');
test('home preserva cinco destinos externos e inclui calendário interno e não inclui o Chat', () => {
  assert.equal(entries.filter(e => e.external).length, 5);
  assert.equal(entries.some(e => /chat/i.test(e.key + e.title)), false);
  for (const e of entries.filter(e => e.external)) { assert.match(e.icon, /^<svg /); assert.equal(e.image, undefined); assert.ok(new URL(e.href)); }
  assert.equal(entries.length, 9);
  const calendar=entries.find(e=>e.key==='calendario');assert.equal(calendar.href,'/conecta/#calendario-academico');assert.equal(access(calendar,null),'login');assert.equal(access(calendar,{apps:[]}), 'allowed');
  for (const key of ['whatsapp','relatorios','artes','manuais','chat']) assert.equal(entries.some(e => e.key === key), false);
});
test('login e permissões se aplicam também aos atalhos de relatórios', () => {
  for (const key of ['matriculas', 'oportunidades']) {
    const entry = entries.find(e => e.key === key);
    assert.equal(access(entry, null), 'login');
    assert.equal(access(entry, { apps: [] }), 'forbidden');
    assert.equal(access(entry, { apps: ['matriculas'] }), 'allowed');
    assert.equal(access(entry, { apps: ['matriculas'], mustChangePassword: true }), 'password');
  }
  assert.equal(access(entries.find(e => e.key === 'conecta'), { apps: [] }), 'allowed');
});
test('retorno do login conserva relatório e rejeita outros destinos', () => {
  const origin = 'https://redebalbino.com.br';
  assert.equal(destination('/conecta/#curso=administracao', origin), '/conecta/#curso=administracao');
  assert.equal(destination('/oportunidades/?contato=sem', origin), '/oportunidades/?contato=sem');
  for (const target of ['https://outro.test/matriculas/', '//outro.test/informa/', 'javascript:alert(1)', '/chat/', '/matriculas-falso/', '/artes/']) assert.equal(destination(target, origin), null);
});

test('ordem salva filtra atalhos removidos e acrescenta novos sem duplicar',()=>{
 const {normalizeOrder}=require('../public/catalogo');
 const order=normalizeOrder(['studeo','chat','studeo','matriculas','inexistente']);
 assert.deepEqual(order.slice(0,2),['studeo','matriculas']); assert.equal(order.length,9); assert.equal(new Set(order).size,9);
 assert.deepEqual(normalizeOrder(null),entries.map(e=>e.key));
});

