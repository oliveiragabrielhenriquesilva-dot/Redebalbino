'use strict';
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch {}
const ROOT = __dirname;
const RUNTIME = path.resolve(process.env.BALBINO_RUNTIME_DIR || path.join(os.homedir(), 'central-balbino-runtime'));
const PORT = Number(process.env.PORT || 3000);
const apps = [
  { key: 'matriculas', prefix: '/matriculas', port: 3111, dir: path.join(ROOT, 'apps', 'matriculas'), entry: 'server.js' },
  { key: 'artes', prefix: '/artes', port: 3112, dir: path.join(ROOT, 'apps', 'artes'), entry: 'server.js' },
  { key: 'chat', prefix: '/chat', port: 3113, dir: path.join(ROOT, 'apps', 'chat'), entry: 'server.js' }
];
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function portAtiva(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 800);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}
async function aguardarServico(app, child) {
  const limite = Date.now() + 45000;
  while (Date.now() < limite) {
    if (await portAtiva(app.port)) return true;
    if (child.exitCode !== null) {
      console.error(`[${app.key}] encerrou antes de abrir a porta ${app.port}.`);
      return false;
    }
    await delay(300);
  }
  console.error(`[${app.key}] não abriu a porta ${app.port} em 45 segundos.`);
  return false;
}

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
  for (const app of apps) {
    if (await portAtiva(app.port)) {
      console.log(`[${app.key}] já está ativo na porta ${app.port}; reutilizando o serviço.`);
      continue;
    }
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(app.port),
      HOSTED: '1',
      ...(app.key === 'matriculas' ? { DATA_DIR: path.join(RUNTIME, 'matriculas') } : {}),
      ...(app.key === 'artes' ? { DATA_DIR: path.join(RUNTIME, 'artes'), ARTES_ADMIN_PASSWORD: process.env.ARTES_ADMIN_PASSWORD } : {}),
      ...(app.key === 'artes' ? { CLOUD_CHROMIUM: '1' } : {}),
      ...(app.key === 'chat' ? {
        GOCHAT_ADMIN_USER: process.env.GOCHAT_ADMIN_USER || 'admin',
        BALBINO_RUNTIME_DIR: path.join(RUNTIME, 'chat'),
        BALBINO_DATA_DIR: path.join(RUNTIME, 'chat', 'data'),
        BALBINO_UPLOADS_DIR: path.join(RUNTIME, 'chat', 'uploads'),
        BALBINO_SESSIONS_DIR: path.join(RUNTIME, 'chat', 'sessions'),
        BALBINO_BACKUPS_DIR: path.join(RUNTIME, 'chat', 'backups')
      } : {})
    };
    const child = spawn(process.execPath, [path.join(app.dir, app.entry)], { cwd: app.dir, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      console.error(`[${app.key}] encerrou (código ${code ?? '—'}, sinal ${signal ?? '—'}).`);
    });
    children.push(child);
    await aguardarServico(app, child);
  }
}
let shuttingDown = false;
function stop(signal) {
  shuttingDown = true;
  for (const child of children) if (child.exitCode == null) child.kill(signal);
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
function rootPage() {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rede Balbino</title><style>body{font:16px system-ui;max-width:720px;margin:10vh auto;padding:24px;color:#16233a}a{display:block;padding:16px;margin:10px 0;border:1px solid #ccd4e2;border-radius:10px;color:#1455cf;text-decoration:none}</style><h1>Rede Balbino</h1><a href="/matriculas/">Acompanhamento de Matrículas</a><a href="/artes/">Gerador de Artes</a><a href="/chat/">Balbino Chat</a></html>`;
}
function proxy(req, res, app, originalUrl) {
  const targetPath = originalUrl.slice(app.prefix.length) || '/';
  const upstream = http.request({
    hostname: '127.0.0.1', port: app.port, method: req.method,
    path: targetPath.startsWith('/') ? targetPath : `/${targetPath}`,
    headers: { ...req.headers, host: req.headers.host || 'redebalbino.com.br', 'accept-encoding': 'identity', 'x-forwarded-for': req.headers['x-forwarded-for'] || req.socket.remoteAddress || '', 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https' }
  }, upstreamRes => {
    const headers = { ...upstreamRes.headers };
    const location = headers.location;
    if (location && location.startsWith('/')) headers.location = app.prefix + location;
    if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(c => c.replace(/;\s*Path=\/(?=;|$)/i, `; Path=${app.prefix}/`));
    const contentType = String(headers['content-type'] || '');
    if (!isText(contentType) || /text\/event-stream/i.test(contentType) || req.method === 'HEAD') {
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
      return;
    }
    const chunks = [];
    upstreamRes.on('data', c => chunks.push(c));
    upstreamRes.on('end', () => {
      const out = rewriteText(Buffer.concat(chunks), app.prefix);
      delete headers['content-length']; delete headers['transfer-encoding']; delete headers.etag;
      headers['content-length'] = String(out.length);
      res.writeHead(upstreamRes.statusCode || 502, headers); res.end(out);
    });
  });
  upstream.on('error', err => {
    console.error(`[${app.key}] ${err.message}`);
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`O sistema ${app.key} ainda está iniciando.`); }
    else res.destroy(err);
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
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
  const upstream = require('node:net').connect(app.port, '127.0.0.1', () => {
    const p = url.pathname.slice(app.prefix.length) + url.search;
    upstream.write(`${req.method} ${p || '/'} HTTP/${req.httpVersion}\r\n`);
    for (const [k, v] of Object.entries(req.headers)) upstream.write(`${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`);
    upstream.write('\r\n'); if (head?.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => console.log(`Central Balbino ativa na porta ${PORT}; caminhos: /chat, /matriculas, /artes`));
startApps().catch(error => {
  console.error('Não foi possível preparar os sistemas:', error);
});
