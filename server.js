'use strict'; process.env.TZ = 'America/Sao_Paulo';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { createPortalAuth } = require('./portal-auth');
const homeCatalog = require('./public/catalogo');

try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch {}
// Chat suspenso nesta hospedagem: não importar módulos nem iniciar conexões/rotinas.
process.env.BALBINO_CHAT_DISABLED = '1';
const ROOT = __dirname;
const RUNTIME = path.resolve(process.env.BALBINO_RUNTIME_DIR || path.join(os.homedir(), 'central-balbino-runtime'));
const portal = createPortalAuth(RUNTIME);
const PORT = Number(process.env.PORT || 3000);
const apps = [
  { key: 'chat', prefix: '/chat', server: null, status: 'disabled', error: null },
  { key: 'matriculas', prefix: '/matriculas', server: null, status: 'starting', error: null }
];

function walkForDatabase(root, filename, depth = 0, out = []) {
  if (!fs.existsSync(root) || depth > 5) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'backups' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === filename) out.push(full);
    else if (entry.isDirectory()) walkForDatabase(full, filename, depth + 1, out);
  }
  return out;
}
function inspectDatabase(file, kind) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    if (kind === 'matriculas' && tables.has('ciclos') && tables.has('matriculas')) {
      return { cycles: db.prepare('SELECT COUNT(*) n FROM ciclos').get().n, enrollments: db.prepare('SELECT COUNT(*) n FROM matriculas').get().n };
    }
    if (kind === 'artes' && tables.has('tipos') && tables.has('cursos')) {
      return { types: db.prepare('SELECT COUNT(*) n FROM tipos').get().n, courses: db.prepare('SELECT COUNT(*) n FROM cursos').get().n, poles: tables.has('polos') ? db.prepare('SELECT COUNT(*) n FROM polos').get().n : 0 };
    }
  } catch {}
  finally { db?.close(); }
  return null;
}
function recoverNestedDatabase(dir, filename, kind) {
  const destination = path.join(dir, filename);
  const current = fs.existsSync(destination) ? inspectDatabase(destination, kind) : null;
  const appDataRoot = path.join(ROOT, 'apps', kind);
  const candidates = [...new Set([...walkForDatabase(dir, filename), ...walkForDatabase(appDataRoot, filename)])]
    .filter(file => path.resolve(file) !== path.resolve(destination));
  const rows = candidates.map(file => ({ file, stats: inspectDatabase(file, kind) })).filter(x => x.stats);
  const score = s => kind === 'matriculas' ? (s.cycles * 1_000_000_000 + s.enrollments) : (s.courses * 1_000_000 + s.types * 1_000 + s.poles);
  const meaningful = s => kind === 'matriculas' ? s.cycles > 0 : s.courses > 0;
  rows.sort((a, b) => score(b.stats) - score(a.stats));
  const best = rows[0];
  if (!best || !meaningful(best.stats) || score(best.stats) <= score(current || (kind === 'matriculas' ? { cycles: 0, enrollments: 0 } : { types: 0, courses: 0, poles: 0 }))) {
    return { recovered: false, stats: current };
  }
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${filename}.${process.pid}.recovered`);
  const source = new DatabaseSync(best.file);
  try { source.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`); }
  finally { source.close(); }
  if (fs.existsSync(destination)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(dir, `before-auto-recovery-${stamp}-${filename}`);
    fs.copyFileSync(destination, backup);
  }
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(destination + ext)) fs.renameSync(destination + ext, `${destination + ext}.before-auto-recovery`);
  fs.renameSync(temp, destination);
  if (kind === 'artes') {
    const nestedData = path.dirname(best.file);
    for (const name of ['artes', 'fotos']) {
      const from = path.join(nestedData, name), to = path.join(dir, name);
      if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, errorOnExist: false, force: false });
    }
  }
  console.log(`[${kind}] banco recuperado de subpasta; ${JSON.stringify(best.stats)}.`);
  return { recovered: true, stats: best.stats };
}
function prepareRuntime() {
  const dir=path.join(RUNTIME,'matriculas');
  fs.mkdirSync(dir,{recursive:true});
  recoverNestedDatabase(dir,'matriculas.db','matriculas');
}
async function startApps() {
  prepareRuntime();
  process.env.NODE_ENV = 'production';
  process.env.HOSTED = '1';
  process.env.CENTRAL_BALBINO_EMBEDDED = '1';
  process.env.MATRICULAS_DATA_DIR = path.join(RUNTIME, 'matriculas');

  const portOriginal = process.env.PORT;
  process.env.BALBINO_CHAT_URL = `http://127.0.0.1:${portOriginal || 3000}/chat`;
  try {
    const boot = async (key, action) => {
      const app = apps.find(a => a.key === key);
      try { await action(app); app.status = 'ready'; }
      catch (error) { app.status = 'error'; app.error = error; console.error(`[${key}] falha ao iniciar:`, error.stack || error.message); }
    };
    console.log('[chat] Balbino Chat desativado; sem conexões ou rotinas nesta hospedagem.');
    await boot('matriculas', async app => {
      process.env.PORT = '3111';
      const mod = require(path.join(ROOT, 'apps', 'matriculas', 'server.js'));
      app.server = mod.servidor; mod.iniciarRotinasHospedadas();
      const stats = inspectDatabase(path.join(RUNTIME, 'matriculas', 'matriculas.db'), 'matriculas');
      console.log(`[matriculas] banco ativo: ${JSON.stringify(stats || { erro: 'estrutura não reconhecida' })}`);
    });
  } finally {
    if (portOriginal == null) delete process.env.PORT;
    else process.env.PORT = portOriginal;
  }
}
let shuttingDown = false;
async function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => {
    console.error('[gateway] encerramento excedeu 20 segundos; forçando saída.');
    process.exit(1);
  }, 20000);
  forceExit.unref();
  try {
    await Promise.allSettled(apps.filter(app => app.shutdown).map(app => Promise.resolve().then(() => app.shutdown(signal, false))));
    await new Promise(resolve => {
      if (!server.listening) return resolve();
      server.close(resolve);
    });
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

function rewriteText(body, prefix) {
  let text = body.toString('utf8');
  const inScope = value => /^(?:api|assets|artes|fotos|uploads|style\.css|app\.js|gestao\.js|conciliacao\.js|whatsapp\.js|planilha\.js|balbino-chat(?:-[^/]+)?|favicon(?:-[^/]+)?|apple-touch-icon\.png)(?=\/|[?#]|$)/i.test(value);
  text = text.replace(/(["'`])\/(?!\/)([^"'`\\\s]*)/g, (match, quote, value) => inScope(value) ? `${quote}${prefix}/${value}` : match);
  text = text.replace(/url\(\s*(['"]?)\/(?!\/)([^)'"\s]*)/gi, (match, quote, value) => inScope(value) ? `url(${quote}${prefix}/${value}` : match);
  return Buffer.from(text, 'utf8');
}
function isText(type = '') {
  return /text\/(html|css|javascript|plain)|application\/(javascript|json|manifest\+json)|image\/svg\+xml/i.test(type);
}
function headersObject(input) {
  const out = {};
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 2) out[String(input[i]).toLowerCase()] = input[i + 1];
  } else if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) out[key.toLowerCase()] = value;
  }
  return out;
}
function prefixHeaders(headers, prefix) {
  if (headers.location && headers.location.startsWith('/')) headers.location = prefix + headers.location;
  if (headers['set-cookie']) {
    const cookies = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']];
    headers['set-cookie'] = cookies.map(cookie => String(cookie).replace(/;\s*Path=\/(?=;|$)/i, `; Path=${prefix}/`));
  }
  return headers;
}
function mountResponse(req, res, app) {
  const writeHead = res.writeHead.bind(res), write = res.write.bind(res), end = res.end.bind(res);
  const buffered = [];
  let mode = null, statusCode = res.statusCode || 200, statusMessage = null, responseHeaders = {};
  const setMode = headers => {
    const type = String(headers['content-type'] || res.getHeader('content-type') || '');
    mode = isText(type) && !/text\/event-stream/i.test(type) && req.method !== 'HEAD' ? 'buffer' : 'passthrough';
  };
  const saveChunk = (chunk, encoding) => {
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') buffered.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
  };
  const callWriteCallback = (encoding, callback) => {
    const cb = typeof encoding === 'function' ? encoding : callback;
    if (typeof cb === 'function') process.nextTick(cb);
  };
  res.writeHead = function(code, messageOrHeaders, maybeHeaders) {
    statusCode = code;
    statusMessage = typeof messageOrHeaders === 'string' ? messageOrHeaders : null;
    const supplied = typeof messageOrHeaders === 'string' ? maybeHeaders : messageOrHeaders;
    responseHeaders = { ...headersObject(res.getHeaders()), ...headersObject(supplied) };
    setMode(responseHeaders);
    if (mode === 'buffer') { res.statusCode = statusCode; return res; }
    prefixHeaders(responseHeaders, app.prefix);
    return statusMessage ? writeHead(statusCode, statusMessage, responseHeaders) : writeHead(statusCode, responseHeaders);
  };
  res.write = function(chunk, encoding, callback) {
    if (!mode) { responseHeaders = headersObject(res.getHeaders()); setMode(responseHeaders); }
    if (mode !== 'buffer') return write(chunk, encoding, callback);
    saveChunk(chunk, encoding); callWriteCallback(encoding, callback); return true;
  };
  res.end = function(chunk, encoding, callback) {
    if (!mode) { responseHeaders = headersObject(res.getHeaders()); statusCode = res.statusCode || 200; setMode(responseHeaders); }
    if (mode !== 'buffer') return end(chunk, encoding, callback);
    saveChunk(chunk, encoding);
    const out = rewriteText(Buffer.concat(buffered), app.prefix);
    const headers = prefixHeaders({ ...responseHeaders, ...headersObject(res.getHeaders()) }, app.prefix);
    delete headers['content-length']; delete headers['transfer-encoding']; delete headers.etag;
    headers['content-length'] = String(out.length);
    if (statusMessage) writeHead(statusCode, statusMessage, headers); else writeHead(statusCode, headers);
    const cb = typeof encoding === 'function' ? encoding : callback;
    return cb ? end(out, cb) : end(out);
  };
}
function proxy(req, res, app, originalUrl) {
  if (!app.server) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`O sistema ${app.key} ainda está iniciando.`); return; }
  const originalUrlValue = req.url;
  const sourceIp = clientIp(req);
  req.url = originalUrl || '/';
  req.headers['accept-encoding'] = 'identity';
  req.headers['x-forwarded-prefix'] = app.prefix;
  req.headers['x-forwarded-host'] = req.headers.host || 'redebalbino.com.br';
  req.headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';
  req.headers['x-forwarded-for'] = sourceIp;
  const access = portal.forApp(req, app.key);
  req.headers['x-balbino-portal'] = access.status === 'allowed' ? JSON.stringify({ app: app.key, id: access.user.id, name: access.user.name, username: access.user.username, account: access.account }) : '';
  mountResponse(req, res, app);
  app.server.emit('request', req, res);
  req.url = originalUrlValue;
}

function jsonReply(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

const informaFonte = require('./apps/informa/fonte').criarFonte(RUNTIME);
// Balbino Informa: somente leitura, dados do Calendário Administrativo Unicesumar (ver apps/informa/fonte.js).
async function informaApi(req, res, url) {
  if (!['/api/informa/calendario', '/api/informa/marco'].includes(url.pathname)) return jsonReply(res, 404, { error: 'Endpoint não encontrado.' });
  const user = portal.current(req);
  if (!user) return jsonReply(res, 401, { error: 'Entre no portal para consultar o Balbino Informa.' });
  if (user.must_change_password) return jsonReply(res, 403, { error: 'Defina sua nova senha no Portal para continuar.' });
  if (req.method !== 'GET') return jsonReply(res, 405, { error: 'Método não permitido.' }, { Allow: 'GET' });
  // Marco Regulatório 51/2027: conteúdo em arquivo de dados (apps/informa/marco-regulatorio-51-2027.json).
  if (url.pathname === '/api/informa/marco') {
    try { return jsonReply(res, 200, JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'informa', 'marco-regulatorio-51-2027.json'), 'utf8'))); }
    catch (error) { return jsonReply(res, 500, { error: 'Não foi possível ler o Marco Regulatório: ' + error.message }); }
  }
  try { return jsonReply(res, 200, await informaFonte.calendario({ forcar: url.searchParams.get('atualizar') === '1' && Boolean(user.is_admin) })); }
  catch (error) { return jsonReply(res, 500, { error: 'Não foi possível montar o calendário: ' + error.message }); }
}

function tutorUsername(name, polo) {
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const first = normalized(name).split(/\s+/)[0] || '';
  const place = normalized(polo);
  if (first === 'larissa' && place.includes('ribeirao preto')) return 'larissa.maria';
  if (first === 'larissa' && place.includes('ituverava')) return 'larissa.paula';
  return normalized(name).replace(/\s+/g, '.');
}
function readTutorRoster() {
  const file = path.join(RUNTIME, 'matriculas', 'matriculas.db');
  if (!fs.existsSync(file)) throw Object.assign(new Error('O banco de Matrículas ainda não está disponível.'), { status: 503 });
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT t.id tutorId, t.nome, t.polo_origem_id origemId,
        tp.polo_id poloId, p.nome polo
      FROM tutores t
      LEFT JOIN tutor_polos tp ON tp.tutor_id=t.id
      LEFT JOIN polos p ON p.id=tp.polo_id
      WHERE t.ativo=1 ORDER BY t.nome COLLATE NOCASE, t.id, p.nome COLLATE NOCASE`).all();
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.tutorId)) grouped.set(row.tutorId, { id: row.tutorId, name: row.nome, origemId: row.origemId, polos: [] });
      if (row.poloId) grouped.get(row.tutorId).polos.push({ id: row.poloId, name: row.polo });
    }
    return [...grouped.values()].map(tutor => {
      const origin = tutor.polos.find(polo => Number(polo.id) === Number(tutor.origemId));
      const polo = origin || (tutor.polos.length === 1 ? tutor.polos[0] : null);
      if (!polo) return { id: tutor.id, name: tutor.name, polo: tutor.polos.map(item => item.name).join(', ') || 'Sem polo', username: '', error: 'Tutor vinculado a mais de um polo sem polo de origem definido.' };
      const name = tutor.name === 'Larissa' && polo.name === 'Ituverava' ? 'Larissa Paula' :
        (String(tutor.name).replace(/[.\s]+$/g, '') === 'Larissa' && polo.name === 'Ribeirão Preto' ? 'Larissa Maria' : tutor.name);
      return { id: tutor.id, name, polo: polo.name, username: tutorUsername(tutor.name, polo.name) };
    });
  } finally { db.close(); }
}
async function readJson(req, max = 64 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw Object.assign(new Error('Requisição muito grande.'), { status: 413 }); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (String(req.headers['content-type'] || '').toLowerCase().includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers.host || '').toLowerCase(); } catch { return false; }
}
const loginAttempts = new Map();
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const throughProxy = Boolean(req.headers['x-forwarded-proto'] || req.headers['x-forwarded-host']);
  return throughProxy && forwarded ? forwarded : (req.socket.remoteAddress || 'unknown');
}
function loginCounter(key, now) {
  const value = loginAttempts.get(key);
  if (!value || value.until <= now) return { count: 0, until: now + 15 * 60 * 1000 };
  return value;
}
function pruneLoginAttempts(now) {
  for (const [key, value] of loginAttempts) if (value.until <= now) loginAttempts.delete(key);
}
function blockedLogin(ip, username, now) {
  pruneLoginAttempts(now);
  return loginCounter(`user:${username}`, now).count >= 5 || loginCounter(`ip:${ip}`, now).count >= 30;
}
function recordLoginFailure(ip, username, now) {
  for (const key of [`user:${username}`, `ip:${ip}`]) {
    const entry = loginCounter(key, now); entry.count++; loginAttempts.set(key, entry);
  }
}
async function portalApi(req, res, url) {
  const method = req.method, p = url.pathname;
  if (method === 'GET' && p === '/api/portal/me') {
    const row = portal.current(req);
    return jsonReply(res, 200, { configured: portal.bootstrap.configured, user: row ? portal.publicUser(row) : null });
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !sameOrigin(req)) return jsonReply(res, 403, { error: 'Origem da solicitação inválida.' });
  if (method === 'POST' && p === '/api/portal/login') {
    const body = await readJson(req), ip = clientIp(req), now = Date.now();
    const formPost = String(req.headers['content-type'] || '').toLowerCase().includes('application/x-www-form-urlencoded');
    const username = String(body.username || '').trim().toLowerCase().slice(0, 100) || '(vazio)';
    if (blockedLogin(ip, username, now)) return jsonReply(res, 401, { error: 'Usuário ou senha inválidos.' });
    const result = portal.login(body.username, body.password, req);
    if (!result) {
      recordLoginFailure(ip, username, now);
      if (formPost) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Falha no acesso</title><body><h1>Usuário ou senha inválidos.</h1><p><a href="/">Voltar ao Portal e tentar novamente</a></p></body></html>');
      }
      return jsonReply(res, 401, { error: 'Usuário ou senha inválidos.' });
    }
    loginAttempts.delete(`user:${username}`);
    if (formPost) {
      const targetValue = String(body.next || '');
      let target = '/';
      try {
        const parsed = new URL(targetValue, 'http://gateway.local');
        if (parsed.origin === 'http://gateway.local' && /^\/(?:matriculas|oportunidades|informa|conecta)(?:\/|$)/.test(parsed.pathname)) {
          target = parsed.pathname + parsed.search + parsed.hash;
        }
      } catch {}
      res.writeHead(303, { Location: target, 'Set-Cookie': result.cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return res.end();
    }
    return jsonReply(res, 200, { user: result.user }, { 'Set-Cookie': result.cookie });
  }
  if (method === 'POST' && p === '/api/portal/logout') return jsonReply(res, 200, { ok: true }, { 'Set-Cookie': portal.logout(req) });
  const actor = portal.current(req);
  if (!actor) return jsonReply(res, 401, { error: 'Entre no portal para continuar.' });
  if (method === 'POST' && p === '/api/portal/password') {
    try { const body = await readJson(req); portal.changeOwnPassword(req, body.currentPassword, body.password); return jsonReply(res, 200, { ok: true }); }
    catch (error) { return jsonReply(res, 400, { error: error.message }); }
  }
  if (actor.must_change_password) return jsonReply(res, 403, { error: 'Defina sua nova senha para continuar.' });
  if (method === 'GET' && p === '/api/portal/preferences') return jsonReply(res, 200, portal.getPreferences(actor.id));
  if (method === 'PUT' && p === '/api/portal/preferences') {
    const body = await readJson(req), order = body.homeOrder;
    const valid = new Set(homeCatalog.entries.map(entry => entry.key));
    if (!Array.isArray(order) || order.length > valid.size || order.some(key => typeof key !== 'string' || !valid.has(key)) || new Set(order).size !== order.length) return jsonReply(res, 400, { error: 'Ordem de atalhos inválida.' });
    return jsonReply(res, 200, portal.setHomeOrder(actor.id, homeCatalog.normalizeOrder(order)));
  }
  if (!actor.is_admin) return jsonReply(res, 403, { error: 'Acesso restrito ao administrador.' });
  if (method === 'GET' && p === '/api/portal/users') return jsonReply(res, 200, { users: portal.listUsers() });
  if (method === 'GET' && p === '/api/portal/tutor-users/preview') {
    try { return jsonReply(res, 200, { tutors: readTutorRoster() }); }
    catch (error) { return jsonReply(res, error.status || 500, { error: error.message }); }
  }
  if (method === 'POST' && p === '/api/portal/tutor-users') {
    try {
      const body = await readJson(req);
      const tutors = readTutorRoster();
      const blocked = tutors.filter(tutor => tutor.error || !tutor.username);
      if (blocked.length) return jsonReply(res, 409, { error: `Revise os vínculos de polo antes de criar os acessos: ${blocked.map(tutor => tutor.name).join(', ')}.` });
      const result = portal.createTutorUsers(tutors.map(tutor => ({ tutorId: tutor.id, name: tutor.name, username: tutor.username })), body.password);
      return jsonReply(res, 201, result);
    } catch (error) { return jsonReply(res, error.message.includes('UNIQUE') ? 409 : (error.status || 400), { error: error.message.includes('UNIQUE') ? 'Há um login duplicado no portal.' : error.message }); }
  }
  if (method === 'POST' && p === '/api/portal/users') {
    try { return jsonReply(res, 201, { user: portal.publicUser(portal.createUser(await readJson(req))) }); }
    catch (error) { return jsonReply(res, error.message.includes('UNIQUE') ? 409 : 400, { error: error.message.includes('UNIQUE') ? 'Esse usuário já existe.' : error.message }); }
  }
  let match = p.match(/^\/api\/portal\/users\/([a-f0-9-]+)$/i);
  if (method === 'PUT' && match) {
    try { const user = portal.updateUser(match[1], await readJson(req), actor.id); return jsonReply(res, 200, { user: portal.publicUser(user) }); }
    catch (error) { return jsonReply(res, error.message.includes('UNIQUE') ? 409 : 400, { error: error.message }); }
  }
  match = p.match(/^\/api\/portal\/users\/([a-f0-9-]+)\/(password|active)$/i);
  if (method === 'POST' && match) {
    const [, id, action] = match, body = await readJson(req);
    try {
      if (action === 'password') portal.changePassword(id, body.password);
      else portal.setActive(id, body.active, actor.id);
      return jsonReply(res, 200, { ok: true });
    } catch (error) { return jsonReply(res, 400, { error: error.message }); }
  }
  return jsonReply(res, 404, { error: 'Endpoint não encontrado.' });
}

const INFORMA_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/style.css', 'style.css']
]);
function serveInforma(req, res, url) {
  const currentUser = portal.current(req);
  if (!currentUser || currentUser.must_change_password) {
    res.writeHead(302, { Location: '/?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (url.pathname === '/informa') {
    res.writeHead(308, { Location: '/informa/' + url.search, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const relative = url.pathname.slice('/informa'.length) || '/';
  const fileName = INFORMA_FILES.get(relative);
  if (!fileName) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Arquivo não encontrado.');
  }
  const content = fs.readFileSync(path.join(ROOT, 'apps', 'informa', 'public', fileName));
  const types = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8' };
  res.writeHead(200, {
    'Content-Type': types[fileName],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  return req.method === 'HEAD' ? res.end() : res.end(content);
}

const CONECTA_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/dados.json', ['dados.json', 'application/json; charset=utf-8']]
]);
let conectaDataBuffer;
function readConectaData() {
  if (!conectaDataBuffer) {
    const dir = path.join(ROOT, 'apps/conecta/data');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const payload = manifest.parts.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('');
    conectaDataBuffer = require('node:zlib').gunzipSync(Buffer.from(payload, 'base64'));
  }
  return conectaDataBuffer;
}
function serveConecta(req, res, url) {
  const user = portal.current(req);
  if (!user || user.must_change_password) {
    if (url.pathname.endsWith('.json') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) return jsonReply(res, user ? 403 : 401, { error: user ? 'Defina sua nova senha no Portal.' : 'Entre no Portal para consultar o Conecta.' });
    res.writeHead(302, { Location: '/?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' }); return res.end();
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (url.pathname === '/conecta') { res.writeHead(308, { Location: '/conecta/' + url.search }); return res.end(); }
  const file = CONECTA_FILES.get(url.pathname.slice('/conecta'.length));
  if (!file) return jsonReply(res, 404, { error: 'Arquivo não encontrado.' });
  const content = file[0] === 'dados.json' ? readConectaData() : fs.readFileSync(path.join(ROOT, 'apps/conecta/public', file[0]));
  res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
  return req.method === 'HEAD' ? res.end() : res.end(content);
}

const server = http.createServer((req, res) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  const url = new URL(req.url || '/', 'http://gateway.local');
  // Credenciais em query string nunca autenticam. Remova-as antes de servir páginas,
  // APIs ou redirecionamentos para evitar que permaneçam na barra e em referers.
  const sensitiveQueryKey = /^(?:user(?:name)?|login|email|password|passwd|pass|senha|token|access_token|secret|credential)$/i;
  const exposedKeys = [...url.searchParams.keys()].filter(key => sensitiveQueryKey.test(key));
  if (exposedKeys.length) {
    for (const key of exposedKeys) url.searchParams.delete(key);
    res.writeHead(303, {
      Location: url.pathname + url.search,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    });
    return res.end();
  }
  if (url.pathname.startsWith('/api/informa/')) {
    informaApi(req, res, url).catch(error => jsonReply(res, 500, { error: error.message || 'Falha ao consultar o calendário.' }));
    return;
  }
  if (url.pathname.startsWith('/api/portal/')) {
    portalApi(req, res, url).catch(error => jsonReply(res, error.status || 400, { error: error.message || 'Falha ao processar a solicitação.' }));
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const appHealth = apps.map(app => {
      const result = {
        name: app.key, status: app.status, loaded: Boolean(app.server),
        ...(app.error ? { error: String(app.error.message || app.error).replace(/\/home\/[^\s:'\"]+/g, '[caminho]').slice(0, 240) } : {})
      };
      if (app.health) {
        try { result.health = app.health(); }
        catch { result.health = { status: 'unavailable' }; }
      }
      return result;
    });
    return res.end(JSON.stringify({ ok: appHealth.every(app => app.status === 'disabled' || (app.status === 'ready' && app.loaded)), apps: appHealth }));
  }
  if (url.pathname === '/chat' || url.pathname.startsWith('/chat/')) return res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Balbino Chat desativado nesta hospedagem.');
  if (url.pathname === '/conecta' || url.pathname.startsWith('/conecta/')) return serveConecta(req, res, url);
  if (url.pathname === '/informa' || url.pathname.startsWith('/informa/')) return serveInforma(req, res, url);
  if (url.pathname === '/artes' || url.pathname.startsWith('/artes/')) return res.writeHead(410, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' }).end('Gerador de Artes está temporariamente desativado.');
  if (url.pathname === '/oportunidades' || url.pathname.startsWith('/oportunidades/')) {
    const access=portal.forApp(req,'matriculas');
    if(access.status!=='allowed'){
      if(url.pathname.includes('/api/')||access.status==='forbidden'||access.status==='password_change_required')return jsonReply(res,access.status==='unauthenticated'?401:403,{error:access.status==='password_change_required'?'Defina sua nova senha no Portal para continuar.':access.status==='forbidden'?'Seu acesso não inclui Matrículas.':'Entre no portal para continuar.'});
      res.writeHead(302,{Location:`/?next=${encodeURIComponent(url.pathname+url.search)}`,'Cache-Control':'no-store'});return res.end();
    }
    if(url.pathname==='/oportunidades'){res.writeHead(308,{Location:'/oportunidades/'+url.search});return res.end()}
    const base=apps.find(a=>a.key==='matriculas');
    const alias={...base,prefix:'/oportunidades'};
    if(url.pathname.startsWith('/oportunidades/api/')){
      if(!base?.server)return jsonReply(res,503,{error:'Sistema de Matrículas ainda está iniciando.'});
      return proxy(req,res,alias,url.pathname.slice('/oportunidades'.length)+url.search);
    }
    const files={'/oportunidades/':['index.html','text/html; charset=utf-8'],'/oportunidades/index.html':['index.html','text/html; charset=utf-8'],'/oportunidades/app.js':['app.js','text/javascript; charset=utf-8'],'/oportunidades/style.css':['style.css','text/css; charset=utf-8']};
    const asset=files[url.pathname];
    if(!asset)return res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Arquivo não encontrado.');
    const content=fs.readFileSync(path.join(ROOT,'apps','oportunidades','public',asset[0]));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    return res.end(content);
  }
  const brandAssets = {
    '/brand/rede-balbino-simbolo.svg': 'rede-balbino-simbolo.svg',
    '/brand/rede-balbino-claro.svg': 'rede-balbino-claro.svg',
    '/brand/rede-balbino-branco.svg': 'rede-balbino-branco.svg',
    '/brand/rede-balbino-branco.webp': 'rede-balbino-branco.webp',
    '/brand/monograma-rede-balbino.webp': 'monograma-rede-balbino.webp',
    '/brand/monograma-rede-balbino-branco.webp': 'monograma-rede-balbino-branco.webp'
  };
  if (url.pathname === '/brand/balbino.css') {
    const content = fs.readFileSync(path.join(ROOT, 'brand', 'balbino.css'));
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(content);
  }
  if (brandAssets[url.pathname]) {
    const content = fs.readFileSync(path.join(ROOT, 'brand', brandAssets[url.pathname]));
    res.writeHead(200, { 'Content-Type': brandAssets[url.pathname].endsWith('.svg') ? 'image/svg+xml' : 'image/webp', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return res.end(content);
  }
  const app = apps.find(a => url.pathname === a.prefix || url.pathname.startsWith(a.prefix + '/'));
  if (!app) {
    const portalAssets = { '/': ['portal.html', 'text/html; charset=utf-8'], '/index.html': ['portal.html', 'text/html; charset=utf-8'], '/portal.css': ['portal.css', 'text/css; charset=utf-8'], '/portal.js': ['portal.js', 'text/javascript; charset=utf-8'], '/catalogo.js': ['catalogo.js', 'text/javascript; charset=utf-8'] };
    if (portalAssets[url.pathname]) {
      const [file, type] = portalAssets[url.pathname], content = fs.readFileSync(path.join(ROOT, 'public', file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); return res.end(content);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Caminho não encontrado.');
  }
  if (url.pathname === app.prefix) { res.writeHead(308, { Location: app.prefix + '/' }); return res.end(); }
  const access = portal.forApp(req, app.key);
  const childPath = url.pathname.slice(app.prefix.length) || '/';
  const childMethod = req.method;
  if (app.key === 'matriculas' && ['/api/worker/boas-vindas', '/api/worker/boas-vindas/status'].includes(childPath)) {
    return proxy(req, res, app, childPath + url.search);
  }
  const chatWelcomeApi =
    (childPath === '/api/integracao/ativar-fila' && childMethod === 'POST') ||
    (childPath === '/api/integracao/boas-vindas' && childMethod === 'POST') ||
    (childPath === '/api/integracao/boas-vindas/status' && childMethod === 'GET') ||
    (childPath === '/api/integracao/saude' && childMethod === 'GET');
  if (app.key === 'chat' && chatWelcomeApi) return proxy(req, res, app, childPath + url.search);
  const isNativeLogout = (app.key === 'matriculas' && childPath === '/api/logout' && childMethod === 'POST') ||
    (app.key === 'artes' && childPath === '/api/sair' && childMethod === 'POST') ||
    (app.key === 'chat' && childPath === '/api/auth/logout' && childMethod === 'POST');
  if (isNativeLogout) return jsonReply(res, 200, { ok: true }, { 'Set-Cookie': portal.logout(req) });
  if (access.status !== 'allowed') {
    if (url.pathname.includes('/api/')) return jsonReply(res, access.status === 'unauthenticated' ? 401 : 403, { error: access.status === 'password_change_required' ? 'Defina sua nova senha no Portal para continuar.' : access.status === 'forbidden' ? 'Seu acesso não inclui este sistema.' : 'Entre no portal para continuar.' });
    res.writeHead(302, { Location: `/?next=${encodeURIComponent(`${app.prefix}${url.pathname.slice(app.prefix.length)}${url.search}`)}`, 'Cache-Control': 'no-store' }); return res.end();
  }
  proxy(req, res, app, url.pathname.slice(app.prefix.length) + url.search);
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://gateway.local');
  const app = apps.find(a => url.pathname.startsWith(a.prefix + '/'));
  if (!app || app.status === 'disabled') { socket.destroy(); return; }
  const access = portal.forApp(req, app.key);
  if (access.status !== 'allowed') { socket.write(`HTTP/1.1 ${access.status === 'unauthenticated' ? '401 Unauthorized' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`); socket.destroy(); return; }
  if (!app.server?.listenerCount('upgrade')) { socket.destroy(); return; }
  req.url = url.pathname.slice(app.prefix.length) + url.search;
  req.headers['x-balbino-portal'] = JSON.stringify({ app: app.key, id: access.user.id, name: access.user.name, username: access.user.username, account: access.account });
  app.server.emit('upgrade', req, socket, head);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Central Balbino ativa na porta ${PORT}; caminhos: /matriculas, /oportunidades, /informa`));
startApps().catch(error => {
  console.error('Não foi possível preparar os sistemas:', error);
});
