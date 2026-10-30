'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch {}
const ROOT = __dirname;
const RUNTIME = path.resolve(process.env.BALBINO_RUNTIME_DIR || path.join(os.homedir(), 'central-balbino-runtime'));
const PORT = Number(process.env.PORT || 3000);
const apps = [
  { key: 'matriculas', prefix: '/matriculas', server: null },
  { key: 'artes', prefix: '/artes', server: null },
  { key: 'chat', prefix: '/chat', server: null }
];

function copyTreeIfMissing(source, destination) {
  if (fs.existsSync(destination) || !fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
}
function prepareRuntime() {
  fs.mkdirSync(RUNTIME, { recursive: true });
  copyTreeIfMissing(path.join(ROOT, 'apps', 'matriculas', 'dados'), path.join(RUNTIME, 'matriculas'));
  copyTreeIfMissing(path.join(ROOT, 'apps', 'artes', 'data'), path.join(RUNTIME, 'artes'));
  for (const part of ['data', 'uploads', 'sessions', 'backups']) fs.mkdirSync(path.join(RUNTIME, 'chat', part), { recursive: true });
}
async function startApps() {
  if (!process.env.GOCHAT_ADMIN_PASSWORD || process.env.GOCHAT_ADMIN_PASSWORD.length < 12) {
    throw new Error('Defina GOCHAT_ADMIN_PASSWORD (mínimo 12 caracteres) nas variáveis do app Hostinger.');
  }
  if (!process.env.ARTES_ADMIN_PASSWORD || process.env.ARTES_ADMIN_PASSWORD.length < 12) {
    throw new Error('Defina ARTES_ADMIN_PASSWORD (mínimo 12 caracteres) nas variáveis do app Hostinger.');
  }
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
    process.env.PORT = '3111';
    const matriculas = require(path.join(ROOT, 'apps', 'matriculas', 'server.js'));
    apps[0].server = matriculas.servidor;
    matriculas.iniciarRotinasHospedadas();

    process.env.PORT = '3112';
    const artes = require(path.join(ROOT, 'apps', 'artes', 'server.js'));
    apps[1].server = artes.servidor;
    artes.iniciarRotinasHospedadas();

    process.env.PORT = '3113';
    const chat = await import(pathToFileURL(path.join(ROOT, 'apps', 'chat', 'server.js')).href);
    apps[2].server = chat.server;
    apps[2].shutdown = chat.gracefulShutdown;
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
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, apps: apps.map(a => a.key) })); }
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
