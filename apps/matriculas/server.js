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
const VERSAO_APP = '30.4.0';

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
  if (process.env.CENTRAL_BALBINO_EMBEDDED === '1') {
    let portal = null; try { portal = JSON.parse(req.headers['x-balbino-portal'] || 'null'); } catch {}
    if (portal && portal.app === 'matriculas') {
      const tutorMatch = String(portal.account || '').match(/^@tutor:(\d+)$/);
      if (tutorMatch) {
        const tutorId = Number(tutorMatch[1]);
        const tutor = get('SELECT id, nome, ativo, polo_origem_id FROM tutores WHERE id=?', tutorId);
        if (!tutor || !tutor.ativo) return null;
        const vinculos = all('SELECT polo_id FROM tutor_polos WHERE tutor_id=? ORDER BY polo_id', tutorId).map(x => Number(x.polo_id));
        const poloId = vinculos.includes(Number(tutor.polo_origem_id)) ? Number(tutor.polo_origem_id) : (vinculos.length === 1 ? vinculos[0] : 0);
        if (!poloId) return null;
        return { id: -tutorId, nome: tutor.nome, login: String(portal.username || tutor.nome), papel: 'visualizador', polo_id: poloId, tutor_id: tutorId, portal: true };
      }
      const u = portal.account === '@admin'
        ? get("SELECT id,nome,login,papel,polo_id FROM usuarios WHERE ativo=1 AND papel='admin' ORDER BY id LIMIT 1")
        : get('SELECT id,nome,login,papel,polo_id FROM usuarios WHERE ativo=1 AND login=? COLLATE NOCASE', String(portal.account || ''));
      return u ? { id: u.id, nome: u.nome, login: u.login, papel: u.papel, polo_id: u.polo_id } : null;
    }
    return null;
  }
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
  if (usuario.tutor_id && (q.tutor || q.visao === 'individual')) {
    add('m.tutor_id = ?', q.tutor && Number(q.tutor) !== Number(usuario.tutor_id) ? -1 : Number(usuario.tutor_id));
  } else if (q.tutor) add('m.tutor_id = ?', Number(q.tutor));
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
  // feriados da semana (nacionais e do polo) — a meta diária não cai neles
  const feriadosSemana = all(`SELECT data, nome, polo_id FROM feriados WHERE data BETWEEN ? AND ? ${polo ? 'AND (polo_id IS NULL OR polo_id = ?)' : ''}`, inicio, datas[6], ...(polo ? [polo] : []));
  return { inicio, fim:datas[6], hoje:cortePosicao, hoje_real:hoje, datas, tutores, semana_atual: inicio === semanaAtual, editavel: inicio >= semanaAtual, feriados: feriadosSemana, dias_meta: [...diasMetaCfg()] };
}

function painel(q, usuario) {
  validarPeriodo(q);
  const cicloId = Number(q.ciclo);
  if (!cicloId) falha(400, 'Selecione um processo');
  const poloFiltro = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : (Number(q.polo) || 0);
  const ref = dataRef(q);
  // corte: com período escolhido (De/Até), vale o período; senão, conta só até a posição do painel
  const corte = q.ref ? (q.ate && q.ate < ref ? q.ate : ref) : (q.de || q.ate) ? (q.ate || '') : ref;
  const usaMeta = !q.tutor && !q.origem && !q.de && !q.ate;
  const { where: whereMat, params } = filtrosMatricula({ ...q, polo: poloFiltro || '', ate: corte, prazo_meta:usaMeta }, usuario);
  const cacheRa = q._cacheRa || {};
  const raConfirmado = conciliacaoMA.raPorMatricula(cicloId, cacheRa);
  const idsRa = Object.keys(raConfirmado).map(Number).filter(Number.isFinite);
  const where = `${whereMat ? whereMat + ' AND' : 'WHERE'} m.id IN (${idsRa.length ? idsRa.join(',') : '0'})`;
  const totaisBrutos = all(`SELECT COUNT(*) n ${SQL_MAT_BASE} ${whereMat}`, ...params)[0]?.n || 0;
  const totaisConfirmados = all(`SELECT COUNT(*) n ${SQL_MAT_BASE} ${where}`, ...params)[0]?.n || 0;
  const pendentesRa = Math.max(Number(totaisBrutos) - Number(totaisConfirmados), 0);
  const base = (sel, group, order = '') => all(`SELECT ${sel}, COUNT(*) qtd, COALESCE(SUM(m.valor),0) valor ${SQL_MAT_BASE} ${where} ${group ? 'GROUP BY ' + group : ''} ${order}`, ...params);

  const cacheSede = {};
  const ritmoAtualCalc = ritmo({ ciclo: cicloId, polo: poloFiltro, produto: q.produto, categoria: q.categoria, grupo: q.grupo, subgrupo: q.subgrupo, ref: q.ref, sede: usaMeta ? q.sede : '0', _cacheSede: cacheSede, _cacheRa: cacheRa, _serie: usaMeta }, usuario);
  const sedeR = ritmoAtualCalc.hoje_situacao.sede; // Sede/Digital do recorte (só com meta, sem filtros de tutor/origem/período)
  const sel = produtosSel(q);
  const metaProd = metasPorProduto(cicloId, poloFiltro, sel);
  const produtos = all('SELECT id, nome, categoria_id FROM produtos ORDER BY ordem, nome').filter(p => !sel || sel.includes(p.id));
  const categorias = all('SELECT id, nome FROM categorias ORDER BY ordem, nome');

  const oferta = new Set(all(`SELECT DISTINCT produto_id FROM polo_produtos ${poloFiltro ? 'WHERE polo_id = ?' : ''}`, ...(poloFiltro ? [poloFiltro] : [])).map(r => r.produto_id));
  const porProdutoRaw = Object.fromEntries(base('m.produto_id', 'm.produto_id').map(r => [r.produto_id, r]));
  const porProduto = produtos.map(p => {
    const r = porProdutoRaw[p.id] || { qtd: 0, valor: 0 };
    const sd = usaMeta ? (sedeR.por_produto[p.id] || 0) : 0;
    return { id: p.id, nome: p.nome, categoria_id: p.categoria_id, qtd: r.qtd + sd, qtd_tutores: r.qtd, sede: sd, valor: r.valor, meta: usaMeta ? (metaProd[p.id] || 0) : null };
  }).filter(p => p.qtd || p.meta || oferta.has(p.id));

  const porCategoria = categorias.map(c => {
    const ps = porProduto.filter(p => p.categoria_id === c.id);
    return { id: c.id, nome: c.nome, qtd: ps.reduce((a, p) => a + p.qtd, 0), qtd_tutores: ps.reduce((a, p) => a + p.qtd_tutores, 0), sede: ps.reduce((a, p) => a + p.sede, 0), valor: ps.reduce((a, p) => a + p.valor, 0), meta: usaMeta ? ps.reduce((a, p) => a + (p.meta || 0), 0) : null };
  });

  const porOrigemCat = base('m.origem_id, pr.categoria_id', 'm.origem_id, pr.categoria_id');
  const origens = all('SELECT id, nome FROM origens ORDER BY ordem, nome');
  const porOrigem = origens.map(o => {
    const rs = porOrigemCat.filter(r => r.origem_id === o.id);
    return { id: o.id, nome: o.nome, qtd: rs.reduce((a, r) => a + r.qtd, 0), valor: rs.reduce((a, r) => a + r.valor, 0), cat: Object.fromEntries(rs.map(r => [r.categoria_id, r.qtd])) };
  }).filter(o => o.qtd);

  const porPoloCat = base('m.polo_id, pr.categoria_id', 'm.polo_id, pr.categoria_id');
  const metasPolo = all(`SELECT me.polo_id, pr.categoria_id, SUM(me.quantidade) q FROM metas me JOIN produtos pr ON pr.id = me.produto_id WHERE me.ciclo_id = ? ${sel ? `AND me.produto_id IN (${sel.join(',')})` : ''} GROUP BY me.polo_id, pr.categoria_id`, cicloId);
  const polos = all('SELECT id, nome FROM polos ORDER BY ordem, nome').filter(p => !poloFiltro || p.id === poloFiltro);
  // vendas do dia e da semana (desde segunda) — leitura rápida do gestor
  const segunda = inicioSemana(ref); // início da semana de meta (padrão terça)
  const vendasDia = Object.fromEntries(all(`SELECT m.polo_id, COUNT(*) n ${SQL_MAT_BASE} ${where ? where + ' AND' : 'WHERE'} m.data = ? GROUP BY m.polo_id`, ...params, ref).map(r => [r.polo_id, r.n]));
  const vendasSemana = Object.fromEntries(all(`SELECT m.polo_id, COUNT(*) n ${SQL_MAT_BASE} ${where ? where + ' AND' : 'WHERE'} m.data BETWEEN ? AND ? GROUP BY m.polo_id`, ...params, segunda, ref).map(r => [r.polo_id, r.n]));
  const ritmoPolo = {};
  const porPolo = polos.map(p => {
    const rs = porPoloCat.filter(r => r.polo_id === p.id);
    const rp = usaMeta ? ritmo({ ciclo: cicloId, polo: p.id, produto: q.produto, categoria: q.categoria, grupo: q.grupo, subgrupo: q.subgrupo, ref: q.ref, sede: q.sede, _cacheSede: cacheSede, _cacheRa: cacheRa }, { papel: 'admin' }) : null;
    ritmoPolo[p.id] = rp;
    const proxP = rp ? rp.spaces.find(s => s.proximo) : null;
    const ms = metasPolo.filter(r => r.polo_id === p.id);
    const qtdT = rs.reduce((a, r) => a + r.qtd, 0), sdP = rp ? rp.hoje_situacao.sede.total : 0;
    return {
      id: p.id, nome: p.nome, qtd: qtdT + sdP, qtd_tutores: qtdT, sede: sdP, sede_fonte: rp ? rp.hoje_situacao.sede.fonte : null, sede_por_produto: rp ? rp.hoje_situacao.sede.por_produto : {}, sede_sem_produto: rp ? rp.hoje_situacao.sede.sem_produto : 0, valor: rs.reduce((a, r) => a + r.valor, 0),
      vendas_dia: vendasDia[p.id] || 0, vendas_semana: vendasSemana[p.id] || 0,
      meta: usaMeta ? ms.reduce((a, r) => a + r.q, 0) : null,
      cat: Object.fromEntries(rs.map(r => [r.categoria_id, r.qtd])),
      catMeta: Object.fromEntries(ms.map(r => [r.categoria_id, r.q])),
      catValor: Object.fromEntries(rs.map(r => [r.categoria_id, r.valor])),
      hojeCat: rp ? Object.fromEntries(rp.hoje_situacao.linhas.map(l => [l.categoria_id, { esperado: l.esperado, realizado: l.realizado, meta: l.meta, saldo: l.saldo }])) : {},
      hoje: rp ? { saldo: rp.hoje_situacao.total.saldo, status: rp.hoje_situacao.total.status, esperado: rp.hoje_situacao.total.esperado } : null,
      proximo: proxP ? { nome: proxP.nome, falta: proxP.total.falta, por_dia: proxP.total.por_dia } : null,
      final: rp && rp.final ? { falta: rp.final.total.falta, por_dia: rp.final.total.por_dia } : null,
    };
  }).filter(p => p.qtd || p.meta);

  const whereTutor = where.replace(/m\.polo_id = \?/g, 'COALESCE(m.tutor_polo_id,m.polo_id) = ?');
  const porTutorCat = all(`SELECT m.tutor_id, COALESCE(m.tutor_polo_id,m.polo_id) polo_id, pr.categoria_id, MAX(m.data) ultima, COUNT(*) qtd, COALESCE(SUM(m.valor),0) valor ${SQL_MAT_BASE} ${whereTutor} GROUP BY 1,2,3`, ...params);
  const tutoresMap = {};
  const nomesT = Object.fromEntries(all('SELECT id, nome FROM tutores').map(t => [t.id, t.nome]));
  const nomesP = Object.fromEntries(all('SELECT id, nome FROM polos').map(t => [t.id, t.nome]));
  const novo = (tid, pid) => ({ tutor_id: tid, polo_id: pid, nome: nomesT[tid], polo: nomesP[pid], qtd: 0, valor: 0, cat: {}, ultima: null });
  // equipe ativa do(s) polo(s) — aparece mesmo sem matrícula
  if (!q.tutor) {
    for (const r of all(`SELECT tp.tutor_id, tp.polo_id FROM tutor_polos tp JOIN tutores t ON t.id = tp.tutor_id JOIN polos p ON p.id = tp.polo_id
                         WHERE t.ativo = 1 AND p.ativo = 1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id=tp.polo_id) ${poloFiltro ? 'AND tp.polo_id = ?' : ''}`, ...(poloFiltro ? [poloFiltro] : [])))
      tutoresMap[`${r.tutor_id}-${r.polo_id}`] = novo(r.tutor_id, r.polo_id);
  }
  for (const r of porTutorCat) {
    const k = `${r.tutor_id}-${r.polo_id}`;
    tutoresMap[k] ??= novo(r.tutor_id, r.polo_id);
    const t = tutoresMap[k];
    t.qtd += r.qtd; t.valor += r.valor; t.cat[r.categoria_id] = r.qtd;
    if (!t.ultima || r.ultima > t.ultima) t.ultima = r.ultima;
  }
  const modoDias = cfg('contagem_dias', 'seg-sex');
  const hoje = ref;
  const porTutor = Object.values(tutoresMap).map(t=>{
    const cadastro=get('SELECT ativo,polo_origem_id FROM tutores WHERE id=?',t.tutor_id),vinculo=!!get('SELECT 1 FROM tutor_polos WHERE tutor_id=? AND polo_id=?',t.tutor_id,t.polo_id);
    const atual=!!(cadastro?.ativo && vinculo && (!cadastro.polo_origem_id||cadastro.polo_origem_id===t.polo_id));
    return {...t,atual,situacao:atual?'ativo':!cadastro?.ativo?'inativo':!vinculo?'sem_vinculo':'transferido'};
  }).filter(t=>t.atual || (q.historico==='1' && t.qtd>0)).map(t => ({
    ...t, dias_sem_venda: t.ultima ? contarDias(addDias(t.ultima, 1), hoje, modoDias, feriadosDe(t.polo_id)) : null,
  })).sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));

  // ---- Meta do tutor no processo: individual (Configuração › Metas e Spaces › Meta por tutor) ou, sem nenhuma no polo,
  //      a meta do polo dividida igualmente pela equipe ativa. Com filtro de produto vale a fatia proporcional.
  //      Esperado/SAVE-GAP do tutor usam o mesmo % previsto do polo.
  const temMetaTutor = usaMeta && porTutor.length > 0;
  if (temMetaTutor) {
    const mt = metasTutorCalc(cicloId);
    const mTot = {}, mSel = {};
    for (const r of all('SELECT polo_id, produto_id, quantidade q FROM metas WHERE ciclo_id = ?', cicloId)) {
      mTot[r.polo_id] = (mTot[r.polo_id] || 0) + r.q;
      if (!sel || sel.includes(r.produto_id)) mSel[r.polo_id] = (mSel[r.polo_id] || 0) + r.q;
    }
    for (const t of porTutor) {
      const individualHistorica=!t.atual?get('SELECT quantidade FROM metas_tutor WHERE ciclo_id=? AND polo_id=? AND tutor_id=?',cicloId,t.polo_id,t.tutor_id):null;
      const b = individualHistorica?{quantidade:individualHistorica.quantidade,origem:'individual'}:mt[`${t.polo_id}-${t.tutor_id}`], rp = ritmoPolo[t.polo_id];
      if (!b || !rp || !mTot[t.polo_id]) continue;
      const meta = b.quantidade * (mSel[t.polo_id] || 0) / mTot[t.polo_id];
      if (!meta) continue;
      t.meta = Math.round(meta * 10) / 10; t.meta_origem = b.origem;
      t.esperado = rp.hoje_situacao.percentual == null ? null : Math.round(meta * rp.hoje_situacao.percentual / 100); t.saldo = t.esperado == null ? null : t.qtd - t.esperado;
      const px = rp.spaces.find(s => s.proximo);
      if (px) { const e = Math.ceil(meta * px.percentual / 100), f = Math.max(e - t.qtd, 0); t.proximo = { nome: px.nome, esperado: e, falta: f, por_dia: px.dias > 0 ? f / px.dias : null }; }
    }
  }

  const externasRecebidas = all(`SELECT m.tutor_id,tu.nome tutor,m.polo_id,po.nome polo_destino,
    COALESCE(m.tutor_polo_id,m.polo_id) polo_origem_id,
    (SELECT nome FROM polos WHERE id=COALESCE(m.tutor_polo_id,m.polo_id)) polo_origem,
    m.produto_id,pr.nome produto,COUNT(*) qtd,COALESCE(SUM(m.valor),0) valor
    ${SQL_MAT_BASE} ${where ? where+' AND' : 'WHERE'} COALESCE(m.tutor_polo_id,m.polo_id)<>m.polo_id
    GROUP BY 1,3,5,7 ORDER BY tu.nome,po.nome,pr.ordem`,...params);
  const porDia = base('m.data', 'm.data', 'ORDER BY m.data');

  // ---- Ticket e RPV no padrão do BI da Unicesumar:
  //      Ticket = mensalidade média (com desconto)            · Meta de ticket cadastrada por polo/produto (linha "Padrão" = todos)
  //      RPV    = receita = Σ mensalidades (matrículas × ticket) · Meta de RPV = Σ (meta de matrículas × meta de ticket)
  //      Meta de ticket de um grupo = Meta de RPV ÷ Meta de matrículas (como no BI). Atingimento RPV = RPV real ÷ meta de RPV.
  //      Para tutor, origem e semana (que não têm meta de matrículas) a meta de ticket é ponderada pelo que foi vendido.
  const rpvRows = all(`SELECT m.polo_id, m.produto_id, pr.categoria_id, m.origem_id, m.tutor_id,
      date(m.data, printf('-%d days', (CAST(strftime('%w', m.data) AS INTEGER) - ${inicioSemanaCfg()} + 7) % 7)) semana, COUNT(*) qtd, COALESCE(SUM(m.valor),0) valor
      ${SQL_MAT_BASE} ${where} GROUP BY 1, 2, 3, 4, 5, 6`, ...params);
  const rpvTutorRows = all(`SELECT COALESCE(m.tutor_polo_id,m.polo_id) polo_id, m.produto_id, pr.categoria_id, m.tutor_id, COUNT(*) qtd, COALESCE(SUM(m.valor),0) valor ${SQL_MAT_BASE} ${whereTutor} GROUP BY 1,2,3,4`, ...params);
  // Detalhamento por produto usa o mesmo recorte e permissões dos totais.
  for (const polo of porPolo) {
    polo.produtos = {}; polo.metaProdutos = {};
    for (const r of rpvRows.filter(x => x.polo_id === polo.id)) polo.produtos[r.produto_id] = (polo.produtos[r.produto_id] || 0) + r.qtd;
    for (const [pid, n] of Object.entries(polo.sede_por_produto || {})) polo.produtos[pid] = (polo.produtos[pid] || 0) + n;
    for (const m of all('SELECT produto_id, quantidade FROM metas WHERE ciclo_id=? AND polo_id=?', cicloId, polo.id)) if (!sel || sel.includes(m.produto_id)) polo.metaProdutos[m.produto_id] = m.quantidade;
    const rp = ritmoPolo[polo.id];
    polo.hojeProduto = rp ? Object.fromEntries(rp.hoje_situacao.linhas.flatMap(l => l.produtos.map(x => [x.produto_id, x]))) : {};
  }
  for (const o of porOrigem) { o.produtos = {}; for (const r of rpvRows.filter(x => x.origem_id === o.id)) o.produtos[r.produto_id] = (o.produtos[r.produto_id] || 0) + r.qtd; }
  for (const t of porTutor) { t.produtos = {}; for (const r of rpvTutorRows.filter(x => x.tutor_id === t.tutor_id && x.polo_id === t.polo_id)) t.produtos[r.produto_id] = (t.produtos[r.produto_id] || 0) + r.qtd; }
  const tkMap = {};
  for (const r of all('SELECT polo_id, produto_id, valor FROM metas_rpv WHERE ciclo_id = ?', cicloId)) tkMap[`${r.polo_id}-${r.produto_id}`] = r.valor;
  const tkDe = (polo, prod) => tkMap[`${polo}-${prod}`] ?? tkMap[`0-${prod}`] ?? null;
  const metasQtd = all('SELECT polo_id, produto_id, quantidade q FROM metas WHERE ciclo_id = ?', cicloId);
  const prodCatMap = Object.fromEntries(all('SELECT id, categoria_id FROM produtos').map(p => [p.id, p.categoria_id]));
  const polosVis = poloFiltro ? [poloFiltro] : all('SELECT id FROM polos WHERE ativo = 1').map(p => p.id);
  const temTicket = Object.keys(tkMap).length > 0;
  const grupo = (filtro, filtroMeta, fonte = rpvRows) => {
    let q = 0, v = 0, qm = 0, alvoMix = 0;
    for (const r of fonte) {
      if (!filtro(r)) continue;
      q += r.qtd; v += r.valor;
      const mt = tkDe(r.polo_id, r.produto_id);
      if (mt != null) { qm += r.qtd; alvoMix += r.qtd * mt; }
    }
    let ticketMeta = null, rpvMeta = null, metaQtdTotal=0,metaQtdCoberta=0;
    if (filtroMeta && usaMeta) {
      let mq = 0, ma = 0;
      for (const m of metasQtd) {
        if (!polosVis.includes(m.polo_id) || !filtroMeta(m.polo_id, m.produto_id) || !m.q) continue;
        metaQtdTotal+=m.q;
        const mt = tkDe(m.polo_id, m.produto_id); if (mt == null) continue;
        mq += m.q; ma += m.q * mt;
      }
      metaQtdCoberta=mq;
      if (mq) { ticketMeta = ma / mq; rpvMeta = ma; }
    }
    if (ticketMeta == null && qm) ticketMeta = alvoMix / qm;
    const ticket = q ? v / q : null;
    return {
      ticket, ticket_meta: ticketMeta, ticket_dif: ticket != null && ticketMeta != null ? ticket - ticketMeta : null,
      meta_qtd_total:metaQtdTotal, meta_qtd_coberta:metaQtdCoberta, meta_rpv_parcial:metaQtdTotal>metaQtdCoberta,
      rpv_real: v, rpv_meta: rpvMeta, rpv_ating: rpvMeta && metaQtdTotal===metaQtdCoberta ? v / rpvMeta : null,
      ticket_contexto:usaMeta&&filtroMeta?'meta_processo':'mix_vendido',
    };
  };
  const okSel = (prod) => !sel || sel.includes(prod);
  for (const p of porProduto) Object.assign(p, grupo(r => r.produto_id === p.id, (po, pr) => pr === p.id));
  for (const c of porCategoria) Object.assign(c, grupo(r => r.categoria_id === c.id, (po, pr) => prodCatMap[pr] === c.id && okSel(pr)));
  for (const p of porPolo) Object.assign(p, grupo(r => r.polo_id === p.id, (po, pr) => po === p.id && okSel(pr)));
  for (const o of porOrigem) Object.assign(o, grupo(r => r.origem_id === o.id));
  for (const t of porTutor) Object.assign(t, grupo(r => r.tutor_id === t.tutor_id && r.polo_id === t.polo_id, null, rpvTutorRows));
  const rpvGrupo = grupo;
  const semanasSet = [...new Set(rpvRows.map(r => r.semana))].sort();
  const rpvSemanas = semanasSet.map(sm => ({ semana: sm, qtd: rpvRows.filter(r => r.semana === sm).reduce((a, r) => a + r.qtd, 0), ...rpvGrupo(r => r.semana === sm) }));

  const semProdR = usaMeta ? (sedeR.sem_produto || 0) : 0;
  const tot = { qtd: porCategoria.reduce((a, c) => a + c.qtd, 0) + semProdR, qtd_tutores: porCategoria.reduce((a, c) => a + c.qtd_tutores, 0), sede: porCategoria.reduce((a, c) => a + c.sede, 0) + semProdR, sede_sem_produto: semProdR, sede_fonte: sedeR.fonte || null, valor: porCategoria.reduce((a, c) => a + c.valor, 0), meta: usaMeta ? porCategoria.reduce((a, c) => a + c.meta, 0) : null };

  Object.assign(tot, rpvGrupo(() => true, (po, pr) => okSel(pr)));
  const ritmoAtual = ritmoAtualCalc;
  const serie = ritmoAtual.serie || [];
  return { pendentes_ra: pendentesRa, externasRecebidas, total_credito_tutores:{qtd:porTutor.reduce((n,t)=>n+t.qtd,0),valor:porTutor.reduce((n,t)=>n+t.valor,0)}, produtosEquipe:all('SELECT id,nome FROM produtos ORDER BY ordem,nome').filter(p=>porProduto.some(x=>x.id===p.id)||porTutor.some(t=>t.produtos[p.id])), sede: { ligada: !!sedeR.ligada, total: tot.sede || 0, fonte: sedeR.fonte || null, posicoes: sedeR.posicoes || [], sem_detalhe_produto: !!sedeR.sem_detalhe_produto }, tem_meta_ticket: temTicket, rpvSemanas, totais: tot, categorias, porCategoria, porProduto, porOrigem, porPolo, porTutor, porDia, usaMeta, ritmo: ritmoAtual, serie: serie.slice(-90),
    tem_meta_tutor: temMetaTutor && porTutor.some(t => t.meta != null), ref, segunda,
    vendas: { dia: Object.values(vendasDia).reduce((a, n) => a + n, 0), semana: Object.values(vendasSemana).reduce((a, n) => a + n, 0) } };
}

// Ritmo Space + SAVE/GAP "esperado até hoje"
//  Entre dois Spaces, o % da meta cresce de forma linear por dia útil (do início do ciclo até o 1º Space, do 1º ao 2º, …).
//  esperado hoje = meta × % acumulado previsto para hoje
//  SAVE / GAP    = realizado até hoje − esperado hoje   (≥ 0 → SAVE, < 0 → GAP)
//  Precisa/dia   = (esperado na data − realizado) ÷ dias úteis restantes (contando hoje)
// ref = data de referência ("fotografia" de um dia, usada no resumo do WhatsApp); sem ref = hoje
// Posição padrão do painel = HOJE (config "lancamento" = mesmo_dia, o padrão). Opcional: "dia_seguinte" abre no último dia fechado,
// então o padrão é o ÚLTIMO DIA FECHADO: o dia de contagem anterior a hoje (segunda → sábado ou sexta, pulando feriados).
// Com "mesmo_dia", a posição é hoje.
function refPadrao() {
  const hoje = hojeISO();
  if (cfg('lancamento', 'mesmo_dia') !== 'dia_seguinte') return hoje;
  const modo = cfg('contagem_dias', 'seg-sex'), fer = feriadosDe(0);
  let d = addDias(hoje, -1);
  for (let i = 0; i < 10 && contarDias(d, d, modo, fer) === 0; i++) d = addDias(d, -1);
  return d;
}
const dataRef = (q) => { validarPeriodo(q); return q.ref || refPadrao(); };
function ritmo(q, usuario) {
  const cicloId = Number(q.ciclo);
  const poloId = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : (Number(q.polo) || 0);
  const modo = cfg('contagem_dias', 'seg-sex');
  const hoje = dataRef(q);
  const fer = feriadosDe(poloId);
  const ciclo = get('SELECT * FROM ciclos WHERE id = ?', cicloId) || {};
  const categorias = all('SELECT id, nome FROM categorias ORDER BY ordem, nome');
  const sel = produtosSel(q);
  const metaProd = metasPorProduto(cicloId, poloId, sel);
  const prodCat = Object.fromEntries(all('SELECT id, categoria_id FROM produtos').map(p => [p.id, p.categoria_id]));
  const metaCat = {};
  for (const [pid, qn] of Object.entries(metaProd)) metaCat[prodCat[pid]] = (metaCat[prodCat[pid]] || 0) + qn;

  const raConfirmado = conciliacaoMA.raPorMatricula(cicloId, q._cacheRa || {});
  const idsRa = Object.keys(raConfirmado).map(Number).filter(Number.isFinite);
  const filtroPolo = (poloId ? 'AND m.polo_id = ? ' : '') + `AND m.id IN (${idsRa.length ? idsRa.join(',') : '0'})` + (sel ? ` AND m.produto_id IN (${sel.length ? sel.join(',') : 0})` : '');
  const pp = poloId ? [poloId] : [];
  const realPorCatAte = (data) => Object.fromEntries(all(`SELECT pr.categoria_id, COUNT(*) n FROM matriculas m JOIN produtos pr ON pr.id = m.produto_id
      WHERE m.ciclo_id = ? AND m.data <= ? ${filtroPolo} GROUP BY pr.categoria_id`, cicloId, data, ...pp).map(r => [r.categoria_id, r.n]));

  // produto com prazo próprio só conta matrículas até o prazo (a meta dele é daquele período)
  const realTutoresAte = (data) => Object.fromEntries(all(`SELECT m.produto_id, pr.meta_ate, COUNT(*) n FROM matriculas m JOIN produtos pr ON pr.id = m.produto_id
      WHERE m.ciclo_id = ? AND m.data <= ? AND (pr.meta_ate IS NULL OR pr.meta_ate = '' OR m.data <= pr.meta_ate) ${filtroPolo} GROUP BY m.produto_id`, cicloId, data, ...pp).map(r => [r.produto_id, r.n]));
  // Sede/Digital (Mundo Azul − lançadas pelos tutores) entra no realizado do polo/produto, na granularidade comprovada.
  // Produto com prazo próprio usa a posição oficial vigente até o prazo. "Sem produto" (só total do polo) entra só no total.
  const sedeOn = conciliacaoMA.sedeLigada(q), cacheSede = q._cacheSede || {};
  const sedeEm = (data) => sedeOn ? conciliacaoMA.extrasSede(cicloId, poloId, data, cacheSede) : null;
  const sedeProdAte = (data) => {
    const e = sedeEm(data); if (!e) return {};
    const out = {};
    for (const pid of Object.keys(e.porProduto).map(Number)) {
      if (sel && !sel.includes(pid)) continue;
      const n = prazo[pid] && data > prazo[pid] ? (sedeEm(prazo[pid]).porProduto[pid] || 0) : e.porProduto[pid];
      if (n) out[pid] = n;
    }
    return out;
  };
  const sedeSemProdutoAte = (data) => { const e = sedeEm(data); return e && !sel ? e.semProduto : 0; };
  const realPorProdAte = (data) => { const r = realTutoresAte(data); for (const [pid, n] of Object.entries(sedeProdAte(data))) r[pid] = (r[pid] || 0) + n; return r; };
  // produtos de cada categoria (para abrir a linha da categoria quando ela tem mais de um produto, ex.: HÍBRIDO)
  const prodsCat = {};
  const prazo = {}; // produto → data final própria da meta (ex.: Pós = 31/12/2026)
  for (const p of all('SELECT id, nome, categoria_id, meta_ate FROM produtos ORDER BY ordem, nome')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.meta_ate || '')) prazo[p.id] = p.meta_ate;
    if (!sel || sel.includes(p.id)) (prodsCat[p.categoria_id] ??= []).push(p);
  }
  const subLinhas = (catId, montarLinha) => {
    const ps = (prodsCat[catId] || []).map(montarLinha).filter(l => l.meta || l.realizado);
    return ps;
  };
  const primeira = (get('SELECT MIN(data) d FROM matriculas WHERE ciclo_id = ?', cicloId) || {}).d;
  const inicio = ciclo.data_inicio || primeira || hoje;
  const decorridos = contarDias(inicio, hoje, modo, fer);
  const spaces = all('SELECT id, nome, data, percentual FROM spaces WHERE ciclo_id = ? ORDER BY data', cicloId);
  const proximo = spaces.find(s => s.data >= hoje) || null;

  // % da meta previsto para hoje (interpolado por dias úteis dentro do período do Space atual)
  let pctHoje = percentualCalendario(ciclo, spaces, hoje, modo, fer), periodo = null;
  if (hoje < inicio) pctHoje = 0;
  else if (proximo) {
    const idx = spaces.indexOf(proximo);
    const ant = idx > 0 ? spaces[idx - 1] : null;
    const iniPer = ant ? addDias(ant.data, 1) : inicio;
    const pctIni = ant ? ant.percentual : 0;
    const total = contarDias(iniPer, proximo.data, modo, fer);
    const feitos = contarDias(iniPer, hoje, modo, fer);
    pctHoje = total > 0 ? pctIni + (proximo.percentual - pctIni) * Math.min(feitos / total, 1) : proximo.percentual;
    periodo = { inicio: iniPer, fim: proximo.data, dias_total: total, dias_feitos: feitos, pct_inicio: pctIni };
  }

  const realHojeProd = realPorProdAte(hoje);
  const catDe = (realP) => { const o = {}; for (const [pid, n] of Object.entries(realP)) { const c = prodCat[pid]; if (c && (!sel || sel.includes(Number(pid)))) o[c] = (o[c] || 0) + n; } return o; };
  const realHoje = catDe(realHojeProd);
  // % previsto numa data para produto com prazo próprio: linear pelos dias de contagem, do início do processo até o prazo
  const pctPrazo = (pid, data) => {
    const fim = prazo[pid]; if (data < inicio) return 0; if (data >= fim) return 100;
    const tot = contarDias(inicio, fim, modo, fer); return tot > 0 ? Math.min(100, contarDias(inicio, data, modo, fer) / tot * 100) : 100;
  };
  const totaliza = (linhas, campos) => linhas.reduce((a, l) => { for (const c of campos) a[c] = (a[c] || 0) + (l[c] || 0); return a; }, {});
  const status = (saldo) => saldo == null ? null : saldo >= 0 ? 'SAVE' : 'GAP';
  // Distribuição proporcional pelo maior resto, determinística por ID.
  // Cada recorte preserva exatamente o total calculado sobre sua própria meta.
  // percentual pode variar por produto (prazo próprio) — pctDe(id)
  const distribuir = (percentual, arredondar, data = null) => {
    const pctDe = (id) => prazo[id] && data ? pctPrazo(id, data) : percentual;
    const linhas = Object.entries(metaProd).map(([id, meta]) => {
      const pc = pctDe(Number(id));
      const bruto = pc == null ? 0 : meta * pc / 100, inteiro = Math.floor(bruto);
      return { id: Number(id), inteiro, resto: bruto-inteiro };
    });
    const total = arredondar(linhas.reduce((n,x) => n+x.inteiro+x.resto,0) - 1e-9);
    let sobras = total-linhas.reduce((n,x)=>n+x.inteiro,0);
    linhas.sort((a,b)=>b.resto-a.resto || a.id-b.id);
    for (const item of linhas) if (sobras > 0) { item.inteiro++; sobras--; }
    return Object.fromEntries(linhas.map(x=>[x.id, metaProd[x.id] && pctDe(x.id) == null ? null : x.inteiro]));
  };
  const esperadoHojePorProduto = distribuir(pctHoje, Math.round, hoje);

  // Situação de hoje
  const hojeLinhas = categorias.map(c => {
    const meta = metaCat[c.id] || 0;
    const realizado = realHoje[c.id] || 0;
    const produtos = subLinhas(c.id, p => {
      const mp = metaProd[p.id] || 0, ep = esperadoHojePorProduto[p.id] ?? (mp ? null : 0), rp = realHojeProd[p.id] || 0;
      return { produto_id: p.id, nome: p.nome, meta: mp, esperado: ep, realizado: rp, saldo: ep == null ? null : rp - ep, status: status(ep == null ? null : rp - ep), meta_ate: prazo[p.id] || null };
    });
    const esperado = somaConhecida(produtos,'esperado'), saldo = esperado == null ? null : realizado - esperado;
    return { categoria_id: c.id, categoria: c.nome, meta, esperado, realizado, saldo, status: status(saldo), produtos };
  }).filter(l => l.meta || l.realizado);
  const hT = totaliza(hojeLinhas, ['meta', 'esperado', 'realizado']);
  const semProdHoje = sedeSemProdutoAte(hoje);
  hT.realizado = (hT.realizado || 0) + semProdHoje;
  hT.esperado = somaConhecida(hojeLinhas,'esperado');
  hT.saldo = hT.esperado == null ? null : hT.realizado - hT.esperado; hT.status = status(hT.saldo);
  const sedeHoje = sedeEm(hoje), sedeProdHoje = sedeProdAte(hoje);
  const sedeInfo = sedeOn ? { ligada: true, fonte: sedeHoje.fonte, posicoes: sedeHoje.posicoes, por_produto: sedeProdHoje, sem_produto: semProdHoje,
    total: Object.values(sedeProdHoje).reduce((a, n) => a + n, 0) + semProdHoje, sem_detalhe_produto: !!sel && !!sedeHoje.semProduto } : { ligada: false, total: 0, por_produto: {}, sem_produto: 0 };
  const situacaoHoje = { percentual: hT.meta && hT.esperado != null ? hT.esperado/hT.meta*100 : null, aguardando_spaces: !spaces.length, periodo, linhas: hojeLinhas, total: hT, sede: sedeInfo };

  // Cada Space (e a meta final): esperado na data, realizado até a data, quanto falta e quanto precisa por dia
  const montar = (data, percentual) => {
    const passado = data < hoje;
    const realP = passado ? realPorProdAte(data) : realHojeProd;
    const real = passado ? catDe(realP) : realHoje;
    // dias que ainda dá para vender: a partir de hoje (se a posição é de um dia já fechado, hoje ainda conta)
    const iniRest = hoje;
    const dias = contarDias(iniRest, data, modo, fer);
    const esperadoPorProduto = distribuir(percentual, Math.ceil, data);
    // dias restantes de cada produto: com prazo próprio, conta só até o prazo
    const diasDe = (pid) => prazo[pid] ? (iniRest > prazo[pid] ? 0 : contarDias(iniRest, data < prazo[pid] ? data : prazo[pid], modo, fer)) : dias;
    const linhas = categorias.map(c => {
      const meta = metaCat[c.id] || 0;
      const realizado = real[c.id] || 0;
      const produtos = subLinhas(c.id, p => {
        const mp = metaProd[p.id] || 0, ep = esperadoPorProduto[p.id] || 0, rp = realP[p.id] || 0, fp = Math.max(ep - rp, 0), dp = diasDe(p.id);
        const passadoP = passado || (prazo[p.id] && prazo[p.id] < hoje && data >= prazo[p.id]);
        return { produto_id: p.id, nome: p.nome, meta: mp, esperado: ep, realizado: rp, falta: fp, por_dia: (!spaces.length && !prazo[p.id]) ? null : (dp > 0 ? fp / dp : null), saldo: passadoP ? rp - ep : null, status: status(passadoP ? rp - ep : null), meta_ate: prazo[p.id] || null };
      });
      const esperado = produtos.reduce((n,p) => n+p.esperado,0), falta = Math.max(esperado - realizado, 0);
      const saldo = passado ? realizado - esperado : null;
      // precisa por dia = soma do que cada produto precisa por dia (produto com prazo próprio usa os dias até o prazo)
      const temPrazo = produtos.some(p => p.meta_ate);
      const porDia = produtos.some(p => p.falta > 0 && p.por_dia == null) ? null : temPrazo ? produtos.reduce((a, p) => a + (p.por_dia || 0), 0) : (dias > 0 ? falta / dias : null);
      return { categoria_id: c.id, categoria: c.nome, meta, esperado, realizado, falta, por_dia: porDia, saldo, status: status(saldo), produtos };
    }).filter(l => l.meta || l.realizado);
    const t = totaliza(linhas, ['meta', 'esperado', 'realizado', 'falta']);
    t.realizado = (t.realizado || 0) + sedeSemProdutoAte(passado ? data : hoje);
    t.falta = Math.max(t.esperado - t.realizado, 0);
    t.por_dia = linhas.some(l => l.falta > 0 && l.por_dia == null) ? null : linhas.some(l => l.produtos.some(p => p.meta_ate)) ? linhas.reduce((a, l) => a + (l.por_dia || 0), 0) : (dias > 0 ? t.falta / dias : null);
    t.saldo = passado ? t.realizado - t.esperado : null; t.status = status(t.saldo);
    return { dias, passado, linhas, total: t };
  };

  const lista = spaces.map(s => ({ ...s, proximo: proximo ? s.id === proximo.id : false, ...montar(s.data, s.percentual) }));
  const dataFinal = ciclo.data_fim || (spaces.length ? spaces[spaces.length - 1].data : null);
  const final = dataFinal ? { nome: 'Meta final', data: dataFinal, percentual: 100, ...montar(dataFinal, 100) } : null;
  const serie = [];
  if (q._serie) {
    const iniSerie = inicio > addDias(hoje,-89) ? inicio : addDias(hoje,-89);
    for (let data = iniSerie; data <= hoje; data = addDias(data,1)) {
      const pp = distribuir(percentualCalendario(ciclo,spaces,data,modo,fer),Math.round,data);
      const conhecidos = Object.entries(metaProd).filter(([,n])=>n>0).map(([pid])=>pp[pid]);
      const esperado = conhecidos.some(x=>x==null) ? null : conhecidos.reduce((a,n)=>a+n,0);
      const realizado = Object.values(realPorProdAte(data)).reduce((a,n)=>a+n,0) + sedeSemProdutoAte(data);
      serie.push({data, esperado, realizado});
    }
  }
  // Detalhamento opcional: mantém as demais consultas leves e usa as mesmas fontes oficiais.
  const acompanhamento = {};
  if (q.relatorio === '1') for (const [pidTxt, fim] of Object.entries(prazo)) {
    const pid = Number(pidTxt);
    if (sel && !sel.includes(pid)) continue;
    const meta = metaProd[pid] || 0, realizado = realHojeProd[pid] || 0;
    const de = hoje < inicio ? inicio : hoje;
    const dias = contarDias(de, fim, modo, fer);
    const fimSemana = addDias(inicioSemana(de), 6);
    const diasSemana = contarDias(de, fimSemana < fim ? fimSemana : fim, modo, fer);
    const falta = Math.max(0, meta - realizado);
    const semanas = [];
    for (let n = 3; n >= 0; n--) {
      const ini = addDias(inicioSemana(hoje), -7*n), limite = addDias(ini, 6);
      const ate = [limite, hoje, fim].sort()[0];
      const antes = realPorProdAte(addDias(ini, -1))[pid] || 0;
      const acumulado = realPorProdAte(ate)[pid] || 0;
      semanas.push({inicio:ini, fim:limite, ate, variacao:ate < ini || ate < inicio ? 0 : acumulado-antes, acumulado:ate < inicio ? 0 : acumulado, parcial:ate < limite});
    }
    acompanhamento[pid] = {dias, dias_semana:diasSemana, por_dia:meta > 0 && dias > 0 ? falta/dias : null,
      necessario_semana:meta > 0 && dias > 0 ? Math.ceil(falta/dias*diasSemana) : null,
      tutores:realTutoresAte(hoje)[pid] || 0, sede:sedeProdHoje[pid] || 0, semanas};
  }
  return { acompanhamento, serie, aguardando_spaces: !spaces.length, modo, hoje, inicio, inicio_estimado: !ciclo.data_inicio, decorridos, proximo_id: proximo ? proximo.id : null, hoje_situacao: situacaoHoje, spaces: lista, final, prazos: prazo };
}

// ---------------------------------------------------------------- origens por polo
// Matrículas lançadas por origem × polo do aluno, num período do processo (padrão: do início até a posição).
// Sede/Digital não tem origem: aparece à parte, por polo.
function origensPolo(q, usuario) {
  validarPeriodo(q);
  const cicloId = Number(q.ciclo);
  const ciclo = get('SELECT * FROM ciclos WHERE id = ?', cicloId); if (!ciclo) falha(400, 'Selecione um processo');
  const ref = q.ref || refPadrao(), restrito = poloRestrito(usuario);
  const ate = q.ate && dataValida(q.ate) ? q.ate : ref;
  const de = q.de && dataValida(q.de) ? q.de : (ciclo.data_inicio || '2000-01-01');
  if (de > ate) falha(400, 'A data inicial deve ser anterior ou igual à final');
  const polos = all('SELECT id, nome FROM polos WHERE ativo = 1 ORDER BY ordem, nome').filter(p => !restrito || p.id === restrito);
  const ids = polos.map(p => p.id);
  const sel = produtosSel(q);
  const filtroProd = sel ? `AND m.produto_id IN (${sel.length ? sel.join(',') : 0})` : '';
  const linhas = ids.length ? all(`SELECT m.origem_id, m.polo_id, COUNT(*) n, COALESCE(SUM(m.valor), 0) valor FROM matriculas m
    WHERE m.ciclo_id = ? AND m.data BETWEEN ? AND ? AND m.polo_id IN (${ids.join(',')}) ${filtroProd} GROUP BY 1, 2`, cicloId, de, ate) : [];
  const origens = all('SELECT id, nome, ordem, ativo FROM origens ORDER BY ordem, nome').filter(o => o.ativo || linhas.some(l => l.origem_id === o.id));
  const sede = {};
  if (conciliacaoMA.sedeLigada(q)) {
    const cache = {};
    for (const p of polos) {
      const a = conciliacaoMA.extrasSede(cicloId, p.id, ate, cache), b = de > (ciclo.data_inicio || '') ? conciliacaoMA.extrasSede(cicloId, p.id, addDias(de, -1), cache) : { porProduto: {} };
      const soma = (x) => Object.entries(x.porProduto).filter(([pid]) => !sel || sel.includes(Number(pid))).reduce((n, [, v]) => n + v, 0);
      const n = soma(a) - soma(b); if (n > 0) sede[p.id] = n;
    }
  }
  return { de, ate, polos, origens: origens.map(o => ({ id: o.id, nome: o.nome })), linhas, sede };
}

// ---------------------------------------------------------------- dia a dia por polo
// Por polo e por dia: matrículas lançadas (polo do aluno) + Sede/Digital da lista do Mundo Azul (data do pagamento).
// Meta do dia = esperado acumulado no dia − esperado acumulado no dia anterior (calendário oficial do polo).
// Sede/Digital que vem só do print (sem data) aparece à parte, no total.
function diario(q, usuario) {
  validarPeriodo(q);
  const cicloId = Number(q.ciclo);
  if (!get('SELECT id FROM ciclos WHERE id = ?', cicloId)) falha(400, 'Selecione um processo');
  const ref = q.ref || refPadrao(), restrito = poloRestrito(usuario);
  const cicloRow = get('SELECT data_inicio FROM ciclos WHERE id = ?', cicloId) || {};
  const inicioCiclo = cicloRow.data_inicio || (get('SELECT MIN(data) d FROM matriculas WHERE ciclo_id = ?', cicloId) || {}).d || null;
  // Padrão: a semana configurada (ex.: terça a segunda) que contém a data pedida; dias depois da posição mostram só o esperado.
  // Período livre (de/ate) continua disponível.
  const porSemana = !(q.de && dataValida(q.de));
  let de, ate, fimMostra;
  if (porSemana) {
    de = inicioSemana(q.semana && dataValida(q.semana) ? q.semana : ref); fimMostra = addDias(de, 6);
    ate = fimMostra < ref ? fimMostra : ref;
  } else {
    ate = q.ate && dataValida(q.ate) ? q.ate : ref; if (ate > ref) ate = ref;
    de = q.de; if (de > ate) de = ate; if (addDias(de, 61) < ate) de = addDias(ate, -61);
    fimMostra = ate;
  }
  const dias = []; for (let d = de; d <= fimMostra; d = addDias(d, 1)) dias.push(d);
  const modo = cfg('contagem_dias', 'seg-sex');
  const pedido = restrito || Number(q.polo) || 0;
  const polos = all('SELECT id, nome FROM polos WHERE ativo = 1 ORDER BY ordem, nome').filter(p => !pedido || p.id === pedido);
  const cache = {}, sedeOn = conciliacaoMA.sedeLigada(q);
  const ateReal = ate < de ? null : ate; // semana inteira no futuro: nenhum dia realizado
  const lista = sedeOn ? conciliacaoMA.classificarLista(cicloId, ate, cache) : { itens: [] };
  const anterior = (d) => addDias(d, -1);
  const saida = polos.map(po => {
    const fer = feriadosDe(po.id);
    const r = ritmo({ ciclo: cicloId, polo: po.id, ref: ate, sede: q.sede, _serie: 1, _cacheSede: cache }, usuario);
    // esperado dos dias que ainda não chegaram (até o fim da semana mostrada)
    const rFut = fimMostra > ate ? ritmo({ ciclo: cicloId, polo: po.id, ref: fimMostra, sede: q.sede, _serie: 1, _cacheSede: cache }, usuario) : null;
    const rIni = de > (r.inicio || de) ? ritmo({ ciclo: cicloId, polo: po.id, ref: anterior(de), sede: q.sede, _cacheSede: cache }, usuario) : null;
    const esp = Object.fromEntries([...(rFut ? rFut.serie || [] : []), ...(r.serie || [])].map(x => [x.data, x.esperado]));
    const realAc = Object.fromEntries((r.serie || []).map(x => [x.data, x.realizado]));
    if (rIni) esp[anterior(de)] = rIni.hoje_situacao.total.esperado;
    const lanc = Object.fromEntries(all('SELECT data, COUNT(*) n FROM matriculas WHERE ciclo_id = ? AND polo_id = ? AND data BETWEEN ? AND ? GROUP BY data', cicloId, po.id, de, ate).map(x => [x.data, x.n]));
    // matrículas de alunos deste polo feitas por tutores de outros polos (contam no polo, não na equipe)
    const outrosDia = Object.fromEntries(all('SELECT data, COUNT(*) n FROM matriculas WHERE ciclo_id = ? AND polo_id = ? AND COALESCE(tutor_polo_id, polo_id) <> polo_id AND data BETWEEN ? AND ? GROUP BY data', cicloId, po.id, de, ate).map(x => [x.data, x.n]));
    const sedeDia = {}; let sedeListaTotal = 0;
    for (const i of lista.itens) if (i.status === 'sede' && i.polo_id === po.id) { sedeListaTotal++; if (i.data >= de && i.data <= ate) sedeDia[i.data] = (sedeDia[i.data] || 0) + 1; }
    const H = r.hoje_situacao, prox = r.spaces.find(s => s.proximo) || null;
    const ini = r.inicio || inicioCiclo;
    const linhaDias = dias.map(d => {
      const antes = !!(ini && d < ini), futuro = !ateReal || d > ateReal;
      const venda = !antes && contarDias(d, d, modo, fer) > 0;
      const e1 = esp[d], e0 = ini && d === ini ? 0 : esp[anterior(d)];
      const meta = antes ? 0 : e1 == null || e0 == null ? null : Math.max(e1 - e0, 0);
      const l = lanc[d] || 0, sd = sedeDia[d] || 0;
      // SAVE/GAP acumulado no fim do dia (mesmo motor do painel: inclui toda a Sede/Digital vigente naquele dia)
      const saldo_acum = antes || futuro || e1 == null || realAc[d] == null ? null : realAc[d] - e1;
      return { data: d, venda, antes, futuro, lancadas: l, sede: sd, outros: outrosDia[d] || 0, total: futuro ? null : l + sd, meta, saldo_dia: futuro || meta == null ? null : l + sd - meta, esperado_acum: antes ? null : e1 ?? null, saldo_acum };
    });
    const vendaDias = linhaDias.filter(x => x.venda && !x.futuro);
    const ultimoAntes = ateReal ? [...linhaDias].reverse().find(x => x.data < ate && x.venda && !x.futuro) || null : null;
    const hojeD = ateReal ? linhaDias.find(x => x.data === ate) : { data: ref, venda: false, total: 0, meta: 0, sede: 0, futuro: true };
    const sedeTotal = H.sede ? H.sede.total || 0 : 0;
    // tutores (polo de crédito do tutor)
    const tt = all(`SELECT m.tutor_id, t.nome, m.data, COUNT(*) n FROM matriculas m JOIN tutores t ON t.id = m.tutor_id
      WHERE m.ciclo_id = ? AND COALESCE(m.tutor_polo_id, m.polo_id) = ? AND m.data BETWEEN ? AND ? GROUP BY 1, 3`, cicloId, po.id, de, ate);
    const equipe = all(`SELECT t.id, t.nome FROM tutores t JOIN tutor_polos tp ON tp.tutor_id = t.id WHERE tp.polo_id = ? AND t.ativo = 1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id = tp.polo_id) ORDER BY t.nome`, po.id);
    const tmap = new Map(equipe.map(t => [t.id, { tutor_id: t.id, nome: t.nome, dias: {} }]));
    for (const x of tt) { if (!tmap.has(x.tutor_id)) tmap.set(x.tutor_id, { tutor_id: x.tutor_id, nome: x.nome, dias: {} }); tmap.get(x.tutor_id).dias[x.data] = x.n; }
    // meta do tutor × % previsto do polo em cada dia (mesma regra do painel); acumulado pelo polo de crédito
    const mtc = metasTutorCalc(cicloId), metaPolo = H.total.meta || 0;
    const pctDia = (d) => esp[d] == null || !metaPolo ? null : esp[d] / metaPolo;
    const antesDe = Object.fromEntries(all('SELECT tutor_id, COUNT(*) n FROM matriculas WHERE ciclo_id = ? AND COALESCE(tutor_polo_id, polo_id) = ? AND data < ? GROUP BY tutor_id', cicloId, po.id, de).map(x => [x.tutor_id, x.n]));
    for (const t of tmap.values()) {
      const m = mtc[`${po.id}-${t.tutor_id}`]; t.meta = m ? m.quantidade : null;
      t.esperado = {}; t.saldo_acum = {}; t.saldo_dia = {};
      let acum = antesDe[t.tutor_id] || 0;
      for (const x of linhaDias) {
        acum += t.dias[x.data] || 0;
        if (x.antes || t.meta == null) continue;
        const p1 = pctDia(x.data), p0 = ini && x.data === ini ? 0 : pctDia(anterior(x.data));
        if (p1 == null || p0 == null) continue;
        // do dia: fração exata (meta do tutor < 1 por dia viraria 0/1 alternado no arredondamento); acumulado: inteiro, como no painel
        const e1 = Math.round(t.meta * p1), fr = Math.max(t.meta * (p1 - p0), 0);
        t.esperado[x.data] = Math.round(fr * 10) / 10;
        if (!x.futuro) { t.saldo_dia[x.data] = Math.round(((t.dias[x.data] || 0) - fr) * 10) / 10; t.saldo_acum[x.data] = acum - e1; }
      }
    }
    const tutores = [...tmap.values()].map(t => ({ ...t, total: Object.values(t.dias).reduce((a, n) => a + n, 0), ultima: (get('SELECT MAX(data) d FROM matriculas WHERE ciclo_id = ? AND tutor_id = ? AND COALESCE(tutor_polo_id, polo_id) = ? AND data <= ?', cicloId, t.tutor_id, po.id, ate) || {}).d || null }));
    // placar no formato do grupo: "Meta até dd/mm — N dias úteis considerando os S sábados" + realizado X meta por produto
    let placar = null;
    if (prox) {
      let sab = 0; for (let d = ate; d <= prox.data; d = addDias(d, 1)) if (new Date(d + 'T12:00:00').getDay() === 6 && contarDias(d, d, modo, fer) > 0) sab++;
      const hojeP = Object.fromEntries(H.linhas.flatMap(l => l.produtos || []).map(x => [x.produto_id, x]));
      const linhas = prox.linhas.flatMap(l => l.produtos || []).map(x => x.meta_ate
        ? { produto_id: x.produto_id, nome: x.nome, realizado: (hojeP[x.produto_id] || {}).realizado || 0, meta: x.meta, meta_ate: x.meta_ate }
        : { produto_id: x.produto_id, nome: x.nome, realizado: x.realizado, meta: x.esperado })
        .filter(x => x.meta > 0 || x.realizado > 0);
      placar = { space: prox.nome, data: prox.data, dias: prox.dias, sabados: sab, modo, linhas };
    }
    return { polo_id: po.id, polo: po.nome, dias: linhaDias, placar,
      hoje: hojeD, anterior: ultimoAntes,
      periodo: { total: linhaDias.reduce((a, x) => a + (x.total || 0), 0),
        meta: linhaDias.some(x => x.venda && x.meta == null) ? null : linhaDias.reduce((a, x) => a + (x.meta || 0), 0),
        meta_ate_hoje: vendaDias.some(x => x.meta == null) ? null : linhaDias.filter(x => !x.futuro).reduce((a, x) => a + (x.meta || 0), 0),
        dias_venda: vendaDias.length, dias_restantes: linhaDias.filter(x => x.futuro && x.data > ref && contarDias(x.data, x.data, modo, fer) > 0 && !x.antes).length + (hojeD && !hojeD.futuro && hojeD.venda ? 1 : 0),
        dias_sem_venda: vendaDias.filter(x => !x.total && x.data < ref).length, media: vendaDias.length ? linhaDias.reduce((a, x) => a + (x.total || 0), 0) / vendaDias.length : null },
      acumulado: { meta: H.total.meta || 0, realizado: H.total.realizado || 0, esperado: H.total.esperado, saldo: H.total.saldo, sede: sedeTotal, sede_sem_data: Math.max(sedeTotal - sedeListaTotal, 0) },
      proximo: prox ? { nome: prox.nome, data: prox.data, falta: prox.total.falta, dias: prox.dias, por_dia: prox.total.por_dia } : null,
      tutores };
  });
  return { ref, de, ate, fim: fimMostra, por_semana: porSemana, semana_anterior: porSemana ? addDias(de, -7) : null, semana_seguinte: porSemana ? addDias(de, 7) : null,
    dias: dias.map(d => ({ data: d, semana: new Date(d + 'T12:00:00').getDay(), futuro: !ateReal || d > ateReal })), modo, sede: sedeOn, polos: saida };
}

// ---------------------------------------------------------------- previsão da próxima semana
// Usa o mesmo motor das metas (calendário oficial, Spaces, feriados, prazo próprio, Sede/Digital):
//  · Meta da semana = esperado acumulado no fim da semana − esperado acumulado no fim da semana anterior (plano)
//  · Necessário até o fim da semana = máx(esperado no fim da semana − realizado hoje, 0) → recupera o GAP atual
//  · Semana passada = matrículas lançadas na última semana completa (polo do aluno; tutores pelo polo de crédito)
function previsaoSemana(q, usuario) {
  validarPeriodo(q);
  const cicloId = Number(q.ciclo);
  if (!get('SELECT id FROM ciclos WHERE id = ?', cicloId)) falha(400, 'Selecione um processo');
  const ref = q.ref || refPadrao(), restrito = poloRestrito(usuario);
  const atual = inicioSemana(ref);
  let ini = q.semana && dataValida(q.semana) ? inicioSemana(q.semana) : addDias(atual, 7);
  if (ini < addDias(atual, 7)) ini = addDias(atual, 7);
  const fim = addDias(ini, 6), fimAnt = addDias(ini, -1);
  const passadaIni = addDias(atual, -7), passadaFim = addDias(atual, -1);
  const modo = cfg('contagem_dias', 'seg-sex');
  const polos = all('SELECT id, nome FROM polos WHERE ativo = 1 ORDER BY ordem, nome').filter(p => !restrito || p.id === restrito);
  const pedidoPolo = restrito || Number(q.polo) || 0;
  const sel = polos.filter(p => !pedidoPolo || p.id === pedidoPolo);
  const prodNome = Object.fromEntries(all('SELECT id, nome, meta_ate FROM produtos').map(p => [p.id, p]));
  const cache = {};
  const base = { ciclo: cicloId, sede: q.sede, _cacheSede: cache };
  const prods = (r) => Object.fromEntries(r.hoje_situacao.linhas.flatMap(l => l.produtos || []).map(x => [x.produto_id, x]));
  const semanaPassada = (poloId) => Object.fromEntries(all(`SELECT produto_id, COUNT(*) n FROM matriculas WHERE ciclo_id = ? AND polo_id = ? AND data BETWEEN ? AND ? GROUP BY produto_id`, cicloId, poloId, passadaIni, passadaFim).map(r => [r.produto_id, r.n]));
  const conta = (meta, espFim, espAnt, real, dias, diasSemana) => {
    const nec = espFim == null ? null : Math.max(espFim - real, 0);
    return { meta, realizado: real, esperado_fim: espFim, meta_semana: espFim == null || espAnt == null ? null : Math.max(espFim - espAnt, 0),
      necessario: nec, dias, dias_semana: diasSemana, por_dia: nec == null ? null : dias > 0 ? nec / dias : null };
  };
  const saida = sel.map(po => {
    const fer = feriadosDe(po.id);
    const rHoje = ritmo({ ...base, polo: po.id, ref }, usuario), rFim = ritmo({ ...base, polo: po.id, ref: fim }, usuario), rAnt = ritmo({ ...base, polo: po.id, ref: fimAnt }, usuario);
    const dias = contarDias(ref, fim, modo, fer), diasSemana = contarDias(ini, fim, modo, fer);
    const pH = prods(rHoje), pF = prods(rFim), pA = prods(rAnt), sp = semanaPassada(po.id);
    const produtos = Object.keys(pH).map(Number).map(id => {
      const pr = prodNome[id] || {}, h = pH[id], f = pF[id] || {}, a = pA[id] || {};
      // produto com prazo próprio já encerrado antes da semana: nada a prever
      const encerrado = pr.meta_ate && pr.meta_ate < ini;
      const diasP = pr.meta_ate ? contarDias(ref, pr.meta_ate < fim ? pr.meta_ate : fim, modo, fer) : dias;
      const diasSemP = pr.meta_ate ? (pr.meta_ate < ini ? 0 : contarDias(ini, pr.meta_ate < fim ? pr.meta_ate : fim, modo, fer)) : diasSemana;
      return { produto_id: id, nome: pr.nome || h.nome, meta_ate: pr.meta_ate || null, encerrado: !!encerrado, esperado_hoje: h.esperado, saldo_hoje: h.saldo,
        semana_passada: sp[id] || 0, ...conta(h.meta, encerrado ? null : f.esperado, encerrado ? null : a.esperado, h.realizado, diasP, diasSemP) };
    }).filter(x => x.meta || x.realizado);
    const T = rHoje.hoje_situacao.total, TF = rFim.hoje_situacao.total, TA = rAnt.hoje_situacao.total;
    const total = { esperado_hoje: T.esperado, saldo_hoje: T.saldo, semana_passada: Object.values(sp).reduce((a, n) => a + n, 0), sede_sem_produto: rHoje.hoje_situacao.sede.sem_produto || 0,
      ...conta(T.meta || 0, TF.esperado, TA.esperado, T.realizado || 0, dias, diasSemana) };
    // tutores: meta do tutor × % previsto do polo (mesma regra do painel); realizado pelo polo de crédito
    const pn = painel({ ciclo: cicloId, polo: po.id, ref, sede: '0' }, usuario);
    const pctF = rFim.hoje_situacao.percentual, pctA = rAnt.hoje_situacao.percentual;
    const spT = Object.fromEntries(all(`SELECT tutor_id, COUNT(*) n FROM matriculas WHERE ciclo_id = ? AND COALESCE(tutor_polo_id, polo_id) = ? AND data BETWEEN ? AND ? GROUP BY tutor_id`, cicloId, po.id, passadaIni, passadaFim).map(r => [r.tutor_id, r.n]));
    const tutores = (pn.porTutor || []).filter(t => t.polo_id === po.id && t.meta).map(t => {
      const eF = pctF == null ? null : Math.round(t.meta * pctF / 100), eA = pctA == null ? null : Math.round(t.meta * pctA / 100);
      return { tutor_id: t.tutor_id, nome: t.nome, semana_passada: spT[t.tutor_id] || 0, esperado_hoje: t.esperado, saldo_hoje: t.saldo, ...conta(t.meta, eF, eA, t.qtd, dias, diasSemana) };
    });
    return { polo_id: po.id, polo: po.nome, total, produtos, tutores, sem_spaces: rHoje.aguardando_spaces };
  });
  return { ref, semana: { inicio: ini, fim }, semana_passada: { inicio: passadaIni, fim: passadaFim }, modo, polos: saida };
}

// ---------------------------------------------------------------- conferência com o BI
// Números do sistema por categoria (até a data de referência), no mesmo formato do BI
function sistemaPorCategoria(cicloId, poloId, dataRef) {
  const filtroPolo = poloId ? 'AND m.polo_id = ?' : '';
  const pp = poloId ? [poloId] : [];
  const real = all(`SELECT pr.categoria_id cat, COUNT(*) qtd, COALESCE(SUM(m.valor),0) valor FROM matriculas m JOIN produtos pr ON pr.id = m.produto_id
                    WHERE m.ciclo_id = ? AND m.data <= ? ${filtroPolo} GROUP BY pr.categoria_id`, cicloId, dataRef, ...pp);
  const tk = {};
  for (const r of all('SELECT polo_id, produto_id, valor FROM metas_rpv WHERE ciclo_id = ?', cicloId)) tk[`${r.polo_id}-${r.produto_id}`] = r.valor;
  const metas = all(`SELECT me.polo_id, me.produto_id, me.quantidade q, pr.categoria_id cat FROM metas me JOIN produtos pr ON pr.id = me.produto_id WHERE me.ciclo_id = ? ${poloId ? 'AND me.polo_id = ?' : ''}`, cicloId, ...pp);
  const out = {};
  for (const c of all('SELECT id FROM categorias')) out[c.id] = { real_qtd: 0, real_rpv: 0, meta_qtd: 0, meta_rpv: 0, tem_meta_tk: false };
  for (const r of real) Object.assign(out[r.cat], { real_qtd: r.qtd, real_rpv: r.valor });
  for (const m of metas) {
    const o = out[m.cat]; if (!o) continue;
    o.meta_qtd += m.q;
    const t = tk[`${m.polo_id}-${m.produto_id}`] ?? tk[`0-${m.produto_id}`];
    if (t != null) { o.meta_rpv += m.q * t; o.tem_meta_tk = true; }
  }
  for (const o of Object.values(out)) {
    o.real_ticket = o.real_qtd ? o.real_rpv / o.real_qtd : null;
    o.meta_ticket = o.tem_meta_tk && o.meta_qtd ? o.meta_rpv / o.meta_qtd : null;
    if (!o.tem_meta_tk) o.meta_rpv = null;
  }
  return out;
}
function lerConferencia(id) {
  const c = get(`SELECT c.*, po.nome polo FROM conferencias c LEFT JOIN polos po ON po.id = c.polo_id WHERE c.id = ?`, id);
  if (!c) return null;
  c.linhas = all('SELECT rotulo, categoria_id, meta_qtd, real_qtd, meta_ticket, real_ticket, meta_rpv, real_rpv FROM conferencia_linhas WHERE conferencia_id = ? ORDER BY rowid', id);
  c.sistema = sistemaPorCategoria(c.ciclo_id, c.polo_id, c.data_ref);
  return c;
}

// ---------------------------------------------------------------- campanhas de incentivo
const csvIds = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(Number).filter(Boolean);
function premio(c, qtd) {
  const N = Math.max(1, c.qtd);
  if (c.tipo === 'meta') return { valor: qtd >= N ? c.valor : 0, falta: qtd >= N ? 0 : N - qtd };
  if (c.tipo === 'escalonada') return { valor: qtd >= N ? c.valor + (qtd - N) * c.adicional : 0, falta: qtd >= N ? 1 : N - qtd };
  if (c.tipo === 'a_cada') return { valor: Math.floor(qtd / N) * c.valor, falta: N - (qtd % N) };
  return { valor: qtd * c.valor, falta: 1 }; // por_matricula
}
function resultadoCampanha(c, usuario, detalhe = false) {
  const prods = csvIds(c.produtos), polos = csvIds(c.polos);
  const campoPolo=c.beneficiario==='polo'?'m.polo_id':'COALESCE(m.tutor_polo_id,m.polo_id)';
  const w = ['m.data BETWEEN ? AND ?']; const p = [c.inicio, c.fim];
  if (prods.length) w.push(`m.produto_id IN (${prods.join(',')})`);
  if (polos.length) w.push(`${campoPolo} IN (${polos.join(',')})`);
  if (usuario.papel === 'visualizador' && usuario.polo_id) { w.push(campoPolo+' = ?'); p.push(usuario.polo_id); }
  // CPF repetido no mesmo produto conta uma vez (fica com a primeira)
  const linhas = all(`SELECT m.id, m.ciclo_id, m.data, m.tutor_id, ${campoPolo} polo_id, m.polo_id polo_destino_id, po.nome polo_destino, m.cpf, m.produto_id, m.aluno, m.curso, m.valor, tu.nome tutor, (SELECT nome FROM polos WHERE id=${campoPolo}) polo, pr.nome produto FROM matriculas m
    JOIN tutores tu ON tu.id = m.tutor_id JOIN polos po ON po.id = m.polo_id JOIN produtos pr ON pr.id = m.produto_id WHERE ${w.join(' AND ')} ORDER BY m.data, m.id`, ...p);
  const vistos = new Set(); const grupos = {}; const itens = []; const raCamp = {};
  const chave = (l) => c.beneficiario === 'polo' ? `p${l.polo_id}` : `${l.tutor_id}-${l.polo_id}`;
  for (const l of linhas) {
    const item = { data: l.data, aluno: l.aluno, cpf: usuario && usuario.papel === 'visualizador' ? mascaraCpf(l.cpf) : formataCpf(l.cpf), ra: detalhe ? conciliacaoMA.raPorMatricula(l.ciclo_id, raCamp)[l.id] || null : null, curso: l.curso, produto: l.produto, valor: l.valor, grupo: chave(l), polo_destino:l.polo_destino, polo_destino_id:l.polo_destino_id, polo_credito:l.polo, conta: true };
    if (detalhe) itens.push(item);
    if (l.cpf) { const k = `${l.cpf}-${l.produto_id}`; if (vistos.has(k)) { item.conta = false; continue; } vistos.add(k); }
    const k = chave(l);
    grupos[k] ??= { nome: c.beneficiario === 'polo' ? l.polo : l.tutor, polo: l.polo, qtd: 0, ultima: null };
    grupos[k].qtd++; grupos[k].ultima = l.data;
  }
  // participantes sem matrícula também aparecem (tutores ativos / polos dos polos da campanha)
  if (c.beneficiario === 'polo') {
    for (const po of all('SELECT id, nome FROM polos WHERE ativo = 1')) if (!polos.length || polos.includes(po.id)) grupos[`p${po.id}`] ??= { nome: po.nome, polo: po.nome, qtd: 0, ultima: null };
  } else {
    for (const r of all('SELECT tp.tutor_id, tp.polo_id, t.nome, po.nome polo FROM tutor_polos tp JOIN tutores t ON t.id = tp.tutor_id JOIN polos po ON po.id = tp.polo_id WHERE t.ativo = 1 AND po.ativo = 1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id=tp.polo_id)'))
      if (!polos.length || polos.includes(r.polo_id)) grupos[`${r.tutor_id}-${r.polo_id}`] ??= { nome: r.nome, polo: r.polo, qtd: 0, ultima: null };
  }
  let lista = Object.entries(grupos).map(([k, g]) => ({ ...g, chave: k, ...premio(c, g.qtd) }));
  if (usuario.papel === 'visualizador' && usuario.polo_id) { const pn = (get('SELECT nome FROM polos WHERE id = ?', usuario.polo_id) || {}).nome; lista = lista.filter(g => g.polo === pn); }
  lista.sort((a, b) => b.qtd - a.qtd || b.valor - a.valor || a.nome.localeCompare(b.nome));
  const hoje = hojeISO();
  return { ...c, atribuicao:c.beneficiario==='polo'?'polo_destino':'polo_credito_tutor', produtos: prods, polos, situacao: hoje < c.inicio ? 'futura' : hoje > c.fim ? 'encerrada' : 'andamento',
    ranking: lista, total_matriculas: lista.reduce((a, g) => a + g.qtd, 0), total_premio: lista.reduce((a, g) => a + g.valor, 0), ganhadores: lista.filter(g => g.valor > 0).length,
    ...(detalhe ? { matriculas: itens.filter(x => lista.some(g => g.chave === x.grupo)) } : {}) };
}
function salvarCampanha(id, c, usuario) {
  const d = {
    nome: String(c.nome || '').trim(), inicio: String(c.inicio || ''), fim: String(c.fim || ''), tipo: String(c.tipo || ''),
    qtd: Math.max(1, Math.round(Number(c.qtd) || 1)), valor: lerValor(c.valor), adicional: lerValor(c.adicional),
    produtos: csvIds(c.produtos).join(','), polos: csvIds(c.polos).join(','), beneficiario: c.beneficiario === 'polo' ? 'polo' : 'tutor',
    obs: (c.obs || '').trim() || null, ativo: c.ativo === 0 ? 0 : 1,
  };
  if (!d.nome) falha(400, 'Dê um nome para a campanha');
  if (!dataValida(d.inicio) || !dataValida(d.fim)) falha(400, 'Informe início e fim');
  if (d.fim < d.inicio) falha(400, 'O fim é antes do início');
  if (!['meta', 'escalonada', 'a_cada', 'por_matricula'].includes(d.tipo)) falha(400, 'Escolha o tipo de regra');
  const cols = Object.keys(d);
  if (id) run(`UPDATE campanhas SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map(k => d[k]), id);
  else id = Number(run(`INSERT INTO campanhas (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(k => d[k])).lastInsertRowid);
  registrar(usuario, 'salvou campanha', `#${id} ${d.nome}`);
  return id;
}

// ---------------------------------------------------------------- página do tutor
// % da meta previsto numa data (mesma regra do ritmo: interpolado por dias de contagem entre os Spaces)
function calendarioTutor(cicloId,poloId) {
  const ciclo=get('SELECT * FROM ciclos WHERE id=?',cicloId)||{}, spaces=all('SELECT data,percentual FROM spaces WHERE ciclo_id=? ORDER BY data',cicloId),modo=cfg('contagem_dias','seg-sex'),fer=feriadosDe(poloId);
  const metas=all('SELECT me.quantidade,pr.meta_ate FROM metas me JOIN produtos pr ON pr.id=me.produto_id WHERE me.ciclo_id=? AND me.polo_id=?',cicloId,poloId);
  const total=metas.reduce((n,x)=>n+x.quantidade,0);
  return data=>{
    const pc=percentualCalendario(ciclo,spaces,data,modo,fer);let esperado=0;
    for(const m of metas){if(!m.quantidade)continue;let pct=pc;
      if(dataValida(m.meta_ate)){const ini=ciclo.data_inicio||data,tot=contarDias(ini,m.meta_ate,modo,fer);pct=data<ini?0:data>=m.meta_ate?100:tot?Math.min(100,contarDias(ini,data,modo,fer)/tot*100):100;}
      if(pct==null)return null;esperado+=m.quantidade*pct/100;
    }
    return total?Math.round(esperado-1e-9)/total*100:null;
  };
}
function pctPrevisto(cicloId,poloId,data){return calendarioTutor(cicloId,poloId)(data);}

function paginaTutor(q, usuario) {
  const cicloId = Number(q.ciclo);
  const poloId = usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : Number(q.polo);
  const tutorId = Number(q.tutor);
  if (!cicloId || !poloId || !tutorId) falha(400, 'Informe processo, polo e tutor');
  if (usuario.tutor_id && Number(usuario.tutor_id) !== tutorId) falha(404, 'Tutor não encontrado neste polo');
  const pn = painel({ ciclo: cicloId, polo: poloId, ref: q.ref, historico:'1' }, usuario);
  const t = pn.porTutor.find(x => x.tutor_id === tutorId && x.polo_id === poloId);
  if (!t) falha(404, 'Tutor não encontrado neste polo');
  const R = pn.ritmo, ref = R.hoje;
  const mats = []; let pagina = 1, lote;
  do { lote = listarMatriculas({ ciclo:cicloId,polo:poloId,tutor:tutorId,credito_tutor:1,prazo_meta:1,ate:ref,limite:5000,pagina:pagina++ },usuario); mats.push(...lote.linhas); } while (mats.length < lote.total && lote.linhas.length);
  mats.reverse(); // da mais antiga para a mais nova
  // evolução diária: realizado acumulado × esperado acumulado (meta do tutor × % previsto do polo)
  const porDia = {}; for (const m of mats) porDia[m.data] = (porDia[m.data] || 0) + 1;
  const percentualTutor=calendarioTutor(cicloId,poloId);
  const serie = []; let acum = mats.filter(m => m.data < R.inicio).length;
  for (let d = R.inicio, i = 0; d <= ref; d = addDias(d, 1), i++) {
    acum += porDia[d] || 0;
    serie.push({ data: d, dia: porDia[d] || 0, realizado: acum, esperado: t.meta != null && percentualTutor(d) != null ? Math.round(t.meta * percentualTutor(d) / 100) : null });
  }
  // Spaces do tutor
  const spaces = R.spaces.map(sp => {
    const esperado = t.meta != null ? Math.ceil(t.meta * sp.percentual / 100) : null;
    const realizado = mats.filter(m => m.data <= (sp.passado ? sp.data : ref)).length;
    const falta = esperado != null ? Math.max(esperado - realizado, 0) : null;
    return { nome: sp.nome, data: sp.data, percentual: sp.percentual, passado: sp.passado, proximo: sp.proximo, dias: sp.dias, esperado, realizado, falta,
      por_dia: falta != null && sp.dias > 0 ? falta / sp.dias : null, saldo: sp.passado && esperado != null ? realizado - esperado : null };
  });
  // histórico semanal (semana de meta: padrão terça a segunda)
  const metasSem = Object.fromEntries(all('SELECT semana, quantidade FROM metas_ritmo_semanal WHERE ciclo_id = ? AND polo_id = ? AND tutor_id = ?', cicloId, poloId, tutorId).map(r => [r.semana, r.quantidade]));
  const semanas = [];
  for (let w = inicioSemana(R.inicio), i = 0; w <= ref; w = addDias(w, 7), i++) {
    const fim = addDias(w, 6);
    const ms = mats.filter(m => m.data >= w && m.data <= fim);
    semanas.push({ inicio: w, fim, realizado: ms.length, valor: ms.reduce((a, m) => a + m.valor, 0), meta: metasSem[w] ?? null, atual: w <= ref && ref <= fim });
  }
  // comparação com a equipe do polo
  const equipe = pn.porTutor.filter(x=>x.atual).map(x => ({ tutor_id: x.tutor_id, nome: x.nome, qtd: x.qtd, valor: x.valor, meta: x.meta ?? null, saldo: x.saldo ?? null })).sort((a, b) => b.qtd - a.qtd);
  return { aguardando_spaces:R.aguardando_spaces, tutor: t, polo: (get('SELECT nome FROM polos WHERE id = ?', poloId) || {}).nome, ref, inicio: R.inicio, modo: R.modo, final: R.final ? { data: R.final.data, dias: R.final.dias } : null,
    produtos: all('SELECT id,nome FROM produtos ORDER BY ordem,nome').filter(p=>pn.porProduto.some(x=>x.id===p.id)||mats.some(x=>x.produto_id===p.id)), serie, spaces, semanas, equipe, matriculas: mats };
}

// ---------------------------------------------------------------- meta do tutor no processo
// { 'polo-tutor': { quantidade, origem: 'individual' | 'dividida' } } para a equipe ativa de cada polo.
// Se o polo tem alguma meta individual cadastrada, valem só as individuais; senão a meta do polo é dividida igualmente.
function metasTutorCalc(cicloId) {
  const out = {};
  const indiv = all('SELECT polo_id, tutor_id, quantidade FROM metas_tutor WHERE ciclo_id = ?', cicloId);
  const metaPolo = Object.fromEntries(all('SELECT polo_id, SUM(quantidade) q FROM metas WHERE ciclo_id = ? GROUP BY polo_id', cicloId).map(r => [r.polo_id, r.q]));
  const equipe = {};
  for (const r of all('SELECT tp.polo_id, tp.tutor_id FROM tutor_polos tp JOIN tutores t ON t.id = tp.tutor_id WHERE t.ativo = 1 AND (t.polo_origem_id IS NULL OR t.polo_origem_id=tp.polo_id) ORDER BY t.nome')) (equipe[r.polo_id] ??= []).push(r.tutor_id);
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
const oportunidades = require('./oportunidades')({ db, DATA_DIR, all, get, run, tx, falha, registrar, lerCorpo, enviarJson, ehAdmin, podeLancar, hojeISO, norm: conciliacaoMA.norm, poloDaFonte: conciliacaoMA.poloDaFonte, produtoDoCurso: conciliacaoMA.produtoDoCurso });

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


  // Fila privada para o emissor local de boas-vindas. A conexão é somente de saída:
  // nenhum serviço precisa abrir portas no computador que envia as mensagens.
  if (p === '/api/worker/boas-vindas' || p === '/api/worker/boas-vindas/status') {
    const esperado=String(process.env.BALBINO_WELCOME_WORKER_TOKEN||'').trim();
    const informado=String(req.headers.authorization||'').replace(/^Bearer\\s+/i,'').trim();
    const a=Buffer.from(esperado),b=Buffer.from(informado);
    if(!esperado||a.length!==b.length||!crypto.timingSafeEqual(a,b))return enviarJson(res,401,{error:'Token do emissor inválido.'});
    if(p==='/api/worker/boas-vindas'&&m==='GET')return enviarJson(res,200,conciliacaoMA.workerBoasVindasPendentes(q.limite));
    if(p==='/api/worker/boas-vindas/status'&&m==='POST'){
      try{return enviarJson(res,200,conciliacaoMA.workerBoasVindasResultado(await lerCorpo(req)));}
      catch(e){return enviarJson(res,e.status||400,{error:e.message||'Não foi possível atualizar o envio.'})}
    }
    return enviarJson(res,405,{error:'Método não permitido.'});
  }

  // ---- autenticadas
  const usuario = usuarioDaSessao(req);
  if (!usuario) falha(401, 'Sessão expirada — entre novamente');
  const exigeAdmin = () => { if (!ehAdmin(usuario)) falha(403, 'Apenas administradores'); };
  const exigeLancar = () => { if (!podeLancar(usuario)) falha(403, 'Seu usuário não pode lançar matrículas'); };

  if (await gestao.rotas(req,res,p,m,q,usuario)) return;

  if (p === '/api/bootstrap' && m === 'GET') return enviarJson(res, 200, bootstrap(usuario));

  if (p === '/api/minha-senha' && m === 'POST') {
    if (usuario.portal) falha(403, 'Altere a senha pelo Portal da Rede Balbino.');
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
  if (p.startsWith('/api/ma/oportunidades') && await oportunidades.rotas(req, res, p, m, q, usuario)) return;
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
  // Resumo do processo atual para a página inicial do Portal: mesmos números do painel (mesmo cálculo e permissões).
  if (p === '/api/resumo-portal' && m === 'GET') {
    const ciclo = get('SELECT id, nome FROM ciclos WHERE padrao = 1 ORDER BY id DESC LIMIT 1') || get('SELECT id, nome FROM ciclos ORDER BY id DESC LIMIT 1');
    if (!ciclo) return enviarJson(res, 200, { ciclo: null });
    const d = painel({ ciclo: String(ciclo.id) }, usuario);
    const r = d.ritmo || {}, hT = r.hoje_situacao?.total || {}, prox = (r.spaces || []).find(x => x.proximo) || null;
    const alvo = prox || r.final || null;
    return enviarJson(res, 200, {
      ciclo: { id: ciclo.id, nome: ciclo.nome }, ref: r.hoje || hojeISO(),
      matriculas: d.totais.qtd, meta: d.totais.meta, percentual_meta: d.totais.meta ? d.totais.qtd / d.totais.meta * 100 : null, pendentes_ra: d.pendentes_ra,
      hoje: { esperado: hT.esperado ?? null, realizado: hT.realizado ?? null, saldo: hT.saldo ?? null, status: hT.status || null },
      vendas_dia: (d.porPolo || []).reduce((a, x) => a + (x.vendas_dia || 0), 0), vendas_semana: (d.porPolo || []).reduce((a, x) => a + (x.vendas_semana || 0), 0),
      proximo_space: alvo ? { nome: alvo.nome, data: alvo.data, final: !prox, esperado: alvo.total?.esperado ?? null, realizado: alvo.total?.realizado ?? null, falta: alvo.total?.falta ?? null, por_dia: alvo.total?.por_dia ?? null, dias: alvo.dias ?? null } : null,
      aguardando_spaces: !!r.aguardando_spaces, polo_restrito: usuario.papel === 'visualizador' && usuario.polo_id ? (get('SELECT nome FROM polos WHERE id = ?', usuario.polo_id)?.nome || null) : null
    });
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

module.exports = { servidor, db, conciliacaoMA, oportunidades, painel, ritmo, previsaoSemana, diario, origensPolo, ritmoSemanal, paginaTutor, metasTutorCalc, salvarMetasTutor, bootstrap, rotear, validarMatricula, salvarCadastro, dataValida, percentualCalendario, gestao, iniciarRotinasHospedadas };
