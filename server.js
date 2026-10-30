'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch {}
const ROOT = __dirname;
const RUNTIME = path.resolve(process.env.BALBINO_RUNTIME_DIR || path.join(os.homedir(), 'central-balbino-runtime'));
const PORT = Number(process.env.PORT || 3000);
const apps = [
  { key: 'matriculas', prefix: '/matriculas', server: null, status: 'starting' },
  { key: 'artes', prefix: '/artes', server: null, status: 'starting' },
  { key: 'chat', prefix: '/chat', server: null, status: 'starting' }
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
  fs.mkdirSync(RUNTIME, { recursive: true });
  for (const [key, filename] of [['matriculas', 'matriculas.db'], ['artes', 'sistema.db']]) {
    const dir = path.join(RUNTIME, key);
    fs.mkdirSync(dir, { recursive: true });
    recoverNestedDatabase(dir, filename, key);
  }
  for (const part of ['data', 'uploads', 'sessions', 'backups']) fs.mkdirSync(path.join(RUNTIME, 'chat', part), { recursive: true });
}
async function startApps() {
  prepareRuntime();
  process.env.NODE_ENV = 'production';
  process.env.HOSTED = '1';
  process.env.CENTRAL_BALBINO_EMBEDDED = '1';
  process.env.CLOUD_CHROMIUM = '1';
  process.env.ARTES_ADMIN_PASSWORD = process.env.ARTES_ADMIN_PASSWORD || '';
  process.env.GOCHAT_ADMIN_USER = process.env.GOCHAT_ADMIN_USER || 'admin';
  process.env.MATRICULAS_DATA_DIR = path.join(RUNTIME, 'matriculas');
  process.env.ARTES_DATA_DIR = path.join(RUNTIME, 'artes');
  process.env.BALBINO_RUNTIME_DIR = path.join(RUNTIME, 'chat');
  process.env.BALBINO_DATA_DIR = path.join(RUNTIME, 'chat', 'data');
  process.env.BALBINO_UPLOADS_DIR = path.join(RUNTIME, 'chat', 'uploads');
  process.env.BALBINO_SESSIONS_DIR = path.join(RUNTIME, 'chat', 'sessions');
  process.env.BALBINO_BACKUPS_DIR = path.join(RUNTIME, 'chat', 'backups');

  const portOriginal = process.env.PORT;
  try {
    const boot = async (key, action) => {
      const app = apps.find(a => a.key === key);
      try { await action(app); app.status = 'ready'; }
      catch (error) { app.status = 'error'; console.error(`[${key}] falha ao iniciar:`, error.stack || error.message); }
    };
    await boot('matriculas', async app => {
      process.env.PORT = '3111';
      const mod = require(path.join(ROOT, 'apps', 'matriculas', 'server.js'));
      app.server = mod.servidor; mod.iniciarRotinasHospedadas();
      const stats = inspectDatabase(path.join(RUNTIME, 'matriculas', 'matriculas.db'), 'matriculas');
      console.log(`[matriculas] banco ativo: ${JSON.stringify(stats || { erro: 'estrutura não reconhecida' })}`);
    });
    await boot('artes', async app => {
      if (!process.env.ARTES_ADMIN_PASSWORD || process.env.ARTES_ADMIN_PASSWORD.length < 12) throw new Error('ARTES_ADMIN_PASSWORD ausente ou menor que 12 caracteres.');
      process.env.PORT = '3112';
      const mod = require(path.join(ROOT, 'apps', 'artes', 'server.js'));
      app.server = mod.servidor; mod.iniciarRotinasHospedadas();
      const stats = inspectDatabase(path.join(RUNTIME, 'artes', 'sistema.db'), 'artes');
      console.log(`[artes] banco ativo: ${JSON.stringify(stats || { erro: 'estrutura não reconhecida' })}`);
    });
    await boot('chat', async app => {
      if (!process.env.GOCHAT_ADMIN_PASSWORD || process.env.GOCHAT_ADMIN_PASSWORD.length < 12) throw new Error('GOCHAT_ADMIN_PASSWORD ausente ou menor que 12 caracteres.');
      process.env.PORT = '3113';
      const mod = await import(pathToFileURL(path.join(ROOT, 'apps', 'chat', 'server.js')).href);
      app.server = mod.server; app.shutdown = mod.gracefulShutdown;
    });
  } finally {
    if (portOriginal == null) delete process.env.PORT;
    else process.env.PORT = portOriginal;
  }
}
let shuttingDown = false;
function stop(signal) {
  shuttingDown = true;
  for (const app of apps) if (app.shutdown) app.shutdown(signal, false).catch(error => console.error('[chat] falha ao encerrar:', error.message));
  server.close();
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

function rewriteText(body, prefix) {
  let text = body.toString('utf8');
  text = text.replace(/(["'`])\/(?!\/)/g, (_, q) => `${q}${prefix}/`);
  text = text.replace(/url\(\s*(['"]?)\/(?!\/)/gi, (_, q) => `url(${q}${prefix}/`);
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
function rootPage() {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rede Balbino</title><style>body{font:16px system-ui;max-width:720px;margin:10vh auto;padding:24px;color:#16233a}a{display:block;padding:16px;margin:10px 0;border:1px solid #ccd4e2;border-radius:10px;color:#1455cf;text-decoration:none}</style><h1>Rede Balbino</h1><a href="/matriculas/">Acompanhamento de Matrículas</a><a href="/artes/">Gerador de Artes</a><a href="/chat/">Balbino Chat</a></html>`;
}
function proxy(req, res, app, originalUrl) {
  if (!app.server) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`O sistema ${app.key} ainda está iniciando.`); return; }
  const originalUrlValue = req.url;
  req.url = originalUrl || '/';
  req.headers['accept-encoding'] = 'identity';
  req.headers['x-forwarded-prefix'] = app.prefix;
  req.headers['x-forwarded-host'] = req.headers.host || 'redebalbino.com.br';
  req.headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';
  mountResponse(req, res, app);
  app.server.emit('request', req, res);
  req.url = originalUrlValue;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://gateway.local');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, apps: apps.map(({ key, status, server: appServer }) => ({ name: key, status, loaded: Boolean(appServer) })) }));
  }
  const app = apps.find(a => url.pathname === a.prefix || url.pathname.startsWith(a.prefix + '/'));
  if (!app) {
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(rootPage()); }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Caminho não encontrado.');
  }
  if (url.pathname === app.prefix) { res.writeHead(308, { Location: app.prefix + '/' }); return res.end(); }
  proxy(req, res, app, url.pathname.slice(app.prefix.length) + url.search);
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://gateway.local');
  const app = apps.find(a => url.pathname.startsWith(a.prefix + '/'));
  if (!app) { socket.destroy(); return; }
  if (!app.server?.listenerCount('upgrade')) { socket.destroy(); return; }
  req.url = url.pathname.slice(app.prefix.length) + url.search;
  app.server.emit('upgrade', req, socket, head);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Central Balbino ativa na porta ${PORT}; caminhos: /chat, /matriculas, /artes`));
startApps().catch(error => {
  console.error('Não foi possível preparar os sistemas:', error);
});
