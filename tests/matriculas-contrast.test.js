'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../apps/matriculas/public/contraste.css'), 'utf8');
function palette(selector) {
  const i = css.indexOf(selector);
  assert.ok(i >= 0, 'Paleta não encontrada: ' + selector);
  const block = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
}
function luminance(hex) {
  const c = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function contrast(a,b) {
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for (const [name,selector] of [
  ['claro','html:not([data-tema="escuro"])'],
  ['escuro','html[data-tema="escuro"]'],
  ['papel','html[data-tema] .rel .rel-pagina {']
]) {
  test('contraste de textos, avisos e controles na paleta '+name, () => {
    const p=palette(selector);
    const pairs=[];
    for(const fg of ['--text','--text-2','--text-3','--accent'])for(const bg of ['--surface','--surface-2','--bg'])pairs.push([fg,bg]);
    pairs.push(['--accent-ink','--accent'],['--info-ink','--accent-soft'],['--accent','--accent-soft'],['--ok','--ok-soft'],['--warn','--warn-soft'],['--bad','--bad-soft'],['--purple','--purple-soft']);
    for(const [fg,bg] of pairs)assert.ok(contrast(p[fg],p[bg])>=4.5, name+': '+fg+' / '+bg);
    assert.ok(contrast(p['--line-strong'],p['--field'])>=3, 'Borda dos campos deve permanecer visível');
  });
}
