'use strict';
// Balbino Oportunidades — gestão e análise de leads de inscrição.
//
// Princípios (resumo — a definição completa dos indicadores está em DOCUMENTACAO/BALBINO_OPORTUNIDADES.md):
//  · A planilha de acompanhamento é a FONTE dos dados da inscrição (nome, curso, polo, tutor do relatório, datas, status).
//    Reimportar atualiza só esses campos; etapa interna, responsável atual, próximo contato, anotações e atendimentos
//    registrados no sistema nunca são sobrescritos. Registro que não vem numa importação não é apagado.
//  · "Status de origem" (Boleto vencido, Inscrito, Qualificado…) e "etapa interna" (novo, em contato…) são campos separados.
//  · Conversão = RA confirmado na lista do Mundo Azul (ma_lista_alunos) do mesmo processo, conciliado por CPF com um único RA,
//    ou vínculo confirmado manualmente por quem lança. "Inscrito" ou boleto NÃO contam como conversão.
//  · Tutor do relatório (fonte), responsável atual (sistema) e autor de cada atendimento são guardados separadamente.
//  · A permissão é verificada aqui no servidor: tutor/visualizador com polo só recebe as oportunidades do próprio polo.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ETAPAS = [
  ['novo', 'Novo'], ['contato', 'Em contato'], ['aguardando', 'Aguardando retorno'], ['negociacao', 'Em negociação'],
  ['pendencia', 'Inscrição pendente'], ['concluido', 'Concluído'], ['perdido', 'Sem interesse']
];
const ETAPA_LABEL = Object.fromEntries(ETAPAS);
const ETAPAS_FECHADAS = new Set(['concluido', 'perdido']);
const CANAIS = { whatsapp: 'WhatsApp', telefone: 'Telefone', presencial: 'Presencial', email: 'E-mail', outro: 'Outro' };
const RA_LABEL = { confirmado: 'RA confirmado', aguardando: 'Aguardando conciliação', sem_ra: 'Sem RA' };
const RETORNO_LABEL = { vencido: 'Retorno vencido', hoje: 'Retorno hoje', proximos7: 'Próximos 7 dias', futuro: 'Mais de 7 dias', sem: 'Sem data de retorno', encerrado: 'Encerrada / convertida' };
// Campos que vêm da planilha (são os únicos que uma importação pode alterar).
const CAMPOS_FONTE = ['cpf', 'nome', 'telefone', 'curso_cod', 'curso_nome', 'polo_fonte', 'prioridade', 'ultimo_atendimento', 'data_retorno_origem', 'data_registro', 'interacoes', 'status_origem', 'origem', 'localizacao', 'contato', 'responsavel_origem'];
const ROTULO_CAMPO = { cpf: 'CPF', nome: 'nome', telefone: 'telefone', curso_cod: 'código do curso', curso_nome: 'curso', polo_fonte: 'polo', prioridade: 'prioridade', ultimo_atendimento: 'último atendimento', data_retorno_origem: 'data de retorno', data_registro: 'data de inscrição', interacoes: 'interações', status_origem: 'status', origem: 'origem', localizacao: 'localização', contato: 'contato', responsavel_origem: 'tutor do relatório' };
const MAX_LINHAS_IMPORTACAO = 20000;

module.exports = function criarOportunidades({ db, DATA_DIR, all, get, run, tx, falha, registrar, lerCorpo, enviarJson, ehAdmin, podeLancar, hojeISO, norm, poloDaFonte, produtoDoCurso }) {
  // ------------------------------------------------------------------ esquema (aditivo, idempotente e com backup)
  function migrar() {
    const existe = t => !!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t);
    if (!existe('ma_oportunidade_atendimentos')) {
      try {
        const n = existe('ma_oportunidades') ? get('SELECT COUNT(*) n FROM ma_oportunidades').n : 0;
        if (n) {
          const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
          db.exec(`VACUUM INTO '${path.join(dir, `antes-oportunidades-v31-${Date.now()}.db`).replace(/'/g, "''")}'`);
        }
      } catch (e) { console.error('Aviso: não consegui criar o backup antes da atualização de Oportunidades:', e.message); }
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS ma_oportunidade_importacoes (
      id INTEGER PRIMARY KEY,
      ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
      arquivo TEXT, conteudo_hash TEXT,
      linhas INTEGER NOT NULL DEFAULT 0, novos INTEGER NOT NULL DEFAULT 0, atualizados INTEGER NOT NULL DEFAULT 0,
      inalterados INTEGER NOT NULL DEFAULT 0, ignorados INTEGER NOT NULL DEFAULT 0, com_alerta INTEGER NOT NULL DEFAULT 0,
      colunas TEXT, detalhe TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), criado_por TEXT, criado_por_nome TEXT);
    CREATE INDEX IF NOT EXISTS ix_ma_op_imp_ciclo ON ma_oportunidade_importacoes(ciclo_id, id);
    CREATE TABLE IF NOT EXISTS ma_oportunidade_atendimentos (
      id INTEGER PRIMARY KEY,
      oportunidade_id INTEGER NOT NULL REFERENCES ma_oportunidades(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      canal TEXT NOT NULL DEFAULT 'outro',
      resultado TEXT,
      etapa_antes TEXT, etapa_depois TEXT, proximo_contato TEXT,
      autor_login TEXT, autor_nome TEXT, autor_usuario_id INTEGER, autor_tutor_id INTEGER,
      anulado INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS ix_ma_op_atend ON ma_oportunidade_atendimentos(oportunidade_id, data);
    CREATE TABLE IF NOT EXISTS ma_oportunidade_eventos (
      id INTEGER PRIMARY KEY,
      oportunidade_id INTEGER NOT NULL REFERENCES ma_oportunidades(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL, de TEXT, para TEXT, detalhe TEXT,
      importacao_id INTEGER,
      por_login TEXT, por_nome TEXT,
      em TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS ix_ma_op_evt ON ma_oportunidade_eventos(oportunidade_id, id);
    `);
    const cols = all('PRAGMA table_info(ma_oportunidades)').map(c => c.name);
    const add = (c, t) => { if (!cols.includes(c)) db.exec(`ALTER TABLE ma_oportunidades ADD COLUMN ${c} ${t}`); };
    add('responsavel_tutor_id', 'INTEGER REFERENCES tutores(id)');
    add('importacao_id', 'INTEGER');
    add('primeira_importacao_id', 'INTEGER');
    add('fonte_atualizada_em', 'TEXT');
    add('ra_manual_lista_id', 'INTEGER');
    add('ra_manual_status', 'TEXT');
    add('ra_manual_por', 'TEXT');
    add('ra_manual_em', 'TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS ix_ma_oportunidades_cpf ON ma_oportunidades(ciclo_id, cpf)');
  }
  migrar();

  // ------------------------------------------------------------------ utilidades
  const soDig = v => String(v ?? '').replace(/\D/g, '');
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  function isoValido(v) {
    if (!ISO.test(v)) return false;
    const d = new Date(v + 'T12:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function addDiasISO(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // Datas da planilha: ISO, dd/mm/aaaa (com ou sem hora), dd-mm-aaaa, dd/mm/aa ou número de série do Excel.
  function dataFonte(v) {
    const t = String(v ?? '').trim();
    if (!t) return { valor: null, ok: true };
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let iso = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    if (!iso && (m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\D|$)/))) {
      const ano = m[3].length === 2 ? '20' + m[3] : m[3];
      iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    if (!iso && /^\d{5}(?:\.\d+)?$/.test(t)) {
      const n = Math.floor(Number(t));
      if (n > 20000 && n < 80000) iso = new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
    }
    return iso && isoValido(iso) ? { valor: iso, ok: true } : { valor: null, ok: false };
  }
  function cpfValido(c) {
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let s = 0; for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
    }
    return true;
  }
  // CPF normalizado: só dígitos, com zeros à esquerda (planilhas costumam perder o zero inicial).
  function cpfNormalizado(v) {
    const d = soDig(v);
    if (!d) return { valor: null, informado: false, valido: true };
    const c = d.length >= 9 && d.length <= 11 ? d.padStart(11, '0') : d;
    return cpfValido(c) ? { valor: c, informado: true, valido: true } : { valor: null, informado: true, valido: false };
  }
  const cpfChave = v => { const d = soDig(v); return d.length >= 9 && d.length <= 11 ? d.padStart(11, '0') : ''; };
  const mascaraCpf = c => { const d = soDig(c); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : (d ? '***' : ''); };
  const txt = (v, n) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, n) : null; };
  const quem = u => ({ login: u.login || null, nome: u.nome || u.login || null });
  function exigeMesmaOrigem(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let host = '';
    try { host = new URL(origin).host; } catch { falha(403, 'Origem da solicitação inválida.'); }
    const esperado = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (host.toLowerCase() !== esperado && host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) falha(403, 'Origem da solicitação inválida.');
  }

  // ------------------------------------------------------------------ permissões
  // admin e lançador: todos os polos. Visualizador/tutor com polo: somente o próprio polo (mesma regra do Matrículas).
  const poloRestrito = u => (u && u.papel === 'visualizador' && u.polo_id ? Number(u.polo_id) : null);
  const ehTutor = u => !!(u && u.tutor_id);
  function permissoes(u) {
    const lancar = !!podeLancar(u);
    return {
      importar: lancar, definir_responsavel: lancar, conciliar: lancar,
      atender: lancar || (ehTutor(u) && !!poloRestrito(u)),
      polo_restrito: poloRestrito(u), tutor_id: u.tutor_id || null, admin: !!ehAdmin(u)
    };
  }
  function cicloValido(v) {
    const id = Number(v) || Number(get('SELECT id FROM ciclos WHERE padrao=1 ORDER BY id DESC LIMIT 1')?.id) || Number(get('SELECT id FROM ciclos ORDER BY id DESC LIMIT 1')?.id) || 0;
    if (!id || !get('SELECT 1 FROM ciclos WHERE id=?', id)) falha(400, 'Selecione um processo válido.');
    return id;
  }

  // ------------------------------------------------------------------ carga e enriquecimento (uma vez por requisição)
  function criarContexto() {
    const poloMemo = new Map();
    const poloId = nome => { const k = String(nome || '').trim(); if (!k) return null; if (!poloMemo.has(k)) poloMemo.set(k, poloDaFonte(k) || null); return poloMemo.get(k); };
    const polos = Object.fromEntries(all('SELECT id, nome FROM polos').map(r => [r.id, r.nome]));
    const produtos = Object.fromEntries(all('SELECT id, nome FROM produtos').map(r => [r.id, r.nome]));
    const porCodigo = produtoDoCurso();
    const porNomeCurso = new Map();
    for (const r of all('SELECT curso_nome, produto_id FROM ma_lista_cursos WHERE produto_id IS NOT NULL AND curso_nome IS NOT NULL')) {
      const k = norm(r.curso_nome); const s = porNomeCurso.get(k) || new Set(); s.add(r.produto_id); porNomeCurso.set(k, s);
    }
    const produtoId = (cod, nome) => {
      if (cod && porCodigo[cod]) return porCodigo[cod];
      const s = porNomeCurso.get(norm(nome)); return s && s.size === 1 ? [...s][0] : null;
    };
    return { poloId, polos, produtos, produtoId };
  }

  function indiceRA(cicloId) {
    const lista = all("SELECT id, candidato, ra, nome, cpf, polo_fonte, curso_nome, data_pagto, data_inscricao FROM ma_lista_alunos WHERE ciclo_id=? AND ativo=1 AND ra<>''", cicloId);
    const porCpf = new Map(), porNome = new Map(), porId = new Map();
    for (const r of lista) {
      porId.set(r.id, r);
      const c = cpfChave(r.cpf); if (c) { const a = porCpf.get(c) || []; a.push(r); porCpf.set(c, a); }
      const n = norm(r.nome); if (n) { const a = porNome.get(n) || []; a.push(r); porNome.set(n, a); }
    }
    const ultima = get('SELECT criado_em, criado_por, linhas, com_ra FROM ma_lista_importacoes WHERE ciclo_id=? ORDER BY id DESC LIMIT 1', cicloId) || null;
    return { porCpf, porNome, porId, total: lista.length, ultima };
  }
  // Situação do RA para uma oportunidade:
  //  confirmado → vínculo manual confirmado ainda presente na lista, ou CPF com exatamente um RA no mesmo processo;
  //  aguardando → CPF com mais de um RA, ou mesmo nome completo com RA sem CPF que confirme (precisa de conciliação manual);
  //  sem_ra     → nenhuma correspondência na lista do Mundo Azul.
  function situacaoRA(o, idx) {
    if (o.ra_manual_status === 'confirmado' && o.ra_manual_lista_id) {
      const r = idx.porId.get(Number(o.ra_manual_lista_id));
      if (r) return { situacao: 'confirmado', ra: r.ra, fonte: 'manual', lista_id: r.id, motivo: 'Vínculo confirmado manualmente' };
    }
    const c = cpfChave(o.cpf);
    const porCpf = c ? idx.porCpf.get(c) || [] : [];
    const ras = [...new Set(porCpf.map(r => String(r.ra).trim()))];
    if (ras.length === 1) return { situacao: 'confirmado', ra: ras[0], fonte: 'cpf', lista_id: porCpf[0].id, motivo: 'CPF com um único RA na lista do Mundo Azul' };
    if (ras.length > 1) return { situacao: 'aguardando', ra: '', fonte: 'cpf', candidatos: porCpf.map(r => r.id), motivo: `CPF com ${ras.length} RAs diferentes na lista do Mundo Azul` };
    if (o.ra_manual_status !== 'rejeitado') {
      const n = norm(o.nome);
      const mesmos = n && n.split(' ').length >= 2 ? (idx.porNome.get(n) || []).filter(r => !(c && cpfChave(r.cpf) && cpfChave(r.cpf) !== c)) : [];
      if (mesmos.length) return { situacao: 'aguardando', ra: '', fonte: 'nome', candidatos: mesmos.map(r => r.id), motivo: 'Nome igual a aluno com RA, sem CPF que confirme' };
    }
    return { situacao: 'sem_ra', ra: '', fonte: null, motivo: c ? 'CPF não encontrado na lista do Mundo Azul' : 'Sem CPF e sem correspondência confiável' };
  }

  function carregarBase(cicloId, usuario, ctx = criarContexto()) {
    const restrito = poloRestrito(usuario);
    const hoje = hojeISO(), em7 = addDiasISO(hoje, 7);
    const rows = all(`SELECT o.*, u.nome resp_usuario_nome, t.nome resp_tutor_nome FROM ma_oportunidades o
      LEFT JOIN usuarios u ON u.id=o.responsavel_id LEFT JOIN tutores t ON t.id=o.responsavel_tutor_id
      WHERE o.ciclo_id=? ORDER BY o.id`, cicloId);
    const atend = new Map();
    for (const a of all(`SELECT a.oportunidade_id, a.data, a.autor_nome, a.autor_login FROM ma_oportunidade_atendimentos a
        JOIN ma_oportunidades o ON o.id=a.oportunidade_id WHERE o.ciclo_id=? AND a.anulado=0 ORDER BY a.data, a.id`, cicloId)) {
      const l = atend.get(a.oportunidade_id) || []; l.push(a); atend.set(a.oportunidade_id, l);
    }
    const idx = indiceRA(cicloId);
    const ultimaImp = get('SELECT id FROM ma_oportunidade_importacoes WHERE ciclo_id=? ORDER BY id DESC LIMIT 1', cicloId)?.id || null;
    const base = [];
    for (const o of rows) {
      const polo_id = ctx.poloId(o.polo_fonte);
      if (restrito && polo_id !== restrito) continue;
      const ra = situacaoRA(o, idx);
      const at = atend.get(o.id) || [];
      const ultimoSistema = at.length ? at[at.length - 1].data : null;
      const proximo = o.proximo_contato || o.data_retorno_origem || null;
      const aberta = ra.situacao !== 'confirmado' && !ETAPAS_FECHADAS.has(o.etapa);
      const retorno = !aberta ? 'encerrado' : !proximo ? 'sem' : proximo < hoje ? 'vencido' : proximo === hoje ? 'hoje' : proximo <= em7 ? 'proximos7' : 'futuro';
      const produto_id = ctx.produtoId(o.curso_cod, o.curso_nome);
      const curso = o.curso_nome || o.curso_cod || '';
      const respKey = o.responsavel_tutor_id ? 't:' + o.responsavel_tutor_id : o.responsavel_id ? 'u:' + o.responsavel_id : '';
      base.push({
        id: o.id, identificador: o.identificador, nome: o.nome || '', cpf: o.cpf || '', telefone: o.telefone || '',
        polo_id, polo: polo_id ? ctx.polos[polo_id] || o.polo_fonte : (o.polo_fonte ? `${o.polo_fonte} (não identificado)` : 'Polo não informado'),
        polo_key: polo_id ? String(polo_id) : 'sem', polo_fonte: o.polo_fonte || '',
        curso, curso_key: norm(curso) || 'sem', curso_cod: o.curso_cod || '',
        produto_id, produto: produto_id ? ctx.produtos[produto_id] || '' : '', produto_key: produto_id ? String(produto_id) : 'sem',
        tutor_origem: o.responsavel_origem || '', tutor_key: norm(o.responsavel_origem) || 'sem',
        responsavel_key: respKey || 'sem', responsavel: o.resp_tutor_nome || o.resp_usuario_nome || '',
        status_origem: o.status_origem || '', status_key: norm(o.status_origem) || 'sem',
        etapa: ETAPA_LABEL[o.etapa] ? o.etapa : 'novo',
        data_registro: o.data_registro || null, ultimo_atendimento: o.ultimo_atendimento || null,
        ultimo_contato_sistema: ultimoSistema, atendimentos: at.length, datas_atendimento: at.map(a => a.data), autores: at.map(a => a.autor_nome || a.autor_login || ''), autores_keys: at.map(a => norm(a.autor_nome || a.autor_login || '') || 'sem'),
        proximo_contato: proximo, proximo_manual: o.proximo_contato || null, retorno, aberta,
        sem_contato: !at.length && !o.ultimo_atendimento,
        ra_situacao: ra.situacao, ra: ra.ra, ra_fonte: ra.fonte, ra_motivo: ra.motivo, ra_candidatos: ra.candidatos || [],
        prioridade: o.prioridade || '', origem: o.origem || '', interacoes: o.interacoes ?? null,
        observacao: o.observacao || '', atualizado_em: o.atualizado_em, atualizado_por: o.atualizado_por,
        fora_ultima_importacao: !!(ultimaImp && o.importacao_id && o.importacao_id !== ultimaImp)
      });
    }
    return { base, idx, ctx, cicloId };
  }

  // ------------------------------------------------------------------ filtros (os mesmos para painel, lista e exportação)
  function lerFiltros(q) {
    const f = {};
    for (const k of ['insc_de', 'insc_ate', 'atend_de', 'atend_ate']) { const v = String(q[k] || ''); if (v) { if (!isoValido(v)) falha(400, 'Data inválida no filtro.'); f[k] = v; } }
    if (f.insc_de && f.insc_ate && f.insc_de > f.insc_ate) falha(400, 'O período de inscrição está invertido.');
    if (f.atend_de && f.atend_ate && f.atend_de > f.atend_ate) falha(400, 'O período de atendimento está invertido.');
    for (const k of ['polo', 'tutor', 'resp', 'curso', 'produto', 'status', 'etapa', 'ra', 'retorno', 'contato', 'mes', 'autor']) { const v = String(q[k] || '').trim(); if (v) f[k] = v.slice(0, 200); }
    const busca = String(q.q || '').trim(); if (busca) f.q = busca.slice(0, 100);
    return f;
  }
  function noPeriodo(d, de, ate) { return !!d && (!de || d >= de) && (!ate || d <= ate); }
  function atendimentoNoFiltro(r, f) {
    if (f.autor) return r.datas_atendimento.some((d, i) => r.autores_keys[i] === f.autor && noPeriodo(d, f.atend_de, f.atend_ate));
    if (!f.atend_de && !f.atend_ate) return true;
    return r.datas_atendimento.some(d => noPeriodo(d, f.atend_de, f.atend_ate)) || noPeriodo(r.ultimo_atendimento, f.atend_de, f.atend_ate);
  }
  function contarAtendimentosFiltrados(r, f) {
    if (!f.autor && !f.atend_de && !f.atend_ate) return r.atendimentos;
    return r.datas_atendimento.filter((d, i) => (!f.autor || r.autores_keys[i] === f.autor) && noPeriodo(d, f.atend_de, f.atend_ate)).length;
  }
  function filtrar(base, f) {
    const termo = f.q ? norm(f.q) : '', termoDig = f.q ? soDig(f.q) : '';
    return base.filter(r => {
      if ((f.insc_de || f.insc_ate) && !noPeriodo(r.data_registro, f.insc_de, f.insc_ate)) return false;
      if (!atendimentoNoFiltro(r, f)) return false;
      if (f.polo && r.polo_key !== f.polo) return false;
      if (f.tutor && r.tutor_key !== f.tutor) return false;
      if (f.resp && r.responsavel_key !== f.resp) return false;
      if (f.curso && r.curso_key !== f.curso) return false;
      if (f.produto && r.produto_key !== f.produto) return false;
      if (f.status && r.status_key !== f.status) return false;
      if (f.etapa && r.etapa !== f.etapa) return false;
      if (f.ra && r.ra_situacao !== f.ra) return false;
      if (f.retorno && (f.retorno === 'atrasados' ? r.retorno !== 'vencido' : r.retorno !== f.retorno)) return false;
      if (f.contato === 'sem' && !r.sem_contato) return false;
      if (f.contato === 'com' && r.sem_contato) return false;
      if (f.mes && (f.mes === 'sem' ? r.data_registro : String(r.data_registro || '').slice(0, 7) !== f.mes)) return false;
      if (termo) {
        const alvo = norm([r.nome, r.identificador, r.curso, r.polo, r.status_origem, r.tutor_origem, r.responsavel, r.ra].join(' '));
        const dig = termoDig.length >= 4 && (r.telefone.includes(termoDig) || r.cpf.includes(termoDig));
        if (!alvo.includes(termo) && !dig) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ indicadores
  const taxa = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);
  function contarRA(rows) {
    const c = { confirmado: 0, aguardando: 0, sem_ra: 0 };
    for (const r of rows) c[r.ra_situacao]++;
    return c;
  }
  function kpis(rows, f) {
    const ra = contarRA(rows);
    const retornos = { vencido: 0, hoje: 0, proximos7: 0, futuro: 0, sem: 0, encerrado: 0 };
    let atendimentos = 0, atendidos = 0;
    for (const r of rows) {
      retornos[r.retorno]++;
      const n = contarAtendimentosFiltrados(r, f);
      atendimentos += n; if (n) atendidos++;
    }
    return {
      total: rows.length, ra, taxa_conversao: taxa(ra.confirmado, rows.length),
      formula: `RA confirmado ÷ oportunidades no filtro = ${ra.confirmado} ÷ ${rows.length}`,
      abertas: rows.filter(r => r.aberta).length,
      sem_contato: rows.filter(r => r.sem_contato).length,
      sem_contato_abertas: rows.filter(r => r.sem_contato && r.aberta).length,
      retornos, atendimentos_registrados: atendimentos, oportunidades_atendidas: atendidos
    };
  }
  function agrupar(rows, chave, rotulo, f) {
    const m = new Map();
    for (const r of rows) {
      const k = r[chave];
      let g = m.get(k);
      if (!g) { g = { key: k, label: rotulo(r), total: 0, confirmado: 0, aguardando: 0, sem_ra: 0, abertas: 0, sem_contato: 0, vencidos: 0, atendimentos: 0, status: {} }; m.set(k, g); }
      g.total++; g[r.ra_situacao]++;
      if (r.aberta) g.abertas++;
      if (r.sem_contato) g.sem_contato++;
      if (r.retorno === 'vencido') g.vencidos++;
      g.atendimentos += contarAtendimentosFiltrados(r, f);
      g.status[r.status_key] = (g.status[r.status_key] || 0) + 1;
    }
    return [...m.values()].map(g => ({ ...g, taxa: taxa(g.confirmado, g.total) })).sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label), 'pt-BR'));
  }
  function statusRotulos(rows) {
    const m = new Map();
    for (const r of rows) if (!m.has(r.status_key)) m.set(r.status_key, r.status_origem || 'Sem status na origem');
    return m;
  }
  function painel(q, usuario) {
    const cicloId = cicloValido(q.ciclo);
    const f = lerFiltros(q);
    const { base, idx } = carregarBase(cicloId, usuario);
    const rows = filtrar(base, f);
    const k = kpis(rows, f);
    const sr = statusRotulos(base);
    const porStatus = agrupar(rows, 'status_key', r => r.status_origem || 'Sem status na origem', f).map(g => ({ ...g, percentual: taxa(g.total, rows.length) }));
    // funil por etapa: contagem na etapa atual e "na etapa ou adiante" (pela etapa ATUAL; o sistema não reconstrói etapas passadas)
    const ordem = ETAPAS.map(e => e[0]).filter(e => e !== 'perdido');
    const porEtapa = ETAPAS.map(([key, label]) => {
      const g = rows.filter(r => r.etapa === key);
      const c = contarRA(g);
      return { key, label, total: g.length, percentual: taxa(g.length, rows.length), confirmado: c.confirmado, taxa: taxa(c.confirmado, g.length) };
    });
    let acumulado = rows.filter(r => r.etapa !== 'perdido').length, anterior = null;
    const funil = ordem.map(key => {
      const atual = acumulado; acumulado -= rows.filter(r => r.etapa === key).length;
      const item = { key, label: ETAPA_LABEL[key], na_etapa_ou_adiante: atual, taxa_da_anterior: anterior === null ? null : taxa(atual, anterior) };
      anterior = atual; return item;
    });
    // conversão por mês de inscrição
    const meses = new Map();
    for (const r of rows) {
      const mk = r.data_registro ? r.data_registro.slice(0, 7) : 'sem';
      const g = meses.get(mk) || { key: mk, label: mk === 'sem' ? 'Sem data de inscrição' : mk.split('-').reverse().join('/'), total: 0, confirmado: 0 };
      g.total++; if (r.ra_situacao === 'confirmado') g.confirmado++; meses.set(mk, g);
    }
    const conversaoPeriodo = [...meses.values()].sort((a, b) => (a.key === 'sem') - (b.key === 'sem') || a.key.localeCompare(b.key)).map(g => ({ ...g, taxa: taxa(g.confirmado, g.total) }));
    // volume atendido por semana (atendimentos registrados no sistema) e por autor
    const semanas = new Map(), autores = new Map();
    for (const r of rows) r.datas_atendimento.forEach((d, i) => {
      if (!noPeriodo(d, f.atend_de, f.atend_ate) || (f.autor && r.autores_keys[i] !== f.autor)) return;
      const dt = new Date(d + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      const wk = dt.toISOString().slice(0, 10);
      const s = semanas.get(wk) || { key: wk, label: 'Semana de ' + wk.split('-').reverse().join('/'), atendimentos: 0, leads: new Set() };
      s.atendimentos++; s.leads.add(r.id); semanas.set(wk, s);
      const an = r.autores[i] || 'Sem autor';
      const a = autores.get(an) || { label: an, atendimentos: 0, leads: new Set() };
      a.atendimentos++; a.leads.add(r.id); autores.set(an, a);
    });
    const volume = [...semanas.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-26).map(s => ({ key: s.key, label: s.label, atendimentos: s.atendimentos, oportunidades: s.leads.size }));
    const porAutor = [...autores.values()].map(a => ({ label: a.label, atendimentos: a.atendimentos, oportunidades: a.leads.size })).sort((a, b) => b.atendimentos - a.atendimentos);
    // cruzamento polo × tutor do relatório × status
    const cruz = new Map();
    for (const r of rows) {
      const ck = r.polo_key + '|' + r.tutor_key;
      const g = cruz.get(ck) || { polo_key: r.polo_key, polo: r.polo, tutor_key: r.tutor_key, tutor: r.tutor_origem || 'Sem tutor no relatório', total: 0, confirmado: 0, status: {} };
      g.total++; if (r.ra_situacao === 'confirmado') g.confirmado++; g.status[r.status_key] = (g.status[r.status_key] || 0) + 1; cruz.set(ck, g);
    }
    const cruzamento = [...cruz.values()].map(g => ({ ...g, taxa: taxa(g.confirmado, g.total) })).sort((a, b) => a.polo.localeCompare(b.polo, 'pt-BR') || b.total - a.total);
    const avisos = [];
    if (!idx.total) avisos.push('Nenhum aluno com RA na lista do Mundo Azul deste processo. Sem essa lista, nenhuma oportunidade pode ser confirmada como matrícula — importe-a em Matrículas › Conciliação Mundo Azul.');
    const semPolo = base.filter(r => r.polo_key === 'sem').length;
    if (semPolo && !poloRestrito(usuario)) avisos.push(`${semPolo} oportunidade(s) com polo não reconhecido. Elas aparecem para a administração, mas não para tutores, até o nome do polo ser vinculado (use “Vincular polos” na importação).`);
    if (k.ra.aguardando) avisos.push(`${k.ra.aguardando} oportunidade(s) aguardando conciliação: há aluno com RA possivelmente correspondente, mas sem CPF único que confirme. Elas não entram na conversão até alguém confirmar o vínculo.`);
    // comparação com outro processo e/ou outro período de inscrição (mesmos demais filtros)
    let comparacao = null;
    const cmpCiclo = Number(q.cmp_ciclo) || null, cmpDe = String(q.cmp_de || ''), cmpAte = String(q.cmp_ate || '');
    if (cmpCiclo || cmpDe || cmpAte) {
      if ((cmpDe && !isoValido(cmpDe)) || (cmpAte && !isoValido(cmpAte))) falha(400, 'Data inválida na comparação.');
      const cid = cmpCiclo || cicloId;
      if (!get('SELECT 1 FROM ciclos WHERE id=?', cid)) falha(400, 'Processo de comparação inválido.');
      const f2 = { ...f };
      if (cmpDe || cmpAte) { f2.insc_de = cmpDe || undefined; f2.insc_ate = cmpAte || undefined; }
      const outros = filtrar(carregarBase(cid, usuario).base, f2);
      comparacao = { ciclo: cid, ciclo_nome: get('SELECT nome FROM ciclos WHERE id=?', cid)?.nome, insc_de: f2.insc_de || null, insc_ate: f2.insc_ate || null, kpis: kpis(outros, f2),
        por_status: agrupar(outros, 'status_key', r => r.status_origem || 'Sem status na origem', f2).map(g => ({ key: g.key, label: g.label, total: g.total, confirmado: g.confirmado })) };
    }
    return {
      ciclo: cicloId, filtros: f, permissoes: permissoes(usuario), atualizado_em: new Date().toISOString(),
      kpis: k, por_status: porStatus, por_etapa: porEtapa, funil,
      por_polo: agrupar(rows, 'polo_key', r => r.polo, f),
      por_tutor: agrupar(rows, 'tutor_key', r => r.tutor_origem || 'Sem tutor no relatório', f),
      por_responsavel: agrupar(rows, 'responsavel_key', r => r.responsavel || 'Sem responsável', f),
      por_curso: agrupar(rows, 'curso_key', r => r.curso || 'Curso não informado', f).slice(0, 60),
      por_produto: agrupar(rows, 'produto_key', r => r.produto || 'Produto não identificado', f),
      cruzamento, status_colunas: [...sr.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => (porStatus.find(x => x.key === b.key)?.total || 0) - (porStatus.find(x => x.key === a.key)?.total || 0)),
      conversao_periodo: conversaoPeriodo, volume_atendimento: volume, por_autor: porAutor,
      base_ra: { alunos_com_ra: idx.total, ultima_importacao: idx.ultima },
      ultima_importacao: get('SELECT id, arquivo, linhas, novos, atualizados, inalterados, ignorados, com_alerta, criado_em, criado_por_nome, criado_por FROM ma_oportunidade_importacoes WHERE ciclo_id=? ORDER BY id DESC LIMIT 1', cicloId) || null,
      total_base: base.length, avisos, comparacao
    };
  }

  function opcoes(q, usuario) {
    const cicloId = cicloValido(q.ciclo);
    const { base } = carregarBase(cicloId, usuario);
    const uniq = (key, label) => { const m = new Map(); for (const r of base) if (!m.has(r[key])) m.set(r[key], label(r)); return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'pt-BR')); };
    const restrito = poloRestrito(usuario);
    const tutores = all(`SELECT t.id, t.nome, GROUP_CONCAT(tp.polo_id) polos FROM tutores t LEFT JOIN tutor_polos tp ON tp.tutor_id=t.id WHERE t.ativo=1 GROUP BY t.id ORDER BY t.nome COLLATE NOCASE`)
      .map(t => ({ key: 't:' + t.id, nome: t.nome, tipo: 'tutor', polos: String(t.polos || '').split(',').filter(Boolean).map(Number) }))
      .filter(t => !restrito || t.polos.includes(restrito));
    const usuarios = podeLancar(usuario) ? all("SELECT id, nome FROM usuarios WHERE ativo=1 AND papel IN ('admin','lancador') ORDER BY nome COLLATE NOCASE").map(u => ({ key: 'u:' + u.id, nome: u.nome, tipo: 'usuario', polos: [] })) : [];
    return {
      ciclo: cicloId, hoje: hojeISO(),
      ciclos: all('SELECT id, nome, padrao, data_inicio, data_fim FROM ciclos ORDER BY id DESC'),
      polos: uniq('polo_key', r => r.polo), polos_cadastro: all('SELECT id, nome FROM polos WHERE ativo=1 ORDER BY ordem, nome').filter(p => !restrito || p.id === restrito),
      tutores_relatorio: uniq('tutor_key', r => r.tutor_origem || 'Sem tutor no relatório'),
      responsaveis_filtro: uniq('responsavel_key', r => r.responsavel || 'Sem responsável'),
      autores_atendimento: (() => {
        const m = new Map();
        for (const r of base) r.autores.forEach((nome, i) => { const value = r.autores_keys[i] || 'sem'; if (!m.has(value)) m.set(value, nome || 'Sem autor'); });
        return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
      })(),
      cursos: uniq('curso_key', r => r.curso || 'Curso não informado'), produtos: uniq('produto_key', r => r.produto || 'Produto não identificado'),
      status: uniq('status_key', r => r.status_origem || 'Sem status na origem'),
      etapas: ETAPAS.map(([value, label]) => ({ value, label })), canais: Object.entries(CANAIS).map(([value, label]) => ({ value, label })),
      ra: Object.entries(RA_LABEL).map(([value, label]) => ({ value, label })), retornos: Object.entries(RETORNO_LABEL).map(([value, label]) => ({ value, label })),
      responsaveis: [...tutores, ...usuarios], permissoes: permissoes(usuario), usuario: { nome: usuario.nome, login: usuario.login, papel: usuario.papel }
    };
  }

  // ------------------------------------------------------------------ lista (detalhamento) e exportação
  const ORDENS = {
    nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    retorno: (a, b) => String(a.proximo_contato || '9999').localeCompare(String(b.proximo_contato || '9999')) || a.nome.localeCompare(b.nome, 'pt-BR'),
    inscricao: (a, b) => String(b.data_registro || '').localeCompare(String(a.data_registro || '')) || a.nome.localeCompare(b.nome, 'pt-BR'),
    contato: (a, b) => String(b.ultimo_contato_sistema || b.ultimo_atendimento || '').localeCompare(String(a.ultimo_contato_sistema || a.ultimo_atendimento || '')),
    polo: (a, b) => a.polo.localeCompare(b.polo, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR')
  };
  function linhaPublica(r, comTelefone) {
    return {
      id: r.id, identificador: r.identificador, nome: r.nome, cpf: mascaraCpf(r.cpf), ...(comTelefone ? { telefone: r.telefone } : {}),
      polo: r.polo, polo_id: r.polo_id, curso: r.curso, produto: r.produto, tutor_origem: r.tutor_origem, responsavel: r.responsavel, responsavel_key: r.responsavel_key === 'sem' ? '' : r.responsavel_key,
      status_origem: r.status_origem, etapa: r.etapa, etapa_label: ETAPA_LABEL[r.etapa], ra_situacao: r.ra_situacao, ra_label: RA_LABEL[r.ra_situacao], ra: r.ra, ra_motivo: r.ra_motivo,
      data_registro: r.data_registro, ultimo_atendimento: r.ultimo_atendimento, ultimo_contato_sistema: r.ultimo_contato_sistema, atendimentos: r.atendimentos,
      proximo_contato: r.proximo_contato, retorno: r.retorno, retorno_label: RETORNO_LABEL[r.retorno], sem_contato: r.sem_contato, prioridade: r.prioridade
    };
  }
  function lista(q, usuario) {
    const cicloId = cicloValido(q.ciclo);
    const f = lerFiltros(q);
    const rows = filtrar(carregarBase(cicloId, usuario).base, f).sort(ORDENS[q.ordem] || ORDENS.retorno);
    const porPagina = Math.min(500, Math.max(10, Number(q.por_pagina) || 100));
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const p = permissoes(usuario);
    return { ciclo: cicloId, total: rows.length, pagina, por_pagina: porPagina, paginas: Math.max(1, Math.ceil(rows.length / porPagina)),
      ra: contarRA(rows), linhas: rows.slice((pagina - 1) * porPagina, pagina * porPagina).map(r => linhaPublica(r, p.atender)), permissoes: p };
  }

  const COLUNAS_EXPORT = [
    ['Identificador', r => r.identificador], ['Nome', r => r.nome], ['CPF (mascarado)', r => mascaraCpf(r.cpf)], ['Polo', r => r.polo], ['Curso', r => r.curso], ['Produto', r => r.produto],
    ['Tutor do relatório', r => r.tutor_origem], ['Responsável atual', r => r.responsavel], ['Status (origem)', r => r.status_origem], ['Etapa interna', r => ETAPA_LABEL[r.etapa]],
    ['Situação do RA', r => RA_LABEL[r.ra_situacao]], ['RA', r => r.ra], ['Data de inscrição', r => r.data_registro], ['Último atendimento (planilha)', r => r.ultimo_atendimento],
    ['Último atendimento (sistema)', r => r.ultimo_contato_sistema], ['Atendimentos registrados', r => r.atendimentos], ['Próximo contato', r => r.proximo_contato], ['Retorno', r => RETORNO_LABEL[r.retorno]]
  ];
  function exportar(q, usuario) {
    const cicloId = cicloValido(q.ciclo);
    const f = lerFiltros(q);
    const rows = filtrar(carregarBase(cicloId, usuario).base, f).sort(ORDENS[q.ordem] || ORDENS.polo);
    const k = kpis(rows, f);
    const ciclo = get('SELECT nome FROM ciclos WHERE id=?', cicloId)?.nome || String(cicloId);
    const filtrosTxt = Object.entries(f).map(([a, b]) => `${a}=${b}`).join('; ') || 'nenhum';
    const nomeBase = `oportunidades-${norm(ciclo).replace(/\s+/g, '-') || cicloId}-${hojeISO()}`;
    registrar(usuario, 'exportou oportunidades', `Processo ${cicloId}: ${rows.length} linha(s); filtros: ${filtrosTxt}`.slice(0, 500));
    if (q.formato === 'xlsx') {
      const resumo = [
        ['Balbino Oportunidades — resumo exportado'], ['Processo', ciclo], ['Filtros', filtrosTxt], ['Gerado em', new Date().toLocaleString('pt-BR')], [],
        ['Indicador', 'Valor'], ['Oportunidades no filtro', k.total], ['RA confirmado', k.ra.confirmado], ['Aguardando conciliação', k.ra.aguardando], ['Sem RA', k.ra.sem_ra],
        ['Taxa de conversão (%)', k.taxa_conversao ?? ''], ['Fórmula', k.formula], ['Em aberto', k.abertas], ['Sem contato registrado', k.sem_contato], ['Retornos vencidos', k.retornos.vencido],
        [], ['Status (origem)', 'Oportunidades', 'RA confirmado'], ...agrupar(rows, 'status_key', r => r.status_origem || 'Sem status na origem', f).map(g => [g.label, g.total, g.confirmado]),
        [], ['Polo', 'Oportunidades', 'RA confirmado', 'Taxa (%)'], ...agrupar(rows, 'polo_key', r => r.polo, f).map(g => [g.label, g.total, g.confirmado, g.taxa ?? '']),
        [], ['Tutor do relatório', 'Oportunidades', 'RA confirmado', 'Taxa (%)'], ...agrupar(rows, 'tutor_key', r => r.tutor_origem || 'Sem tutor no relatório', f).map(g => [g.label, g.total, g.confirmado, g.taxa ?? ''])
      ];
      const dados = [COLUNAS_EXPORT.map(c => c[0]), ...rows.map(r => COLUNAS_EXPORT.map(c => c[1](r) ?? ''))];
      return { tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nome: nomeBase + '.xlsx', corpo: gerarXlsx([{ nome: 'Oportunidades', linhas: dados }, { nome: 'Resumo', linhas: resumo }]) };
    }
    const cel = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const linhas = [COLUNAS_EXPORT.map(c => cel(c[0])).join(';'), ...rows.map(r => COLUNAS_EXPORT.map(c => cel(c[1](r))).join(';'))];
    return { tipo: 'text/csv; charset=utf-8', nome: nomeBase + '.csv', corpo: Buffer.from('﻿' + linhas.join('\r\n') + '\r\n', 'utf8') };
  }

  // ------------------------------------------------------------------ detalhe, acompanhamento e atendimentos
  function lerOportunidade(id, usuario, ctx = criarContexto()) {
    const o = get('SELECT * FROM ma_oportunidades WHERE id=?', id);
    if (!o) falha(404, 'Oportunidade não encontrada.');
    const polo = ctx.poloId(o.polo_fonte), restrito = poloRestrito(usuario);
    if (restrito && polo !== restrito) falha(404, 'Oportunidade não encontrada.');
    return { o, polo };
  }
  function detalhe(id, usuario) {
    const { o } = lerOportunidade(id, usuario);
    const { base, idx } = carregarBase(o.ciclo_id, usuario);
    const r = base.find(x => x.id === id);
    const p = permissoes(usuario);
    const atendimentos = all('SELECT id, data, canal, resultado, etapa_antes, etapa_depois, proximo_contato, autor_nome, autor_login, criado_em FROM ma_oportunidade_atendimentos WHERE oportunidade_id=? AND anulado=0 ORDER BY data DESC, id DESC', id)
      .map(a => ({ ...a, canal_label: CANAIS[a.canal] || a.canal, etapa_antes_label: ETAPA_LABEL[a.etapa_antes] || null, etapa_depois_label: ETAPA_LABEL[a.etapa_depois] || null }));
    const eventos = all('SELECT tipo, de, para, detalhe, importacao_id, por_nome, por_login, em FROM ma_oportunidade_eventos WHERE oportunidade_id=? ORDER BY id DESC LIMIT 200', id);
    const candidatos = (r.ra_candidatos || []).map(i => idx.porId.get(i)).filter(Boolean).map(a => ({ lista_id: a.id, ra: a.ra, nome: a.nome, cpf: mascaraCpf(a.cpf), polo: a.polo_fonte, curso: a.curso_nome, data: a.data_pagto || a.data_inscricao }));
    const imp = o.importacao_id ? get('SELECT id, arquivo, criado_em, criado_por_nome, criado_por FROM ma_oportunidade_importacoes WHERE id=?', o.importacao_id) : null;
    const primeira = o.primeira_importacao_id ? get('SELECT id, arquivo, criado_em, criado_por_nome, criado_por FROM ma_oportunidade_importacoes WHERE id=?', o.primeira_importacao_id) : null;
    return {
      oportunidade: { ...linhaPublica(r, p.atender), observacao: o.observacao || '', proximo_manual: o.proximo_contato || null, data_retorno_origem: o.data_retorno_origem, curso_cod: o.curso_cod,
        polo_fonte: o.polo_fonte, origem: o.origem, localizacao: o.localizacao, contato: o.contato, interacoes: o.interacoes, criado_em: o.criado_em, atualizado_em: o.atualizado_em,
        atualizado_por: o.atualizado_por, fonte_atualizada_em: o.fonte_atualizada_em, fora_ultima_importacao: r.fora_ultima_importacao, ra_fonte: r.ra_fonte,
        ra_manual_status: o.ra_manual_status, ra_manual_por: o.ra_manual_por, ra_manual_em: o.ra_manual_em, ciclo_id: o.ciclo_id },
      importacao: imp, primeira_importacao: primeira, atendimentos, eventos, ra_candidatos: p.conciliar ? candidatos : candidatos.map(c => ({ ...c, cpf: '' })), permissoes: p
    };
  }
  function evento(oid, tipo, de, para, u, extra = {}) {
    run('INSERT INTO ma_oportunidade_eventos (oportunidade_id, tipo, de, para, detalhe, importacao_id, por_login, por_nome) VALUES (?,?,?,?,?,?,?,?)',
      oid, tipo, de == null ? null : String(de).slice(0, 300), para == null ? null : String(para).slice(0, 300), extra.detalhe ? String(extra.detalhe).slice(0, 500) : null, extra.importacao_id || null, quem(u).login, quem(u).nome);
  }
  function nomeResponsavel(o) {
    if (o.responsavel_tutor_id) return get('SELECT nome FROM tutores WHERE id=?', o.responsavel_tutor_id)?.nome || `Tutor #${o.responsavel_tutor_id}`;
    if (o.responsavel_id) return get('SELECT nome FROM usuarios WHERE id=?', o.responsavel_id)?.nome || `Usuário #${o.responsavel_id}`;
    return 'Sem responsável';
  }
  function lerResponsavel(c) {
    // aceita "t:ID" (tutor), "u:ID" (usuário) ou o campo antigo responsavel_id (usuário)
    let v = c.responsavel !== undefined ? String(c.responsavel || '') : (c.responsavel_id === '' || c.responsavel_id == null ? '' : 'u:' + c.responsavel_id);
    if (!v) return { usuario: null, tutor: null };
    const m = v.match(/^([tu]):(\d+)$/); if (!m) falha(400, 'Responsável inválido.');
    const id = Number(m[2]);
    if (m[1] === 't') { if (!get('SELECT 1 FROM tutores WHERE id=? AND ativo=1', id)) falha(400, 'Tutor responsável inválido ou inativo.'); return { usuario: null, tutor: id }; }
    if (!get('SELECT 1 FROM usuarios WHERE id=? AND ativo=1', id)) falha(400, 'Usuário responsável inválido ou inativo.');
    return { usuario: id, tutor: null };
  }
  // Atualiza etapa, responsável, próximo contato e anotação. Cada mudança vira um evento; o histórico nunca é sobrescrito.
  function salvar(id, c, usuario) {
    const p = permissoes(usuario);
    if (!p.atender) falha(403, 'Seu usuário não pode alterar o acompanhamento.');
    const { o } = lerOportunidade(id, usuario);
    const etapa = c.etapa === undefined ? o.etapa : String(c.etapa || 'novo');
    if (!ETAPA_LABEL[etapa]) falha(400, 'Etapa inválida.');
    const proximo = c.proximo_contato === undefined ? o.proximo_contato : (String(c.proximo_contato || '').trim() || null);
    if (proximo && !isoValido(proximo)) falha(400, 'Data de retorno inválida.');
    const observacao = c.observacao === undefined ? o.observacao : (String(c.observacao || '').trim().slice(0, 2000) || null);
    let resp = { usuario: o.responsavel_id, tutor: o.responsavel_tutor_id };
    const mexeResp = c.responsavel !== undefined || c.responsavel_id !== undefined;
    if (mexeResp) {
      const novo = lerResponsavel(c);
      const mudou = Number(novo.usuario || 0) !== Number(o.responsavel_id || 0) || Number(novo.tutor || 0) !== Number(o.responsavel_tutor_id || 0);
      if (mudou && !p.definir_responsavel) falha(403, 'Somente quem lança pode alterar o responsável.');
      resp = novo;
    }
    return tx(() => {
      const antesResp = nomeResponsavel(o);
      run(`UPDATE ma_oportunidades SET etapa=?, responsavel_id=?, responsavel_tutor_id=?, proximo_contato=?, observacao=?, atualizado_por=?, atualizado_em=datetime('now','localtime') WHERE id=?`,
        etapa, resp.usuario || null, resp.tutor || null, proximo, observacao, usuario.login, id);
      const depois = get('SELECT * FROM ma_oportunidades WHERE id=?', id);
      if (etapa !== o.etapa) evento(id, 'etapa', ETAPA_LABEL[o.etapa] || o.etapa, ETAPA_LABEL[etapa], usuario);
      const depoisResp = nomeResponsavel(depois);
      if (depoisResp !== antesResp || Number(depois.responsavel_tutor_id || 0) !== Number(o.responsavel_tutor_id || 0) || Number(depois.responsavel_id || 0) !== Number(o.responsavel_id || 0)) evento(id, 'responsavel', antesResp, depoisResp, usuario);
      if ((proximo || null) !== (o.proximo_contato || null)) evento(id, 'proximo_contato', o.proximo_contato, proximo, usuario);
      if ((observacao || null) !== (o.observacao || null)) evento(id, 'anotacao', null, null, usuario, { detalhe: 'Anotação geral alterada' });
      registrar(usuario, 'atualizou oportunidade', `Lead ${o.identificador} — ${etapa}`);
      return { ok: true };
    });
  }
  function registrarAtendimento(id, c, usuario) {
    const p = permissoes(usuario);
    if (!p.atender) falha(403, 'Seu usuário não pode registrar atendimentos.');
    const { o } = lerOportunidade(id, usuario);
    const data = String(c.data || hojeISO()).trim();
    if (!isoValido(data)) falha(400, 'Data do atendimento inválida.');
    if (data > hojeISO()) falha(400, 'A data do atendimento não pode ser futura.');
    const canal = CANAIS[c.canal] ? c.canal : 'outro';
    const resultado = String(c.resultado || '').trim().slice(0, 2000);
    if (!resultado) falha(400, 'Descreva o que aconteceu no atendimento.');
    const etapa = c.etapa ? String(c.etapa) : o.etapa;
    if (!ETAPA_LABEL[etapa]) falha(400, 'Etapa inválida.');
    const proximo = c.proximo_contato === undefined ? undefined : (String(c.proximo_contato || '').trim() || null);
    if (proximo && !isoValido(proximo)) falha(400, 'Data de retorno inválida.');
    return tx(() => {
      const aid = Number(run(`INSERT INTO ma_oportunidade_atendimentos (oportunidade_id, data, canal, resultado, etapa_antes, etapa_depois, proximo_contato, autor_login, autor_nome, autor_usuario_id, autor_tutor_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, data, canal, resultado, o.etapa, etapa, proximo === undefined ? o.proximo_contato : proximo, quem(usuario).login, quem(usuario).nome,
        usuario.id > 0 ? usuario.id : null, usuario.tutor_id || null).lastInsertRowid);
      run(`UPDATE ma_oportunidades SET etapa=?, proximo_contato=?, atualizado_por=?, atualizado_em=datetime('now','localtime') WHERE id=?`,
        etapa, proximo === undefined ? o.proximo_contato : proximo, usuario.login, id);
      if (etapa !== o.etapa) evento(id, 'etapa', ETAPA_LABEL[o.etapa] || o.etapa, ETAPA_LABEL[etapa], usuario, { detalhe: `Atendimento #${aid}` });
      if (proximo !== undefined && (proximo || null) !== (o.proximo_contato || null)) evento(id, 'proximo_contato', o.proximo_contato, proximo, usuario, { detalhe: `Atendimento #${aid}` });
      registrar(usuario, 'registrou atendimento de oportunidade', `Lead ${o.identificador} — ${CANAIS[canal]}`);
      return { ok: true, id: aid };
    });
  }
  // Conciliação manual do RA: confirma um aluno da lista do Mundo Azul (mesmo processo) ou descarta as sugestões por nome.
  function conciliar(id, c, usuario) {
    if (!permissoes(usuario).conciliar) falha(403, 'Somente quem lança pode conciliar RA.');
    const { o } = lerOportunidade(id, usuario);
    const acao = String(c.acao || '');
    if (acao === 'confirmar') {
      const lid = Number(c.lista_id);
      const a = get("SELECT id, ra, nome FROM ma_lista_alunos WHERE id=? AND ciclo_id=? AND ativo=1 AND ra<>''", lid, o.ciclo_id);
      if (!a) falha(400, 'Aluno com RA não encontrado na lista do Mundo Azul deste processo.');
      run(`UPDATE ma_oportunidades SET ra_manual_lista_id=?, ra_manual_status='confirmado', ra_manual_por=?, ra_manual_em=datetime('now','localtime') WHERE id=?`, lid, usuario.login, id);
      evento(id, 'conciliacao', null, `RA ${a.ra}`, usuario, { detalhe: `Vínculo confirmado com ${a.nome || 'aluno'} (lista #${lid})` });
    } else if (acao === 'rejeitar') {
      run(`UPDATE ma_oportunidades SET ra_manual_lista_id=NULL, ra_manual_status='rejeitado', ra_manual_por=?, ra_manual_em=datetime('now','localtime') WHERE id=?`, usuario.login, id);
      evento(id, 'conciliacao', null, 'Sugestões descartadas', usuario, { detalhe: 'Nenhum aluno sugerido corresponde a este candidato' });
    } else if (acao === 'desfazer') {
      run(`UPDATE ma_oportunidades SET ra_manual_lista_id=NULL, ra_manual_status=NULL, ra_manual_por=?, ra_manual_em=datetime('now','localtime') WHERE id=?`, usuario.login, id);
      evento(id, 'conciliacao', o.ra_manual_status, 'Conciliação automática', usuario);
    } else falha(400, 'Ação de conciliação inválida.');
    registrar(usuario, 'conciliou RA de oportunidade', `Lead ${o.identificador} — ${acao}`);
    return { ok: true };
  }

  // ------------------------------------------------------------------ importação com prévia
  function normalizarLinha(l, n) {
    const identificador = String(l.identificador ?? '').trim().replace(/\.0+$/, '').slice(0, 80);
    const cpf = cpfNormalizado(l.cpf);
    const datas = {};
    const alertas = [], motivos = [];
    for (const [k, src] of [['ultimo_atendimento', 'ultimo_atendimento'], ['data_retorno_origem', 'data_retorno'], ['data_registro', 'data_registro']]) {
      const d = dataFonte(l[src]); datas[k] = d.valor;
      if (!d.ok) alertas.push(`Data não reconhecida em ${ROTULO_CAMPO[k]} (“${String(l[src]).slice(0, 30)}”); campo ficará vazio.`);
    }
    if (cpf.informado && !cpf.valido) alertas.push('CPF inválido; não será usado na conciliação do RA.');
    const interacoes = String(l.interacoes ?? '').trim();
    const v = {
      cpf: cpf.valor, nome: txt(l.nome, 180), telefone: soDig(l.telefone).slice(0, 15) || null,
      curso_cod: txt(l.curso_cod, 80), curso_nome: txt(l.curso_nome, 180), polo_fonte: txt(l.polo_fonte, 120), prioridade: txt(l.prioridade, 120),
      ultimo_atendimento: datas.ultimo_atendimento, data_retorno_origem: datas.data_retorno_origem, data_registro: datas.data_registro,
      interacoes: interacoes && /^\d+(?:[.,]0+)?$/.test(interacoes) ? Number(interacoes.replace(',', '.')) : null,
      status_origem: txt(l.status_origem, 100), origem: txt(l.origem, 120), localizacao: txt(l.localizacao, 120), contato: txt(l.contato, 120), responsavel_origem: txt(l.responsavel_origem, 180)
    };
    if (!identificador && !v.cpf) motivos.push('Sem Identificador e sem CPF válido — não há como identificar o candidato.');
    if (!v.nome) alertas.push('Nome vazio.');
    if (!v.polo_fonte) alertas.push('Polo vazio — a oportunidade só aparecerá para a administração.');
    return { n: Number(l.linha) || n, identificador, valores: v, alertas, motivos };
  }
  function analisarImportacao(c, usuario) {
    const cicloId = Number(c.ciclo);
    if (!cicloId || !get('SELECT 1 FROM ciclos WHERE id=?', cicloId)) falha(400, 'Selecione um processo válido.');
    if (!Array.isArray(c.linhas) || !c.linhas.length) falha(400, 'A planilha não contém linhas para importar.');
    if (c.linhas.length > MAX_LINHAS_IMPORTACAO) falha(413, `A planilha excede o limite de ${MAX_LINHAS_IMPORTACAO} registros por importação.`);
    const ctx = criarContexto();
    const existentes = all('SELECT * FROM ma_oportunidades WHERE ciclo_id=?', cicloId);
    const porIdent = new Map(existentes.map(o => [o.identificador, o]));
    const porCpf = new Map();
    for (const o of existentes) { const k = cpfChave(o.cpf); if (k) { const a = porCpf.get(k) || []; a.push(o); porCpf.set(k, a); } }
    const vistos = new Map(), alvosVistos = new Map();
    const resultado = [];
    const polosNao = new Map(), statusEncontrados = new Map();
    c.linhas.forEach((bruta, i) => {
      const l = normalizarLinha(bruta || {}, i + 2);
      const item = { linha: l.n, identificador: l.identificador || (l.valores.cpf ? 'CPF ' + mascaraCpf(l.valores.cpf) : ''), nome: l.valores.nome || '', polo: l.valores.polo_fonte || '', status: l.valores.status_origem || '', acao: '', motivos: l.motivos, alertas: l.alertas, mudancas: [] };
      if (l.motivos.length) { item.acao = 'ignorado'; resultado.push(item); return; }
      const chave = l.identificador || 'CPF:' + l.valores.cpf;
      if (vistos.has(chave)) { item.acao = 'ignorado'; item.motivos.push(`Repetido no arquivo (mesmo ${l.identificador ? 'Identificador' : 'CPF'} da linha ${vistos.get(chave)}).`); resultado.push(item); return; }
      vistos.set(chave, l.n);
      // reconciliação: Identificador primeiro; sem ele (ou registro antigo criado só por CPF), o CPF normalizado
      let alvo = porIdent.get(chave) || null, adotar = false;
      if (!alvo && l.valores.cpf) {
        const mesmos = porCpf.get(l.valores.cpf) || [];
        if (l.identificador) {
          const semIdent = mesmos.filter(o => o.identificador === 'CPF:' + l.valores.cpf);
          if (semIdent.length === 1) { alvo = semIdent[0]; adotar = true; item.alertas.push('Registro anterior (criado só pelo CPF) recebe agora este Identificador.'); }
          else if (mesmos.length) item.alertas.push(`Mesmo CPF já consta com outro Identificador (${mesmos.map(o => o.identificador).slice(0, 3).join(', ')}): será outra oportunidade (ex.: outro curso).`);
        } else {
          const comIdent = mesmos.filter(o => !String(o.identificador).startsWith('CPF:'));
          if (comIdent.length === 1) { alvo = comIdent[0]; item.alertas.push(`Sem Identificador na linha; atualizado pelo CPF (Identificador ${comIdent[0].identificador}).`); }
          else if (comIdent.length > 1) { item.acao = 'ignorado'; item.motivos.push('Sem Identificador e o CPF corresponde a mais de uma oportunidade — informe o Identificador.'); resultado.push(item); return; }
        }
      }
      if (alvo && alvosVistos.has(alvo.id)) { item.acao = 'ignorado'; item.motivos.push(`Corresponde à mesma oportunidade da linha ${alvosVistos.get(alvo.id)}.`); resultado.push(item); return; }
      if (alvo) alvosVistos.set(alvo.id, l.n);
      if (l.valores.polo_fonte && !ctx.poloId(l.valores.polo_fonte)) {
        polosNao.set(l.valores.polo_fonte, (polosNao.get(l.valores.polo_fonte) || 0) + 1);
        item.alertas.push('Polo não reconhecido — visível só para a administração até ser vinculado.');
      }
      if (l.valores.status_origem) statusEncontrados.set(l.valores.status_origem, (statusEncontrados.get(l.valores.status_origem) || 0) + 1);
      if (!alvo) item.acao = 'novo';
      else {
        const igual = (k, a, b) => k === 'interacoes' ? Number(a || 0) === Number(b || 0) : String(a ?? '') === String(b ?? '');
        item.mudancas = CAMPOS_FONTE.filter(k => !igual(k, alvo[k], l.valores[k])).map(k => ROTULO_CAMPO[k]);
        if (adotar) item.mudancas.unshift('Identificador');
        item.acao = item.mudancas.length ? 'atualizado' : 'inalterado';
      }
      item._dados = { chave, alvo_id: alvo ? alvo.id : null, adotar, identificador: alvo && !adotar ? alvo.identificador : (l.identificador || 'CPF:' + l.valores.cpf), valores: l.valores, campos: item.mudancas };
      resultado.push(item);
    });
    const hash = crypto.createHash('sha256').update(JSON.stringify(c.linhas)).digest('hex');
    const repetida = get('SELECT id, criado_em, criado_por_nome, criado_por FROM ma_oportunidade_importacoes WHERE ciclo_id=? AND conteudo_hash=? ORDER BY id DESC LIMIT 1', cicloId, hash) || null;
    const contar = a => resultado.filter(r => r.acao === a).length;
    const totais = { linhas: resultado.length, novos: contar('novo'), atualizados: contar('atualizado'), inalterados: contar('inalterado'), ignorados: contar('ignorado'), com_alerta: resultado.filter(r => r.acao !== 'ignorado' && r.alertas.length).length };
    const naoVieram = existentes.filter(o => !resultado.some(r => r._dados && r._dados.alvo_id === o.id)).length;
    return { cicloId, hash, repetida, totais, resultado, nao_vieram: naoVieram, polos_nao_reconhecidos: [...polosNao.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd), status_encontrados: [...statusEncontrados.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd) };
  }
  function previaImportacao(c, usuario) {
    const a = analisarImportacao(c, usuario);
    return { ciclo: a.cicloId, arquivo: String(c.arquivo || '').slice(0, 200), totais: a.totais, ja_importado: a.repetida, nao_vieram: a.nao_vieram,
      polos_nao_reconhecidos: a.polos_nao_reconhecidos, status_encontrados: a.status_encontrados, colunas: Array.isArray(c.colunas) ? c.colunas.slice(0, 40) : [],
      linhas: a.resultado.map(({ _dados, ...r }) => r) };
  }
  function importar(c, usuario) {
    if (!c.confirmado) falha(400, 'Revise a prévia e confirme a importação.');
    const a = analisarImportacao(c, usuario);
    const validos = a.resultado.filter(r => r._dados && r.acao !== 'ignorado');
    const problemas = a.resultado.filter(r => r.acao === 'ignorado' || r.alertas.length).slice(0, 2000).map(r => ({ linha: r.linha, identificador: r.identificador, acao: r.acao, motivos: r.motivos, alertas: r.alertas }));
    return tx(() => {
      const impId = Number(run(`INSERT INTO ma_oportunidade_importacoes (ciclo_id, arquivo, conteudo_hash, linhas, novos, atualizados, inalterados, ignorados, com_alerta, colunas, detalhe, criado_por, criado_por_nome)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, a.cicloId, String(c.arquivo || '').slice(0, 200) || null, a.hash, a.totais.linhas, a.totais.novos, a.totais.atualizados, a.totais.inalterados, a.totais.ignorados, a.totais.com_alerta,
        JSON.stringify(Array.isArray(c.colunas) ? c.colunas.slice(0, 40) : []), JSON.stringify(problemas), quem(usuario).login, quem(usuario).nome).lastInsertRowid);
      const sets = CAMPOS_FONTE.map(k => `${k}=?`).join(', ');
      const ins = db.prepare(`INSERT INTO ma_oportunidades (ciclo_id, identificador, ${CAMPOS_FONTE.join(', ')}, importacao_id, primeira_importacao_id, fonte_atualizada_em)
        VALUES (?, ?, ${CAMPOS_FONTE.map(() => '?').join(', ')}, ?, ?, datetime('now','localtime'))`);
      const upd = db.prepare(`UPDATE ma_oportunidades SET identificador=?, ${sets}, importacao_id=?, primeira_importacao_id=COALESCE(primeira_importacao_id, ?), fonte_atualizada_em=datetime('now','localtime'), atualizado_em=datetime('now','localtime') WHERE id=?`);
      const visto = db.prepare('UPDATE ma_oportunidades SET importacao_id=?, primeira_importacao_id=COALESCE(primeira_importacao_id, ?) WHERE id=?');
      for (const r of validos) {
        const d = r._dados, vals = CAMPOS_FONTE.map(k => d.valores[k] ?? null);
        if (r.acao === 'novo') {
          const nid = Number(ins.run(a.cicloId, d.identificador, ...vals, impId, impId).lastInsertRowid);
          evento(nid, 'importacao', null, 'Criada', usuario, { importacao_id: impId, detalhe: `Linha ${r.linha} de ${String(c.arquivo || 'planilha').slice(0, 120)}` });
        } else if (r.acao === 'atualizado') {
          upd.run(d.identificador, ...vals, impId, impId, d.alvo_id);
          evento(d.alvo_id, 'importacao', null, 'Atualizada', usuario, { importacao_id: impId, detalhe: 'Campos: ' + d.campos.join(', ') });
        } else visto.run(impId, impId, d.alvo_id);
      }
      registrar(usuario, 'importou oportunidades', `Processo ${a.cicloId}, importação #${impId}: ${a.totais.novos} novas, ${a.totais.atualizados} atualizadas, ${a.totais.inalterados} sem mudança, ${a.totais.ignorados} ignoradas`);
      return { ok: true, importacao_id: impId, ...a.totais };
    });
  }
  function importacoes(q, usuario) {
    if (!permissoes(usuario).importar) falha(403, 'Somente quem lança pode consultar as importações.');
    const cicloId = cicloValido(q.ciclo);
    return { importacoes: all('SELECT id, arquivo, linhas, novos, atualizados, inalterados, ignorados, com_alerta, colunas, detalhe, criado_em, criado_por, criado_por_nome FROM ma_oportunidade_importacoes WHERE ciclo_id=? ORDER BY id DESC LIMIT 100', cicloId)
      .map(r => ({ ...r, colunas: JSON.parse(r.colunas || '[]'), problemas: JSON.parse(r.detalhe || '[]'), detalhe: undefined })) };
  }

  // Rota antiga (GET /api/ma/oportunidades): mantém o formato usado pela versão anterior da tela.
  function listaCompat(q, usuario) {
    const cicloId = cicloValido(q.ciclo);
    const { base } = carregarBase(cicloId, usuario);
    const situacao = ['abertas', 'perdidas', 'matriculadas', 'todas'].includes(String(q.situacao || '')) ? String(q.situacao) : 'abertas';
    const f = lerFiltros({ q: q.q });
    const rows = filtrar(base, f).filter(r => situacao === 'todas' || (situacao === 'matriculadas' ? r.ra_situacao === 'confirmado' : situacao === 'perdidas' ? r.ra_situacao !== 'confirmado' && r.etapa === 'perdido' : r.ra_situacao !== 'confirmado' && r.etapa !== 'perdido'));
    const abertas = base.filter(r => r.ra_situacao !== 'confirmado' && r.etapa !== 'perdido');
    const p = permissoes(usuario);
    return { ciclo: cicloId, ciclos: all('SELECT id,nome,padrao FROM ciclos ORDER BY id DESC'), etapas: ETAPAS.map(e => e[0]), pode_editar: p.importar,
      responsaveis: p.definir_responsavel ? all('SELECT id,nome FROM usuarios WHERE ativo=1 ORDER BY nome') : [],
      resumo: { abertas: abertas.length, novas: abertas.filter(r => r.etapa === 'novo').length, em_contato: abertas.filter(r => ['contato', 'aguardando', 'negociacao', 'pendencia'].includes(r.etapa)).length,
        matriculadas: base.filter(r => r.ra_situacao === 'confirmado').length, perdidas: base.filter(r => r.ra_situacao !== 'confirmado' && r.etapa === 'perdido').length, retornos_atrasados: abertas.filter(r => r.retorno === 'vencido').length },
      lista: rows.slice(0, 1000).map(r => ({ ...linhaPublica(r, p.atender), candidato_id: r.id, curso_nome: r.curso, polo_fonte: r.polo_fonte, situacao: r.ra_situacao === 'confirmado' ? 'matriculado' : r.etapa === 'perdido' ? 'perdida' : 'oportunidade', responsavel_origem: r.tutor_origem, observacao: r.observacao })) };
  }

  // ------------------------------------------------------------------ rotas /api/ma/oportunidades*
  async function rotas(req, res, p, m, q, usuario) {
    if (p !== '/api/ma/oportunidades' && !p.startsWith('/api/ma/oportunidades/')) return false;
    if (m !== 'GET' && m !== 'HEAD') exigeMesmaOrigem(req);
    const exigeImportar = () => { if (!permissoes(usuario).importar) falha(403, 'Somente quem lança pode importar a planilha.'); };
    if (p === '/api/ma/oportunidades' && m === 'GET') { enviarJson(res, 200, listaCompat(q, usuario)); return true; }
    if (p === '/api/ma/oportunidades/opcoes' && m === 'GET') { enviarJson(res, 200, opcoes(q, usuario)); return true; }
    if (p === '/api/ma/oportunidades/painel' && m === 'GET') { enviarJson(res, 200, painel(q, usuario)); return true; }
    if (p === '/api/ma/oportunidades/lista' && m === 'GET') { enviarJson(res, 200, lista(q, usuario)); return true; }
    if (p === '/api/ma/oportunidades/exportar' && m === 'GET') {
      const out = exportar(q, usuario);
      res.writeHead(200, { 'Content-Type': out.tipo, 'Content-Disposition': `attachment; filename="${out.nome}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': out.corpo.length });
      res.end(out.corpo); return true;
    }
    if (p === '/api/ma/oportunidades/importacoes' && m === 'GET') { enviarJson(res, 200, importacoes(q, usuario)); return true; }
    if (p === '/api/ma/oportunidades/importar/previa' && m === 'POST') { exigeImportar(); enviarJson(res, 200, previaImportacao(await lerCorpo(req, 4e7), usuario)); return true; }
    if (p === '/api/ma/oportunidades/importar' && m === 'POST') { exigeImportar(); enviarJson(res, 200, importar(await lerCorpo(req, 4e7), usuario)); return true; }
    let mm = p.match(/^\/api\/ma\/oportunidades\/(\d+)$/);
    if (mm && m === 'GET') { enviarJson(res, 200, detalhe(Number(mm[1]), usuario)); return true; }
    if (mm && m === 'PUT') { enviarJson(res, 200, salvar(Number(mm[1]), await lerCorpo(req), usuario)); return true; }
    mm = p.match(/^\/api\/ma\/oportunidades\/(\d+)\/atendimentos$/);
    if (mm && m === 'POST') { enviarJson(res, 200, registrarAtendimento(Number(mm[1]), await lerCorpo(req), usuario)); return true; }
    mm = p.match(/^\/api\/ma\/oportunidades\/(\d+)\/conciliacao$/);
    if (mm && m === 'POST') { enviarJson(res, 200, conciliar(Number(mm[1]), await lerCorpo(req), usuario)); return true; }
    falha(404, 'Rota não encontrada');
  }

  return { rotas, painel, lista, exportar, opcoes, detalhe, salvar, registrarAtendimento, conciliar, previaImportacao, importar, importacoes, listaCompat, carregarBase, situacaoRA, dataFonte, cpfNormalizado, ETAPAS };
};

// ------------------------------------------------------------------ XLSX mínimo (sem dependências): ZIP "stored" + SpreadsheetML
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStored(files) {
  const locais = [], central = []; let offset = 0;
  for (const f of files) {
    const nome = Buffer.from(f.nome, 'utf8'), dados = Buffer.isBuffer(f.dados) ? f.dados : Buffer.from(f.dados, 'utf8'), crc = crc32(dados);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(dados.length, 18); lh.writeUInt32LE(dados.length, 22); lh.writeUInt16LE(nome.length, 26); lh.writeUInt16LE(0, 28);
    locais.push(lh, nome, dados);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(dados.length, 20); ch.writeUInt32LE(dados.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nome);
    offset += 30 + nome.length + dados.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, cd, end]);
}
function gerarXlsx(planilhas) {
  const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colRef = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheetXml = linhas => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    linhas.map((l, r) => `<row r="${r + 1}">` + (l || []).map((v, c) => {
      const ref = colRef(c) + (r + 1);
      if (v === '' || v == null) return '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${r === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const nomes = planilhas.map((p, i) => esc(String(p.nome || `Planilha${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  const files = [
    { nome: '[Content_Types].xml', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + planilhas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { nome: '_rels/.rels', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: 'xl/workbook.xml', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + nomes.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { nome: 'xl/_rels/workbook.xml.rels', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + planilhas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${planilhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nome: 'xl/styles.xml', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...planilhas.map((p, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: sheetXml(p.linhas) }))
  ];
  return zipStored(files);
}
module.exports.gerarXlsx = gerarXlsx;
