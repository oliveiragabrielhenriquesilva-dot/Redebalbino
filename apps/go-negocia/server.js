// GO Negocia — servidor HTTP (Node puro, sem dependências, mesmo estilo da base Balbino Chat).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, VERSAO, appDir, NOME_PRODUTO } from './src/config.js';
import { abrirBanco, migrar, auditar, varios, um } from './src/db.js';
import { garantirAdminInicial, login, logout, usuarioDaSessao, listarAcessos } from './src/auth.js';
import { exigirEscopo, ErroHttp, filtroUnidade, casoVisivel } from './src/escopo.js';
import { criarPrevia, aplicarLote, descartarLote, obterLote, listarLotes } from './src/importacao.js';
import { listarCarteira, resumoCarteira, detalheCaso, assumirCaso, liberarCaso, registrarContato, distribuirCaso, filaDeHoje } from './src/carteira.js';
import { receberMensagem, listarConversas, detalheConversa, verificarConversa, iniciarContatoAtivo, enviarMensagem, conexoesDaOrg, bloqueiosDoEnvioAtivo } from './src/conversas.js';
import * as admin from './src/admin.js';
import { assinaturaValida, extrairMensagens } from './src/canais/oficial.js';

const publicDir = path.join(appDir, 'public');
const COOKIE = 'go_negocia.sid';
// Cookie do nome anterior: ainda aceito na leitura (sessões abertas antes da troca de marca) e expirado no login/logout.
const COOKIE_ANTERIOR = 'olivelo.sid';
const tokenSessao = req => { const c = cookies(req); return c[COOKIE] || c[COOKIE_ANTERIOR]; };
const TIPOS = { '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function cabecalhosSeguranca(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

async function corpoBruto(req, limite) {
  const partes = []; let tam = 0;
  for await (const c of req) { tam += c.length; if (tam > limite) throw new ErroHttp(413, 'Conteúdo acima do limite'); partes.push(c); }
  return Buffer.concat(partes);
}

async function corpoJson(req, limite = 1024 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) throw new ErroHttp(415, 'Envie JSON');
  const b = await corpoBruto(req, limite);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new ErroHttp(400, 'JSON inválido'); }
}

function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}

function definirCookie(res, valor, maxAge) {
  const c = config();
  const seg = c.cookieSeguro ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seg}`,
    `${COOKIE_ANTERIOR}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${seg}`,
  ]);
}

// Proteção extra contra requisições de outro site (além de SameSite=Strict e JSON obrigatório).
function origemValida(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try { return new URL(origem).host === req.headers.host; } catch { return false; }
}

function servirEstatico(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const arquivo = path.normalize(path.join(publicDir, rel));
  if (!arquivo.startsWith(publicDir + path.sep) || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    if (String(req.headers.accept || '').includes('text/html')) { res.writeHead(404, { 'Content-Type': TIPOS['.html'] }); return fs.createReadStream(path.join(publicDir, '404.html')).pipe(res); }
    res.writeHead(404); return res.end('Não encontrado');
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(arquivo).pipe(res);
}

// ---------- Webhook da API oficial ----------
async function webhook(req, res, url) {
  const c = config();
  if (req.method === 'GET') {
    const ok = c.webhookVerifyToken && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === c.webhookVerifyToken;
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
    return res.end(ok ? String(url.searchParams.get('hub.challenge') || '') : 'Token inválido');
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  const bruto = await corpoBruto(req, 2 * 1024 * 1024);
  if (!assinaturaValida(bruto, req.headers['x-hub-signature-256'], c.metaAppSecret)) {
    auditar({ acao: 'WEBHOOK_ASSINATURA_INVALIDA' });
    res.writeHead(401); return res.end();
  }
  let payload = {};
  try { payload = JSON.parse(bruto.toString('utf8')); } catch { res.writeHead(400); return res.end(); }
  for (const m of extrairMensagens(payload)) receberMensagem({ modo: 'OFICIAL', ...m });
  res.writeHead(200); res.end('ok');
}

// ---------- API ----------
const rotas = [];
function rota(metodo, padrao, fn, { publica = false } = {}) {
  const nomes = [];
  const re = new RegExp('^' + padrao.replace(/:([a-z_]+)/g, (_, n) => { nomes.push(n); return '([A-Za-z0-9_-]+)'; }) + '$');
  rotas.push({ metodo, re, nomes, fn, publica });
}

// Rotas de uma instituição: o escopo (acesso + unidades) é verificado ANTES do handler.
function rotaOrg(metodo, padrao, permissao, fn) {
  rota(metodo, '/api/o/:org' + padrao, async ctx => fn({ ...ctx, escopo: exigirEscopo(ctx.usuario, ctx.p.org, permissao) }));
}

rota('POST', '/api/auth/login', async ({ req, res }) => {
  const b = await corpoJson(req);
  const r = login(b.login, b.senha);
  if (!r) return json(res, 401, { erro: 'Login ou senha inválidos' });
  definirCookie(res, r.token, config().sessaoHoras * 3600);
  return json(res, 200, { ok: true });
}, { publica: true });
rota('POST', '/api/auth/logout', async ({ req, res }) => { logout(tokenSessao(req)); definirCookie(res, '', 0); return json(res, 200, { ok: true }); }, { publica: true });
rota('GET', '/api/eu', async ({ res, usuario }) => {
  if (!usuario) return json(res, 401, { erro: 'Sessão expirada' });
  const instituicoes = usuario.admin
    ? varios("SELECT id AS organizacao_id, nome, 'ADMIN' AS papel, 1 AS todas_unidades FROM organizacoes WHERE ativa=1 ORDER BY nome")
    : listarAcessos(usuario.id);
  return json(res, 200, { usuario, instituicoes, produto: NOME_PRODUTO, versao: VERSAO, envio_real: config().envioReal });
}, { publica: true });

// Admin
const adm = fn => async ctx => { admin.exigirAdmin(ctx.usuario); return fn(ctx); };
rota('GET', '/api/admin/organizacoes', adm(async ({ res }) => json(res, 200, admin.listarOrganizacoes())));
rota('POST', '/api/admin/organizacoes', adm(async ({ req, res, usuario }) => json(res, 201, admin.criarOrganizacao(usuario, await corpoJson(req)))));
rota('PATCH', '/api/admin/organizacoes/:id', adm(async ({ req, res, usuario, p }) => json(res, 200, admin.atualizarOrganizacao(usuario, p.id, await corpoJson(req)))));
rota('GET', '/api/admin/organizacoes/:id/unidades', adm(async ({ res, p }) => json(res, 200, admin.listarUnidades(p.id))));
rota('POST', '/api/admin/organizacoes/:id/unidades', adm(async ({ req, res, usuario, p }) => json(res, 201, admin.criarUnidade(usuario, p.id, await corpoJson(req)))));
rota('GET', '/api/admin/organizacoes/:id/conexoes', adm(async ({ res, p }) => json(res, 200, admin.listarConexoesAdmin(p.id))));
rota('POST', '/api/admin/organizacoes/:id/conexoes', adm(async ({ req, res, usuario, p }) => json(res, 201, admin.criarConexao(usuario, p.id, await corpoJson(req)))));
rota('PATCH', '/api/admin/organizacoes/:id/conexoes/:cid', adm(async ({ req, res, usuario, p }) => json(res, 200, admin.definirConexaoAtiva(usuario, p.id, p.cid, Boolean((await corpoJson(req)).ativa)))));
rota('GET', '/api/admin/usuarios', adm(async ({ res }) => json(res, 200, admin.listarUsuarios())));
rota('POST', '/api/admin/usuarios', adm(async ({ req, res, usuario }) => json(res, 201, admin.cadastrarUsuario(usuario, await corpoJson(req)))));
rota('PATCH', '/api/admin/usuarios/:id', adm(async ({ req, res, usuario, p }) => json(res, 200, admin.definirAtivo(usuario, p.id, Boolean((await corpoJson(req)).ativo)))));
rota('POST', '/api/admin/usuarios/:id/senha', adm(async ({ req, res, usuario, p }) => json(res, 200, admin.redefinirSenha(usuario, p.id, (await corpoJson(req)).senha))));
rota('PUT', '/api/admin/usuarios/:id/acessos/:org', adm(async ({ req, res, usuario, p }) => json(res, 200, admin.definirAcesso(usuario, p.id, p.org, await corpoJson(req)))));
rota('GET', '/api/admin/auditoria', adm(async ({ res, url }) => json(res, 200, admin.listarAuditoria(url.searchParams.get('org')))));

// Instituição
rotaOrg('GET', '/contexto', null, async ({ res, escopo }) => {
  const f = filtroUnidade(escopo, 'id');
  const unidades = varios(`SELECT id, nome, codigo FROM unidades WHERE organizacao_id=? AND ativa=1 AND ${f.sql} ORDER BY nome`, escopo.org.id, ...f.params);
  const equipe = escopo.pode('fila.distribuir') || escopo.papel === 'ADMIN'
    ? varios("SELECT u.id, u.nome, a.papel FROM acessos a JOIN usuarios u ON u.id=a.usuario_id WHERE a.organizacao_id=? AND a.papel IN ('ATENDENTE','SUPERVISOR') AND u.ativo=1 ORDER BY u.nome", escopo.org.id) : [];
  const conexoes = escopo.pode('conversa.ver') || escopo.papel === 'ADMIN'
    ? conexoesDaOrg(escopo.org.id).filter(c => c.ativa === 1).map(c => ({ id: c.id, nome: c.nome, modo: c.modo, numero_exibicao: c.numero_exibicao, tem_modelo: Boolean(c.modelo_primeiro_contato) })) : [];
  const permissoes = ['carteira.ver', 'carteira.importar', 'lotes.ver', 'fila.ver', 'fila.distribuir', 'caso.trabalhar', 'conversa.ver', 'conversa.enviar', 'teste.simular'].filter(p => escopo.papel === 'ADMIN' || escopo.pode(p));
  if (!escopo.todasUnidades) { const i = permissoes.indexOf('carteira.importar'); if (i >= 0) permissoes.splice(i, 1); }
  return json(res, 200, {
    organizacao: { id: escopo.org.id, nome: escopo.org.nome, dias_saldo_valido: escopo.org.dias_saldo_valido, regra_verificacao: escopo.org.regra_verificacao },
    papel: escopo.papel, todas_unidades: escopo.todasUnidades, unidades, equipe, conexoes, permissoes, resumo: resumoCarteira(escopo),
  });
});
rotaOrg('GET', '/carteira', 'carteira.ver', async ({ res, escopo, url }) => json(res, 200, listarCarteira(escopo, {
  busca: url.searchParams.get('busca') || '', unidadeId: url.searchParams.get('unidade') || '', situacao: url.searchParams.get('situacao') || '', pagina: url.searchParams.get('pagina') || 1,
})));
rotaOrg('GET', '/responsaveis/:rid/caso', 'caso.trabalhar', async ({ res, escopo, p }) => {
  const c = um('SELECT id FROM casos WHERE organizacao_id=? AND responsavel_id=?', escopo.org.id, p.rid);
  if (!c) throw new ErroHttp(404, 'Este responsável não tem caso aberto (sem títulos em aberto)');
  casoVisivel(escopo, c.id);
  return json(res, 200, { caso_id: c.id });
});

const exigeImportarTodas = escopo => { if (!escopo.todasUnidades) throw new ErroHttp(403, 'Importação exige acesso a todas as unidades da instituição', 'PERMISSAO'); };
rotaOrg('GET', '/lotes', 'lotes.ver', async ({ res, escopo }) => json(res, 200, listarLotes(escopo)));
rotaOrg('POST', '/lotes', 'carteira.importar', async ({ req, res, escopo, usuario }) => {
  exigeImportarTodas(escopo);
  const b = await corpoJson(req, 22 * 1024 * 1024);
  const conteudo = Buffer.from(String(b.conteudo_base64 || ''), 'base64');
  return json(res, 201, criarPrevia({ escopo, usuario, arquivoNome: b.arquivo_nome, conteudo, dataReferencia: b.data_referencia, tipo: b.tipo || 'CARTEIRA', escopoLote: b.escopo || 'COMPLETA' }));
});
rotaOrg('GET', '/lotes/:id', 'lotes.ver', async ({ res, escopo, p, url }) => json(res, 200, obterLote(escopo, p.id, { status: url.searchParams.get('status') || null })));
rotaOrg('POST', '/lotes/:id/aplicar', 'carteira.importar', async ({ res, escopo, usuario, p }) => { exigeImportarTodas(escopo); return json(res, 200, aplicarLote({ escopo, usuario, loteId: p.id })); });
rotaOrg('POST', '/lotes/:id/descartar', 'carteira.importar', async ({ res, escopo, usuario, p }) => { exigeImportarTodas(escopo); return json(res, 200, descartarLote({ escopo, usuario, loteId: p.id })); });

rotaOrg('GET', '/fila', 'fila.ver', async ({ res, escopo, usuario, url }) => json(res, 200, filaDeHoje(escopo, usuario, {
  unidadeId: url.searchParams.get('unidade') || '', atendente: url.searchParams.get('atendente') || '', atrasoMin: Number(url.searchParams.get('atraso') || 0),
})));
rotaOrg('GET', '/casos/:id', 'caso.trabalhar', async ({ res, escopo, p }) => json(res, 200, detalheCaso(escopo, p.id)));
rotaOrg('GET', '/casos/:id/bloqueios', 'caso.trabalhar', async ({ res, escopo, p }) => json(res, 200, { bloqueios: bloqueiosDoEnvioAtivo(escopo, casoVisivel(escopo, p.id)).bloqueios }));
rotaOrg('POST', '/casos/:id/assumir', 'caso.trabalhar', async ({ req, res, escopo, usuario, p }) => json(res, 200, assumirCaso(escopo, usuario, p.id, { forcar: Boolean((await corpoJson(req)).forcar) })));
rotaOrg('POST', '/casos/:id/liberar', 'caso.trabalhar', async ({ res, escopo, usuario, p }) => json(res, 200, liberarCaso(escopo, usuario, p.id)));
rotaOrg('POST', '/casos/:id/contatos', 'caso.trabalhar', async ({ req, res, escopo, usuario, p }) => json(res, 201, registrarContato(escopo, usuario, p.id, await corpoJson(req))));
rotaOrg('POST', '/casos/:id/distribuir', 'fila.distribuir', async ({ req, res, escopo, usuario, p }) => json(res, 200, distribuirCaso(escopo, usuario, p.id, (await corpoJson(req)).atendente_id || null)));
rotaOrg('POST', '/casos/:id/contato-ativo', 'conversa.enviar', async ({ req, res, escopo, usuario, p }) => json(res, 201, await iniciarContatoAtivo(escopo, usuario, p.id, await corpoJson(req))));

rotaOrg('GET', '/conversas', 'conversa.ver', async ({ res, escopo }) => json(res, 200, listarConversas(escopo)));
rotaOrg('GET', '/conversas/:id', 'conversa.ver', async ({ res, escopo, p }) => json(res, 200, detalheConversa(escopo, p.id)));
rotaOrg('POST', '/conversas/:id/verificar', 'conversa.enviar', async ({ req, res, escopo, usuario, p }) => json(res, 200, verificarConversa(escopo, usuario, p.id, await corpoJson(req))));
rotaOrg('POST', '/conversas/:id/mensagens', 'conversa.enviar', async ({ req, res, escopo, usuario, p }) => json(res, 201, await enviarMensagem(escopo, usuario, p.id, await corpoJson(req))));

// Ambiente de teste: simula uma mensagem recebida numa conexão TESTE desta instituição (nada sai do servidor).
rotaOrg('POST', '/teste/receber', 'teste.simular', async ({ req, res, escopo, usuario }) => {
  const b = await corpoJson(req);
  const cx = um("SELECT * FROM conexoes WHERE id=? AND organizacao_id=? AND modo='TESTE' AND ativa=1", String(b.conexao_id || ''), escopo.org.id);
  if (!cx) throw new ErroHttp(404, 'Conexão de teste não encontrada nesta instituição');
  const r = receberMensagem({ modo: 'TESTE', phoneNumberId: cx.phone_number_id, telefone: b.telefone, texto: b.texto, idExterno: b.id_externo || null });
  auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'TESTE_MENSAGEM_SIMULADA', alvoTipo: 'conversa', alvoId: r.conversaId || null });
  return json(res, 201, r);
});

async function tratar(req, res) {
  cabecalhosSeguranca(res);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, produto: NOME_PRODUTO, versao: VERSAO });
    if (url.pathname === '/webhooks/whatsapp') return await webhook(req, res, url);
    if (!url.pathname.startsWith('/api/')) return servirEstatico(req, res, url.pathname);
    if (req.method !== 'GET' && !origemValida(req)) throw new ErroHttp(403, 'Origem não permitida');
    const usuario = usuarioDaSessao(tokenSessao(req));
    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const p = Object.fromEntries(r.nomes.map((n, i) => [n, m[i + 1]]));
      if (!r.publica && !usuario) throw new ErroHttp(401, 'Sessão expirada. Entre novamente.', 'AUTH');
      return await r.fn({ req, res, url, p, usuario });
    }
    throw new ErroHttp(404, 'Não encontrado');
  } catch (e) {
    if (e instanceof ErroHttp) return json(res, e.status, { erro: e.message, codigo: e.codigo, ...(e.extra || {}) });
    if (e?.status && e.status < 500) return json(res, e.status, { erro: e.message });
    console.error('[go-negocia]', e);
    return json(res, 500, { erro: 'Erro interno. Tente novamente.' });
  }
}

export function iniciar({ dbFile, porta, host } = {}) {
  const c = config();
  abrirBanco(dbFile || c.dbFile);
  migrar();
  garantirAdminInicial();
  const servidor = http.createServer((req, res) => { tratar(req, res); });
  return new Promise(resolve => servidor.listen(porta ?? c.porta, host ?? c.host, () => resolve(servidor)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  iniciar().then(s => {
    const a = s.address();
    console.log(`${NOME_PRODUTO} ${VERSAO} em http://${a.address}:${a.port} — envio real: ${config().envioReal ? 'LIGADO' : 'desligado'}`);
  });
}
