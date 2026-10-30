// Motor de automação: cria sozinho os avisos de boleto (todo mês) e o rodízio de cursos
const { db, getConfig, setConfig, tipoRow } = require('./db');
const { dadosDoCurso, temPreco } = require('./cursos');
const render = require('./render');
const sv = require('./servicos');

// ---------- Datas ----------
const p2 = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const deIso = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

// Feriados nacionais e dias sem expediente bancário + feriados extras cadastrados (municipais, por exemplo)
function feriados(ano) {
  const nomes = new Map();
  const add = (d, nome) => nomes.set(iso(d), nome);
  for (const [m, d, n] of [[1, 1, 'Confraternização Universal'], [4, 21, 'Tiradentes'], [5, 1, 'Dia do Trabalho'], [9, 7, 'Independência'],
    [10, 12, 'Nossa Senhora Aparecida'], [11, 2, 'Finados'], [11, 15, 'Proclamação da República'], [11, 20, 'Consciência Negra'], [12, 25, 'Natal']]) add(new Date(ano, m - 1, d), n);
  const p = pascoa(ano);
  add(somaDias(p, -48), 'Carnaval (segunda)');
  add(somaDias(p, -47), 'Carnaval (terça)');
  add(somaDias(p, -2), 'Sexta-feira Santa');
  add(somaDias(p, 60), 'Corpus Christi');
  for (const linha of String(getConfig().feriados_extras || '').split(/[\n,;]+/)) {
    const m = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(.*)$/.exec(linha);
    if (!m) continue;
    if (m[3] && Number(m[3]) !== ano) continue;
    add(new Date(ano, Number(m[2]) - 1, Number(m[1])), m[4].replace(/^[-–\s]+/, '') || 'Feriado extra');
  }
  return nomes;
}
function ehDiaUtil(d) {
  if (d.getDay() === 0 || d.getDay() === 6) return false;
  return !feriados(d.getFullYear()).has(iso(d));
}
function vencimentoBoleto(ano, mes, dia) {
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  let d = new Date(ano, mes, Math.min(dia, ultimo));
  const original = d;
  while (!ehDiaUtil(d)) d = somaDias(d, 1);
  return { data: d, original, adiado: iso(d) !== iso(original) };
}

// ---------- Planejamento ----------
const listaNumeros = s => String(s || '').split(',').map(x => x.trim()).filter(x => x !== '').map(Number).filter(n => !Number.isNaN(n));
const lista = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const ignorada = db.prepare('SELECT 1 FROM auto_ignoradas WHERE chave = ?');
const existe = db.prepare('SELECT 1 FROM publicacoes WHERE auto_chave = ?');
const prefixoUsado = db.prepare(`SELECT 1 FROM publicacoes WHERE auto_chave LIKE ? || '%' UNION SELECT 1 FROM auto_ignoradas WHERE chave LIKE ? || '%' LIMIT 1`);

function contexto() {
  const cfg = getConfig();
  const agora = sv.agoraLocal();
  const hoje = deIso(agora.slice(0, 10));
  const horizonte = Math.max(1, Number(cfg.horizonte_dias) || 14);
  const limite = somaDias(hoje, horizonte);
  const polos = db.prepare('SELECT * FROM polos WHERE ativo = 1 ORDER BY nome').all();
  return { cfg, agora, hoje, limite, polos };
}
function formatosValidos(tipo, texto) {
  return lista(texto).filter(f => tipo.formatos.includes(f) && render.templateExiste(tipo.id, f));
}

// Retorna os "momentos" que a automação deve cobrir (cada um vira uma publicação por polo e formato)
function planejar() {
  const { cfg, agora, hoje, limite, polos } = contexto();
  const momentos = [];

  // Avisos mensais por data (boleto no vencimento; arrasto no dia limite do desconto)
  const mensais = [
    { id: 'boleto', prefixo: 'boleto', diaPadrao: 10, campo: 'vencimento', rotulo: 'Boleto vence' },
    { id: 'arrasto', prefixo: 'arrasto', diaPadrao: 20, campo: 'limite', rotulo: 'Desconto até' }
  ];
  for (const m of mensais) {
    const t = tipoRow(db.prepare('SELECT * FROM tipos WHERE id = ?').get(m.id));
    if (cfg[m.prefixo + '_ativo'] !== '1' || !t || !t.ativo) continue;
    const formatos = formatosValidos(t, cfg[m.prefixo + '_formatos']);
    const antes = listaNumeros(cfg[m.prefixo + '_dias_antes']);
    const dia = Number(cfg[m.prefixo + '_dia']) || m.diaPadrao;
    const hora = cfg[m.prefixo + '_hora'] || '09:00';
    for (let i = -1; i <= 3; i++) {
      const ref = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      const v = vencimentoBoleto(ref.getFullYear(), ref.getMonth(), dia);
      for (const n of antes) {
        const quando = somaDias(v.data, -n);
        const dataHora = `${iso(quando)}T${hora}`;
        if (dataHora < agora || quando > limite) continue;
        momentos.push({
          tipo: t, chave: `${m.prefixo}:${iso(v.data)}:${n}`, data_hora: dataHora, formatos, polos,
          dados: { [m.campo]: iso(v.data) },
          descricao: `${m.rotulo} ${iso(v.data).split('-').reverse().join('/')}${v.adiado ? ' (adiado por feriado ou fim de semana)' : ''}` + (n ? `, aviso ${n} dia(s) antes` : ', aviso no dia')
        });
      }
    }
  }

  // Rodízio de cursos
  const tCurso = tipoRow(db.prepare("SELECT * FROM tipos WHERE id = 'curso'").get());
  if (cfg.cursos_ativo === '1' && tCurso && tCurso.ativo) {
    const formatos = formatosValidos(tCurso, cfg.cursos_formatos);
    const dias = listaNumeros(cfg.cursos_dias);
    const porDia = Math.max(1, Number(cfg.cursos_por_dia) || 1);
    for (let d = hoje; d <= limite; d = somaDias(d, 1)) {
      if (!dias.includes(d.getDay())) continue;
      const dataHora = `${iso(d)}T${cfg.cursos_hora || '18:00'}`;
      if (dataHora < agora) continue;
      for (let k = 0; k < porDia; k++) {
        momentos.push({ tipo: tCurso, chave: `curso:${iso(d)}:${k}`, data_hora: dataHora, formatos, polos, rodizio: true,
          descricao: `${DIAS_SEMANA[d.getDay()]}: curso do rodízio` });
      }
    }
  }
  return momentos.sort((a, b) => a.data_hora.localeCompare(b.data_hora));
}

// Rodízio: arte do curso, arte de oferta (com preço) ou alternando entre as duas.
// Curso sem mensalidade cadastrada sempre sai como arte do curso.
function modeloDoRodizio(cfg, curso) {
  const modelo = cfg.cursos_modelo || 'curso';
  if (modelo === 'curso' || !temPreco(curso)) return null;
  const tOferta = tipoRow(db.prepare("SELECT * FROM tipos WHERE id = 'oferta'").get());
  if (!tOferta || !tOferta.ativo) return null;
  if (modelo === 'oferta') return tOferta;
  const vez = getConfig().cursos_alternancia === 'oferta' ? 'curso' : 'oferta';
  setConfig({ cursos_alternancia: vez });
  return vez === 'oferta' ? tOferta : null;
}

function proximoCurso() {
  return db.prepare("SELECT * FROM cursos WHERE ativo = 1 ORDER BY ultimo_post = '' DESC, ultimo_post ASC, id ASC LIMIT 1").get();
}

// Prévia do que a automação vai fazer (sem criar nada)
function previa() {
  const plano = planejar();
  const cursosFila = db.prepare("SELECT * FROM cursos WHERE ativo = 1 ORDER BY ultimo_post = '' DESC, ultimo_post ASC, id ASC").all();
  let fila = 0;
  return plano.map(m => {
    const criada = Boolean(prefixoUsado.get(m.chave + ':', m.chave + ':'));
    let curso = '';
    if (m.rodizio) {
      if (criada) {
        const r = db.prepare("SELECT dados FROM publicacoes WHERE auto_chave LIKE ? || '%' LIMIT 1").get(m.chave + ':');
        curso = r ? (JSON.parse(r.dados).curso || '') : '(removida)';
      } else curso = cursosFila.length ? cursosFila[fila++ % cursosFila.length].curso : '';
    }
    return { chave: m.chave, data_hora: m.data_hora, tipo: m.tipo.nome, descricao: m.descricao + (curso ? `: ${curso}` : ''), formatos: m.formatos, criada, sem_curso: m.rodizio && !curso };
  });
}

// Cria as publicações que ainda não existem
let rodando = false;
async function executar(gerarArte) {
  if (rodando) return { criadas: 0, erros: [] };
  rodando = true;
  const criadas = []; const erros = [];
  try {
    const { cfg } = contexto();
    const status = cfg.auto_aprovar === '1' ? 'aprovada' : 'rascunho';
    const ins = db.prepare(`INSERT INTO publicacoes (lote, tipo, polo_id, formato, dados, legenda, data_hora, status, auto_chave, origem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'automacao')`);
    for (const m of planejar()) {
      if (!m.polos.length || !m.formatos.length) continue;
      if (prefixoUsado.get(m.chave + ':', m.chave + ':')) continue; // momento já tratado (criado ou excluído por você)
      let dados = { ...(m.dados || {}) };
      if (m.rodizio) {
        const c = proximoCurso();
        if (!c) { erros.push('Rodízio de cursos: nenhum curso ativo em Cursos.'); continue; }
        const tipoArte = modeloDoRodizio(cfg, c);
        if (tipoArte) m.tipo = tipoArte;
        dados = dadosDoCurso(c, m.tipo.id);
        db.prepare('UPDATE cursos SET ultimo_post = ? WHERE id = ?').run(m.data_hora, c.id);
      }
      for (const campo of m.tipo.campos) if (dados[campo.chave] === undefined && campo.padrao) dados[campo.chave] = campo.padrao;
      for (const polo of m.polos) {
        const legenda = render.legenda(m.tipo, polo, dados);
        for (const f of m.formatos) {
          const chave = `${m.chave}:${polo.id}:${f}`;
          if (existe.get(chave) || ignorada.get(chave)) continue;
          const id = Number(ins.run('auto-' + m.chave, m.tipo.id, polo.id, f, JSON.stringify(dados), legenda, m.data_hora, status, chave).lastInsertRowid);
          criadas.push(id);
          try { await gerarArte(id); } catch (e) { erros.push(e.message); db.prepare('UPDATE publicacoes SET erro = ? WHERE id = ?').run(e.message, id); }
        }
      }
    }
  } finally { rodando = false; }
  return { criadas: criadas.length, erros: [...new Set(erros)] };
}

function proximosVencimentos(qtd = 6, prefixo = 'boleto', diaPadrao = 10) {
  const cfg = getConfig(); const hoje = new Date(); const dia = Number(cfg[prefixo + '_dia']) || diaPadrao;
  const r = [];
  for (let i = 0; i < qtd; i++) {
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    const v = vencimentoBoleto(ref.getFullYear(), ref.getMonth(), dia);
    const nomeFeriado = feriados(v.original.getFullYear()).get(iso(v.original));
    r.push({ data: iso(v.data), original: iso(v.original), adiado: v.adiado, motivo: v.adiado ? (nomeFeriado || 'fim de semana') : '' });
  }
  return r;
}

module.exports = { planejar, previa, executar, proximosVencimentos, vencimentoBoleto, feriados, ehDiaUtil, iso };
