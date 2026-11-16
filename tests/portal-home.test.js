'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { entries, access, destination } = require('../public/catalogo');
test('home preserva os sete destinos externos e não inclui o Chat', () => {
  assert.equal(entries.filter(e => e.external).length, 7);
  assert.equal(entries.some(e => /chat/i.test(e.key + e.title)), false);
  for (const e of entries.filter(e => e.external)) { assert.match(e.image, /^data:image\/webp;base64,/); assert.ok(new URL(e.href)); }
  assert.equal(entries.find(e => e.key === 'artes').disabled, true);
  assert.equal(entries.find(e => e.key === 'manuais').href, null);
});
test('login e permissões se aplicam também aos atalhos de relatórios', () => {
  for (const key of ['matriculas', 'oportunidades', 'relatorios']) {
    const entry = entries.find(e => e.key === key);
    assert.equal(access(entry, null), 'login');
    assert.equal(access(entry, { apps: [] }), 'forbidden');
    assert.equal(access(entry, { apps: ['matriculas'] }), 'allowed');
    assert.equal(access(entry, { apps: ['matriculas'], mustChangePassword: true }), 'password');
  }
  assert.equal(access(entries.find(e => e.key === 'informa'), { apps: [] }), 'allowed');
});
test('retorno do login conserva relatório e rejeita outros destinos', () => {
  const origin = 'https://redebalbino.com.br';
  assert.equal(destination('/matriculas/#/relatorios', origin), '/matriculas/#/relatorios');
  assert.equal(destination('/oportunidades/?contato=sem', origin), '/oportunidades/?contato=sem');
  for (const target of ['https://outro.test/matriculas/', '//outro.test/informa/', 'javascript:alert(1)', '/chat/', '/matriculas-falso/', '/artes/']) assert.equal(destination(target, origin), null);
});
