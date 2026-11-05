'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const COOKIE = 'balbino.sid';
const SESSION_MS = 12 * 60 * 60 * 1000;
const APP_KEYS = new Set(['matriculas', 'artes', 'chat']);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function passwordMatches(password, salt, hash) {
  try {
    const actual = Buffer.from(hashPassword(password, salt).hash, 'hex');
    const expected = Buffer.from(String(hash || ''), 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function parseJSON(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function cleanApps(apps) {
  return [...new Set((Array.isArray(apps) ? apps : []).filter(app => APP_KEYS.has(app)))];
}
function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    apps: cleanApps(parseJSON(row.apps_json, [])),
    accounts: parseJSON(row.accounts_json, {}),
    isAdmin: Boolean(row.is_admin),
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password)
  };
}
function cookieValue(req) {
  for (const item of String(req.headers.cookie || '').split(';')) {
    const at = item.indexOf('=');
    if (at < 0) continue;
    if (item.slice(0, at).trim() === COOKIE) return decodeURIComponent(item.slice(at + 1).trim());
  }
  return '';
}
function safeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function createPortalAuth(runtimeDir, env = process.env) {
  const dir = path.join(runtimeDir, 'portal');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dbFile = path.join(dir, 'portal.db');
  const db = new DatabaseSync(dbFile);
  try { fs.chmodSync(dbFile, 0o600); } catch {}
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      apps_json TEXT NOT NULL DEFAULT '[]',
      accounts_json TEXT NOT NULL DEFAULT '{}',
      is_admin INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  `);

  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  if (!userColumns.has('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  const total = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  let bootstrap = { configured: true, created: false };
  if (!total) {
    const username = safeUsername(env.CENTRAL_ADMIN_USERNAME || env.GOCHAT_ADMIN_USER || 'admin');
    const password = String(env.CENTRAL_ADMIN_PASSWORD || env.GOCHAT_ADMIN_PASSWORD || '');
    if (!password || password.length < 12) {
      bootstrap = { configured: false, created: false };
    } else {
      const { salt, hash } = hashPassword(password);
      const now = Date.now();
      db.prepare(`INSERT INTO users
        (id,name,username,password_salt,password_hash,apps_json,accounts_json,is_admin,active,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
          crypto.randomUUID(), 'Administrador', username, salt, hash,
          JSON.stringify(['matriculas', 'artes', 'chat']),
          JSON.stringify({ matriculas: '@admin', chat: 'admin' }), 1, 1, now, now
        );
      bootstrap.created = true;
    }
  }

  const getUserById = db.prepare('SELECT * FROM users WHERE id=?');
  const getUserByName = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE');
  function publicUser(row) {
    const user = sanitizeUser(row);
    if (!user) return null;
    delete user.accounts;
    return user;
  }
  function findSession(req) {
    const token = cookieValue(req);
    if (!token) return null;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=? AND s.expires_at>? AND u.active=1`).get(token, Date.now());
    if (!row) db.prepare('DELETE FROM sessions WHERE token=? OR expires_at<=?').run(token, Date.now());
    return row || null;
  }
  function sessionCookie(token, req, maxAge = SESSION_MS / 1000) {
    const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  function login(username, password, req) {
    const row = getUserByName.get(safeUsername(username));
    if (!row || !row.active || !passwordMatches(password, row.password_salt, row.password_hash)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, row.id, Date.now() + SESSION_MS);
    return { user: publicUser(row), cookie: sessionCookie(token, req) };
  }
  function logout(req) {
    const token = cookieValue(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return sessionCookie('', req, 0);
  }
  function current(req) { return findSession(req); }
  function forApp(req, app) {
    const row = findSession(req);
    if (!row) return { status: 'unauthenticated', user: null };
    const user = sanitizeUser(row);
    if (user.mustChangePassword) return { status: 'password_change_required', user };
    if (!user.apps.includes(app) && !(user.isAdmin && app === 'chat')) return { status: 'forbidden', user };
    const account = user.isAdmin && app === 'chat' ? '@admin' : (user.accounts[app] || (user.isAdmin && app === 'matriculas' ? '@admin' : user.username));
    return { status: 'allowed', user, account };
  }
  function listUsers() {
    return db.prepare('SELECT * FROM users ORDER BY is_admin DESC, name COLLATE NOCASE').all().map(sanitizeUser);
  }
  function createUser(input) {
    const name = String(input.name || '').trim().slice(0, 100);
    const username = safeUsername(input.username);
    const password = String(input.password || '');
    const apps = cleanApps(input.apps);
    const accounts = {
      ...(apps.includes('matriculas') ? { matriculas: String(input.matriculasLogin || '').trim().slice(0, 100) } : {}),
      ...(apps.includes('chat') ? { chat: String(input.chatUsername || '').trim().slice(0, 100) } : {})
    };
    if (!name || !/^[a-z0-9._-]{2,80}$/.test(username)) throw new Error('Informe nome e usuário (2 a 80 caracteres: letras, números, ponto, hífen ou sublinhado).');
    if (password.length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres.');
    if (!apps.length) throw new Error('Selecione pelo menos um sistema.');
    if (apps.includes('matriculas') && !accounts.matriculas) throw new Error('Informe o login que essa pessoa já usa no Matrículas.');
    if (apps.includes('chat') && !accounts.chat) throw new Error('Informe o usuário que essa pessoa já usa no Balbino Chat.');
    const { salt, hash } = hashPassword(password), now = Date.now(), id = crypto.randomUUID();
    db.prepare(`INSERT INTO users
      (id,name,username,password_salt,password_hash,apps_json,accounts_json,is_admin,active,must_change_password,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, name, username, salt, hash, JSON.stringify(apps), JSON.stringify(accounts), 0, 1, 1, now, now);
    return sanitizeUser(getUserById.get(id));
  }
  function createTutorUsers(tutors, password) {
    if (!String(password || '')) throw new Error('Informe a senha inicial dos tutores.');
    if (!Array.isArray(tutors) || !tutors.length) throw new Error('Nenhum tutor ativo disponível para provisionar.');
    const existingRows = db.prepare('SELECT * FROM users').all();
    const existingByAccount = new Map();
    for (const row of existingRows) {
      const account = parseJSON(row.accounts_json, {}).matriculas;
      if (account) existingByAccount.set(account, row);
    }
    const prepared = tutors.map(tutor => {
      const name = String(tutor.name || '').trim().slice(0, 100);
      const username = safeUsername(tutor.username);
      const account = `@tutor:${Number(tutor.tutorId)}`;
      if (!name || !Number.isInteger(Number(tutor.tutorId)) || Number(tutor.tutorId) < 1 || !/^[a-z0-9._-]{2,80}$/.test(username)) {
        throw new Error('A lista contém um tutor com dados inválidos.');
      }
      return { name, username, account, existing: existingByAccount.get(account) || null };
    });
    const newRows = prepared.filter(row => !row.existing);
    const names = new Set();
    for (const row of newRows) {
      if (names.has(row.username)) throw new Error(`O login ${row.username} aparece mais de uma vez na lista.`);
      names.add(row.username);
      const collision = getUserByName.get(row.username);
      if (collision) throw new Error(`O login ${row.username} já pertence a outra conta do portal.`);
    }
    const insert = db.prepare(`INSERT INTO users
      (id,name,username,password_salt,password_hash,apps_json,accounts_json,is_admin,active,must_change_password,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const created = [], existing = [];
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of prepared) {
        if (row.existing) { existing.push({ name: row.name, username: row.existing.username, active: Boolean(row.existing.active) }); continue; }
        const { salt, hash } = hashPassword(password), id = crypto.randomUUID();
        insert.run(id, row.name, row.username, salt, hash,
          JSON.stringify(['matriculas']), JSON.stringify({ matriculas: row.account }), 0, 1, 1, now, now);
        created.push({ name: row.name, username: row.username });
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return { created, existing };
  }
  function updateUser(id, input, actorId) {
    const row = getUserById.get(id);
    if (!row) throw new Error('Usuário não encontrado.');
    const name = String(input.name || '').trim().slice(0, 100);
    const apps = cleanApps(input.apps);
    const accounts = {
      ...(apps.includes('matriculas') ? { matriculas: String(input.matriculasLogin || '').trim().slice(0, 100) } : {}),
      ...(apps.includes('chat') ? { chat: String(input.chatUsername || '').trim().slice(0, 100) } : {})
    };
    if (!name) throw new Error('Informe o nome.');
    if (!apps.length && row.is_admin) throw new Error('O administrador deve manter acesso a pelo menos um sistema.');
    if (apps.includes('matriculas') && !accounts.matriculas) throw new Error('Informe o login que essa pessoa já usa no Matrículas.');
    if (apps.includes('chat') && !accounts.chat) throw new Error('Informe o usuário que essa pessoa já usa no Balbino Chat.');
    if (row.is_admin && id === actorId) throw new Error('As permissões do administrador principal não podem ser alteradas aqui.');
    db.prepare('UPDATE users SET name=?,apps_json=?,accounts_json=?,updated_at=? WHERE id=?').run(name, JSON.stringify(apps), JSON.stringify(accounts), Date.now(), id);
    return sanitizeUser(getUserById.get(id));
  }
  function changePassword(id, password) {
    if (String(password || '').length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres.');
    const { salt, hash } = hashPassword(password);
    db.prepare('UPDATE users SET password_salt=?,password_hash=?,must_change_password=1,updated_at=? WHERE id=?').run(salt, hash, Date.now(), id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  function changeOwnPassword(req, currentPassword, newPassword) {
    const row = findSession(req);
    if (!row || !passwordMatches(currentPassword, row.password_salt, row.password_hash)) throw new Error('A senha atual está incorreta.');
    if (String(newPassword || '').length < 12) throw new Error('A nova senha precisa ter pelo menos 12 caracteres.');
    if (passwordMatches(newPassword, row.password_salt, row.password_hash)) throw new Error('A nova senha deve ser diferente da atual.');
    const { salt, hash } = hashPassword(newPassword), token = cookieValue(req), now = Date.now();
    db.prepare('UPDATE users SET password_salt=?,password_hash=?,must_change_password=0,updated_at=? WHERE id=?').run(salt, hash, now, row.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(row.id, token);
    db.prepare('UPDATE sessions SET expires_at=? WHERE token=? AND user_id=?').run(now + SESSION_MS, token, row.id);
  }
  function setActive(id, active, actorId) {
    const target = getUserById.get(id);
    if (!target) throw new Error('Usuário não encontrado.');
    if (id === actorId) throw new Error('Não é possível desativar a própria conta.');
    if (target.is_admin && !active) {
      const admins = db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin=1 AND active=1').get().n;
      if (admins <= 1) throw new Error('Mantenha pelo menos um administrador ativo.');
    }
    db.prepare('UPDATE users SET active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, Date.now(), id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return sanitizeUser(getUserById.get(id));
  }

  return { db, bootstrap, login, logout, current, forApp, publicUser, listUsers, createUser, createTutorUsers, updateUser, changePassword, changeOwnPassword, setActive, sessionCookie };
}

module.exports = { createPortalAuth };
