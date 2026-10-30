Warning: truncated output (original token count: 33822)
Total output lines: 1863

'use strict';
// Sistema de Acompanhamento de Matrículas — servidor local para acesso pela rede
// Requisitos: Node.js 22.13+ (recomendado: Node 24 LTS). Sem dependências externas.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
function loadLocalEnv(){try{for(const line of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i>0&&process.env[t.slice(0,i).trim()]==null)process.env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,'')}}catch{}}
loadLocalEnv();
const restauracao = require('./restauracao');
if (require.main === module) restauracao.bloquearInstancia(process.env.DATA_DIR || path.join(__dirname,'dados'));
const { db, DB_FILE, DATA_DIR } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSAO_DIAS = 30;
const VERSAO_APP = '30.3.6';

// ---------------------------------------------------------------- utilidades
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const falha = (status, msg) => { throw new HttpError(status, msg); };

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${h}`;
}
function confereSenha(senha, salvo) {
  const [salt, h] = String(salvo).split(':');
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(String(senha), salt, 64);
  const ref = Buffer.from(h, 'hex');
  return ref.length === calc.length && crypto.timingSafeEqual(ref, calc);
}

function dataValida(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const poloRestrito = u => u && u.papel === 'visualizador' && u.polo_id ? Number(u.polo_id) : 0;
const somaConhecida = (xs, campo) => xs.some(x => x[campo] == null) ? null : xs.reduce((n,x) => n + x[campo], 0);
function validarPeriodo(q) {
  for (const k of ['ref', 'de', 'ate', 'semana']) if (q[k] && !dataValida(q[k])) falha(400, 'Data inválida: ' + k);
  if (q.de && q.ate && q.de > q.ate) falha(400, 'A data inicial deve ser anterior ou igual à final');
}
const tentativasLogin = new Map();
function limitarLogin(req, login) {
  const ip = req.socket.remoteAddress || 'local', agora = Date.now();
  for (const [k,v] of tentativasLogin) if (agora >= v.ate) tentativasLogin.delete(k);
  for (const chave of ['ip:' + ip, 'conta:' + String(login || '').trim().toLowerCase()]) {
    let t = tentativasLogin.get(chave);
    if (!t) { t = { n:0, ate: agora + 15*60*1000 }; tentativasLogin.set(chave,t); }
    if (t.n >= (chave.startsWith('ip:') ? 60 : 10)) falha(429, 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.');
    t.n++;
  }
}
function percentualCalendario(ciclo, spaces, data, modo, fer) {
  if (data < ciclo.data_inicio) return 0;
  if (!spaces.length) return null;
  const ultimo=spaces.at(-1);
  if(ciclo.data_fim && ultimo.data<ciclo.data_fim && ultimo.percentual<100) spaces=[...spaces,{data:ciclo.data_fim,percentual:100}];
  const prox = spaces.find(s => s.data >= data);
  if (!prox) return spaces.at(-1).percentual;
  const idx = spaces.indexOf(prox), ant = idx ? spaces[idx-1] : null;
  const ini = ant ? addDias(ant.data,1) : (ciclo.data_inicio || data), anterior = ant ? ant.percentual : 0;
  const total = contarDias(ini,prox.data,modo,fer), feitos = contarDias(ini,data,modo,fer);
  return total ? anterior + (prox.percentual-anterior)*Math.min(feitos/total,1) : prox.percentual;
}
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function cfg(chave, padrao = '') {
  const r = get('SELECT valor FROM config WHERE chave = ?', chave);
  return r ? r.valor : padrao;
}
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function cpfValido(cpf) {
  const c = soDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    const d = ((s * 10) % 11) % 10;
    if (d !== Number(c[t])) return false;
  }
  return true;
}
function formataCpf(cpf) {
  const c = soDigitos(cpf);
  return c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : (cpf || '');
}
function mascaraCpf(cpf) {
  const c = soDigitos(cpf);
  return c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : (cpf ? '***' : '');
}
function registrar(usuario, acao, detalhe) {
  run('INSERT INTO historico (usuario, acao, detalhe) VALUES (?, ?, ?)', usuario ? usuario.login : null, acao, detalhe ? String(detalhe).slice(0, 500) : null);
}

// ---------------------------------------------------------------- calendário (dias úteis + feriados)
function isoDe(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDias(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDe(d); }
function feriadosDe(poloId) {
  const rows = poloId ? all('SELECT data FROM feriados WHERE polo_id IS NULL OR polo_id = ?', poloId) : all('SELECT data FROM feriados WHERE polo_id IS NULL');
  return new Set(rows.map(r => r.data));
}
// Conta os dias (inclusive nas duas pontas) conforme o modo: corridos | seg-sex | seg-sab. Feriados só contam fora do modo "corridos".
function contarDias(de, ate, modo, feriados) {
  if (!de || !ate || ate < de) return 0;
  let n = 0;
  const fim = new Date(ate + 'T12:00:00');
  for (let d = new Date(de + 'T12:00:00'); d <= fim; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (modo === 'seg-sex' && (w === 0 || w === 6)) continue;
    if (modo === 'seg-sab' && w === 0) continue;
    if (modo !== 'corridos' && feriados.has(isoDe(d))) continue;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- sessão
function lerCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function usuarioDaSessao(req) {
  const token = lerCookies(req).sessao;
  if (!token) return null;
  const s = get(`SELECT u.id, u.nome, u.login, u.papel, u.polo_id, u.ativo, s.expira
                 FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`, token);
  if (!s || !s.ativo || s.expira < Date.now()) return null;
  return { id: s.id, nome: s.nome, login: s.login, papel: s.papel, polo_id: s.polo_id };
}
const podeLancar = (u) => u && (u.papel === 'admin' || u.papel === 'lancador');
const ehAdmin = (u) => u && u.papel === 'admin';

// ---------------------------------------------------------------- http
function enviarJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function lerCorpo(req, maximo = 2e6) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', c => { tam += c.length; if (tam > maximo) { reject(new HttpError(413, 'Requisição muito grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function servirEstatico(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const arq = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!arq.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(arq, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- cadastros genéricos
const CADASTROS = {
  cursos: { campos: ['nome', 'produto_id', 'apelidos', 'ativo', 'polos'], obrig: ['nome', 'produto_id'], uso: [] },
  polos: { campos: ['nome', 'ordem', 'ativo', 'apelidos'], obrig: ['nome'], uso: [['matriculas', 'polo_id']] },
  origens: { campos: ['nome', 'ordem', 'ativo', 'apelidos'], obrig: ['nome'], uso: [['matriculas', 'origem_id']] },
  categorias: { campos: ['nome', 'ordem', 'grupo'], obrig: ['nome'], uso: [['produtos', 'categoria_id']] },
  produtos: { campos: ['nome', 'categoria_id', 'subgrupo', 'meta_ate', 'ordem', 'ativo', 'valor_min', 'valor_max'], obrig: ['nome', 'categoria_id'], uso: [['matriculas', 'produto_id']] },
  tutores: { campos: ['nome', 'ativo', 'apelidos', 'polo_origem_id'], obrig: ['nome'], uso: [['matriculas', 'tutor_id']] },
  ciclos: { campos: ['nome', 'data_inicio', 'data_fim', 'padrao'], obrig: ['nome'], uso: [['matriculas', 'ciclo_id']] },
  spaces: { campos: ['ciclo_id', 'nome', 'data', 'percentual'], obrig: ['ciclo_id', 'nome', 'data', 'percentual'], uso: [] },
  feriados: { campos: ['data', 'nome', 'polo_id'], obrig: ['data', 'nome'], uso: [] },
};

function limparValor(campo, v) {
  if (v === undefined) return undefined;
  if (campo === 'polos') return Array.isArray(v) ? v.map(Number).filter(Boolean).join(',') : String(v || '');
  if (v === '' || v === null) return null;
  if (campo === 'valor_min' || campo === 'valor_max') return lerValor(v) || null;
  if (['ordem', 'ativo', 'padrao', 'categoria_id', 'ciclo_id'].includes(campo)) return Number(v) || 0;
  if (campo === 'polo_id' || campo === 'polo_origem_id') return Number(v) || null;
  if (campo === 'produto_id') return Number(v) || null;
  if (campo === 'percentual') { const n = Number(String(v).replace(',', '.')); if (!(n >= 0 && n <= 100)) falha(400, 'Percentual deve ficar entre 0 e 100'); return n; }
  if (['data', 'data_inicio', 'data_fim', 'meta_ate'].includes(campo) && !dataValida(v)) falha(400, 'Data inválida');
  return String(v).trim();
}

function salvarCadastro(tabela, id, corpo, usuario) {
  const def = CADASTROS[tabela];
  const dados = {};
  for (const c of def.campos) { const v = limparValor(c, corpo[c]); if (v !== undefined) dados[c] = v; }
  if (!id) for (const c of def.obrig) if (dados[c] === undefined || dados[c] === null || dados[c] === '') falha(400, `Campo obrigatório: ${c}`);
  if (id) for (const c of def.obrig) if (c in dados && (dados[c] === null || dados[c] === '')) falha(400, `Campo obrigatório: ${c}`);

  const combinado = { ...(id ? get(`SELECT * FROM ${tabela} WHERE id = ?`, id) : {}), ...dados };
  if (id && !get(`SELECT 1 FROM ${tabela} WHERE id = ?`, id)) falha(404, 'Cadastro não encontrado');
  if (tabela === 'ciclos' && combinado.data_inicio && combinado.data_fim && combinado.data_fim < combinado.data_inicio) falha(400, 'O fim do processo é anterior ao início');
  if(tabela==='tutores' && combinado.polo_origem_id){
    const vinculos=Array.isArray(corpo.polos)?corpo.polos.map(Number):all('SELECT polo_id FROM tutor_polos WHERE tutor_id=?',id||0).map(x=>x.polo_id);
    if(!vinculos.includes(Number(combinado.polo_origem_id))) falha(400,'O polo de origem precisa estar entre os vínculos do tutor');
  }
  if (tabela === 'spaces') {
    const ciclo = get('SELECT * FROM ciclos WHERE id = ?', combinado.ciclo_id);
    if (!ciclo) falha(400, 'Processo inválido');
    if ((ciclo.data_inicio && combinado.data < ciclo.data_inicio) || (ciclo.data_fim && combinado.data > ciclo.data_fim)) falha(400, 'O Space deve estar dentro do período do processo');
    const outros = all('SELECT id, data, percentual FROM spaces WHERE ciclo_id = ? AND id <> ? ORDER BY data', combinado.ciclo_id, id || 0);
    if (outros.some(x => x.data === combinado.data)) falha(400, 'Já existe um Space nesta data');
    if (outros.some(x => x.data < combinado.data ? x.percentual > combinado.percentual : x.percentual < combinado.percentual)) falha(400, 'Os percentuais dos Spaces devem ser crescentes');
  }
  return tx(() => {
    if (tabela === 'ciclos' && dados.padrao) run('UPDATE ciclos SET padrao = 0');
    if (tabela === 'categorias' && dados.nome) dados.grupo = dados.nome; // categoria = Graduação / Continuada (o grupo acompanha o nome)
    let novoId = id;
    try {
      const cols = Object.keys(dados);
      if (id) {
        if (cols.length) run(`UPDATE ${tabela} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map(c => dados[c]), id);
      } else {
        novoId = Number(run(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => dados[c])).lastInsertRowid);
      }
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) falha(409, 'Já existe um cadastro com esse nome');
      throw e;
    }
    if (tabela === 'polos' && Array.isArray(corpo.produtos)) {
      run('DELETE FROM polo_produtos WHERE polo_id = ?', novoId);
      for (const p of corpo.produtos) run('INSERT OR IGNORE INTO polo_produtos (polo_id, produto_id) VALUES (?, ?)', novoId, Number(p));
    }
    if (tabela === 'produtos' && !id) {
      // produto novo: já fica disponível em todos os polos (ajuste em Cadastros › Polos)
      run('INSERT OR IGNORE INTO polo_produtos (polo_id, produto_id) SELECT id, ? FROM polos', novoId);
    }
    if (tabela === 'tutores' && Array.isArray(corpo.polos)) {
      run('DELETE FROM tutor_polos WHERE tutor_id = ?', novoId);
      for (const p of corpo.polos) run('INSERT OR IGNORE INTO tutor_polos (tutor_id, polo_id) VALUES (?, ?)', novoId, Number(p));
    }
    registrar(usuario, id ? `editou ${tabela}` : `criou ${tabela}`, `${novoId} ${dados.nome || ''}`);
    return novoId;
  });
}

function excluirCadastro(tabela, id, usuario) {
  const def = CADASTROS[tabela];
  for (const [t, col] of def.uso) {
    const n = get(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = ?`, id).n;
    if (n > 0) falha(409, `Não dá para excluir: está em uso em ${n} registro(s) de ${t}. Desative em vez de excluir.`);
  }
  if (tabela === 'produtos') {
    const n = get('SELECT COUNT(*) n FROM cursos WHERE produto_id = ?', id).n;
    if (n > 0) falha(409, `Não dá para excluir: este produto está vinculado a ${n} curso(s). Desative em vez de excluir.`);
  }
  if (tabela === 'polos') {
    const n = get('SELECT COUNT(*) n FROM usuarios WHERE polo_id = ?', id).n;
    if (n) falha(409, 'Há usuários vinculados a este polo.');
  }
  run(`DELETE FROM ${tabela} WHERE id = ?`, id);
  registrar(usuario, `excluiu ${tabela}`, String(id));
}

function bootstrap(usuario) {
  const polos = all('SELECT id, nome, ordem, ativo, apelidos FROM polos ORDER BY ordem, nome');
  const pp = all('SELECT polo_id, produto_id FROM polo_produtos');
  for (const p of polos) p.produtos = pp.filter(x => x.polo_id === p.id).map(x => x.produto_id);
  const tutores = all('SELECT id, nome, ativo, apelidos, polo_origem_id FROM tutores ORDER BY nome');
  const tp = all('SELECT tutor_id, polo_id FROM tutor_polos');
  for (const t of tutores) { t.polos = tp.filter(x => x.tutor_id === t.id).map(x => x.polo_id); if(!t.polo_origem_id&&t.polos.length===1)t.polo_origem_id=t.polos[0]; }
  const out = {
    usuario,
    hoje: hojeISO(),
    config: Object.fromEntries(all('SELECT chave, valor FROM config').map(r => [r.chave, r.valor])),
    polos, tutores,
    origens: all('SELECT id, nome, ordem, ativo, apelidos FROM origens ORDER BY ordem, nome'),
    cursos: all('SELECT id, nome, produto_id, apelidos, ativo, polos FROM cursos ORDER BY nome').map(c => ({ ...c, polos: c.polos ? c.polos.split(',').map(Number) : [] })),
    versao: VERSAO_APP, ref_padrao: refPadrao(),
    categorias: all('SELECT id, nome, ordem, apelidos, grupo FROM categorias ORDER BY ordem, nome'),
    produtos: all('SELECT id, nome, categoria_id, subgrupo, meta_ate, ordem, ativo, valor_min, valor_max FROM produtos ORDER BY ordem, nome'),
    ciclos: all('SELECT id, nome, data_inicio, data_fim, padrao FROM ciclos ORDER BY COALESCE(data_fim, data_inicio) DESC, id DESC'),
    spaces: all('SELECT id, ciclo_id, nome, data, percentual FROM spaces ORDER BY data'),
    feriados: all('SELECT id, data, nome, polo_id FROM feriados ORDER BY data'),
  };
  if (!ehAdmin(usuario)) {
    for (const k of ['pasta_backup_extra','backup_extra_status']) delete out.config[k];
  }
  if (poloRestrito(usuario)) {
    const pid = poloRestrito(usuario);
    out.polos = out.polos.filter(p => p.id === pid);
    out.tutores = out.tutores.filter(t => t.polos.includes(pid)).map(t => ({...t, polo_origem_id:t.polo_origem_id===pid?pid:null, polos:[pid]}));
    out.feriados = out.feriados.filter(f => !f.polo_id || f.polo_id === pid);
    out.cursos = out.cursos.filter(c => !c.polos.length || c.polos.includes(pid)).map(c => ({...c, polos:c.polos.length ? [pid] : []}));
  }
  if (ehAdmin(usuario)) out.usuarios = all('SELECT id, nome, login, papel, polo_id, ativo FROM usuarios ORDER BY nome');
  return out;
}

// ---------------------------------------------------------------- matrículas
function filtrosMatricula(q, usuario) {
  const w = []; const p = [];
  const add = (cond, v) => { w.push(cond); p.push(v); };
  if (q.ciclo) add('m.ciclo_id = ?', Number(q.ciclo));
  validarPeriodo(q);
  const campoPolo = q.credito_tutor ? 'COALESCE(m.tutor_polo_id, m.polo_id)' : 'm.polo_id';
  if (usuario.papel === 'visualizador' && usuario.polo_id) add(campoPolo + ' = ?', usuario.polo_id);
  else if (q.polo) add(campoPolo + ' = ?', Number(q.polo));
  if (q.tutor) add('m.tutor_id = ?', Number(q.tutor));
  if (q.produto) add('m.produto_id = ?', Number(q.produto));
  if (q.categoria) add('pr.categoria_id = ?', Number(q.categoria));
  if (q.grupo) add('ca.grupo = ?', String(q.grupo));
  if (q.subgrupo) add('pr.subgrupo = ?', String(q.subgrupo));
  if (q.origem) add('m.origem_id = ?', Number(q.origem));
  if (q.de) add('m.data >= ?', q.de);
  if (q.ate) add('m.data <= ?', q.ate);
  if (q.prazo_meta) w.push("(pr.meta_ate IS NULL OR pr.meta_ate = '' OR m.data <= pr.meta_ate)");
  if (q.busca) {
    const b = `%${q.busca}%`; const d = soDigitos(q.busca);
    w.push(`(m.aluno LIKE ? OR m.curso LIKE ? OR m.obs LIKE ?${d ? ' OR m.cpf LIKE ?' : ''})`);
    p.push(b, b, b); if (d) p.push(`%${d}%`);
  }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

const SQL_MAT_BASE = `
  FROM matriculas m
  JOIN polos po ON po.id = m.polo_id
  JOIN tutores tu ON tu.id = m.tutor_id
  JOIN produtos pr ON pr.id = m.produto_id
  JOIN categorias ca ON ca.id = pr.categoria_id
  JOIN origens og ON og.id = m.origem_id
  JOIN ciclos ci ON ci.id = m.ciclo_id`;

function listarMatriculas(q, usuario) {
  const { where, params } = filtrosMatricula(q, usuario);
  const limite = Math.max(1, Math.min(Math.floor(Number(q.limite)) || 500, 5000));
  const pagina = Math.max(Math.floor(Number(q.pagina)) || 1, 1);
  const total = get(`SELECT COUNT(*) n, COALESCE(SUM(m.valor),0) v ${SQL_MAT_BASE} ${where}`, ...params);
  const linhas = all(`SELECT m.id, m.ciclo_id, m.data, m.polo_id, m.tutor_id, m.tutor_polo_id, m.produto_id, m.origem_id, m.aluno, m.cpf, m.curso, m.valor, m.obs, m.criado_em, m.valor_primeira, m.bolsa, m.cupom, m.importado,
      po.nome polo, tu.nome tutor, (SELECT nome FROM polos WHERE id = m.tutor_polo_id) tutor_polo, pr.nome produto, ca.nome categoria, og.nome origem, ci.nome ciclo
      ${SQL_MAT_BASE} ${where} ORDER BY m.data DESC, m.id DESC LIMIT ? OFFSET ?`, ...params, limite, (pagina - 1) * limite);
  const verCpf = usuario.papel !== 'visualizador';
  const cacheRa = {}, raDe = (l) => (conciliacaoMA.raPorMatricula(l.ciclo_id, cacheRa) || {})[l.id] || null;
  for (const l of linhas) { l.ra = raDe(l); l.cpf = verCpf ? formataCpf(l.cpf) : mascaraCpf(l.cpf); }
  return { total: total.n, valor_total: total.v, pagina, limite, linhas };
}

function lerValor(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function validarMatricula(c, anterior = null) {
  const d = {
    ciclo_id: Number(c.ciclo_id), data: String(c.data || ''), polo_id: Number(c.polo_id), tutor_id: Number(c.tutor_id),
    produto_id: Number(c.produto_id), origem_id: Number(c.origem_id),
    aluno: (c.aluno || '').trim() || null, cpf: soDigitos(c.cpf) || null, curso: (c.curso || '').trim() || null,
    valor: lerValor(c.valor), obs: (c.obs || '').trim() || null,
    valor_primeira: c.valor_primeira === '' || c.valor_primeira == null ? null : lerValor(c.valor_primeira),
    bolsa: (c.bolsa || '').trim() || null, cupom: (c.cupom || '').trim() || null,
  };
  if (c.importado) d.importado = String(c.importado).slice(0, 40);
  if (!dataValida(d.data)) falha(400, 'Informe a data da matrícula');
  for (const [k, n] of [['ciclo_id', 'processo'], ['polo_id', 'polo'], ['tutor_id', 'tutor'], ['produto_id', 'produto'], ['origem_id', 'origem']])
    if (!d[k]) falha(400, `Informe o ${n}`);
  if (cfg('exigir_cpf') === '1' && !d.cpf) falha(400, 'Informe o CPF do aluno');
  if (d.cpf && !cpfValido(d.cpf)) falha(400, 'CPF inválido — confira os dígitos');
  if (cfg('exigir_aluno') === '1' && !d.aluno) falha(400, 'Informe o nome do aluno');
  if (!Number.isFinite(d.valor) || d.valor < 0) falha(400, 'Valor inválido');
  const vinculos = all('SELECT polo_id FROM tutor_polos WHERE tutor_id = ?', d.tutor_id).map(x => x.polo_id);
  d.tutor_polo_id = Number(c.tutor_polo_id) || (anterior && anterior.tutor_id === d.tutor_id && Number(anterior.tutor_polo_id||anterior.polo_id)) || ((get('SELECT polo_origem_id FROM tutores WHERE id=?',d.tutor_id)||{}).polo_origem_id || (vinculos.length === 1 ? vinculos[0] : 0));
  if (!vinculos.includes(d.tutor_polo_id) && !(anterior && anterior.tutor_id===d.tutor_id && Number(anterior.tutor_polo_id||anterior.polo_id)===d.tutor_polo_id)) falha(400, 'Selecione um polo vinculado ao tutor para sua meta individual');
  return d;
}

function salvarMatricula(id, corpo, usuario) {
  const antes = id ? get('SELECT * FROM matriculas WHERE id = ?', id) : null;
  const d = validarMatricula(corpo, antes);
  const tutor=get('SELECT polo_origem_id FROM tutores WHERE id=?',d.tutor_id);
  const vinculos=all('SELECT polo_id FROM tutor_polos WHERE tutor_id=?',d.tutor_id).map(x=>x.polo_id);
  const creditoAnterior=antes&&antes.tutor_id===d.tutor_id?Number(antes.tutor_polo_id||antes.polo_id):null;
  const padrao=creditoAnterior||tutor?.polo_origem_id||(vinculos.length===1?vinculos[0]:null);
  const excecao=padrao!=null && d.tutor_polo_id!==padrao;
  const motivo=String(corpo.motivo_credito||'').trim();
  if(excecao){
    if(!ehAdmin(usuario)) falha(403,'Somente administrador pode alterar o crédito padrão da matrícula');
    if(!(corpo.excecao_credito===true||corpo.excecao_credito==='1')||motivo.length<5) falha(400,'Para alterar o crédito, marque a exceção e informe o motivo (mínimo 5 caracteres)');
  }
  const registrarExcecao=(matriculaId)=>{
    if(!excecao)return;
    run('INSERT INTO credito_excecoes(matricula_id,ciclo_id,tutor_id,polo_destino_id,credito_anterior,credito_novo,motivo,usuario) VALUES(?,?,?,?,?,?,?,?)',matriculaId,d.ciclo_id,d.tutor_id,d.polo_id,padrao,d.tutor_polo_id,motivo.slice(0,500),usuario.login);
    registrar(usuario,'exceção de crédito individual',`#${matriculaId} ${padrao} → ${d.tutor_polo_id}: ${motivo.slice(0,350)}`);
  };
  const inalterado = antes && antes.produto_id === d.produto_id && antes.polo_id === d.polo_id;
  if (!inalterado && !get('SELECT 1 FROM polo_produtos WHERE polo_id = ? AND produto_id = ?', d.polo_id, d.produto_id))
    falha(400, 'Esse polo não vende esse produto (ajuste em Cadastros › Polos)');
  // Aviso de duplicidade (mesmo CPF + produto no mesmo ciclo)
  if (!corpo.confirmar_faixa) {
    const pr = get('SELECT nome, valor_min, valor_max FROM produtos WHERE id = ?', d.produto_id);
    if (pr && ((pr.valor_min != null && d.valor < pr.valor_min) || (pr.valor_max != null && d.valor > pr.valor_max)))
      return { fora_faixa: { produto: pr.nome, min: pr.valor_min, max: pr.valor_max, valor: d.valor } };
  }
  if (d.cpf && !corpo.confirmar_duplicada) {
    const dup = get('SELECT m.id, m.data, po.nome polo FROM matriculas m JOIN polos po ON po.id = m.polo_id WHERE m.cpf = ? AND m.produto_id = ? AND m.ciclo_id = ? AND m.id != ?',
      d.cpf, d.produto_id, d.ciclo_id, id || 0);
    if (dup) return { duplicada: dup };
  }
  const cols = Object.keys(d);
  if (id) {
    if (!get('SELECT 1 FROM matriculas WHERE id = ?', id)) falha(404, 'Matrícula não encontrada');
    tx(() => {
      run(`UPDATE matriculas SET ${cols.map(c => `${c} = ?`).join(', ')}, atualizado_em = datetime('now','localtime') WHERE id = ?`, ...cols.map(c => d[c]), id);
      const alterados = cols.filter(c => c !== 'cpf' && String(antes[c] ?? '') !== String(d[c] ?? ''));
      registrar(usuario, 'editou matrícula', `#${id}`);
      registrarExcecao(id);
      for (const campo of alterados) registrar(usuario, 'alterou campo de matrícula', `#${id} ${campo}: ${String(antes[campo] ?? '—').slice(0, 180)} → ${String(d[campo] ?? '—').slice(0, 180)}`);
      if (String(antes.cpf || '') !== String(d.cpf || '')) registrar(usuario, 'alterou campo de matrícula', `#${id} CPF alterado`);
    });
    return { id };
  }
  return tx(()=>{
    const novo = Number(run(`INSERT INTO matriculas (${cols.join(', ')}, criado_por) VALUES (${cols.map(() => '?').join(', ')}, ?)`, ...cols.map(c => d[c]), usuario.id).lastInsertRowid);
    registrar(usuario, 'lançou matrícula', `#${novo}`);registrarExcecao(novo);
    return { id: novo };
  });
}

function csvMatriculas(q, usuario) {
  const linhasCompletas = []; let pagina = 1, dados;
  do { dados = listarMatriculas({ ...q, limite: 5000, pagina }, usuario); linhasCompletas.push(...dados.linhas); pagina++; } while (dados.linhas.length && linhasCompletas.length < dados.total);
  if (linhasCompletas.length !== dados.total) falha(409, 'Não foi possível exportar todas as matrículas; tente novamente.');
  const cab = ['Data', 'Processo', 'Polo', 'Tutor', 'Aluno', 'CPF', 'Categoria', 'Produto', 'Curso', 'Origem', 'Valor Mensalidade', 'Valor da 1ª', 'Bolsa', 'Cupom', 'Observação'];
  const esc = (v) => { const raw = v == null ? '' : String(v); const s = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw; return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = linhasCompletas.map(l => [l.data.split('-').reverse().join('/'), l.ciclo, l.polo, l.tutor, l.aluno, l.cpf, l.categoria, l.produto, l.curso, l.origem, String(l.valor.toFixed(2)).replace('.', ','), l.valor_primeira != null ? String(l.valor_primeira.toFixed(2)).replace('.', ',') : '', l.bolsa, l.cupom, l.obs].map(esc).join(';'));
  return '﻿' + [cab.join(';'), ...linhas].join('\r\n');
}

// ---------------------------------------------------------------- painel / indicadores
// Recorte por produto: ?produto=ID ou ?categoria=ID → lista de produtos (ou null = todos)
function produtosSel(q) {
  if (Number(q.produto)) return [Number(q.produto)];
  if (q.subgrupo) return all('SELECT id FROM produtos WHERE subgrupo = ?', String(q.subgrupo)).map(r => r.id);
  if (q.grupo) return all('SELECT p.id FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE c.grupo = ?', String(q.grupo)).map(r => r.id);
  if (Number(q.categoria)) return all('SELECT id FROM produtos WHERE categoria_id = ?', Number(q.categoria)).map(r => r.id);
  return null;
}
function metasPorProduto(cicloId, poloId, sel = null) {
  const r = metasPorProdutoTodos(cicloId, poloId);
  if (sel) for (const k of Object.keys(r)) if (!sel.includes(Number(k))) delete r[k];
  return r;
}
function metasPorProdutoTodos(cicloId, poloId) {
  const rows = poloId
    ? all('SELECT produto_id, quantidade q FROM metas WHERE ciclo_id = ? AND polo_id = ?', cicloId, poloId)
    : all('SELECT produto_id, SUM(quantidade) q FROM metas WHERE ciclo_id = ? GROUP BY produto_id', cicloId);
  return Object.fromEntries(rows.map(r => [r.produto_id, r.q]));
}


// Semana de meta: começa no dia configurado (padrão terça → vai até segunda) — Configuração › Sistema e backup.
// Dias que recebem meta: padrão todos menos domingo (0=dom … 6=sáb); feriados nacionais e do polo ficam fora.
const inicioSemanaCfg = () => { const n = Number(cfg('inicio_semana', '2')); return n >= 0 && n <= 6 ? n : 2; };
const diasMetaCfg = () => new Set(String(cfg('dias_meta_semana', '1,2,3,4,5,6')).split(',').map(Number).filter(n => n >= 0 && n <= 6));
function inicioSemana(iso) { const w = new Date(iso + 'T12:00:00').getDay(); return addDias(iso, -((w - inicioSemanaCfg() + 7) % 7)); }
const semanaValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && inicioSemana(s) === s;
// Distribui a meta semanal pelos dias que recebem meta, sem feriados. O resto vai para os primeiros dias. Devolve 7 valores.
function distribuirSemana(total, datas, polo) {
  const fer = new Set(all('SELECT data FROM feriados WHERE data BETWEEN ? AND ? AND (polo_id IS NULL OR polo_id = ?)', datas[0], datas[6], polo).map(r => r.data));
  const dias = diasMetaCfg();
  const ativo = datas.map(d => dias.has(new Date(d + 'T12:00:00').getDay()) && !fer.has(d));
  const n = ativo.filter(Boolean).length || 1;
  let k = 0;
  return datas.map((d, i) => { if (!ativo[i]) return 0; const v = Math.floor(total / n) + (k < total % n ? 1 : 0); k++; return v; });
}
function ritmoSemanal(q, usuario) {
  const ciclo = Number(q.ciclo);
  if (!ciclo || !get('SELECT id FROM ciclos WHERE id = ?', ciclo)) falha(400, 'Selecione um processo válido');
  const polo = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : (Number(q.polo) || 0);
  const hoje = hojeISO();
  validarPeriodo(q);
  const referencia = q.semana || q.ref || hoje;
  const posicao = q.ref || (q.semana && q.semana < hoje ? addDias(inicioSemana(q.semana),6) : hoje);
  const cortePosicao = posicao < hoje ? posicao : hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referencia) || Number.isNaN(new Date(referencia + 'T12:00:00').getTime()) || isoDe(new Date(referencia + 'T12:00:00')) !== referencia) falha(400, 'Selecione uma data válida');
  const inicio = inicioSemana(referencia);
  const datas = Array.from({ length: 7 }, (_, i) => addDias(inicio, i));
  const fimConsulta = datas[6] < cortePosicao ? datas[6] : cortePosicao;
  // semana futura (ainda sem dias até a posição): sem vendas a listar — antes dava "data inicial maior que a final"
  const semVendas = fimConsulta < inicio;
  const { where, params } = filtrosMatricula({ ciclo, polo: polo || '', de: inicio, ate: semVendas ? inicio : fimConsulta }, usuario);
  const whereCredito = where.replace(/m\.polo_id = \?/g, 'COALESCE(m.tutor_polo_id, m.polo_id) = ?');
  const registros = semVendas ? [] : all(`SELECT m.tutor_id, COALESCE(m.tutor_polo_id,m.polo_id) polo_id, tu.nome, (SELECT nome FROM polos WHERE id=COALESCE(m.tutor_polo_id,m.polo_id)) polo, m.data, COUNT(*) qtd
    ${SQL_MAT_BASE} ${whereCredito} GROUP BY m.tutor_id, COALESCE(m.tutor_polo_id,m.polo_id), m.data`, ...params);
  const mapa = new Map();
  const participantes = all(`SELECT t.id tutor_id, po.id polo_id, t.nome, po.nome polo FROM tutor_polos tp
    JOIN tutores t ON t.id = tp.tutor_id JOIN polos po ON po.id = tp.polo_id
    WHERE t.ativo = 1 AND po.ativo = 1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id=tp.polo_id) ${polo ? 'AND po.id = ?' : ''}`, ...(polo ? [polo] : []));
  for (const t of [...participantes, ...registros]) {
    const chave = `${t.tutor_id}-${t.polo_id}`;
    if (!mapa.has(chave)) mapa.set(chave, { tutor_id:t.tutor_id, polo_id:t.polo_id, nome:t.nome, polo:t.polo, dias:{}, total:0 });
    if (t.data) { const linha = mapa.get(chave); linha.dias[t.data] = t.qtd; linha.total += t.qtd; }
  }
  const metas = all(`SELECT tutor_id, polo_id, quantidade FROM metas_ritmo_semanal WHERE ciclo_id = ? AND semana = ? ${polo ? 'AND polo_id = ?' : ''}`, ...[ciclo, inicio, ...(polo ? [polo] : [])]);
  for (const meta of metas) { const linha = mapa.get(`${meta.tutor_id}-${meta.polo_id}`); if (linha) linha.meta = meta.quantidade; }
  const metasDias = all(`SELECT tutor_id, polo_id, data, quantidade FROM metas_ritmo_diario WHERE ciclo_id = ? AND semana = ? ${polo ? 'AND polo_id = ?' : ''}`, ...[ciclo, inicio, ...(polo ? [polo] : [])]);
  for (const meta of metasDias) { const linha = mapa.get(`${meta.tutor_id}-${meta.polo_id}`); if (linha) { linha.metas_dias ??= {}; linha.metas_dias[meta.data] = meta.quantidade; } }
  // Sugestão de meta semanal = RITMO DO PLANO: a parte da meta do tutor que o calendário prevê para esta semana
  //   (meta × (% previsto no fim da semana − % previsto no fim da semana anterior)), arredondada para cima,
  //   nunca abaixo do mínimo semanal configurado. Não sobe quando o tutor atrasa: o atraso aparece à parte.
  const metasProc = metasTutorCalc(ciclo), pctFim = {}, pctIni = {};
  const minimoSemanal = Math.max(0, Number(cfg('ritmo_minimo_semanal', '0')) || 0);
  const antes = Object.fromEntries(all(`SELECT m.tutor_id || '-' || COALESCE(m.tutor_polo_id, m.polo_id) k, COUNT(*) n FROM matriculas m WHERE m.ciclo_id = ? AND m.data < ? GROUP BY 1`, ciclo, inicio).map(r => [r.k, r.n]));
  for (const linha of mapa.values()) {
    const b = metasProc[`${linha.polo_id}-${linha.tutor_id}`]; if (!b) continue;
    pctFim[linha.polo_id] ??= ritmo({ ciclo, polo: linha.polo_id, ref: datas[6] }, { papel: 'admin' }).hoje_situacao.percentual;
    pctIni[linha.polo_id] ??= ritmo({ ciclo, polo: linha.polo_id, ref: addDias(inicio, -1) }, { papel: 'admin' }).hoje_situacao.percentual;
    linha.meta_processo = b.quantidade; linha.meta_processo_origem = b.origem;
    const pf = pctFim[linha.polo_id], pi = pctIni[linha.polo_id] ?? 0, feitoAntes = antes[`${linha.tutor_id}-${linha.polo_id}`] || 0;
    // atraso = esperado acumulado no começo da semana − o que já vendeu antes dela (informativo)
    linha.atraso = Math.max(0, Math.round(b.quantidade * pi / 100) - feitoAntes);
    linha.ritmo_plano = pf == null ? null : Math.max(0, Math.ceil(b.quantidade * (pf - pi) / 100 - 1e-9));
    linha.sugestao = linha.ritmo_plano == null ? null : Math.max(linha.ritmo_plano, minimoSemanal);
    linha.sugestao_minimo = minimoSemanal > (linha.ritmo_plano || 0);
  }
  const tutores = [...mapa.values()].filter(t=>(q.historico==='1' && t.total>0)||!!get(`SELECT 1 FROM tutor_polos tp JOIN tutores tu ON tu.id=tp.tutor_id WHERE tp.tutor_id=? AND tp.polo_id=? AND tu.ativo=1 AND (tu.polo_origem_id IS NULL OR tu.polo_origem_id=tp.polo_id)`,t.tutor_id,t.polo_id)).sort((a,b) => b.total - a.total || a.nome.localeCompare(b.nome) || a.polo.localeCompare(b.polo));
  const semanaAtual = inicioSemana(hoje);
  // feriados da semana (nacionais e do polo) — a meta diária não c…15822 tokens truncated….tutor_id FROM tutor_polos tp JOIN tutores t ON t.id = tp.tutor_id WHERE t.ativo = 1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id=tp.polo_id) ORDER BY t.nome')) (equipe[r.polo_id] ??= []).push(r.tutor_id);
  for (const [poloId, tutores] of Object.entries(equipe)) {
    const doPolo = indiv.filter(r => r.polo_id === Number(poloId));
    if (doPolo.length) { for (const r of doPolo) if (r.quantidade) out[`${poloId}-${r.tutor_id}`] = { quantidade: r.quantidade, origem: 'individual' }; continue; }
    const total = metaPolo[poloId] || 0;
    if (!total || !tutores.length) continue;
    const parte = Math.floor(total / tutores.length); let sobra = total - parte * tutores.length;
    for (const tid of tutores) out[`${poloId}-${tid}`] = { quantidade: parte + (sobra-- > 0 ? 1 : 0), origem: 'dividida' };
  }
  return out;
}
function salvarMetasTutor(cicloId, poloId, itens, usuario) {
  if (!get('SELECT id FROM ciclos WHERE id=?',cicloId) || !get('SELECT id FROM polos WHERE id=?',poloId)) falha(400,'Processo ou polo inválido');
  const vistos = new Set();
  for (const i of itens) {
    if (!Number.isInteger(i.quantidade) || i.quantidade < 0 || i.quantidade > 1000000 || vistos.has(i.tutor_id) || !get('SELECT 1 FROM tutor_polos WHERE tutor_id=? AND polo_id=?',i.tutor_id,poloId)) falha(400,'Confira os vínculos e as metas dos tutores');
    vistos.add(i.tutor_id);
  }
  tx(() => {
    run('DELETE FROM metas_tutor WHERE ciclo_id = ? AND polo_id = ?', cicloId, poloId);
    const ins = db.prepare('INSERT INTO metas_tutor (ciclo_id, polo_id, tutor_id, quantidade) VALUES (?, ?, ?, ?)');
    for (const i of itens) { const qn = Math.max(0, Math.round(Number(i.quantidade) || 0)); if (Number(i.tutor_id) && qn) ins.run(cicloId, poloId, Number(i.tutor_id), qn); }
  });
  registrar(usuario, itens.some(i => Number(i.quantidade)) ? 'salvou meta por tutor' : 'voltou meta por tutor para divisão automática', `processo ${cicloId} · polo ${poloId}`);
}

// ---------------------------------------------------------------- resumo para o WhatsApp
// Fotografia numa data: painel até a data + o que entrou no período (o dia ou a semana)
function resumo(q, usuario) {
  const ref = dataRef(q);
  const de = /^\d{4}-\d{2}-\d{2}$/.test(q.de || '') ? q.de : ref;
  const pn = painel({ ciclo: q.ciclo, polo: q.polo, ref }, usuario);
  const poloFiltro = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : (Number(q.polo) || 0);
  const vendas = all(`SELECT m.polo_id, COALESCE(m.tutor_polo_id,m.polo_id) credito, m.tutor_id, ca.grupo, ca.id categoria_id, COUNT(*) n FROM matriculas m JOIN produtos pr ON pr.id = m.produto_id JOIN categorias ca ON ca.id = pr.categoria_id
    WHERE m.ciclo_id = ? AND m.data BETWEEN ? AND ? ${poloFiltro ? 'AND (m.polo_id = ? OR COALESCE(m.tutor_polo_id,m.polo_id) = ?)' : ''} GROUP BY 1, 2, 3, 4, 5`, Number(q.ciclo), de, ref, ...(poloFiltro ? [poloFiltro,poloFiltro] : []));
  const soma = (f) => vendas.filter(f).reduce((a, r) => a + r.n, 0);
  return {
    ref, de, painel: pn,
    periodo: {
      total: soma(r => !poloFiltro || r.polo_id===poloFiltro),
      porPolo: Object.fromEntries(pn.porPolo.map(x => [x.id, soma(r => r.polo_id === x.id)])),
      porTutor: Object.fromEntries(pn.porTutor.map(t => [`${t.tutor_id}-${t.polo_id}`, soma(r => r.tutor_id === t.tutor_id && r.credito === t.polo_id)])),
      porGrupo: Object.fromEntries([...new Set(vendas.map(r => r.grupo || ''))].map(g => [g, soma(r => (!poloFiltro||r.polo_id===poloFiltro) && (r.grupo || '') === g)])),
      porCategoria: Object.fromEntries([...new Set(vendas.map(r => r.categoria_id))].map(c => [c, soma(r => (!poloFiltro||r.polo_id===poloFiltro) && r.categoria_id === c)])),
    },
  };
}

// Grade polo × produto para metas e Mundo Azul
function lerMetasRpv(cicloId) { return all('SELECT polo_id, produto_id, valor FROM metas_rpv WHERE ciclo_id = ?', cicloId); }
function salvarMetasRpv(cicloId, itens, usuario) {
  tx(() => {
    const up = db.prepare(`INSERT INTO metas_rpv (ciclo_id, polo_id, produto_id, valor) VALUES (?, ?, ?, ?)
                           ON CONFLICT (ciclo_id, polo_id, produto_id) DO UPDATE SET valor = excluded.valor`);
    const del = db.prepare('DELETE FROM metas_rpv WHERE ciclo_id = ? AND polo_id = ? AND produto_id = ?');
    for (const i of itens) {
      const v = lerValor(i.valor);
      if (!v) del.run(cicloId, Number(i.polo_id) || 0, Number(i.produto_id));
      else up.run(cicloId, Number(i.polo_id) || 0, Number(i.produto_id), v);
    }
  });
  registrar(usuario, 'salvou metas de RPV', `ciclo ${cicloId}`);
}

function lerGrade(tabela, cicloId) {
  return all(`SELECT polo_id, produto_id, quantidade FROM ${tabela} WHERE ciclo_id = ?`, cicloId);
}
function salvarGrade(tabela, cicloId, itens, usuario) {
  tx(() => {
    const up = db.prepare(`INSERT INTO ${tabela} (ciclo_id, polo_id, produto_id, quantidade) VALUES (?, ?, ?, ?)
                           ON CONFLICT (ciclo_id, polo_id, produto_id) DO UPDATE SET quantidade = excluded.quantidade`);
    const del = db.prepare(`DELETE FROM ${tabela} WHERE ciclo_id = ? AND polo_id = ? AND produto_id = ?`);
    for (const i of itens) {
      const qn = Number(i.quantidade);
      if (!Number.isFinite(qn) || qn < 0 || !Number.isInteger(qn) || qn > 1000000) falha(400,'Meta deve ser um número inteiro entre 0 e 1.000.000');
      if (!qn) del.run(cicloId, Number(i.polo_id), Number(i.produto_id));
      else up.run(cicloId, Number(i.polo_id), Number(i.produto_id), Math.max(0, Math.round(qn)));
    }
  });
  registrar(usuario, `salvou ${tabela === 'metas' ? 'metas' : 'Mundo Azul'}`, `ciclo ${cicloId}`);
}

function conferenciaMundoAzul(q, usuario) {
  const cicloId = Number(q.ciclo);
  const poloId = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : (Number(q.polo) || 0);
  const sis = all(`SELECT m.polo_id, m.produto_id, COUNT(*) n FROM matriculas m WHERE m.ciclo_id = ? GROUP BY m.polo_id, m.produto_id`, cicloId);
  const ma = lerGrade('mundo_azul', cicloId);
  return { sistema: sis.filter(r => !poloId || r.polo_id === poloId), mundo_azul: ma.filter(r => !poloId || r.polo_id === poloId) };
}

// ---------------------------------------------------------------- conciliação com o Mundo Azul (posições oficiais)
const conciliacaoMA = require('./conciliacao')({ db, DATA_DIR, all, get, run, tx, falha, registrar, lerCorpo, enviarJson, ehAdmin, podeLancar, hojeISO, cfg });

const gestao = require('./gestao')({db,all,get,run,falha,enviarJson,lerCorpo,ehAdmin,poloRestrito,dataRef,addDias,inicioSemana,painel,paginaTutor,bootstrap,registrar,tx,validarPeriodo,hojeISO,mascaraCpf});

// ---------------------------------------------------------------- rotas
async function rotear(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  const m = req.method;
  validarPeriodo(q);

  if (!p.startsWith('/api/')) return servirEstatico(req, res, p);

  // ---- públicas
  if (p === '/api/estado' && m === 'GET') {
    return enviarJson(res, 200, { versao: VERSAO_APP, precisa_configurar: get('SELECT COUNT(*) n FROM usuarios').n === 0, nome_sistema: cfg('nome_sistema'), subtitulo: cfg('subtitulo'), nome_rede: cfg('nome_rede'), logo: cfg('logo') });
  }
  if (p === '/api/primeiro-acesso' && m === 'POST') {
    if (get('SELECT COUNT(*) n FROM usuarios').n > 0) falha(403, 'O sistema já foi configurado');
    const c = await lerCorpo(req);
    if (!c.nome || !c.login || !c.senha || String(c.senha).length < 6) falha(400, 'Preencha nome, login e uma senha com pelo menos 6 caracteres');
    run('INSERT INTO usuarios (nome, login, senha_hash, papel) VALUES (?, ?, ?, ?)', c.nome.trim(), c.login.trim(), hashSenha(c.senha), 'admin');
    return enviarJson(res, 200, { ok: true });
  }
  if (p === '/api/login' && m === 'POST') {
    const c = await lerCorpo(req);
    limitarLogin(req,c.login);
    const u = get('SELECT * FROM usuarios WHERE login = ? AND ativo = 1', String(c.login || '').trim());
    if (!u || !confereSenha(c.senha || '', u.senha_hash)) { await new Promise(r => setTimeout(r, 400)); falha(401, 'Login ou senha incorretos'); }
    tentativasLogin.delete('conta:'+String(c.login||'').trim().toLowerCase());
    const limiteIP=tentativasLogin.get('ip:'+(req.socket.remoteAddress||'local')); if(limiteIP)limiteIP.n=Math.max(0,limiteIP.n-1);
    const token = crypto.randomBytes(32).toString('hex');
    run('DELETE FROM sessoes WHERE expira < ?', Date.now());
    run('INSERT INTO sessoes (token, usuario_id, expira) VALUES (?, ?, ?)', token, u.id, Date.now() + SESSAO_DIAS * 864e5);
    registrar(u, 'entrou', req.socket.remoteAddress);
    return enviarJson(res, 200, { ok: true }, { 'Set-Cookie': `sessao=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSAO_DIAS * 86400}` });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = lerCookies(req).sessao; if (t) run('DELETE FROM sessoes WHERE token = ?', t);
    return enviarJson(res, 200, { ok: true }, { 'Set-Cookie': 'sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  // ---- autenticadas
  const usuario = usuarioDaSessao(req);
  if (!usuario) falha(401, 'Sessão expirada — entre novamente');
  const exigeAdmin = () => { if (!ehAdmin(usuario)) falha(403, 'Apenas administradores'); };
  const exigeLancar = () => { if (!podeLancar(usuario)) falha(403, 'Seu usuário não pode lançar matrículas'); };

  if (await gestao.rotas(req,res,p,m,q,usuario)) return;

  if (p === '/api/bootstrap' && m === 'GET') return enviarJson(res, 200, bootstrap(usuario));

  if (p === '/api/minha-senha' && m === 'POST') {
    const c = await lerCorpo(req);
    const u = get('SELECT senha_hash FROM usuarios WHERE id = ?', usuario.id);
    if (!confereSenha(c.atual || '', u.senha_hash)) falha(400, 'Senha atual incorreta');
    if (!c.nova || String(c.nova).length < 6) falha(400, 'A nova senha precisa ter pelo menos 6 caracteres');
    run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', hashSenha(c.nova), usuario.id);
    run('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?',usuario.id,lerCookies(req).sessao);
    return enviarJson(res, 200, { ok: true });
  }

  // Cadastros
  let mm = p.match(/^\/api\/cad\/(\w+)(?:\/(\d+))?$/);
  if (mm && CADASTROS[mm[1]]) {
    // quem lança matrícula pode cadastrar curso novo durante a importação
    if (!(mm[1] === 'cursos' && m === 'POST' && podeLancar(usuario))) exigeAdmin();
    const [, tabela, idStr] = mm; const id = idStr ? Number(idStr) : null;
    if (m === 'POST' && !id) return enviarJson(res, 200, { id: salvarCadastro(tabela, null, await lerCorpo(req), usuario) });
    if (m === 'PUT' && id) return enviarJson(res, 200, { id: salvarCadastro(tabela, id, await lerCorpo(req), usuario) });
    if (m === 'DELETE' && id) { excluirCadastro(tabela, id, usuario); return enviarJson(res, 200, { ok: true }); }
  }

  // Usuários
  mm = p.match(/^\/api\/usuarios(?:\/(\d+))?$/);
  if (mm) {
    exigeAdmin();
    const id = mm[1] ? Number(mm[1]) : null;
    if (m === 'DELETE' && id) {
      if (id === usuario.id) falha(400, 'Você não pode excluir o próprio usuário');
      run('DELETE FROM usuarios WHERE id = ?', id); registrar(usuario, 'excluiu usuário', String(id));
      return enviarJson(res, 200, { ok: true });
    }
    const c = await lerCorpo(req);
    c.nome=String(c.nome||'').trim();c.login=String(c.login||'').trim();if('ativo' in c)c.ativo=Number(c.ativo)===0?0:1;
    if (!['admin', 'lancador', 'visualizador'].includes(c.papel)) falha(400, 'Perfil inválido');
    if (!c.nome || !c.login) falha(400, 'Informe nome e login');
    const polo = c.papel === 'visualizador' && c.polo_id ? Number(c.polo_id) : null;
    if(polo&&!get('SELECT id FROM polos WHERE id=?',polo))falha(400,'Polo inválido');
    if(!((m==='POST'&&!id)||(m==='PUT'&&id)))falha(405,'Método não suportado');
    if(id&&!get('SELECT id FROM usuarios WHERE id=?',id))falha(404,'Usuário não encontrado');
    if((!id||c.senha)&&(!c.senha||String(c.senha).length<6))falha(400,'Senha com pelo menos 6 caracteres');
    if(id===usuario.id&&(c.papel!=='admin'||c.ativo===0))falha(400,'Você não pode tirar o próprio acesso de administrador');
    const senhaHash=c.senha?hashSenha(c.senha):null;
    try {tx(()=>{
      if(!id)run('INSERT INTO usuarios(nome,login,senha_hash,papel,polo_id,ativo) VALUES(?,?,?,?,?,?)',c.nome.trim(),c.login.trim(),senhaHash,c.papel,polo,c.ativo===0?0:1);
      else {
        run('UPDATE usuarios SET nome=?,login=?,papel=?,polo_id=?,ativo=? WHERE id=?',c.nome.trim(),c.login.trim(),c.papel,polo,c.ativo===0?0:1,id);
        if(senhaHash)run('UPDATE usuarios SET senha_hash=? WHERE id=?',senhaHash,id);
        if(c.ativo===0)run('DELETE FROM sessoes WHERE usuario_id=?',id);
        else if(senhaHash){if(id===usuario.id)run('DELETE FROM sessoes WHERE usuario_id=? AND token<>?',id,lerCookies(req).sessao);else run('DELETE FROM sessoes WHERE usuario_id=?',id);}
      }
      registrar(usuario,id?'editou usuário':'criou usuário',c.login);
    });}catch(e){if(String(e.message).includes('UNIQUE'))falha(409,'Esse login já existe');throw e;}
    return enviarJson(res, 200, { ok: true });
  }

  // Configurações gerais
  if (p === '/api/config' && m === 'PUT') {
    exigeAdmin();
    const c = await lerCorpo(req);
    const permitidas = ['incluir_sede_digital', 'pasta_backup_extra', 'dias_min_projecao', 'nome_rede', 'nome_sistema', 'subtitulo', 'contagem_dias', 'lancamento', 'inicio_semana', 'dias_meta_semana', 'exigir_cpf', 'exigir_aluno', 'logo', 'rotulos_whatsapp', 'cabecalho_placar_whatsapp', 'ritmo_minimo_semanal', 'tolerancia_ra_dias', 'contatos_google', 'boas_vindas'];
    if ('logo' in c && c.logo && !/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(c.logo)) falha(400, 'Logo deve ser uma imagem PNG, JPG, SVG ou WEBP');
    if ('logo' in c && c.logo && c.logo.length > 1_400_000) falha(400, 'Imagem muito grande (máx. ~1 MB)');
    if (c.pasta_backup_extra) { try { testarPasta(String(c.pasta_backup_extra).trim()); } catch (e) { falha(400, 'Não consegui gravar na pasta de backup: ' + e.message); } c.pasta_backup_extra = String(c.pasta_backup_extra).trim(); }
    for (const k of permitidas) if (k in c) run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)', k, String(c[k]));
    registrar(usuario, 'alterou configurações');
    if (c.pasta_backup_extra) backupAutomatico();
    return enviarJson(res, 200, { ok: true });
  }

  // Metas e Mundo Azul (grade polo × produto)
  if (p === '/api/metas-rpv') {
    const cicloId = Number(q.ciclo); if (!cicloId) falha(400, 'Selecione um processo');
    if (m === 'GET') return enviarJson(res, 200, lerMetasRpv(cicloId).filter(x=>!poloRestrito(usuario)||x.polo_id===0||x.polo_id===poloRestrito(usuario)));
    if (m === 'PUT') { exigeAdmin(); const c = await lerCorpo(req); salvarMetasRpv(cicloId, Array.isArray(c.itens) ? c.itens : [], usuario); return enviarJson(res, 200, { ok: true }); }
  }
  mm = p.match(/^\/api\/(metas|mundo-azul)$/);
  if (mm) {
    const tabela = mm[1] === 'metas' ? 'metas' : 'mundo_azul';
    const cicloId = Number(q.ciclo); if (!cicloId) falha(400, 'Selecione um processo');
    if (m === 'GET') return enviarJson(res, 200, lerGrade(tabela, cicloId).filter(x=>!poloRestrito(usuario)||x.polo_id===poloRestrito(usuario)));
    if (m === 'PUT') {
      if (tabela === 'metas') exigeAdmin(); else exigeLancar();
      const c = await lerCorpo(req);
      salvarGrade(tabela, cicloId, Array.isArray(c.itens) ? c.itens : [], usuario);
      return enviarJson(res, 200, { ok: true });
    }
  }
  if (p === '/api/metas-tutor') {
    const cicloId = Number(q.ciclo); if (!cicloId) falha(400, 'Selecione um processo');
    if (m === 'GET') {
      const calc = metasTutorCalc(cicloId);
      return enviarJson(res, 200, Object.entries(calc).filter(([k])=>!poloRestrito(usuario)||Number(k.split('-')[0])===poloRestrito(usuario)).map(([k, v]) => { const [polo_id, tutor_id] = k.split('-').map(Number); return { polo_id, tutor_id, ...v }; }));
    }
    if (m === 'PUT') {
      exigeAdmin(); const c = await lerCorpo(req);
      if (!Number(c.polo_id)) falha(400, 'Informe o polo');
      salvarMetasTutor(cicloId, Number(c.polo_id), Array.isArray(c.itens) ? c.itens : [], usuario);
      return enviarJson(res, 200, { ok: true });
    }
  }
  if (p === '/api/resumo' && m === 'GET') return enviarJson(res, 200, resumo(q, usuario));
  if(p==='/api/tutores-processo'&&m==='GET'){
    const ciclo=Number(q.ciclo),polo=poloRestrito(usuario)||Number(q.polo),ref=dataRef(q);
    if(!ciclo||!polo||!get('SELECT id FROM ciclos WHERE id=?',ciclo))falha(400,'Informe processo e polo válidos');
    const lista=all(`SELECT t.id,t.nome,t.ativo,t.polo_origem_id,
      EXISTS(SELECT 1 FROM tutor_polos tp WHERE tp.tutor_id=t.id AND tp.polo_id=?) vinculado,
      EXISTS(SELECT 1 FROM matriculas m WHERE m.tutor_id=t.id AND m.ciclo_id=? AND COALESCE(m.tutor_polo_id,m.polo_id)=? AND m.data<=?) tem_historico FROM tutores t ORDER BY t.nome`,polo,ciclo,polo,ref)
      .map(t=>({...t,atual:!!(t.ativo&&t.vinculado&&(!t.polo_origem_id||t.polo_origem_id===polo))}))
      .filter(t=>t.atual||t.tem_historico).map(t=>({id:t.id,nome:t.nome,atual:t.atual,situacao:t.atual?'ativo':!t.ativo?'inativo':!t.vinculado?'sem_vinculo':'transferido'}));
    return enviarJson(res,200,lista);
  }
  if (p === '/api/tutor' && m === 'GET') return enviarJson(res, 200, paginaTutor(q, usuario));
  let mc = p.match(/^\/api\/campanhas\/(\d+)$/);
  if (mc && m === 'GET') {
    const c = get('SELECT * FROM campanhas WHERE id = ?', Number(mc[1]));
    if (!c) falha(404, 'Campanha não encontrada');
    return enviarJson(res, 200, resultadoCampanha(c, usuario, true));
  }
  if (p === '/api/campanhas' && m === 'GET') {
    return enviarJson(res, 200, all('SELECT * FROM campanhas ORDER BY ativo DESC, fim DESC, id DESC LIMIT 200').map(c => resultadoCampanha(c, usuario)));
  }
  mm = p.match(/^\/api\/campanhas(?:\/(\d+))?$/);
  if (mm) {
    exigeLancar();
    const id = mm[1] ? Number(mm[1]) : null;
    if (m === 'POST' && !id) return enviarJson(res, 200, { id: salvarCampanha(null, await lerCorpo(req), usuario) });
    if (m === 'PUT' && id) return enviarJson(res, 200, { id: salvarCampanha(id, await lerCorpo(req), usuario) });
    if (m === 'DELETE' && id) { exigeAdmin(); run('DELETE FROM campanhas WHERE id = ?', id); registrar(usuario, 'excluiu campanha', `#${id}`); return enviarJson(res, 200, { ok: true }); }
  }
  if (p === '/api/conferencias' && m === 'GET') {
    const cicloId = Number(q.ciclo);
    const poloRestrito = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : null;
    const lista = all(`SELECT c.id, c.data_ref, c.fonte, c.obs, c.criado_em, c.criado_por, c.polo_id, po.nome polo,
        (SELECT SUM(real_qtd) FROM conferencia_linhas WHERE conferencia_id = c.id) bi_qtd, (SELECT SUM(real_rpv) FROM conferencia_linhas WHERE conferencia_id = c.id) bi_rpv
        FROM conferencias c LEFT JOIN polos po ON po.id = c.polo_id WHERE c.ciclo_id = ? ${poloRestrito ? 'AND c.polo_id = ?' : ''} ORDER BY c.data_ref DESC, c.id DESC LIMIT 200`, cicloId, ...(poloRestrito ? [poloRestrito] : []));
    for (const l of lista) { const s2 = Object.values(sistemaPorCategoria(cicloId, l.polo_id, l.data_ref)); l.sis_qtd = s2.reduce((a, x) => a + x.real_qtd, 0); l.sis_rpv = s2.reduce((a, x) => a + x.real_rpv, 0); }
    return enviarJson(res, 200, lista);
  }
  mm = p.match(/^\/api\/conferencias(?:\/(\d+))?$/);
  if (mm) {
    const id = mm[1] ? Number(mm[1]) : null;
    if (m === 'GET' && id) { const c = lerConferencia(id); if (!c || (poloRestrito(usuario) && c.polo_id !== poloRestrito(usuario))) falha(404, 'Conferência não encontrada'); return enviarJson(res, 200, c); }
    if (m === 'DELETE' && id) { exigeAdmin(); run('DELETE FROM conferencias WHERE id = ?', id); registrar(usuario, 'excluiu conferência BI', `#${id}`); return enviarJson(res, 200, { ok: true }); }
    if (m === 'POST' && !id) {
      exigeLancar();
      const c = await lerCorpo(req);
      if (!Number(c.ciclo_id)) falha(400, 'Selecione o processo');
      if (!dataValida(c.data_ref)) falha(400, 'Informe a data de referência dos números do BI');
      const linhas = (Array.isArray(c.linhas) ? c.linhas : []).filter(l => l.rotulo);
      if (!linhas.length) falha(400, 'Nenhuma linha para salvar');
      const num = (v) => v === '' || v == null ? null : lerValor(v);
      const novo = tx(() => {
        const cid = Number(run('INSERT INTO conferencias (ciclo_id, polo_id, data_ref, fonte, obs, criado_por) VALUES (?, ?, ?, ?, ?, ?)',
          Number(c.ciclo_id), Number(c.polo_id) || null, c.data_ref, String(c.fonte || 'colado').slice(0, 40), (c.obs || '').slice(0, 300) || null, usuario.login).lastInsertRowid);
        const ins = db.prepare('INSERT INTO conferencia_linhas (conferencia_id, rotulo, categoria_id, meta_qtd, real_qtd, meta_ticket, real_ticket, meta_rpv, real_rpv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const l of linhas) ins.run(cid, String(l.rotulo).slice(0, 60), Number(l.categoria_id) || null, num(l.meta_qtd), num(l.real_qtd), num(l.meta_ticket), num(l.real_ticket), num(l.meta_rpv), num(l.real_rpv));
        return cid;
      });
      registrar(usuario, 'salvou conferência BI', `#${novo} ${c.data_ref}`);
      return enviarJson(res, 200, { id: novo });
    }
  }
  if (p === '/api/conferencia' && m === 'GET') return enviarJson(res, 200, conferenciaMundoAzul(q, usuario));
  if (p.startsWith('/api/ma/') && await conciliacaoMA.rotas(req, res, p, m, q, usuario)) return;

  // Matrículas
  if (p === '/api/apelido' && m === 'POST') {
    exigeLancar();
    const c = await lerCorpo(req);
    if (!['origens', 'polos', 'tutores', 'cursos'].includes(c.tabela)) falha(400, 'Cadastro inválido');
    const reg = get(`SELECT apelidos FROM ${c.tabela} WHERE id = ?`, Number(c.id));
    if (!reg) falha(404, 'Cadastro não encontrado');
    const novo = String(c.apelido || '').replace(/[,;]/g, ' ').trim().slice(0, 60);
    const lista = String(reg.apelidos || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
    if (novo && !lista.some(x => x.toLowerCase() === novo.toLowerCase())) lista.push(novo);
    run(`UPDATE ${c.tabela} SET apelidos = ? WHERE id = ?`, lista.join(', '), Number(c.id));
    registrar(usuario, 'adicionou apelido', `${c.tabela} #${c.id}: ${novo}`);
    return enviarJson(res, 200, { ok: true });
  }
  if (p === '/api/cpfs' && m === 'GET') {
    exigeLancar();
    return enviarJson(res, 200, all('SELECT m.cpf, m.produto_id, m.data, po.nome polo FROM matriculas m JOIN polos po ON po.id = m.polo_id WHERE m.ciclo_id = ? AND m.cpf IS NOT NULL', Number(q.ciclo)));
  }
  if (p === '/api/matriculas/lote' && m === 'POST') {
    exigeLancar();
    const c = await lerCorpo(req);
    const itens = Array.isArray(c.itens) ? c.itens.slice(0, 500) : [];
    const resultado = itens.map((it, i) => {
      try {
        const r = salvarMatricula(null, { ...it, importado: it.importado || 'whatsapp' }, usuario);
        if (r.duplicada) return { i, ok: false, motivo: `CPF já lançado neste produto (${r.duplicada.polo}, ${r.duplicada.data.split('-').reverse().join('/')})` };
        if (r.fora_faixa) return { i, ok: false, motivo: `Mensalidade fora da faixa de ${r.fora_faixa.produto}` };
        return { i, ok: true, id: r.id };
      } catch (e) { return { i, ok: false, motivo: e.message }; }
    });
    registrar(usuario, 'importou matrículas', `${resultado.filter(r => r.ok).length} de ${itens.length}`);
    return enviarJson(res, 200, { resultado });
  }
  if (p === '/api/matriculas' && m === 'GET') return enviarJson(res, 200, listarMatriculas(q, usuario));
  if (p === '/api/matriculas.csv' && m === 'GET') {
    const nome = `matriculas-${hojeISO()}.csv`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` });
    return res.end(csvMatriculas(q, usuario));
  }
  mm = p.match(/^\/api\/matriculas(?:\/(\d+))?$/);
  if (mm) {
    exigeLancar();
    const id = mm[1] ? Number(mm[1]) : null;
    if (m === 'POST' && !id) return enviarJson(res, 200, salvarMatricula(null, await lerCorpo(req), usuario));
    if (m === 'PUT' && id) return enviarJson(res, 200, salvarMatricula(id, await lerCorpo(req), usuario));
    if (m === 'DELETE' && id) {
      const r = get('SELECT * FROM matriculas WHERE id = ?', id);
      if (!r) falha(404, 'Matrícula não encontrada');
      tx(() => {
        run('DELETE FROM matriculas WHERE id = ?', id);
        registrar(usuario, 'excluiu matrícula', `#${id} ${r.aluno || ''} ${mascaraCpf(r.cpf)}`);
        for (const campo of ['ciclo_id','data','polo_id','tutor_id','tutor_polo_id','produto_id','origem_id','curso','valor','valor_primeira','bolsa','cupom','obs'])
          if (r[campo] != null && r[campo] !== '') registrar(usuario, 'dados de matrícula excluída', `#${id} ${campo}: ${String(r[campo]).slice(0, 350)}`);
      });
      return enviarJson(res, 200, { ok: true });
    }
  }

  if (p === '/api/ritmo-semanal' && m === 'GET') return enviarJson(res, 200, ritmoSemanal(q, usuario));
  if (p === '/api/ritmo-semanal/meta' && m === 'POST') {
    exigeAdmin();
    const c = await lerCorpo(req);
    const ciclo = Number(c.ciclo), polo = Number(c.polo), tutor = Number(c.tutor);
    if (!Number.isInteger(ciclo) || !Number.isInteger(polo) || !Number.isInteger(tutor) || !get('SELECT id FROM ciclos WHERE id = ?', ciclo) || !get('SELECT 1 FROM tutor_polos WHERE tutor_id = ? AND polo_id = ?', tutor, polo)) falha(400, 'Processo, polo ou vínculo do tutor inválido');
    const atual = ritmoSemanal({ ciclo, polo }, usuario).inicio;
    if (!semanaValida(c.semana) || c.semana < atual) falha(400, 'Só dá para cadastrar meta da semana atual ou das próximas.');
    const semanaAtual = c.semana;
    const meta = c.meta === null || c.meta === '' ? null : Number(c.meta);
    if (meta !== null && (!Number.isInteger(meta) || meta < 0 || meta > 100000)) falha(400, 'Informe uma meta inteira entre 0 e 100.000.');
    const anterior = get('SELECT quantidade FROM metas_ritmo_semanal WHERE ciclo_id = ? AND polo_id = ? AND tutor_id = ? AND semana = ?', ciclo, polo, tutor, semanaAtual);
    if (meta !== null && anterior && anterior.quantidade === meta) return enviarJson(res, 200, { ok: true });
    const datasSem = Array.from({ length: 7 }, (_, i) => addDias(semanaAtual, i));
    tx(() => {
      run('DELETE FROM metas_ritmo_diario WHERE ciclo_id = ? AND polo_id = ? AND tutor_id = ? AND semana = ?', ciclo, polo, tutor, semanaAtual);
      if (meta === null) run('DELETE FROM metas_ritmo_semanal WHERE ciclo_id = ? AND polo_id = ? AND tutor_id = ? AND semana = ?', ciclo, polo, tutor, semanaAtual);
      else {
        run(`INSERT INTO metas_ritmo_semanal (ciclo_id, polo_id, tutor_id, semana, quantidade) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(ciclo_id, polo_id, tutor_id, semana) DO UPDATE SET quantidade=excluded.quantidade`, ciclo, polo, tutor, semanaAtual, meta);
        // já deixa a meta de cada dia: segunda a sexta, sem feriados (dá para ajustar em "Por dia")
        distribuirSemana(meta, datasSem, polo).forEach((v, i) => run('INSERT INTO metas_ritmo_diario (ciclo_id,polo_id,tutor_id,semana,data,quantidade) VALUES (?,?,?,?,?,?)', ciclo, polo, tutor, semanaAtual, datasSem[i], v));
      }
    });
    registrar(usuario, 'salvou meta de ritmo semanal', `ciclo ${ciclo}, polo ${polo}, tutor ${tutor}, semana ${semanaAtual}`);
    return enviarJson(res, 200, { ok: true });
  }
  if (p === '/api/ritmo-semanal/metas-diarias' && m === 'POST') {
    exigeAdmin();
    const c = await lerCorpo(req); const ciclo = Number(c.ciclo), polo = Number(c.polo), tutor = Number(c.tutor);
    if (!Number.isInteger(ciclo) || !Number.isInteger(polo) || !Number.isInteger(tutor) || !get('SELECT id FROM ciclos WHERE id = ?', ciclo) || !get('SELECT 1 FROM tutor_polos WHERE tutor_id = ? AND polo_id = ?', tutor, polo)) falha(400, 'Processo, polo ou vínculo do tutor inválido');
    const atualD = ritmoSemanal({ ciclo, polo }, usuario).inicio;
    if (!semanaValida(c.semana) || c.semana < atualD) falha(400, 'Só dá para cadastrar meta da semana atual ou das próximas.');
    const sem = { inicio: c.semana, datas: Array.from({ length: 7 }, (_, i) => addDias(c.semana, i)) };
    if (!Array.isArray(c.valores) || c.valores.length !== 7 || c.valores.some(n => typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) || c.valores.reduce((a,b) => a+b,0) > 100000) falha(400, 'Informe sete metas diárias inteiras, não negativas; o total não pode ultrapassar 100.000.');
    tx(() => {
      run('DELETE FROM metas_ritmo_diario WHERE ciclo_id = ? AND polo_id = ? AND tutor_id = ? AND semana = ?', ciclo, polo, tutor, sem.inicio);
      for (let i=0;i<7;i++) run('INSERT INTO metas_ritmo_diario (ciclo_id,polo_id,tutor_id,semana,data,quantidade) VALUES (?,?,?,?,?,?)', ciclo,polo,tutor,sem.inicio,sem.datas[i],c.valores[i]);
      run(`INSERT INTO metas_ritmo_semanal (ciclo_id,polo_id,tutor_id,semana,quantidade) VALUES (?,?,?,?,?) ON CONFLICT(ciclo_id,polo_id,tutor_id,semana) DO UPDATE SET quantidade=excluded.quantidade`, ciclo,polo,tutor,sem.inicio,c.valores.reduce((a,b)=>a+b,0));
    });
    registrar(usuario, 'salvou metas diárias de ritmo', `ciclo ${ciclo}, polo ${polo}, tutor ${tutor}, semana ${sem.inicio}`);
    return enviarJson(res, 200, { ok: true });
  }
  if (p === '/api/painel' && m === 'GET') return enviarJson(res, 200, painel(q, usuario));
  if (p === '/api/ritmo' && m === 'GET') return enviarJson(res, 200, ritmo(q, usuario));
  if (p === '/api/previsao-semana' && m === 'GET') return enviarJson(res, 200, previsaoSemana(q, usuario));
  if (p === '/api/diario' && m === 'GET') return enviarJson(res, 200, diario(q, usuario));
  if (p === '/api/origens-polo' && m === 'GET') return enviarJson(res, 200, origensPolo(q, usuario));

  if (p === '/api/historico' && m === 'GET') {
    exigeAdmin();
    return enviarJson(res, 200, all('SELECT quando, usuario, acao, detalhe FROM historico ORDER BY id DESC LIMIT 300'));
  }

  if (p === '/api/backup-restaurar' && m === 'POST') {
    exigeAdmin();
    const c = await lerCorpo(req,60*1024*1024);
    limitarLogin(req,usuario.login);
    const u = get('SELECT senha_hash FROM usuarios WHERE id=?',usuario.id);
    if (!confereSenha(c.senha||'',u.senha_hash)) falha(403,'Senha de administrador incorreta');
    let r;try { r=restauracao.preparar(DATA_DIR,c.base64); } catch(e){falha(400,e.message);}
    registrar(usuario,'preparou restauração de backup',r.matriculas+' matrícula(s) no backup');
    return enviarJson(res,200,{ok:true,msg:'Backup validado ('+r.matriculas+' matrículas). Feche a janela do servidor e abra iniciar.bat novamente. A restauração será aplicada e a base atual será preservada em dados/backups.'});
  }

  if (p === '/api/backup-agora' && m === 'POST') {
    exigeAdmin();
    const r = backupAutomatico(true);
    registrar(usuario, 'fez backup manual', r.msg);
    return enviarJson(res, r.ok ? 200 : 500, r.ok ? r : { erro: r.msg });
  }
  if (p === '/api/backup-testar' && m === 'POST') {
    exigeAdmin();
    const c = await lerCorpo(req);
    try { testarPasta(String(c.pasta || '').trim()); } catch (e) { falha(400, 'Não consegui gravar nessa pasta: ' + e.message); }
    return enviarJson(res, 200, { ok: true });
  }
  if (p === '/api/backup' && m === 'GET') {
    exigeAdmin();
    const arq = path.join(DATA_DIR, `backup-tmp-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${arq.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(arq); fs.unlinkSync(arq);
    registrar(usuario, 'baixou backup');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="backup-matriculas-${hojeISO()}.db"` });
    return res.end(buf);
  }

  falha(404, 'Rota não encontrada');
}

const servidor = http.createServer(async (req, res) => {
  try { await rotear(req, res); }
  catch (e) {
    const erroChaveEstrangeira = /FOREIGN KEY constraint failed/i.test(String(e && e.message || ''));
    const status = e instanceof HttpError ? e.status : erroChaveEstrangeira ? 409 : 500;
    if (status === 500) console.error(e);
    const mensagem = erroChaveEstrangeira
      ? 'Não foi possível excluir: este cadastro está vinculado a outros dados. Desative o cadastro para preservar o histórico.'
      : status === 500 ? 'Erro interno — veja a janela do servidor' : e.message;
    if (!res.headersSent) enviarJson(res, status, { erro: mensagem });
    else res.end();
  }
});

// Backup automático diário (mantém os últimos 30) + cópia para pasta externa (rede, pendrive, Google Drive…)
function registrarStatusBackup(ok, msg) {
  run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)', 'backup_extra_status', JSON.stringify({ quando: new Date().toLocaleString('pt-BR'), ok, msg }));
}
function limparAntigos(dir, max = 30) {
  const lista = fs.readdirSync(dir).filter(f => /^matriculas-.*\.db$/.test(f)).sort();
  while (lista.length > max) fs.unlinkSync(path.join(dir, lista.shift()));
}
function testarPasta(pasta) {
  if (!pasta || !path.isAbsolute(pasta)) throw new Error('Informe o caminho completo da pasta (ex.: G:\\Meu Drive\\Backup Matrículas ou \\\\SERVIDOR\\backups)');
  fs.mkdirSync(pasta, { recursive: true });
  const teste = path.join(pasta, `.teste-${Date.now()}.tmp`);
  fs.writeFileSync(teste, 'ok'); fs.unlinkSync(teste);
}
function backupAutomatico(forcar = false) {
  let arq;
  try {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    arq = path.join(dir, `matriculas-${hojeISO()}.db`);
    if (forcar && fs.existsSync(arq)) fs.unlinkSync(arq);
    if (!fs.existsSync(arq)) db.exec(`VACUUM INTO '${arq.replace(/'/g, "''")}'`);
    limparAntigos(dir);
  } catch (e) { console.error('Falha no backup automático:', e.message); return { ok: false, msg: 'Falha no backup local: ' + e.message }; }

  const extra = cfg('pasta_backup_extra');
  if (!extra) return { ok: true, msg: 'Backup local feito (pasta externa não configurada)' };
  try {
    testarPasta(extra);
    const destino = path.join(extra, path.basename(arq));
    if (forcar || !fs.existsSync(destino)) fs.copyFileSync(arq, destino);
    limparAntigos(extra);
    registrarStatusBackup(true, `Cópia salva em ${destino}`);
    return { ok: true, msg: `Cópia salva em ${destino}` };
  } catch (e) {
    console.error('Falha na cópia para a pasta externa:', e.message);
    registrarStatusBackup(false, e.message);
    return { ok: false, msg: 'Falha ao copiar para a pasta externa: ' + e.message };
  }
}

let backupInterval = null;
function iniciarRotinasHospedadas() {
  if (backupInterval) return;
  backupAutomatico();
  backupInterval = setInterval(backupAutomatico, 60 * 60 * 1000);
  backupInterval.unref?.();
  let ips = [];
  try { ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address); }
  catch (e) { console.warn('Não foi possível listar endereços locais da rede:', e.message); }
  console.log('');
  console.log('  Sistema de Matrículas rodando!');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Pela rede:         http://${ip}:${PORT}`);
  console.log(`  Banco de dados:    ${DB_FILE}`);
  console.log('');
  console.log('  Deixe esta janela aberta enquanto o sistema estiver em uso.');
}
if (require.main === module) servidor.listen(PORT, process.env.HOST || '0.0.0.0', iniciarRotinasHospedadas);

module.exports = { servidor, db, conciliacaoMA, painel, ritmo, previsaoSemana, diario, origensPolo, ritmoSemanal, paginaTutor, metasTutorCalc, salvarMetasTutor, bootstrap, rotear, validarMatricula, salvarCadastro, dataValida, percentualCalendario, gestao, iniciarRotinasHospedadas };
