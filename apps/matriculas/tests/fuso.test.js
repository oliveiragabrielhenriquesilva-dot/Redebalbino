'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.TZ = 'America/Sao_Paulo';
process.env.MATRICULAS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'matriculas-fuso-'));
const NativeDate = Date;
const { hojeISO } = require('../server.js');

test('hojeISO acompanha a data de Brasília às 23h30', t => {
  const instant = new NativeDate('2026-11-04T02:30:00.000Z');
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
  };
  t.after(() => { global.Date = NativeDate; });
  assert.equal(new Date().getHours(), 23);
  assert.equal(hojeISO(), '2026-11-03');
});
