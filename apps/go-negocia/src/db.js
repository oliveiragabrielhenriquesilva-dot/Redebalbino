import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as m001 from '../migrations/001_base.js';

export const MIGRACOES = [m001];

let banco = null;

export function abrirBanco(arquivo) {
  if (banco) banco.close();
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  banco = new DatabaseSync(arquivo, { timeout: 5000 });
  banco.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  banco.exec('CREATE TABLE IF NOT EXISTS schema_migracoes(id TEXT PRIMARY KEY, aplicada_em INTEGER NOT NULL) STRICT;');
  return banco;
}

export function db() {
  if (!banco) throw new Error('Banco não aberto');
  return banco;
}

export function fecharBanco() { if (banco) { banco.close(); banco = null; } }

export function migracoesAplicadas() {
  return db().prepare('SELECT id FROM schema_migracoes ORDER BY id').all().map(r => r.id);
}

export function migrar() {
  const feitas = new Set(migracoesAplicadas());
  const novas = [];
  for (const m of MIGRACOES) {
    if (feitas.has(m.id)) continue;
    transacao(() => {
      db().exec(m.up);
      db().prepare('INSERT INTO schema_migracoes(id, aplicada_em) VALUES(?, ?)').run(m.id, Date.now());
    });
    novas.push(m.id);
  }
  return novas;
}

export function reverterUltima() {
  const feitas = migracoesAplicadas();
  const ultima = feitas[feitas.length - 1];
  if (!ultima) return null;
  const m = MIGRACOES.find(x => x.id === ultima);
  transacao(() => {
    db().exec('PRAGMA foreign_keys=OFF;');
    db().exec(m.down);
    db().prepare('DELETE FROM schema_migracoes WHERE id=?').run(ultima);
  });
  db().exec('PRAGMA foreign_keys=ON;');
  return ultima;
}

let profundidade = 0;
export function transacao(fn) {
  const d = db();
  if (profundidade > 0) return fn();
  d.exec('BEGIN IMMEDIATE');
  profundidade++;
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* já revertido */ }
    throw e;
  } finally {
    profundidade--;
  }
}

export function novoId(prefixo) { return `${prefixo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`; }

export function um(sql, ...p) { return db().prepare(sql).get(...p) || null; }
export function varios(sql, ...p) { return db().prepare(sql).all(...p); }
export function executar(sql, ...p) { return db().prepare(sql).run(...p); }

export function auditar({ usuarioId = null, organizacaoId = null, acao, alvoTipo = null, alvoId = null, detalhes = null }) {
  executar('INSERT INTO auditoria(em, usuario_id, organizacao_id, acao, alvo_tipo, alvo_id, detalhes) VALUES(?,?,?,?,?,?,?)',
    Date.now(), usuarioId, organizacaoId, acao, alvoTipo, alvoId, detalhes == null ? null : JSON.stringify(detalhes));
}
