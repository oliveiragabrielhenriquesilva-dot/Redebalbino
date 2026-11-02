'use strict';
// Conciliação com o Mundo Azul — posições oficiais (snapshots) por polo OU por produto.
//
// Regras (resumo):
//  · Uma posição é uma "foto" de um gráfico do Mundo Azul numa data/hora: dimensão (polo ou produto) + escopo
//    (rede inteira, ou um polo/produto selecionado como filtro VERIFICADO). Não é movimento: reimportar não soma.
//  · Os nomes da fonte são guardados como vieram. A correspondência com polos/produtos locais é explícita.
//    Agrupar mais de uma linha da fonte (ou mais de um item local) numa comparação exige agrupamento verificado.
//  · Linha ausente na fonte não vira zero. Número de barra cinza (contexto geral) nunca é usado.
//  · Complemento = máx(oficial − identificadas no mesmo recorte e até a data da posição, 0). Só existe nas
//    unidades comparáveis; nunca vira matrícula, aluno, CPF, tutor ou origem.
//  · Visão por polo e visão por produto são o mesmo universo: não se somam e não se distribuem uma na outra.
//  · Consulta numa data R usa a última posição ativa com data ≤ R (nunca uma posição futura).
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

module.exports = function criarConciliacao({ db, DATA_DIR, all, get, run, tx, falha, registrar, lerCorpo, enviarJson, ehAdmin, podeLancar, hojeISO, cfg }) {
  // ------------------------------------------------------------------ esquema (aditivo e idempotente)
  function migrar() {
    const existe = (t) => !!get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t);
    if (!existe('ma_posicoes')) {
      try {
        const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
        const tem = get('SELECT COUNT(*) n FROM matriculas').n;
        if (tem) db.exec(`VACUUM INTO '${path.join(dir, `antes-conciliacao-mundo-azul-${Date.now()}.db`).replace(/'/g, "''")}'`);
      } catch (e) { console.error('Aviso: não consegui criar o backup antes da conciliação:', e.message); }
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS ma_evidencias (
      id INTEGER PRIMARY KEY, nome TEXT, tipo TEXT, tamanho INTEGER, hash TEXT, dados TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), criado_por TEXT);
    CREATE TABLE IF NOT EXISTS ma_posicoes (
      id INTEGER PRIMARY KEY,
      ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
      dimensao TEXT NOT NULL CHECK (dimensao IN ('polo','produto')),
      escopo_tipo TEXT NOT NULL DEFAULT 'rede' CHECK (escopo_tipo IN ('rede','polo','produto')),
      escopo_ids TEXT NOT NULL DEFAULT '',
      escopo_fonte TEXT,
      cruzamento_verificado INTEGER NOT NULL DEFAULT 0,
      cruzamento_evidencia TEXT,
      data_posicao TEXT NOT NULL,
      hora_posicao TEXT NOT NULL DEFAULT '',
      origem TEXT NOT NULL,
      arquivo TEXT, arquivo_hash TEXT,
      evidencia_id INTEGER REFERENCES ma_evidencias(id),
      total_fonte INTEGER,
      conteudo_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','substituida','descartada')),
      substitui_id INTEGER REFERENCES ma_posicoes(id),
      substituida_por INTEGER REFERENCES ma_posicoes(id),
      motivo TEXT, obs TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), criado_por TEXT,
      status_em TEXT, status_por TEXT);
    CREATE INDEX IF NOT EXISTS ix_ma_pos ON ma_posicoes(ciclo_id, dimensao, escopo_tipo, escopo_ids, data_posicao);
    CREATE TABLE IF NOT EXISTS ma_posicao_linhas (
      id INTEGER PRIMARY KEY,
      posicao_id INTEGER NOT NULL REFERENCES ma_posicoes(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL DEFAULT 0,
      nome_fonte TEXT NOT NULL,
      quantidade INTEGER,
      leitura TEXT NOT NULL DEFAULT 'ok' CHECK (leitura IN ('ok','selecao','contexto','cortada','ilegivel','ambigua')),
      local_ids TEXT NOT NULL DEFAULT '',
      obs TEXT);
    CREATE TABLE IF NOT EXISTS ma_mapeamentos (
      tipo TEXT NOT NULL CHECK (tipo IN ('polo','produto')),
      chave TEXT NOT NULL,
      nome_fonte TEXT NOT NULL,
      local_ids TEXT NOT NULL DEFAULT '',
      verificado INTEGER NOT NULL DEFAULT 0,
      obs TEXT,
      atualizado_em TEXT, atualizado_por TEXT,
      PRIMARY KEY (tipo, chave));
    CREATE TABLE IF NOT EXISTS ma_lista_cursos (
      curso_cod TEXT PRIMARY KEY,
      curso_nome TEXT, unidade TEXT,
      produto_id INTEGER REFERENCES produtos(id),
      atualizado_em TEXT, atualizado_por TEXT);
    CREATE TABLE IF NOT EXISTS ma_lista_importacoes (
      id INTEGER PRIMARY KEY,
      ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
      arquivo TEXT, unidades TEXT, linhas INTEGER, com_ra INTEGER, novos INTEGER, sairam INTEGER,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), criado_por TEXT);
    CREATE TABLE IF NOT EXISTS ma_lista_alunos (
      id INTEGER PRIMARY KEY,
      ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
      candidato TEXT NOT NULL,
      unidade TEXT, concurso TEXT, ra TEXT, nome TEXT, cpf TEXT,
      curso_cod TEXT, curso_nome TEXT, polo_fonte TEXT,
      data_pagto TEXT, data_inscricao TEXT, inscrito_por TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      importacao_id INTEGER REFERENCES ma_lista_importacoes(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')), atualizado_em TEXT,
      UNIQUE (ciclo_id, candidato));
    CREATE INDEX IF NOT EXISTS ix_ma_lista_ciclo ON ma_lista_alunos(ciclo_id, ativo);
    CREATE TABLE IF NOT EXISTS ma_oportunidades (
      id INTEGER PRIMARY KEY,
      ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
      identificador TEXT NOT NULL,
      cpf TEXT,
      nome TEXT,
      telefone TEXT,
      curso_cod TEXT,
      curso_nome TEXT,
      polo_fonte TEXT,
      prioridade TEXT,
      ultimo_atendimento TEXT,
      data_retorno_origem TEXT,
      data_registro TEXT,
      interacoes INTEGER,
      status_origem TEXT,
      origem TEXT,
      localizacao TEXT,
      contato TEXT,
      responsavel_origem TEXT,
      etapa TEXT NOT NULL DEFAULT 'novo',
      responsavel_id INTEGER REFERENCES usuarios(id),
      proximo_contato TEXT,
      observacao TEXT,
      atualizado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE (ciclo_id, identificador)
    );
    CREATE INDEX IF NOT EXISTS ix_ma_oportunidades_ciclo ON ma_oportunidades(ciclo_id, etapa);
    `);
    // 30.1: celular informado no arquivo do Mundo Azul para contatos e acompanhamento
    const colsLista = all('PRAGMA table_info(ma_lista_alunos)').map(c => c.name);
    if (!colsLista.includes('celular')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN celular TEXT');
    if (!colsLista.includes('contato_exportado_em')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN contato_exportado_em TEXT');
    // 30.2: boas-vindas (fila semiautomática)
    if (!colsLista.includes('boas_vindas_em')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN boas_vindas_em TEXT');
    if (!colsLista.includes('boas_vindas_por')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN boas_vindas_por TEXT');
    if (!colsLista.includes('boas_vindas_chat_id')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN boas_vindas_chat_id TEXT');
    if (!colsLista.includes('boas_vindas_chat_status')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN boas_vindas_chat_status TEXT');
    if (!colsLista.includes('boas_vindas_chat_erro')) db.exec('ALTER TABLE ma_lista_alunos ADD COLUMN boas_vindas_chat_erro TEXT');
  }
  migrar();

  // ------------------------------------------------------------------ utilidades
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ids = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const idsTxt = (v) => ids(v).join(',');
  const LEITURAS = { ok: 'valor do recorte', selecao: 'valor destacado da seleção (confirmado)', contexto: 'barra cinza / contexto geral', cortada: 'valor cortado', ilegivel: 'ilegível', ambigua: 'ambíguo' };
  const USAVEL = new Set(['ok', 'selecao']);
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const tabelaLocal = (dim) => (dim === 'polo' ? 'polos' : 'produtos');
  const nomesLocais = (dim) => Object.fromEntries(all(`SELECT id, nome FROM ${tabelaLocal(dim)}`).map(r => [r.id, r.nome]));
  const dataHora = (p) => `${p.data_posicao} ${p.hora_posicao || '23:59'}`;
  const outraDim = (d) => (d === 'polo' ? 'produto' : 'polo');

  function mapaDicionario(tipo) {
    return Object.fromEntries(all('SELECT * FROM ma_mapeamentos WHERE tipo = ?', tipo).map(m => [m.chave, m]));
  }
  // Sugestão: dicionário salvo; senão, nome idêntico (normalizado) a um cadastro local ou a um apelido dele.
  function sugerir(tipo, nome) {
    const d = get('SELECT * FROM ma_mapeamentos WHERE tipo = ? AND chave = ?', tipo, norm(nome));
    if (d) return { local_ids: ids(d.local_ids), verificado: !!d.verificado, origem: 'dicionario' };
    const locais = all(`SELECT id, nome, ${tipo === 'polo' ? 'apelidos' : "'' apelidos"} FROM ${tabelaLocal(tipo)}`);
    const n = norm(nome);
    // o Mundo Azul escreve o polo com a UF ("BATATAIS SP"): para polo, também tenta sem a sigla final do estado
    const alvos = new Set([n]); if (tipo === 'polo') alvos.add(n.replace(/\s(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)$/, ''));
    const achados = locais.filter(l => [l.nome, ...String(l.apelidos || '').split(/[,;]/)].map(norm).filter(Boolean).some(x => alvos.has(x)));
    if (achados.length === 1) return { local_ids: [achados[0].id], verificado: false, origem: 'nome_identico' };
    return { local_ids: [], verificado: false, origem: achados.length > 1 ? 'ambiguo' : 'sem_correspondencia' };
  }

  // ------------------------------------------------------------------ validação do que veio da tela
  function normalizarEntrada(c, usuario) {
    const d = {
      ciclo_id: Number(c.ciclo_id), dimensao: String(c.dimensao || ''), escopo_tipo: String(c.escopo_tipo || 'rede'),
      escopo_ids: idsTxt(c.escopo_ids), escopo_fonte: String(c.escopo_fonte || '').trim().slice(0, 120) || null,
      cruzamento_verificado: c.cruzamento_verificado ? 1 : 0, cruzamento_evidencia: String(c.cruzamento_evidencia || '').trim().slice(0, 500) || null,
      data_posicao: String(c.data_posicao || ''), hora_posicao: String(c.hora_posicao || '').trim(),
      origem: String(c.origem || 'digitado'), arquivo: String(c.arquivo || '').slice(0, 200) || null, arquivo_hash: String(c.arquivo_hash || '').slice(0, 80) || null,
      total_fonte: c.total_fonte === '' || c.total_fonte == null ? null : Number(c.total_fonte),
      obs: String(c.obs || '').trim().slice(0, 500) || null,
    };
    if (!d.ciclo_id || !get('SELECT 1 FROM ciclos WHERE id = ?', d.ciclo_id)) falha(400, 'Selecione um processo válido');
    if (!['polo', 'produto'].includes(d.dimensao)) falha(400, 'Informe se o gráfico é por polo ou por produto');
    if (!['rede', 'polo', 'produto'].includes(d.escopo_tipo)) falha(400, 'Escopo inválido');
    if (d.escopo_tipo === d.dimensao) falha(400, 'O escopo filtrado precisa ser da outra dimensão (ex.: gráfico por produto com um polo selecionado)');
    if (d.escopo_tipo === 'rede') { d.escopo_ids = ''; d.escopo_fonte = null; d.cruzamento_verificado = 0; d.cruzamento_evidencia = null; }
    else {
      if (!d.escopo_ids) falha(400, `Escolha o ${d.escopo_tipo} local correspondente à seleção feita no Mundo Azul`);
      const existentes = ids(all(`SELECT id FROM ${tabelaLocal(d.escopo_tipo)}`).map(r => r.id));
      if (ids(d.escopo_ids).some(i => !existentes.includes(i))) falha(400, 'Escopo com cadastro inexistente');
    }
    if (!ISO.test(d.data_posicao) || Number.isNaN(new Date(d.data_posicao + 'T12:00:00Z').getTime()) || new Date(d.data_posicao + 'T12:00:00Z').toISOString().slice(0,10)!==d.data_posicao) falha(400, 'Informe a data da posição oficial');
    if (d.data_posicao > hojeISO()) falha(400, 'A data da posição não pode ser futura');
    if (d.hora_posicao && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.hora_posicao)) falha(400, 'Hora da posição inválida (use HH:MM)');
    if (!['imagem', 'excel', 'colado', 'digitado', 'navegador'].includes(d.origem)) falha(400, 'Origem inválida');
    if (d.total_fonte != null && (!Number.isInteger(d.total_fonte) || d.total_fonte < 0)) falha(400, 'Total da fonte deve ser um número inteiro');
    const brutas = Array.isArray(c.linhas) ? c.linhas.slice(0, 300) : [];
    const linhas = [];
    brutas.forEach((l, i) => {
      const nome = String(l.nome_fonte || '').trim().slice(0, 160);
      if (!nome) return;
      const leitura = LEITURAS[l.leitura] ? l.leitura : 'ok';
      let qtd = l.quantidade === '' || l.quantidade == null ? null : Number(String(l.quantidade).replace(/\./g, '').replace(',', '.'));
      if (qtd != null && (!Number.isInteger(qtd) || qtd < 0)) falha(400, `Quantidade inválida em "${nome}" (use número inteiro)`);
      if (USAVEL.has(leitura) && qtd == null) falha(400, `Informe a quantidade de "${nome}" ou marque a leitura como cortada/ilegível/ambígua`);
      linhas.push({ ordem: i, nome_fonte: nome, quantidade: qtd, leitura, local_ids: idsTxt(l.local_ids), obs: String(l.obs || '').trim().slice(0, 200) || null });
    });
    if (!linhas.length) falha(400, 'Nenhuma linha da fonte informada');
    const chaves = linhas.map(l => norm(l.nome_fonte));
    const rep = chaves.find((k, i) => chaves.indexOf(k) !== i);
    if (rep) falha(400, `Linha repetida na fonte: "${linhas[chaves.indexOf(rep)].nome_fonte}". Uma posição não pode ter o mesmo nome duas vezes.`);
    const existentes = ids(all(`SELECT id FROM ${tabelaLocal(d.dimensao)}`).map(r => r.id));
    for (const l of linhas) if (ids(l.local_ids).some(i => !existentes.includes(i))) falha(400, `Correspondência inválida em "${l.nome_fonte}"`);
    d.linhas = linhas;
    d.conteudo_hash = crypto.createHash('sha256').update(JSON.stringify({
      c: d.ciclo_id, d: d.dimensao, e: d.escopo_tipo, ei: d.escopo_ids, dt: d.data_posicao, h: d.hora_posicao, t: d.total_fonte,
      l: linhas.map(l => [norm(l.nome_fonte), l.quantidade, l.leitura]).sort((a, b) => a[0].localeCompare(b[0])),
    })).digest('hex');
    return d;
  }

  // ------------------------------------------------------------------ unidades de comparação
  // Liga linhas da fonte e itens locais (união de conjuntos): cada componente é comparado por inteiro.
  function unidades(posicao, linhas, dicionario) {
    const pai = {};
    const raiz = (x) => { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
    const une = (a, b) => { pai[a] ??= a; pai[b] ??= b; const ra = raiz(a), rb = raiz(b); if (ra !== rb) pai[ra] = rb; };
    const usaveis = [], fora = [];
    for (const l of linhas) {
      const loc = ids(l.local_ids);
      if (!USAVEL.has(l.leitura) || l.quantidade == null) { fora.push({ ...l, motivo: 'leitura ' + (LEITURAS[l.leitura] || l.leitura) }); continue; }
      if (!loc.length) { fora.push({ ...l, motivo: 'sem correspondência local' }); continue; }
      const k = 'f' + l.ordem; pai[k] ??= k;
      for (const i of loc) une(k, 'l' + i);
      usaveis.push(l);
    }
    const grupos = {};
    for (const l of usaveis) (grupos[raiz('f' + l.ordem)] ??= { linhas: [], locais: new Set() }).linhas.push(l);
    for (const g of Object.values(grupos)) for (const l of g.linhas) for (const i of ids(l.local_ids)) g.locais.add(i);
    return {
      fora,
      lista: Object.values(grupos).map(g => {
        const locais = [...g.locais].sort((a, b) => a - b);
        const agrupado = g.linhas.length > 1 || locais.length > 1;
        // agrupamento só vale se cada linha envolvida tiver o mesmo vínculo verificado no dicionário
        const verificado = !agrupado || g.linhas.every(l => { const m = dicionario[norm(l.nome_fonte)]; return m && m.verificado && idsTxt(m.local_ids) === idsTxt(l.local_ids); });
        return { linhas: g.linhas, locais, agrupado, agrupamento_verificado: verificado, oficial: g.linhas.reduce((a, l) => a + l.quantidade, 0) };
      }),
    };
  }

  // Matrículas identificadas no recorte: polo = polo do aluno (m.polo_id), nunca o polo de crédito do tutor.
  function contarIdentificadas(cicloId, dim, locais, escopoTipo, escopoIds, ate, de = null) {
    const w = ['m.ciclo_id = ?', 'm.data <= ?']; const p = [cicloId, ate];
    if (de) { w.push('m.data > ?'); p.push(de); }
    const col = (d) => (d === 'polo' ? 'm.polo_id' : 'm.produto_id');
    w.push(`${col(dim)} IN (${ids(locais).join(',') || 0})`);
    if (escopoTipo !== 'rede') w.push(`${col(escopoTipo)} IN (${ids(escopoIds).join(',') || 0})`);
    return get(`SELECT COUNT(*) n FROM matriculas m WHERE ${w.join(' AND ')}`, ...p).n;
  }

  // Calcula a conciliação de UMA posição (ref = data de consulta, ≥ data da posição)
  function calcular(posicao, linhas, ref = null) {
    const dic = mapaDicionario(posicao.dimensao);
    const nomes = nomesLocais(posicao.dimensao);
    const { lista, fora } = unidades(posicao, linhas, dic);
    const D = posicao.data_posicao;
    const R = ref && ref > D ? ref : D;
    const escopoOk = posicao.escopo_tipo === 'rede' || !!posicao.cruzamento_verificado;
    const res = lista.map(u => {
      const identificadas = contarIdentificadas(posicao.ciclo_id, posicao.dimensao, u.locais, posicao.escopo_tipo, posicao.escopo_ids, D);
      const mesmoDia = posicao.hora_posicao && posicao.hora_posicao < '23:59' ? (identificadas - contarIdentificadas(posicao.ciclo_id, posicao.dimensao, u.locais, posicao.escopo_tipo, posicao.escopo_ids, addDia(D, -1))) : 0;
      const apos = R > D ? contarIdentificadas(posicao.ciclo_id, posicao.dimensao, u.locais, posicao.escopo_tipo, posicao.escopo_ids, R, D) : 0;
      const comparavel = u.agrupamento_verificado && escopoOk;
      const complemento = comparavel ? Math.max(u.oficial - identificadas, 0) : null;
      const divergencia = comparavel && identificadas > u.oficial ? identificadas - u.oficial : 0;
      return {
        fonte: u.linhas.map(l => ({ nome: l.nome_fonte, quantidade: l.quantidade, leitura: l.leitura })),
        locais: u.locais, nomes_locais: u.locais.map(i => nomes[i] || `#${i}`), agrupado: u.agrupado, agrupamento_verificado: u.agrupamento_verificado,
        comparavel, motivo: !escopoOk ? 'cruzamento não verificado' : !u.agrupamento_verificado ? 'agrupamento não verificado' : null,
        oficial: u.oficial, identificadas, complemento, divergencia, mesmo_dia: mesmoDia,
        identificadas_apos: apos, identificadas_ate_ref: identificadas + apos,
        consolidado: comparavel ? identificadas + apos + complemento : null,
      };
    }).sort((a, b) => b.oficial - a.oficial || a.nomes_locais.join().localeCompare(b.nomes_locais.join()));
    // itens locais com matrículas que não aparecem em nenhuma linha usável da fonte (não se deduz zero)
    const cobertos = new Set(res.flatMap(u => u.locais));
    const colDim = posicao.dimensao === 'polo' ? 'm.polo_id' : 'm.produto_id';
    const colEsc = posicao.escopo_tipo === 'polo' ? 'm.polo_id' : 'm.produto_id';
    const semLinha = all(`SELECT ${colDim} id, COUNT(*) n FROM matriculas m WHERE m.ciclo_id = ? AND m.data <= ? ${posicao.escopo_tipo !== 'rede' ? `AND ${colEsc} IN (${ids(posicao.escopo_ids).join(',') || 0})` : ''} GROUP BY 1`, posicao.ciclo_id, D)
      .filter(r => !cobertos.has(r.id)).map(r => ({ id: r.id, nome: nomes[r.id] || `#${r.id}`, identificadas: r.n }));
    const comp = res.filter(u => u.comparavel);
    const somaLinhas = linhas.filter(l => l.quantidade != null && l.leitura !== 'contexto').reduce((a, l) => a + l.quantidade, 0);
    const avisos = [];
    if (posicao.total_fonte != null && somaLinhas !== posicao.total_fonte) avisos.push(`A soma das linhas lidas (${somaLinhas}) é diferente do total mostrado na fonte (${posicao.total_fonte}). Pode haver linha ausente, cortada ou lida errado.`);
    if (posicao.total_fonte == null) avisos.push('Total da fonte não informado: não dá para conferir se faltou alguma linha.');
    if (fora.length) avisos.push(`${fora.length} linha(s) ficaram fora do cálculo (leitura não confiável ou sem correspondência).`);
    if (semLinha.length) avisos.push(`Há matrículas identificadas em ${semLinha.length} ${posicao.dimensao === 'polo' ? 'polo(s)' : 'produto(s)'} que não aparecem na fonte. Não foi considerado zero oficial.`);
    if (posicao.escopo_tipo !== 'rede' && !posicao.cruzamento_verificado) avisos.push('Escopo filtrado sem confirmação de que a seleção FILTRA o gráfico: nenhum complemento é calculado.');
    if (res.some(u => u.agrupado && !u.agrupamento_verificado)) avisos.push('Há agrupamento de nomes sem verificação: essas linhas não geram complemento até um administrador confirmar o agrupamento.');
    if (comp.some(u => u.mesmo_dia > 0)) avisos.push(`A posição tem hora (${posicao.hora_posicao}). Matrículas lançadas no próprio dia ${D.split('-').reverse().join('/')} contam como identificadas; se foram feitas depois desse horário, o complemento fica menor do que deveria.`);
    if (comp.some(u => u.divergencia > 0)) avisos.push('Há recortes com mais matrículas identificadas do que o oficial: divergência mostrada, nada é excluído e o complemento fica 0.');
    return {
      ref: R, unidades: res, fora, sem_linha: semLinha, avisos, soma_linhas: somaLinhas,
      totais: {
        oficial: comp.reduce((a, u) => a + u.oficial, 0), identificadas: comp.reduce((a, u) => a + u.identificadas, 0),
        complemento: comp.reduce((a, u) => a + u.complemento, 0), divergencia: comp.reduce((a, u) => a + u.divergencia, 0),
        identificadas_apos: comp.reduce((a, u) => a + u.identificadas_apos, 0), consolidado: comp.reduce((a, u) => a + u.consolidado, 0),
        oficial_lido: res.reduce((a, u) => a + u.oficial, 0), unidades_sem_calculo: res.filter(u => !u.comparavel).length,
      },
    };
  }
  function addDia(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // ------------------------------------------------------------------ leitura
  function lerPosicao(id) {
    const p = get('SELECT * FROM ma_posicoes WHERE id = ?', id);
    if (!p) return null;
    p.linhas = all('SELECT ordem, nome_fonte, quantidade, leitura, local_ids, obs FROM ma_posicao_linhas WHERE posicao_id = ? ORDER BY ordem, id', id).map(l => ({ ...l, local_ids: ids(l.local_ids) }));
    p.escopo_nomes = p.escopo_tipo === 'rede' ? [] : ids(p.escopo_ids).map(i => nomesLocais(p.escopo_tipo)[i] || `#${i}`);
    return p;
  }
  const rotuloEscopo = (p) => p.escopo_tipo === 'rede' ? 'Rede (sem seleção)' : `${p.escopo_tipo === 'polo' ? 'Polo' : 'Produto'} selecionado: ${(p.escopo_nomes || []).join(', ')}${p.escopo_fonte ? ` (na fonte: ${p.escopo_fonte})` : ''}`;

  // Restrição de visualizador com polo: só o próprio polo
  function filtroUsuario(usuario) { return usuario.papel === 'visualizador' && usuario.polo_id ? usuario.polo_id : null; }
  function podeVer(p, usuario) {
    const pr = filtroUsuario(usuario); if (!pr) return true;
    if (p.escopo_tipo === 'polo') return ids(p.escopo_ids).length === 1 && ids(p.escopo_ids)[0] === pr;
    return p.dimensao === 'polo';
  }
  function recortarParaUsuario(p, calc, usuario) {
    const pr = filtroUsuario(usuario); if (!pr || p.escopo_tipo === 'polo') return calc;
    // visão por polo da rede: só a unidade que contém exatamente o polo do usuário
    const unidadesV = calc.unidades.filter(u => u.locais.length === 1 && u.locais[0] === pr);
    const comp = unidadesV.filter(u => u.comparavel);
    const tot = (k) => comp.reduce((a, u) => a + (u[k] || 0), 0);
    return { ...calc, soma_linhas:unidadesV.reduce((n,u)=>n+u.oficial,0), unidades: unidadesV, fora: [], sem_linha: calc.sem_linha.filter(s => s.id === pr), avisos: comp.some(u=>u.divergencia>0) ? ['Há mais matrículas identificadas que o oficial neste polo.'] : [],
      totais: { oficial: tot('oficial'), identificadas: tot('identificadas'), complemento: tot('complemento'), divergencia: tot('divergencia'), identificadas_apos: tot('identificadas_apos'), consolidado: tot('consolidado'), oficial_lido: unidadesV.reduce((a, u) => a + u.oficial, 0), unidades_sem_calculo: unidadesV.filter(u => !u.comparavel).length } };
  }

  // Posição vigente em R para cada série (dimensão + escopo): a última ativa com data ≤ R
  function vigentes(cicloId, ref) {
    const ativas = all(`SELECT * FROM ma_posicoes WHERE ciclo_id = ? AND status = 'ativa' AND data_posicao <= ? ORDER BY data_posicao DESC, hora_posicao DESC, id DESC`, cicloId, ref);
    const series = {};
    for (const p of ativas) { const k = `${p.dimensao}|${p.escopo_tipo}|${p.escopo_ids}`; if (!series[k]) series[k] = p; }
    return Object.values(series);
  }

  function conciliacao(q, usuario) {
    const cicloId = Number(q.ciclo);
    if (!cicloId || !get('SELECT 1 FROM ciclos WHERE id = ?', cicloId)) falha(400, 'Selecione um processo');
    const ref = ISO.test(q.ref || '') ? q.ref : hojeISO();
    const visoes = vigentes(cicloId, ref).filter(p => podeVer(p, usuario)).map(p0 => {
      const p = lerPosicao(p0.id);
      const calc = recortarParaUsuario(p, calcular(p, p.linhas, ref), usuario);
      return { posicao: resumoPosicao(p,usuario,calc), ...calc };
    });
    const porPolo = visoes.find(v => v.posicao.dimensao === 'polo' && v.posicao.escopo_tipo === 'rede') || null;
    const porProduto = visoes.find(v => v.posicao.dimensao === 'produto' && v.posicao.escopo_tipo === 'rede') || null;
    const cruzamentos = visoes.filter(v => v.posicao.escopo_tipo !== 'rede');
    const avisos = [];
    if (porPolo && porProduto && !filtroUsuario(usuario)) {
      const a = porPolo.posicao, b = porProduto.posicao;
      if (a.data_posicao !== b.data_posicao || a.hora_posicao !== b.hora_posicao) avisos.push(`As visões por polo (${a.data_posicao.split('-').reverse().join('/')}${a.hora_posicao ? ' ' + a.hora_posicao : ''}) e por produto (${b.data_posicao.split('-').reverse().join('/')}${b.hora_posicao ? ' ' + b.hora_posicao : ''}) são de posições diferentes.`);
      else if (a.total_fonte != null && b.total_fonte != null && a.total_fonte !== b.total_fonte) avisos.push(`Mesma posição, totais diferentes: por polo ${a.total_fonte} × por produto ${b.total_fonte}. As duas visões deveriam representar o mesmo universo; confira as fontes.`);
    }
    // Spaces encerrados: posição oficial vigente na data de cada Space (sem interpolar e sem usar posição futura)
    const spaces = all('SELECT id, nome, data, percentual FROM spaces WHERE ciclo_id = ? AND data <= ? ORDER BY data', cicloId, ref).map(sp => {
      const vs = vigentes(cicloId, sp.data).filter(p => p.escopo_tipo === 'rede' && podeVer(p, usuario));
      const item = (dim) => { const p0 = vs.find(p => p.dimensao === dim); if (!p0) return null; const p = lerPosicao(p0.id); const c = recortarParaUsuario(p, calcular(p, p.linhas, sp.data), usuario); return { posicao_id: p.id, data_posicao: p.data_posicao, hora_posicao: p.hora_posicao, ...c.totais }; };
      return { ...sp, por_polo: item('polo'), por_produto: item('produto') };
    });
    return { ref, por_polo: porPolo, por_produto: porProduto, cruzamentos, avisos, spaces };
  }
  function resumoPosicao(p,usuario=null,calc=null) {
    const restrito=usuario&&filtroUsuario(usuario)&&p.escopo_tipo!=='polo';
    return { id: p.id, dimensao: p.dimensao, escopo_tipo: p.escopo_tipo, escopo_ids: ids(p.escopo_ids), escopo_nomes: p.escopo_nomes, escopo_fonte: restrito ? '' : p.escopo_fonte, escopo_rotulo: rotuloEscopo(p),
      cruzamento_verificado: !!p.cruzamento_verificado, data_posicao: p.data_posicao, hora_posicao: p.hora_posicao, origem: p.origem, arquivo: restrito ? null : p.arquivo, total_fonte: restrito ? (calc?.totais.oficial_lido ?? null) : p.total_fonte,
      status: p.status, evidencia_id: restrito ? null : p.evidencia_id, criado_em: p.criado_em, criado_por: p.criado_por };
  }

  // ------------------------------------------------------------------ prévia, gravação e histórico
  function mesmaChave(d) {
    return all(`SELECT * FROM ma_posicoes WHERE ciclo_id = ? AND dimensao = ? AND escopo_tipo = ? AND escopo_ids = ? AND data_posicao = ? AND hora_posicao = ? AND status = 'ativa' ORDER BY id DESC`,
      d.ciclo_id, d.dimensao, d.escopo_tipo, d.escopo_ids, d.data_posicao, d.hora_posicao);
  }
  function previa(c, usuario) {
    const d = normalizarEntrada(c, usuario);
    const iguais = all(`SELECT id, status, criado_em, criado_por FROM ma_posicoes WHERE ciclo_id = ? AND conteudo_hash = ? ORDER BY id DESC`, d.ciclo_id, d.conteudo_hash);
    const ativaIgual = iguais.find(x => x.status === 'ativa');
    const conflito = ativaIgual ? null : mesmaChave(d)[0] || null;
    const posterior = get(`SELECT id, data_posicao, hora_posicao FROM ma_posicoes WHERE ciclo_id = ? AND dimensao = ? AND escopo_tipo = ? AND escopo_ids = ? AND status = 'ativa' AND (data_posicao > ? OR (data_posicao = ? AND hora_posicao > ?)) ORDER BY data_posicao DESC LIMIT 1`,
      d.ciclo_id, d.dimensao, d.escopo_tipo, d.escopo_ids, d.data_posicao, d.data_posicao, d.hora_posicao);
    const calc = calcular({ ...d, escopo_ids: d.escopo_ids }, d.linhas.map(l => ({ ...l })), null);
    const sugestoes = d.linhas.map(l => ({ nome_fonte: l.nome_fonte, ...sugerir(d.dimensao, l.nome_fonte) }));
    return { dados: { ...d, escopo_ids: ids(d.escopo_ids), linhas: d.linhas.map(l => ({ ...l, local_ids: ids(l.local_ids) })) }, calculo: calc, sugestoes,
      ja_registrada: ativaIgual ? { id: ativaIgual.id, criado_em: ativaIgual.criado_em, criado_por: ativaIgual.criado_por } : null,
      conflito: conflito ? { id: conflito.id, criado_em: conflito.criado_em, criado_por: conflito.criado_por } : null,
      posterior: posterior || null };
  }
  function gravar(c, usuario) {
    if (!c.confirmado) falha(400, 'Revise a prévia e confirme antes de gravar');
    const pv = previa(c, usuario), d = { ...pv.dados, escopo_ids: idsTxt(pv.dados.escopo_ids) };
    if (pv.ja_registrada) return { id: pv.ja_registrada.id, ja_registrada: true };
    const substituir = Number(c.substituir_id) || null;
    if (pv.conflito && substituir !== pv.conflito.id) falha(409, `Já existe uma posição ativa com o mesmo gráfico, escopo, data e hora (#${pv.conflito.id}) com números diferentes. Para trocar, escolha "Substituir" e informe o motivo.`);
    if (substituir) {
      const ant = get('SELECT * FROM ma_posicoes WHERE id = ?', substituir);
      if (!ant || ant.status !== 'ativa' || ant.ciclo_id !== d.ciclo_id || ant.dimensao !== d.dimensao || ant.escopo_tipo !== d.escopo_tipo || ant.escopo_ids !== d.escopo_ids) falha(400, 'A posição a substituir não corresponde ao mesmo gráfico e escopo');
      if (!String(c.motivo || '').trim()) falha(400, 'Informe o motivo da substituição');
    }
    let evidenciaId = null;
    const ev = c.evidencia;
    return tx(() => {
      if (ev && ev.dados) {
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(ev.dados)) falha(400, 'Evidência deve ser imagem PNG, JPG ou WEBP');
        if (ev.dados.length > 1_500_000) falha(400, 'Imagem da evidência muito grande');
        const hash = crypto.createHash('sha256').update(ev.dados).digest('hex');
        evidenciaId = (get('SELECT id FROM ma_evidencias WHERE hash = ?', hash) || {}).id
          || Number(run('INSERT INTO ma_evidencias (nome, tipo, tamanho, hash, dados, criado_por) VALUES (?, ?, ?, ?, ?, ?)', String(ev.nome || '').slice(0, 200), ev.dados.slice(5, ev.dados.indexOf(';')), ev.dados.length, hash, ev.dados, usuario.login).lastInsertRowid);
      }
      const id = Number(run(`INSERT INTO ma_posicoes (ciclo_id, dimensao, escopo_tipo, escopo_ids, escopo_fonte, cruzamento_verificado, cruzamento_evidencia, data_posicao, hora_posicao, origem, arquivo, arquivo_hash, evidencia_id, total_fonte, conteudo_hash, substitui_id, motivo, obs, criado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, d.ciclo_id, d.dimensao, d.escopo_tipo, d.escopo_ids, d.escopo_fonte, d.cruzamento_verificado, d.cruzamento_evidencia, d.data_posicao, d.hora_posicao,
        d.origem, d.arquivo, d.arquivo_hash, evidenciaId, d.total_fonte, d.conteudo_hash, substituir, substituir ? String(c.motivo).trim().slice(0, 300) : null, d.obs, usuario.login).lastInsertRowid);
      const ins = db.prepare('INSERT INTO ma_posicao_linhas (posicao_id, ordem, nome_fonte, quantidade, leitura, local_ids, obs) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const l of d.linhas) ins.run(id, l.ordem, l.nome_fonte, l.quantidade, l.leitura, idsTxt(l.local_ids), l.obs);
      if (substituir) run(`UPDATE ma_posicoes SET status = 'substituida', substituida_por = ?, status_em = datetime('now','localtime'), status_por = ? WHERE id = ?`, id, usuario.login, substituir);
      // dicionário: guarda a correspondência escolhida (sem marcar como verificada; agrupamento exige administrador)
      if (c.salvar_mapeamentos !== false) for (const l of d.linhas) {
        if (!ids(l.local_ids).length) continue;
        const atual = get('SELECT * FROM ma_mapeamentos WHERE tipo = ? AND chave = ?', d.dimensao, norm(l.nome_fonte));
        if (atual && idsTxt(atual.local_ids) === idsTxt(l.local_ids)) continue;
        run(`INSERT INTO ma_mapeamentos (tipo, chave, nome_fonte, local_ids, verificado, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, 0, datetime('now','localtime'), ?)
             ON CONFLICT (tipo, chave) DO UPDATE SET local_ids = excluded.local_ids, verificado = 0, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
          d.dimensao, norm(l.nome_fonte), l.nome_fonte, idsTxt(l.local_ids), usuario.login);
        registrar(usuario, 'mapeou nome do Mundo Azul', `${d.dimensao}: "${l.nome_fonte}" → ${idsTxt(l.local_ids)}${atual ? ` (antes ${atual.local_ids || 'vazio'})` : ''}`);
      }
      registrar(usuario, substituir ? 'substituiu posição Mundo Azul' : 'registrou posição Mundo Azul', `#${id} ${d.dimensao} ${d.escopo_tipo}${d.escopo_ids ? ' ' + d.escopo_ids : ''} ${d.data_posicao} ${d.hora_posicao}${substituir ? ` (substitui #${substituir}: ${String(c.motivo).trim().slice(0, 200)})` : ''}`);
      return { id };
    });
  }
  function listar(q, usuario) {
    const cicloId = Number(q.ciclo);
    return all(`SELECT * FROM ma_posicoes WHERE ciclo_id = ? ORDER BY data_posicao DESC, hora_posicao DESC, id DESC LIMIT 500`, cicloId)
      .map(p => ({ ...p, escopo_nomes: p.escopo_tipo === 'rede' ? [] : ids(p.escopo_ids).map(i => nomesLocais(p.escopo_tipo)[i] || `#${i}`) }))
      .filter(p => podeVer(p, usuario))
      .map(p => { const pp = lerPosicao(p.id); const cc = recortarParaUsuario(pp, calcular(pp, pp.linhas, null), usuario); return { ...resumoPosicao(pp,usuario,cc), substitui_id: p.substitui_id, substituida_por: p.substituida_por, motivo: filtroUsuario(usuario)&&pp.escopo_tipo!=='polo' ? null : p.motivo, obs: filtroUsuario(usuario)&&pp.escopo_tipo!=='polo' ? null : p.obs, status_em: p.status_em, status_por: p.status_por, linhas: filtroUsuario(usuario) ? cc.unidades.length : pp.linhas.length, totais: cc.totais }; });
  }


  const etapasOportunidade=new Set(['novo','contato','negociacao','pendencia','perdido']);
  const cpfChave=v=>{const d=String(v||'').replace(/\D/g,'');return d.length>=10&&d.length<=11?d.padStart(11,'0'):''};
  const dataOportunidade=v=>{const d=String(v||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:null};
  function listaOportunidades(q,usuario){
    const cicloId=Number(q.ciclo)||Number(get('SELECT id FROM ciclos WHERE padrao=1 ORDER BY id DESC LIMIT 1')?.id)||0;
    if(!cicloId)falha(400,'Não há processo ativo para consultar.');
    const situacao=['abertas','perdidas','matriculadas','todas'].includes(String(q.situacao||''))?String(q.situacao):'abertas';
    const leads=all(`SELECT o.*,u.nome responsavel FROM ma_oportunidades o
      LEFT JOIN usuarios u ON u.id=o.responsavel_id
      WHERE o.ciclo_id=? ORDER BY COALESCE(o.proximo_contato,o.data_retorno_origem,'9999-12-31'),o.nome,o.id LIMIT 10000`,cicloId);
    const matriculas=all('SELECT cpf,ra FROM ma_lista_alunos WHERE ciclo_id=? AND ativo=1 AND ra<>\'\'',cicloId);
    const porCpf=new Map();
    for(const m of matriculas){const key=cpfChave(m.cpf);if(!key)continue;const atual=porCpf.get(key)||new Set();atual.add(String(m.ra||'').trim());porCpf.set(key,atual);}
    const restrito=filtroUsuario(usuario),termo=String(q.q||'').trim().toLocaleLowerCase('pt-BR');
    const rows=leads.map(r=>{
      const ras=porCpf.get(cpfChave(r.cpf));const ra=ras&&ras.size===1?[...ras][0]:'';
      return {...r,candidato_id:r.id,ra,telefone:r.telefone||'',situacao:ra?'matriculado':r.etapa==='perdido'?'perdida':'oportunidade',proximo_contato:r.proximo_contato||r.data_retorno_origem||''};
    }).filter(r=>{
      if(restrito&&poloDaFonte(r.polo_fonte)!==restrito)return false;
      if(situacao==='abertas'&&(r.ra||r.etapa==='perdido'))return false;
      if(situacao==='perdidas'&&(r.ra||r.etapa!=='perdido'))return false;
      if(situacao==='matriculadas'&&!r.ra)return false;
      if(termo&&!['nome','identificador','cpf','curso_nome','polo_fonte','telefone','status_origem'].some(k=>String(r[k]||'').toLocaleLowerCase('pt-BR').includes(termo)))return false;
      return true;
    });
    const visiveis=leads.filter(r=>!restrito||poloDaFonte(r.polo_fonte)===restrito);
    const abertas=visiveis.filter(r=>r.etapa!=='perdido'&&porCpf.get(cpfChave(r.cpf))?.size!==1);
    const hoje=hojeISO();
    const resumo={abertas:abertas.length,novas:abertas.filter(r=>r.etapa==='novo').length,em_contato:abertas.filter(r=>['contato','negociacao','pendencia'].includes(r.etapa)).length,matriculadas:visiveis.filter(r=>porCpf.get(cpfChave(r.cpf))?.size===1).length,perdidas:visiveis.filter(r=>r.etapa==='perdido'&&porCpf.get(cpfChave(r.cpf))?.size!==1).length,retornos_atrasados:abertas.filter(r=>(r.proximo_contato||r.data_retorno_origem)&&String(r.proximo_contato||r.data_retorno_origem)<hoje).length};
    return{ciclo:cicloId,ciclos:all('SELECT id,nome,ativo FROM ciclos ORDER BY id DESC'),etapas:[...etapasOportunidade],pode_editar:!!podeLancar(usuario),responsaveis:podeLancar(usuario)?all("SELECT id,nome FROM usuarios WHERE ativo=1 ORDER BY nome"):[],resumo,lista:rows.slice(0,1000)};
  }
  function importarOportunidades(c,usuario){
    const cicloId=Number(c.ciclo);
    if(!cicloId||!get('SELECT id FROM ciclos WHERE id=?',cicloId))falha(400,'Selecione um processo válido.');
    if(!Array.isArray(c.linhas)||!c.linhas.length)falha(400,'A planilha não contém linhas para importar.');
    if(c.linhas.length>3000)falha(413,'A planilha excede o limite de 3.000 registros por importação.');
    const seen=new Set();let novos=0,atualizados=0,ignorados=0;
    for(const r of c.linhas){
      const identificador=String(r.identificador||'').trim().slice(0,80);
      const cpf=cpfChave(r.cpf);
      const chave=identificador||cpf;
      if(!chave){ignorados++;continue}
      const id=identificador||('CPF:'+cpf);
      if(seen.has(id)){ignorados++;continue}seen.add(id);
      const old=get('SELECT id FROM ma_oportunidades WHERE ciclo_id=? AND identificador=?',cicloId,id);
      const vals=[cicloId,id,cpf||null,String(r.nome||'').trim().slice(0,180)||null,String(r.telefone||'').replace(/\D/g,'').slice(0,15)||null,String(r.curso_cod||'').trim().slice(0,80)||null,String(r.curso_nome||'').trim().slice(0,180)||null,String(r.polo_fonte||'').trim().slice(0,120)||null,String(r.prioridade||'').trim().slice(0,120)||null,dataOportunidade(r.ultimo_atendimento),dataOportunidade(r.data_retorno),dataOportunidade(r.data_registro),Math.max(0,Number(r.interacoes)||0),String(r.status_origem||'').trim().slice(0,100)||null,String(r.origem||'').trim().slice(0,120)||null,String(r.localizacao||'').trim().slice(0,120)||null,String(r.contato||'').trim().slice(0,120)||null,String(r.responsavel_origem||'').trim().slice(0,180)||null];
      run(`INSERT INTO ma_oportunidades(ciclo_id,identificador,cpf,nome,telefone,curso_cod,curso_nome,polo_fonte,prioridade,ultimo_atendimento,data_retorno_origem,data_registro,interacoes,status_origem,origem,localizacao,contato,responsavel_origem)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(ciclo_id,identificador) DO UPDATE SET cpf=excluded.cpf,nome=excluded.nome,telefone=excluded.telefone,curso_cod=excluded.curso_cod,curso_nome=excluded.curso_nome,polo_fonte=excluded.polo_fonte,prioridade=excluded.prioridade,ultimo_atendimento=excluded.ultimo_atendimento,data_retorno_origem=excluded.data_retorno_origem,data_registro=excluded.data_registro,interacoes=excluded.interacoes,status_origem=excluded.status_origem,origem=excluded.origem,localizacao=excluded.localizacao,contato=excluded.contato,responsavel_origem=excluded.responsavel_origem,atualizado_em=datetime('now','localtime')`,...vals);
      if(old)atualizados++;else novos++;
    }
    registrar(usuario,'importou oportunidades',`Processo ${cicloId}: ${novos} novos, ${atualizados} atualizados`);
    return{ok:true,novos,atualizados,ignorados};
  }
  function salvarOportunidade(id,c,usuario){
    const row=get('SELECT id,ciclo_id,identificador,polo_fonte FROM ma_oportunidades WHERE id=?',id);
    if(!row)falha(404,'Lead não encontrado.');
    const restrito=filtroUsuario(usuario);if(restrito&&poloDaFonte(row.polo_fonte)!==restrito)falha(404,'Lead não encontrado.');
    const etapa=String(c.etapa||'novo');if(!etapasOportunidade.has(etapa))falha(400,'Etapa inválida.');
    const responsavel=c.responsavel_id===''||c.responsavel_id==null?null:Number(c.responsavel_id);
    if(responsavel!==null&&(!Number.isInteger(responsavel)||!get('SELECT id FROM usuarios WHERE id=? AND ativo=1',responsavel)))falha(400,'Responsável inválido.');
    const proximo=String(c.proximo_contato||'').trim();if(proximo&&!dataOportunidade(proximo))falha(400,'Data de retorno inválida.');
    const observacao=String(c.observacao||'').trim().slice(0,2000);
    run(`UPDATE ma_oportunidades SET etapa=?,responsavel_id=?,proximo_contato=?,observacao=?,atualizado_por=?,atualizado_em=datetime('now','localtime') WHERE id=?`,etapa,responsavel,proximo||null,observacao||null,usuario.login,id);
    registrar(usuario,'atualizou oportunidade',`Lead ${row.identificador} — ${etapa}`);
    return{ok:true};
  }

  // ------------------------------------------------------------------ rotas /api/ma/*
  async function rotas(req, res, p, m, q, usuario) {
    if (!p.startsWith('/api/ma/')) return false;
    const exigeLancar = () => { if (!podeLancar(usuario)) falha(403, 'Seu usuário não pode registrar posições oficiais'); };
    const exigeAdmin = () => { if (!ehAdmin(usuario)) falha(403, 'Apenas administradores'); };
    if(p==='/api/ma/oportunidades'&&m==='GET'){
      enviarJson(res,200,listaOportunidades(q,usuario));return true;
    }
    if(p==='/api/ma/oportunidades/importar'&&m==='POST'){
      exigeLancar();enviarJson(res,200,importarOportunidades(await lerCorpo(req),usuario));return true;
    }
    const oportunidade=p.match(/^\/api\/ma\/oportunidades\/(\d+)$/);
    if(oportunidade&&m==='PUT'){
      exigeLancar();enviarJson(res,200,salvarOportunidade(Number(oportunidade[1]),await lerCorpo(req),usuario));return true;
    }
    if (p === '/api/ma/conciliacao' && m === 'GET') { enviarJson(res, 200, conciliacao(q, usuario)); return true; }
    if (p === '/api/ma/sede' && m === 'GET') { enviarJson(res, 200, quadroSede(q, usuario)); return true; }
    if (p === '/api/ma/resetar' && m === 'GET') { exigeAdmin(); const k = contarReset(q); delete k.pos; enviarJson(res, 200, k); return true; }
    if (p === '/api/ma/resetar' && m === 'POST') { exigeAdmin(); enviarJson(res, 200, resetar(await lerCorpo(req), usuario)); return true; }
    if (p === '/api/ma/boas-vindas' && m === 'GET') {
      exigeLancar();
      const cicloId = Number(q.ciclo); if (!cicloId) falha(400, 'Selecione um processo');
      const restrito = filtroUsuario(usuario);
      const prodCurso = produtoDoCurso();
      const pnome = Object.fromEntries(all('SELECT id, nome FROM polos').map(r => [r.id, r.nome])), prnome = Object.fromEntries(all('SELECT id, nome FROM produtos').map(r => [r.id, r.nome]));
      const rows = all("SELECT id, unidade, ra, nome, curso_cod, curso_nome, polo_fonte, celular, data_pagto, data_inscricao, boas_vindas_em, boas_vindas_por, boas_vindas_chat_status, boas_vindas_chat_erro, boas_vindas_chat_id FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND ra <> '' ORDER BY COALESCE(data_pagto, data_inscricao), id", cicloId);
      await sincronizarStatusBoasVindas(rows);
      const alunos = rows.map(r => { const po = poloDaFonte(r.polo_fonte), pr = prodCurso[r.curso_cod] || null;
        return { id: r.id, ra: r.ra, nome: r.nome, curso_nome: r.curso_nome, unidade: r.unidade, polo_id: po, polo: po ? pnome[po] : r.polo_fonte, produto_id: pr, produto: pr ? prnome[pr] : null, celular: r.celular, data: r.data_pagto || r.data_inscricao, enviada_em: r.boas_vindas_em, enviada_por: r.boas_vindas_por, chat_status:r.boas_vindas_chat_status||null, chat_erro:r.boas_vindas_chat_erro||null }; })
        .filter(r => !restrito || r.polo_id === restrito);
      enviarJson(res, 200, { alunos }); return true;
    }
    if (p === '/api/ma/boas-vindas/marcar' && m === 'POST') {
      exigeLancar(); const c = await lerCorpo(req);
      const lista = ids(c.ids); if (!lista.length) { enviarJson(res, 200, { ok: true, n: 0 }); return true; }
      const n = c.desfazer ? run(`UPDATE ma_lista_alunos SET boas_vindas_em = NULL, boas_vindas_por = NULL WHERE id IN (${lista.join(',')})`).changes
        : run(`UPDATE ma_lista_alunos SET boas_vindas_em = datetime('now','localtime'), boas_vindas_por = ? WHERE id IN (${lista.join(',')}) AND boas_vindas_em IS NULL`, String(c.motivo === 'antigos' ? 'já recebidos (marcação inicial)' : usuario.login)).changes;
      registrar(usuario, c.desfazer ? 'desfez boas-vindas' : 'marcou boas-vindas enviadas', `${n} aluno(s)`);
      enviarJson(res, 200, { ok: true, n }); return true;
    }
    if (p === '/api/ma/contatos' && m === 'GET') {
      exigeLancar();
      const cicloId = Number(q.ciclo); if (!cicloId) falha(400, 'Selecione um processo');
      const restrito = filtroUsuario(usuario);
      const rows = all("SELECT id, unidade, ra, nome, curso_nome, polo_fonte, celular, data_pagto, data_inscricao, contato_exportado_em FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND ra <> '' ORDER BY id", cicloId);
      const pnome = Object.fromEntries(all('SELECT id, nome FROM polos').map(r => [r.id, r.nome]));
      const out = rows.map(r => { const po = poloDaFonte(r.polo_fonte); return { id: r.id, unidade: r.unidade, ra: r.ra, nome: r.nome, curso_nome: r.curso_nome, polo: po ? pnome[po] : r.polo_fonte, polo_id: po, celular: r.celular, data: r.data_pagto || r.data_inscricao, exportado_em: r.contato_exportado_em }; })
        .filter(r => !restrito || r.polo_id === restrito);
      enviarJson(res, 200, { alunos: out }); return true;
    }
    if (p === '/api/ma/contatos/marcar' && m === 'POST') {
      exigeLancar(); const c = await lerCorpo(req);
      const lista = ids(c.ids); if (!lista.length) { enviarJson(res, 200, { ok: true, n: 0 }); return true; }
      const n = run(`UPDATE ma_lista_alunos SET contato_exportado_em = ${c.desmarcar ? 'NULL' : "datetime('now','localtime')"} WHERE id IN (${lista.join(',')})`).changes;
      registrar(usuario, c.desmarcar ? 'desmarcou contatos exportados' : 'exportou contatos para o Google', `${n} aluno(s)`);
      enviarJson(res, 200, { ok: true, n }); return true;
    }
    if (p === '/api/ma/lista' && m === 'GET') { enviarJson(res, 200, listaResumo(q, usuario)); return true; }
    if (p === '/api/ma/lista/previa' && m === 'POST') { exigeLancar(); enviarJson(res, 200, previaLista(await lerCorpo(req, 2e7), usuario)); return true; }
    if (p === '/api/ma/lista' && m === 'POST') { exigeLancar(); enviarJson(res, 200, await gravarLista(await lerCorpo(req, 2e7), usuario)); return true; }
    if (p === '/api/ma/lista/cursos' && m === 'PUT') {
      exigeLancar(); const c = await lerCorpo(req);
      const cod = String(c.curso_cod || '').trim(); if (!cod) falha(400, 'Informe o curso');
      const pid = Number(c.produto_id) || null; if (pid && !get('SELECT 1 FROM produtos WHERE id = ?', pid)) falha(400, 'Produto inválido');
      run(`INSERT INTO ma_lista_cursos (curso_cod, produto_id, atualizado_em, atualizado_por) VALUES (?, ?, datetime('now','localtime'), ?)
           ON CONFLICT (curso_cod) DO UPDATE SET produto_id = excluded.produto_id, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`, cod, pid, usuario.login);
      registrar(usuario, 'mapeou curso do Mundo Azul', `${cod} → ${pid || 'sem produto'}`);
      enviarJson(res, 200, { ok: true }); return true;
    }
    if (p === '/api/ma/posicoes' && m === 'GET') { enviarJson(res, 200, listar(q, usuario)); return true; }
    if (p === '/api/ma/previa' && m === 'POST') { exigeLancar(); enviarJson(res, 200, previa(await lerCorpo(req), usuario)); return true; }
    if (p === '/api/ma/posicoes' && m === 'POST') { exigeLancar(); enviarJson(res, 200, gravar(await lerCorpo(req), usuario)); return true; }
    let mm = p.match(/^\/api\/ma\/posicoes\/(\d+)$/);
    if (mm && m === 'GET') {
      const pos = lerPosicao(Number(mm[1])); if (!pos || !podeVer(pos, usuario)) falha(404, 'Posição não encontrada');
      const calc = recortarParaUsuario(pos, calcular(pos, pos.linhas, ISO.test(q.ref || '') ? q.ref : null), usuario);
      const hist = [];
      for (let x = pos; x && x.substitui_id && hist.length < 50;) { x = get('SELECT id, data_posicao, hora_posicao, status, motivo, criado_em, criado_por, substitui_id FROM ma_posicoes WHERE id = ?', x.substitui_id); if (x) hist.push(x); }
      const restrito = filtroUsuario(usuario) && pos.escopo_tipo !== 'polo';
      enviarJson(res, 200, { posicao: { ...resumoPosicao(pos,usuario,calc), motivo: restrito ? null : pos.motivo, obs: restrito ? null : pos.obs, substitui_id: pos.substitui_id, substituida_por: pos.substituida_por, cruzamento_evidencia: pos.cruzamento_evidencia, status_em: pos.status_em, status_por: pos.status_por, linhas: restrito ? [] : pos.linhas, leituras: LEITURAS }, calculo: calc, anteriores: restrito ? [] : hist });
      return true;
    }
    mm = p.match(/^\/api\/ma\/posicoes\/(\d+)\/descartar$/);
    if (mm && m === 'POST') {
      exigeAdmin();
      const c = await lerCorpo(req); const id = Number(mm[1]);
      const pos = get('SELECT * FROM ma_posicoes WHERE id = ?', id); if (!pos) falha(404, 'Posição não encontrada');
      if (pos.status !== 'ativa') falha(400, 'Só uma posição ativa pode ser descartada');
      if (!String(c.motivo || '').trim()) falha(400, 'Informe o motivo do descarte');
      run(`UPDATE ma_posicoes SET status = 'descartada', motivo = COALESCE(motivo || ' | ', '') || ?, status_em = datetime('now','localtime'), status_por = ? WHERE id = ?`, 'Descartada: ' + String(c.motivo).trim().slice(0, 300), usuario.login, id);
      registrar(usuario, 'descartou posição Mundo Azul', `#${id}: ${String(c.motivo).trim().slice(0, 200)}`);
      enviarJson(res, 200, { ok: true }); return true;
    }
    mm = p.match(/^\/api\/ma\/evidencias\/(\d+)$/);
    if (mm && m === 'GET') {
      const pos = get('SELECT * FROM ma_posicoes WHERE evidencia_id = ? ORDER BY id LIMIT 1', Number(mm[1]));
      if (!pos || !podeVer({ ...pos, escopo_nomes: [] }, usuario) || (filtroUsuario(usuario) && pos.escopo_tipo !== 'polo')) falha(404, 'Evidência não encontrada');
      const ev = get('SELECT dados, tipo FROM ma_evidencias WHERE id = ?', Number(mm[1]));
      if (!ev) falha(404, 'Evidência não encontrada');
      const b64 = ev.dados.slice(ev.dados.indexOf(',') + 1);
      res.writeHead(200, { 'Content-Type': ev.tipo || 'image/png', 'Cache-Control': 'private, max-age=3600' });
      res.end(Buffer.from(b64, 'base64')); return true;
    }
    if (p === '/api/ma/mapeamentos' && m === 'GET') {
      exigeLancar();
      enviarJson(res, 200, all('SELECT tipo, chave, nome_fonte, local_ids, verificado, obs, atualizado_em, atualizado_por FROM ma_mapeamentos ORDER BY tipo, nome_fonte').map(r => ({ ...r, local_ids: ids(r.local_ids) })));
      return true;
    }
    if (p === '/api/ma/sugestoes' && m === 'POST') {
      exigeLancar(); const c = await lerCorpo(req);
      const tipo = c.tipo === 'polo' ? 'polo' : 'produto';
      enviarJson(res, 200, (Array.isArray(c.nomes) ? c.nomes.slice(0, 300) : []).map(n => ({ nome_fonte: String(n), ...sugerir(tipo, n) })));
      return true;
    }
    if (p === '/api/ma/mapeamentos' && m === 'PUT') {
      const c = await lerCorpo(req);
      const tipo = c.tipo === 'polo' ? 'polo' : c.tipo === 'produto' ? 'produto' : falha(400, 'Tipo inválido');
      const nome = String(c.nome_fonte || '').trim(); if (!nome) falha(400, 'Informe o nome da fonte');
      const loc = idsTxt(c.local_ids);
      const verificado = c.verificado ? 1 : 0;
      if (verificado) exigeAdmin(); else exigeLancar();
      if (verificado && !String(c.obs || '').trim()) falha(400, 'Para verificar um agrupamento, registre a regra comercial / evidência na observação');
      if (!loc) { run('DELETE FROM ma_mapeamentos WHERE tipo = ? AND chave = ?', tipo, norm(nome)); registrar(usuario, 'removeu mapeamento Mundo Azul', `${tipo}: "${nome}"`); enviarJson(res, 200, { ok: true }); return true; }
      run(`INSERT INTO ma_mapeamentos (tipo, chave, nome_fonte, local_ids, verificado, obs, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)
           ON CONFLICT (tipo, chave) DO UPDATE SET nome_fonte = excluded.nome_fonte, local_ids = excluded.local_ids, verificado = excluded.verificado, obs = excluded.obs, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
        tipo, norm(nome), nome, loc, verificado, String(c.obs || '').trim().slice(0, 300) || null, usuario.login);
      registrar(usuario, verificado ? 'verificou agrupamento Mundo Azul' : 'mapeou nome do Mundo Azul', `${tipo}: "${nome}" → ${loc}${c.obs ? ' · ' + String(c.obs).slice(0, 200) : ''}`);
      enviarJson(res, 200, { ok: true }); return true;
    }
    falha(404, 'Rota não encontrada');
  }

  // ------------------------------------------------------------------ lista de alunos do Mundo Azul (Excel "Consultar candidatos")
  // Matrícula = candidato com R.A. Data = pagamento da mensalidade (sem ela, a inscrição).
  // Aluno com R.A. que não está lançado no sistema (CPF; sem CPF, nome + polo) = Sede/Digital, por polo e produto.
  // Importar de novo não soma: a chave é o número do candidato. Quem some da lista da mesma unidade sai do cálculo.
  const soDig = (v) => String(v ?? '').replace(/\D/g, '');
  const dataBRparaISO = (v) => { const t = String(v ?? '').trim(); let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
  function normalizarLinhaLista(l) {
    const candidato = String(l.candidato ?? '').trim();
    if (!candidato) return null;
    return { candidato: candidato.slice(0, 40), unidade: String(l.unidade ?? '').trim().slice(0, 60), concurso: String(l.concurso ?? '').trim().slice(0, 60),
      ra: String(l.ra ?? '').trim().slice(0, 30), nome: String(l.nome ?? '').trim().slice(0, 160), cpf: soDig(l.cpf).slice(0, 11) || null,
      curso_cod: String(l.curso_cod ?? '').trim().slice(0, 60), curso_nome: String(l.curso_nome ?? '').trim().slice(0, 160), polo_fonte: String(l.polo_fonte ?? '').trim().slice(0, 120),
      data_pagto: dataBRparaISO(l.data_pagto), data_inscricao: dataBRparaISO(l.data_inscricao), inscrito_por: String(l.inscrito_por ?? '').trim().slice(0, 120),
      celular: /^\+55 \d{2} 9\d{4}-\d{4}$/.test(String(l.celular ?? '').trim()) ? String(l.celular).trim() : null };
  }
  const produtoDoCurso = () => Object.fromEntries(all('SELECT curso_cod, produto_id FROM ma_lista_cursos WHERE produto_id IS NOT NULL').map(r => [r.curso_cod, r.produto_id]));
  function sugerirProdutoCurso(curso_cod, curso_nome, unidade) {
    const d = get('SELECT produto_id FROM ma_lista_cursos WHERE curso_cod = ? AND produto_id IS NOT NULL', curso_cod);
    if (d) return { produto_id: d.produto_id, origem: 'dicionario' };
    // mesmo curso já mapeado com outro código? (nome igual)
    const n = norm(curso_nome);
    const porNome = all('SELECT curso_nome, produto_id FROM ma_lista_cursos WHERE produto_id IS NOT NULL').filter(r => norm(r.curso_nome) === n);
    if (porNome.length && new Set(porNome.map(r => r.produto_id)).size === 1) return { produto_id: porNome[0].produto_id, origem: 'mesmo_nome' };
    // curso cadastrado no sistema (Cadastros › Cursos): o Mundo Azul escreve "LICENCIATURA EM PEDAGOGIA", "SUPERIOR DE TECNOLOGIA EM…"
    const tira = (t) => norm(t).replace(/^(graduacao|licenciatura|bacharelado|superior de tecnologia|tecnologo|tecnico|curso superior de tecnologia) em /, '');
    let cursosSis = []; try { cursosSis = all('SELECT nome, produto_id FROM cursos WHERE produto_id IS NOT NULL'); } catch {}
    const alvoA = n, alvoB = tira(curso_nome);
    const cand = cursosSis.map(r => ({ ...r, n: norm(r.nome), t: tira(r.nome) })).filter(r => r.n === alvoA || r.t === alvoB || alvoB === r.n || (!/^egrad_/i.test(curso_cod) && r.t.length >= 4 && (alvoB + ' ').startsWith(r.t + ' ')));
    // EGRAD_ (graduação 100% EAD) só aceita nome idêntico: "Engenharia de Software" não é o semipresencial "Engenharia"
    if (cand.length) {
      const exato = cand.filter(r => r.n === alvoA);
      const melhor = exato.length ? exato : cand.sort((x, y) => y.t.length - x.t.length).filter((r, _, xs) => r.t.length === xs[0].t.length);
      if (new Set(melhor.map(r => r.produto_id)).size === 1) return { produto_id: melhor[0].produto_id, origem: 'curso_cadastrado', curso_sistema: melhor[0].nome };
    }
    // código do Mundo Azul: ETEC_ = técnico, EGRAD_ = graduação EAD (os semipresenciais vêm como ESPRE_ e precisam do cadastro de cursos)
    const porNomeProd = (alvo) => { const t = all('SELECT id, nome FROM produtos').filter(p => norm(p.nome) === alvo); return t.length === 1 ? t[0].id : null; };
    if (/^etec_/i.test(curso_cod) || /tec$/i.test(unidade || '')) { const id = porNomeProd('tecnico'); if (id) return { produto_id: id, origem: 'codigo' }; }
    if (/^egrad_/i.test(curso_cod)) { const id = porNomeProd('graduacao'); if (id) return { produto_id: id, origem: 'codigo' }; }
    // pós-graduação (unidade ou código com POS; "PÓS-GRADUAÇÃO…", "ESPECIALIZAÇÃO…", "MBA…") → produto Pós
    if (/pos/i.test(unidade || '') || /^e?pos/i.test(curso_cod) || /^(pos graduacao|especializacao|mba)\b/.test(n)) { const id = porNomeProd('pos'); if (id) return { produto_id: id, origem: 'unidade' }; }
    return { produto_id: null, origem: 'sem_correspondencia' };
  }
  const poloDaFonte = (nome) => { const s1 = sugerir('polo', nome); return s1.local_ids.length === 1 ? s1.local_ids[0] : null; };
  const welcomeChatBase=()=>String(process.env.BALBINO_CHAT_URL||'http://127.0.0.1:3001').replace(/\/$/,'');
  const welcomeChatToken=()=>String(process.env.BALBINO_CHAT_TOKEN||'').trim();
  function welcomeConfig(){try{return JSON.parse(cfg('boas_vindas','{}')||'{}')}catch{return{}}}
  function autoWelcomeEnabled(){return welcomeConfig().automatica===true}
  function welcomeMessage(row){
    const productId=produtoDoCurso()[row.curso_cod]||null,product=productId?get('SELECT nome FROM produtos WHERE id=?',productId)?.nome||'':'';
    const poloId=poloDaFonte(row.polo_fonte),polo=poloId?get('SELECT nome FROM polos WHERE id=?',poloId)?.nome||row.polo_fonte:row.polo_fonte||'';
    const conf=welcomeConfig(),model=(productId&&conf.produtos?.[productId])||conf.padrao||'Olá, {primeiro_nome}! 👋\nSeja muito bem-vindo(a) à Unicesumar – Polo {polo}! 🎓\nSua matrícula em *{curso}* está confirmada (R.A. {ra}).\nQualquer dúvida, é só chamar por aqui. Estamos com você! 💙';
    const rawName=String(row.nome||'').trim().replace(/\s+/g,' '),smallWords=new Set(['de','da','do','das','dos','e']),name=rawName.toLowerCase().split(/\s+/).map((w,i)=>i&&smallWords.has(w)?w:w.charAt(0).toLocaleUpperCase('pt-BR')+w.slice(1)).join(' ');
    let course=String(row.curso_nome||'').trim();const prefix=/^(gradua[cç][aã]o|licenciatura|bacharelado|superior de tecnologia|tecn[oó]logo|t[eé]cnico|curso superior de tecnologia|p[oó]s[- ]gradua[cç][aã]o( lato sensu)?|especializa[cç][aã]o|mba)( em| -)?\s+/i;for(let i=0;i<2;i++)course=course.replace(prefix,'');course=course.toLowerCase().split(/\s+/).map((w,i)=>i&&new Set(['de','da','do','das','dos','e','em','para','a','o','na','no']).has(w)?w:w.charAt(0).toLocaleUpperCase('pt-BR')+w.slice(1)).join(' ');
    const vars={primeiro_nome:name.split(' ')[0]||name,nome,curso:course,polo,produto,ra:String(row.ra||'')};
    return String(model).replace(/\{(\w+)\}/g,(m,k)=>Object.hasOwn(vars,k)?vars[k]:m);
  }
  async function enviarBoasVindasPendentes(){
    if(String(process.env.BALBINO_WELCOME_WORKER_TOKEN||'').trim())return{enviados:0,erro:null};
    const token=welcomeChatToken();if(!token||!autoWelcomeEnabled())return{enviados:0,erro:null};
    const rows=all("SELECT id,ciclo_id,candidato,nome,ra,curso_cod,curso_nome,polo_fonte,celular,boas_vindas_chat_id FROM ma_lista_alunos WHERE ativo=1 AND ra<>'' AND celular IS NOT NULL AND celular<>'' AND boas_vindas_chat_status='PENDENTE' ORDER BY id LIMIT 100");
    if(!rows.length)return{enviados:0,erro:null};
    const itens=rows.map(r=>{const id=r.boas_vindas_chat_id||`matricula:${r.ciclo_id}:${r.id}`;if(!r.boas_vindas_chat_id)run('UPDATE ma_lista_alunos SET boas_vindas_chat_id=? WHERE id=?',id,r.id);return{id_externo:id,telefone:String(r.celular).replace(/\D/g,''),nome:r.nome||'',mensagem:welcomeMessage(r)}});
    try{
      const resp=await fetch(`${welcomeChatBase()}/api/integracao/boas-vindas`,{method:'POST',headers:{'Content-Type':'application/json','X-Token':token},body:JSON.stringify({itens}),signal:AbortSignal.timeout(10000)}),data=await resp.json().catch(()=>({}));
      if(!resp.ok)throw new Error(data.error||`Balbino Chat respondeu HTTP ${resp.status}`);
      const accepted=new Set(data.aceitos||[]),dups=new Set(data.duplicados||[]),refused=new Map((data.recusados||[]).map(x=>[x.id_externo,x.motivo]));
      for(const x of itens){if(accepted.has(x.id_externo)||dups.has(x.id_externo))run("UPDATE ma_lista_alunos SET boas_vindas_chat_status='NA_FILA',boas_vindas_chat_erro=NULL WHERE boas_vindas_chat_id=?",x.id_externo);else if(refused.has(x.id_externo))run("UPDATE ma_lista_alunos SET boas_vindas_chat_status='ERRO',boas_vindas_chat_erro=? WHERE boas_vindas_chat_id=?",String(refused.get(x.id_externo)).slice(0,300),x.id_externo)}
      return{enviados:accepted.size+dups.size,erro:null};
    }catch(e){const msg=String(e.message||e).slice(0,300);for(const x of itens)run('UPDATE ma_lista_alunos SET boas_vindas_chat_erro=? WHERE boas_vindas_chat_id=?',msg,x.id_externo);return{enviados:0,erro:msg}}
  }
  async function sincronizarStatusBoasVindas(rows){
    if(String(process.env.BALBINO_WELCOME_WORKER_TOKEN||'').trim())return;
    const token=welcomeChatToken(),ids=rows.map(r=>r.boas_vindas_chat_id).filter(Boolean);if(!token||!ids.length)return;
    try{const resp=await fetch(`${welcomeChatBase()}/api/integracao/boas-vindas/status?ids=${encodeURIComponent(ids.slice(0,100).join(','))}`,{headers:{'X-Token':token},signal:AbortSignal.timeout(8000)});if(!resp.ok)return;const data=await resp.json();for(const s of data.statuses||[]){const status=String(s.status||'').toLowerCase();if(status==='enviada')run("UPDATE ma_lista_alunos SET boas_vindas_chat_status='ENVIADA',boas_vindas_chat_erro=NULL,boas_vindas_em=COALESCE(boas_vindas_em,datetime('now','localtime')),boas_vindas_por=COALESCE(boas_vindas_por,'Balbino Chat') WHERE boas_vindas_chat_id=?",s.id_externo);else if(status==='erro')run("UPDATE ma_lista_alunos SET boas_vindas_chat_status='ERRO',boas_vindas_chat_erro=? WHERE boas_vindas_chat_id=?",String(s.erro||'Falha no envio').slice(0,300),s.id_externo);else run('UPDATE ma_lista_alunos SET boas_vindas_chat_status=?,boas_vindas_chat_erro=NULL WHERE boas_vindas_chat_id=?',status==='enviando'?'ENVIANDO':'NA_FILA',s.id_externo)}}catch{}
  }
  const welcomeChatTimer=setInterval(async()=>{try{await enviarBoasVindasPendentes();const rows=all("SELECT boas_vindas_chat_id FROM ma_lista_alunos WHERE boas_vindas_chat_status IN ('NA_FILA','ENVIANDO') AND boas_vindas_chat_id IS NOT NULL ORDER BY id DESC LIMIT 100");await sincronizarStatusBoasVindas(rows)}catch{}},45000);welcomeChatTimer.unref?.();
  // "RIBEIRÃO PRETO - IPIRANGA - SP" → Ribeirão Preto (só como sugestão; vale depois de confirmado na importação)
  const poloPorPrefixo = (nome) => { const n = norm(nome).replace(/\s(sp|mg|pr|rj|go|ms|mt|ba|sc|rs)$/, ''); const xs = all('SELECT id, nome FROM polos WHERE ativo = 1').filter(p => (n + ' ').startsWith(norm(p.nome) + ' ')); return xs.length === 1 ? xs[0].id : null; };
  function previaLista(c, usuario) {
    const cicloId = Number(c.ciclo); if (!get('SELECT id FROM ciclos WHERE id = ?', cicloId)) falha(400, 'Selecione um processo');
    const linhas = (Array.isArray(c.linhas) ? c.linhas : []).slice(0, 20000).map(normalizarLinhaLista).filter(Boolean);
    if (!linhas.length) falha(400, 'Não encontrei linhas com o número do Candidato. Use o Excel do Mundo Azul (Consultar candidatos › Gerar Excel).');
    const unidades = [...new Set(linhas.map(l => l.unidade))];
    const existentes = Object.fromEntries(all('SELECT candidato, ra, data_pagto, ativo FROM ma_lista_alunos WHERE ciclo_id = ?', cicloId).map(r => [r.candidato, r]));
    const noArquivo = new Set(linhas.map(l => l.candidato));
    const sairam = all(`SELECT candidato, ra FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND unidade IN (${unidades.map(() => '?').join(',')})`, cicloId, ...unidades).filter(r => !noArquivo.has(r.candidato));
    const cursos = {}, polos = {};
    for (const l of linhas) {
      if (!cursos[l.curso_cod]) cursos[l.curso_cod] = { curso_cod: l.curso_cod, curso_nome: l.curso_nome, unidade: l.unidade, alunos: 0, com_ra: 0, ...sugerirProdutoCurso(l.curso_cod, l.curso_nome, l.unidade) };
      cursos[l.curso_cod].alunos++; if (l.ra) cursos[l.curso_cod].com_ra++;
      if (!polos[l.polo_fonte]) { const id = poloDaFonte(l.polo_fonte); polos[l.polo_fonte] = { polo_fonte: l.polo_fonte, polo_id: id, salvo: !!id, sugerido: id || poloPorPrefixo(l.polo_fonte), alunos: 0, com_ra: 0 }; }
      polos[l.polo_fonte].alunos++; if (l.ra) polos[l.polo_fonte].com_ra++;
    }
    const duplicados = linhas.length - noArquivo.size;
    return { ciclo: cicloId, unidades, linhas: linhas.length, com_ra: linhas.filter(l => l.ra).length, sem_ra: linhas.filter(l => !l.ra).length,
      novos: linhas.filter(l => !existentes[l.candidato]).length, ja_importados: linhas.filter(l => existentes[l.candidato]).length,
      novos_ra: linhas.filter(l => l.ra && !(existentes[l.candidato] && existentes[l.candidato].ra)).length,
      sairam: sairam.length, sairam_com_ra: sairam.filter(r => r.ra).length, duplicados,
      cursos: Object.values(cursos), polos: Object.values(polos) };
  }
  async function gravarLista(c, usuario) {
    if (!c.confirmado) falha(400, 'Confira a prévia e confirme antes de importar');
    const pv = previaLista(c, usuario), cicloId = pv.ciclo;
    const linhas = c.linhas.slice(0, 20000).map(normalizarLinhaLista).filter(Boolean);
    const antesLista=all('SELECT candidato,ra,celular,boas_vindas_em FROM ma_lista_alunos WHERE ciclo_id=?',cicloId),antesPorCandidato=new Map(antesLista.map(r=>[r.candidato,r]));
    const tinhaBase=antesLista.length>0, autoAtivo=autoWelcomeEnabled();
    const elegiveisNovos=autoAtivo&&tinhaBase?linhas.filter(l=>l.ra&&l.celular&&!(antesPorCandidato.get(l.candidato)?.boas_vindas_em)&&(!antesPorCandidato.has(l.candidato)||!antesPorCandidato.get(l.candidato)?.ra||!antesPorCandidato.get(l.candidato)?.celular)):[];
    const okProd = new Set(all('SELECT id FROM produtos').map(r => r.id)), okPolo = new Set(all('SELECT id FROM polos').map(r => r.id));
    const resultado=tx(() => {
      for (const k of (Array.isArray(c.cursos) ? c.cursos : [])) {
        const cod = String(k.curso_cod || '').trim(); if (!cod) continue;
        const pid = okProd.has(Number(k.produto_id)) ? Number(k.produto_id) : null;
        const info = pv.cursos.find(x => x.curso_cod === cod) || {};
        run(`INSERT INTO ma_lista_cursos (curso_cod, curso_nome, unidade, produto_id, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, datetime('now','localtime'), ?)
             ON CONFLICT (curso_cod) DO UPDATE SET curso_nome = excluded.curso_nome, unidade = excluded.unidade, produto_id = excluded.produto_id, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
          cod, info.curso_nome || null, info.unidade || null, pid, usuario.login);
      }
      for (const k of (Array.isArray(c.polos) ? c.polos : [])) {
        const nome = String(k.polo_fonte || '').trim(), pid = Number(k.polo_id);
        if (!nome || !okPolo.has(pid)) continue;
        run(`INSERT INTO ma_mapeamentos (tipo, chave, nome_fonte, local_ids, verificado, atualizado_em, atualizado_por) VALUES ('polo', ?, ?, ?, 0, datetime('now','localtime'), ?)
             ON CONFLICT (tipo, chave) DO UPDATE SET nome_fonte = excluded.nome_fonte, local_ids = excluded.local_ids, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`, norm(nome), nome, String(pid), usuario.login);
      }
      const imp = Number(run('INSERT INTO ma_lista_importacoes (ciclo_id, arquivo, unidades, linhas, com_ra, novos, sairam, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        cicloId, String(c.arquivo || '').slice(0, 200) || null, pv.unidades.join(', '), pv.linhas, pv.com_ra, pv.novos, pv.sairam, usuario.login).lastInsertRowid);
      for (const l of linhas) run(`INSERT INTO ma_lista_alunos (ciclo_id, candidato, unidade, concurso, ra, nome, cpf, curso_cod, curso_nome, polo_fonte, data_pagto, data_inscricao, inscrito_por, celular, ativo, importacao_id, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now','localtime'))
          ON CONFLICT (ciclo_id, candidato) DO UPDATE SET unidade = excluded.unidade, concurso = excluded.concurso, ra = excluded.ra, nome = excluded.nome, cpf = excluded.cpf, curso_cod = excluded.curso_cod,
            curso_nome = excluded.curso_nome, polo_fonte = excluded.polo_fonte, data_pagto = excluded.data_pagto, data_inscricao = excluded.data_inscricao, inscrito_por = excluded.inscrito_por,
            celular = COALESCE(excluded.celular, ma_lista_alunos.celular), ativo = 1, importacao_id = excluded.importacao_id, atualizado_em = excluded.atualizado_em`,
        cicloId, l.candidato, l.unidade, l.concurso, l.ra, l.nome, l.cpf, l.curso_cod, l.curso_nome, l.polo_fonte, l.data_pagto, l.data_inscricao, l.inscrito_por, l.celular, imp);
      const vistos = new Set(linhas.map(l => l.candidato));
      for (const r of all(`SELECT id, candidato FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND unidade IN (${pv.unidades.map(() => '?').join(',')})`, cicloId, ...pv.unidades))
        if (!vistos.has(r.candidato)) run("UPDATE ma_lista_alunos SET ativo = 0, atualizado_em = datetime('now','localtime') WHERE id = ?", r.id);
      registrar(usuario, 'importou lista de alunos do Mundo Azul', `${pv.unidades.join(', ')} · ${pv.linhas} linhas · ${pv.com_ra} com R.A. · ${pv.novos} novas · ${pv.sairam} saíram`);
      return { ok: true, id: imp, ...pv, cursos: undefined, polos: undefined };
    });
    if(elegiveisNovos.length){
      for(const l of elegiveisNovos){const row=get('SELECT id FROM ma_lista_alunos WHERE ciclo_id=? AND candidato=?',cicloId,l.candidato);if(row)run("UPDATE ma_lista_alunos SET boas_vindas_chat_id=COALESCE(boas_vindas_chat_id,?),boas_vindas_chat_status=COALESCE(boas_vindas_chat_status,'PENDENTE') WHERE id=? AND boas_vindas_em IS NULL",`matricula:${cicloId}:${row.id}`,row.id)}
      const envio=await enviarBoasVindasPendentes();resultado.boas_vindas={novos:elegiveisNovos.length,enfileirados:envio.enviados,erro:envio.erro};
    }else resultado.boas_vindas={novos:0,enfileirados:0,baselined:!tinhaBase&&autoAtivo};
    return resultado;
  }
  // Classificação numa data: lançada (já no sistema) · Sede/Digital (não lançada) · falta mapear curso/polo
  function classificarLista(cicloId, ref, cache = {}) {
    const k = `lista|${cicloId}|${ref}`; if (cache[k]) return cache[k];
    const alunos = all("SELECT * FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND ra <> '' AND COALESCE(data_pagto, data_inscricao) <= ?", cicloId, ref);
    const out = { itens: [], cobertos: new Set(), porPoloProduto: {}, tem: false };
    const temLista = get('SELECT 1 x FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 LIMIT 1', cicloId);
    if (!temLista) { cache[k] = out; return out; }
    out.tem = true;
    const prodCurso = produtoDoCurso();
    // produtos cobertos pela lista = produtos dos cursos das unidades importadas (mesmo sem matrícula ainda)
    for (const r of all('SELECT DISTINCT curso_cod FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1', cicloId)) if (prodCurso[r.curso_cod]) out.cobertos.add(prodCurso[r.curso_cod]);
    const mats = all('SELECT id, data, polo_id, produto_id, tutor_id, cpf, aluno FROM matriculas WHERE ciclo_id = ?', cicloId);
    const porCpf = {}, porNome = {};
    for (const m of mats) { if (m.cpf) (porCpf[soDig(m.cpf)] ??= []).push(m); if (m.aluno) (porNome[`${norm(m.aluno)}|${m.polo_id}`] ??= []).push(m); }
    const usados = new Set();
    const polosCache = {};
    for (const a of alunos) {
      const polo_id = polosCache[a.polo_fonte] !== undefined ? polosCache[a.polo_fonte] : (polosCache[a.polo_fonte] = poloDaFonte(a.polo_fonte));
      const produto_id = prodCurso[a.curso_cod] || null;
      const data = a.data_pagto || a.data_inscricao;
      const cand = (a.cpf && porCpf[a.cpf]) || (polo_id && porNome[`${norm(a.nome)}|${polo_id}`]) || [];
      // prefere a do mesmo produto e ainda não usada por outro aluno da lista
      const m = cand.filter(x => !usados.has(x.id)).sort((x, y) => (x.produto_id === produto_id ? 0 : 1) - (y.produto_id === produto_id ? 0 : 1))[0] || null;
      if (m) usados.add(m.id);
      let status;
      if (m && m.data <= ref) status = 'lancada';
      else if (!polo_id || !produto_id) status = 'mapear';
      else status = 'sede';
      const item = { id: a.id, candidato: a.candidato, ra: a.ra, nome: a.nome, curso: a.curso_nome || a.curso_cod, curso_cod: a.curso_cod, unidade: a.unidade, polo_fonte: a.polo_fonte, polo_id, produto_id, data,
        inscrito_por: a.inscrito_por, status, matricula_id: m ? m.id : null, por_cpf: !!(m && a.cpf && soDig(m.cpf) === a.cpf), lancada_em: m ? m.data : null };
      out.itens.push(item);
      if (status === 'sede') { const kk = `${polo_id}|${produto_id}`; out.porPoloProduto[kk] = (out.porPoloProduto[kk] || 0) + 1; }
    }
    // Possível duplicidade: Sede/Digital com nome parecido (mesmo primeiro e último nome) de uma matrícula lançada no mesmo
    // polo que não foi reconhecida (CPF diferente ou vazio). Continua contando — corrija o CPF/nome da matrícula para ligar.
    const chaveNome = (t) => { const w = norm(t).split(' ').filter(x => x.length > 2 && !['dos', 'das', 'de', 'da', 'do'].includes(x)); return w.length ? `${w[0]} ${w.at(-1)}` : ''; };
    const livresPorNome = {};
    for (const m of mats) if (!usados.has(m.id) && m.aluno) (livresPorNome[`${chaveNome(m.aluno)}|${m.polo_id}`] ??= []).push(m);
    for (const it of out.itens) if (it.status === 'sede') {
      const c = livresPorNome[`${chaveNome(it.nome)}|${it.polo_id}`];
      if (c && c.length) it.possivel_dup = { matricula_id: c[0].id, aluno: c[0].aluno, tem_cpf: !!c[0].cpf, data: c[0].data };
    }
    // Lançadas no sistema (produtos cobertos pela lista) que não aparecem com R.A. no Mundo Azul até a consulta − tolerância
    const tol = Math.max(0, Number((get("SELECT valor FROM config WHERE chave = 'tolerancia_ra_dias'") || { valor: '3' }).valor) || 0);
    const limite = (() => { const d = new Date(ref + 'T12:00:00'); d.setDate(d.getDate() - tol); return d.toISOString().slice(0, 10); })();
    const semRaCpf = {}, semRaNome = {};
    for (const a of all("SELECT cpf, nome, polo_fonte FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND (ra = '' OR ra IS NULL)", cicloId)) {
      if (a.cpf) semRaCpf[a.cpf] = true;
      const po = polosCache[a.polo_fonte] !== undefined ? polosCache[a.polo_fonte] : (polosCache[a.polo_fonte] = poloDaFonte(a.polo_fonte));
      if (po) semRaNome[`${norm(a.nome)}|${po}`] = true;
    }
    // aluno com R.A. depois da consulta também "existe" — não é pendência
    const raDepois = all("SELECT cpf, nome, polo_fonte FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 AND ra <> '' AND COALESCE(data_pagto, data_inscricao) > ?", cicloId, ref);
    for (const a of raDepois) { if (a.cpf) semRaCpf[a.cpf] = 'depois'; const po = poloDaFonte(a.polo_fonte); if (po) semRaNome[`${norm(a.nome)}|${po}`] = 'depois'; }
    out.tolerancia = tol; out.lancadas_sem_ra = []; out.sem_cpf = 0; out.sem_cpf_polo = {};
    for (const m of mats) {
      if (!out.cobertos.has(m.produto_id) || m.data > ref) continue;
      if (!m.cpf) { out.sem_cpf++; out.sem_cpf_polo[m.polo_id] = (out.sem_cpf_polo[m.polo_id] || 0) + 1; }
      if (usados.has(m.id) || m.data > limite) continue;
      const achou = (m.cpf && semRaCpf[soDig(m.cpf)]) || (m.aluno && semRaNome[`${norm(m.aluno)}|${m.polo_id}`]);
      if (achou === 'depois') continue;
      out.lancadas_sem_ra.push({ matricula_id: m.id, data: m.data, polo_id: m.polo_id, produto_id: m.produto_id, tutor_id: m.tutor_id, aluno: m.aluno, tem_cpf: !!m.cpf, situacao: achou ? 'sem_ra' : 'nao_encontrada' });
    }
    cache[k] = out; return out;
  }
  // R.A. de cada matrícula lançada, pela lista do Mundo Azul (reconhecida por CPF ou nome + polo)
  function raPorMatricula(cicloId, cache = {}) {
    const k = `ra|${cicloId}`; if (cache[k]) return cache[k];
    const out = {};
    for (const i of classificarLista(cicloId, '9999-12-31', cache).itens) if (i.matricula_id) out[i.matricula_id] = i.ra;
    cache[k] = out; return out;
  }
  const cpfPara = (usuario, cpf) => { const c = soDig(cpf); if (c.length !== 11) return cpf || ''; return filtroUsuario(usuario) ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`; };
  function listaResumo(q, usuario) {
    const cicloId = Number(q.ciclo); if (!cicloId) falha(400, 'Selecione um processo');
    const ref = ISO.test(q.ref || '') ? q.ref : hojeISO();
    const restrito = filtroUsuario(usuario);
    const c = classificarLista(cicloId, ref);
    const pnome = Object.fromEntries(all('SELECT id, nome FROM polos').map(r => [r.id, r.nome])), prnome = Object.fromEntries(all('SELECT id, nome FROM produtos').map(r => [r.id, r.nome]));
    const cpfLista = Object.fromEntries(all('SELECT id, cpf FROM ma_lista_alunos WHERE ciclo_id = ?', cicloId).map(r => [r.id, r.cpf]));
    const cpfMat = Object.fromEntries(all('SELECT id, cpf FROM matriculas WHERE ciclo_id = ?', cicloId).map(r => [r.id, r.cpf]));
    const itens = c.itens.filter(i => !restrito || i.polo_id === restrito).map(i => ({ ...i, cpf: cpfPara(usuario, cpfLista[i.id]), polo: pnome[i.polo_id] || null, produto: prnome[i.produto_id] || null }));
    const conta = (st) => itens.filter(i => i.status === st).length;
    const ult = get('SELECT * FROM ma_lista_importacoes WHERE ciclo_id = ? ORDER BY id DESC LIMIT 1', cicloId) || null;
    const unidades = all('SELECT unidade, COUNT(*) n, SUM(ra <> \'\') com_ra, MAX(atualizado_em) em FROM ma_lista_alunos WHERE ciclo_id = ? AND ativo = 1 GROUP BY unidade ORDER BY unidade', cicloId);
    const tnome = Object.fromEntries(all('SELECT id, nome FROM tutores').map(r => [r.id, r.nome]));
    const semRa = (c.lancadas_sem_ra || []).filter(i => !restrito || i.polo_id === restrito).map(i => ({ ...i, cpf: cpfPara(usuario, cpfMat[i.matricula_id]), polo: pnome[i.polo_id], produto: prnome[i.produto_id], tutor: tnome[i.tutor_id] }));
    return { ref, tem: c.tem, resumo: { com_ra: itens.length, lancadas: conta('lancada'), sede: conta('sede'), mapear: conta('mapear'), possivel_dup: itens.filter(i => i.possivel_dup).length, sem_ra: semRa.length, sem_cpf: restrito ? ((c.sem_cpf_polo || {})[restrito] || 0) : (c.sem_cpf || 0) }, itens,
      lancadas_sem_ra: semRa, tolerancia: c.tolerancia,
      cobertos: [...c.cobertos].map(id => ({ id, nome: prnome[id] })), ultima: ult && { criado_em: ult.criado_em, criado_por: restrito ? null : ult.criado_por, unidades: ult.unidades, linhas: ult.linhas },
      unidades: restrito ? [] : unidades,
      cursos: restrito ? [] : all('SELECT curso_cod, curso_nome, unidade, produto_id FROM ma_lista_cursos ORDER BY unidade, curso_nome') };
  }

  // ------------------------------------------------------------------ zerar dados do Mundo Azul (administrador)
  // Apaga, do processo escolhido, posições do print e/ou a lista de alunos; opcionalmente as correspondências de nomes.
  // Faz uma cópia completa do banco antes. Matrículas, metas, tutores e o resto do sistema não são tocados.
  function contarReset(c) {
    const cicloId = Number(c.ciclo); if (!get('SELECT id FROM ciclos WHERE id = ?', cicloId)) falha(400, 'Selecione um processo');
    const data = ISO.test(c.data || '') ? c.data : null;
    const pos = all(`SELECT id FROM ma_posicoes WHERE ciclo_id = ?${data ? ' AND data_posicao = ?' : ''}`, cicloId, ...(data ? [data] : [])).map(r => r.id);
    return { cicloId, data, pos,
      posicoes: pos.length,
      lista_alunos: get('SELECT COUNT(*) n FROM ma_lista_alunos WHERE ciclo_id = ?', cicloId).n,
      lista_importacoes: get('SELECT COUNT(*) n FROM ma_lista_importacoes WHERE ciclo_id = ?', cicloId).n,
      mapeamentos: get('SELECT COUNT(*) n FROM ma_mapeamentos').n + get('SELECT COUNT(*) n FROM ma_lista_cursos').n };
  }
  function resetar(c, usuario) {
    if (String(c.confirmacao || '').trim().toUpperCase() !== 'ZERAR') falha(400, 'Digite ZERAR para confirmar');
    if (!c.posicoes && !c.lista && !c.mapeamentos) falha(400, 'Escolha o que zerar');
    const k = contarReset(c);
    let backup = null;
    try {
      const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
      backup = path.join(dir, `antes-zerar-mundo-azul-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    } catch (e) { falha(500, 'Não consegui criar a cópia de segurança; nada foi apagado. ' + e.message); }
    const feito = tx(() => {
      const r = { posicoes: 0, lista_alunos: 0, mapeamentos: 0 };
      if (c.posicoes && k.pos.length) {
        const lista = k.pos.join(',');
        run(`UPDATE ma_posicoes SET substitui_id = NULL, substituida_por = NULL WHERE id IN (${lista}) OR substitui_id IN (${lista}) OR substituida_por IN (${lista})`);
        run(`DELETE FROM ma_posicao_linhas WHERE posicao_id IN (${lista})`);
        r.posicoes = run(`DELETE FROM ma_posicoes WHERE id IN (${lista})`).changes;
        run('DELETE FROM ma_evidencias WHERE id NOT IN (SELECT evidencia_id FROM ma_posicoes WHERE evidencia_id IS NOT NULL)');
      }
      if (c.lista) {
        r.lista_alunos = run('DELETE FROM ma_lista_alunos WHERE ciclo_id = ?', k.cicloId).changes;
        run('DELETE FROM ma_lista_importacoes WHERE ciclo_id = ?', k.cicloId);
      }
      if (c.mapeamentos) { r.mapeamentos = run('DELETE FROM ma_mapeamentos').changes + run('DELETE FROM ma_lista_cursos').changes; }
      return r;
    });
    registrar(usuario, 'zerou dados do Mundo Azul', `processo ${k.cicloId}${k.data ? ' · posições de ' + k.data : ''} · posições ${feito.posicoes} · alunos da lista ${feito.lista_alunos} · correspondências ${feito.mapeamentos} · backup ${path.basename(backup)}`);
    return { ok: true, ...feito, backup: path.basename(backup) };
  }

  // ------------------------------------------------------------------ Sede/Digital para as metas
  // Sede/Digital = complemento (oficial − lançadas pelos tutores), na granularidade comprovada:
  //  · um polo: cruzamento verificado (produto × polo selecionado) → por produto; senão, visão por polo → só o total do polo
  //  · rede: visão por produto → por produto; senão, visão por polo somada → só o total
  // Unidade agrupada com mais de um produto do sistema entra como "sem produto" (vai só no total).
  function complementoPosicao(p0, cache) {
    if (cache[p0.id]) return cache[p0.id];
    const p = lerPosicao(p0.id);
    const r = { id: p.id, data_posicao: p.data_posicao, hora_posicao: p.hora_posicao, unidades: calcular(p, p.linhas, null).unidades.filter(u => u.comparavel) };
    cache[p0.id] = r; return r;
  }
  // A partir da 29.6 a Sede/Digital vem SÓ da lista de alunos importada (planilha do Mundo Azul): aluno com R.A. que
  // não está lançado no sistema, no polo e no produto dele, na data do pagamento. Posições antigas (print/grade) ficam
  // guardadas no banco, sem uso no cálculo.
  function extrasSede(cicloId, poloId, data, cache = {}) {
    const k = `l|${poloId}|${data}`;
    if (cache[k]) return cache[k];
    const out = { porProduto: {}, semProduto: 0, fonte: null, posicoes: [] };
    const L = classificarLista(cicloId, data, cache);
    if (L.tem) {
      for (const [kk, q] of Object.entries(L.porPoloProduto)) { const [po, pr] = kk.split('|').map(Number); if (!poloId || po === Number(poloId)) out.porProduto[pr] = (out.porProduto[pr] || 0) + q; }
      out.fonte = 'lista'; out.lista = { produtos: [...L.cobertos] };
    }
    cache[k] = out; return out;
  }
  function extrasSedePosicoesAntigo(cicloId, poloId, data, cache = {}) {
    const k = `v|${poloId}|${data}`;
    if (cache[k]) return cache[k];
    const vs = vigentes(cicloId, data);
    const out = { porProduto: {}, semProduto: 0, fonte: null, posicoes: [] };
    const somaUnidades = (r) => { for (const u of r.unidades) { if (u.locais.length === 1) out.porProduto[u.locais[0]] = (out.porProduto[u.locais[0]] || 0) + u.complemento; else out.semProduto += u.complemento; } };
    const visaoPolo = vs.find(p => p.dimensao === 'polo' && p.escopo_tipo === 'rede');
    if (poloId) {
      const cruz = vs.find(p => p.dimensao === 'produto' && p.escopo_tipo === 'polo' && p.cruzamento_verificado && p.escopo_ids === String(poloId));
      if (cruz) {
        somaUnidades(complementoPosicao(cruz, cache)); out.fonte = 'cruzamento'; out.posicoes.push(cruz.id);
        // A visão por polo é o total oficial do polo. Se ela mostra mais Sede/Digital do que a leitura por produto
        // (produto que não apareceu no print do polo selecionado, ou prints de horários diferentes), a diferença
        // entra no total do polo como "produto não informado" — não se perde e não é inventada num produto.
        const u = visaoPolo && complementoPosicao(visaoPolo, cache).unidades.find(x => x.locais.length === 1 && x.locais[0] === Number(poloId));
        const somaCruz = Object.values(out.porProduto).reduce((a, n) => a + n, 0) + out.semProduto;
        if (u && u.complemento > somaCruz) { out.semProduto += u.complemento - somaCruz; out.diferenca_visoes = u.complemento - somaCruz; out.posicoes.push(visaoPolo.id); }
      }
      else if (visaoPolo) {
        const u = complementoPosicao(visaoPolo, cache).unidades.find(x => x.locais.length === 1 && x.locais[0] === Number(poloId));
        if (u) { out.semProduto = u.complemento; out.fonte = 'visao_polo'; out.posicoes.push(visaoPolo.id); }
        // Dedução: se na rede só UM produto tem Sede/Digital, o Sede/Digital do polo só pode ser desse produto
        // (desde que a soma dos polos sem leitura própria caiba no Sede/Digital da rede nesse produto).
        const visaoProd = vs.find(p => p.dimensao === 'produto' && p.escopo_tipo === 'rede');
        if (u && u.complemento && visaoProd) {
          const rp = complementoPosicao(visaoProd, cache).unidades.filter(x => x.complemento > 0);
          if (rp.length === 1 && rp[0].locais.length === 1) {
            const pid = rp[0].locais[0];
            const cruzOutros = vs.filter(p => p.dimensao === 'produto' && p.escopo_tipo === 'polo' && p.cruzamento_verificado && ids(p.escopo_ids).length === 1);
            const comCruz = new Set(cruzOutros.map(p => ids(p.escopo_ids)[0]));
            const usadoCruz = cruzOutros.reduce((a, p) => a + complementoPosicao(p, cache).unidades.filter(x => x.locais.length === 1 && x.locais[0] === pid).reduce((b, x) => b + x.complemento, 0), 0);
            const semCruz = complementoPosicao(visaoPolo, cache).unidades.filter(x => x.locais.length === 1 && !comCruz.has(x.locais[0])).reduce((a, x) => a + x.complemento, 0);
            if (semCruz <= rp[0].complemento - usadoCruz) {
              out.porProduto[pid] = u.complemento; out.semProduto = 0; out.fonte = 'deduzido'; out.deduzido = true; out.posicoes.push(visaoProd.id);
            }
          }
        }
      }
    } else {
      const visaoProd = vs.find(p => p.dimensao === 'produto' && p.escopo_tipo === 'rede');
      const cruzamentos = vs.filter(p => p.dimensao === 'produto' && p.escopo_tipo === 'polo' && p.cruzamento_verificado && ids(p.escopo_ids).length === 1);
      if (visaoProd) {
        somaUnidades(complementoPosicao(visaoProd, cache)); out.fonte = 'visao_produto'; out.posicoes.push(visaoProd.id);
        // mesma regra no consolidado: se a visão por polo somar mais Sede/Digital, a diferença entra sem produto
        if (visaoPolo) {
          const tp = complementoPosicao(visaoPolo, cache).unidades.reduce((a, x) => a + x.complemento, 0);
          const tprod = Object.values(out.porProduto).reduce((a, n) => a + n, 0) + out.semProduto;
          if (tp > tprod) { out.semProduto += tp - tprod; out.diferenca_visoes = tp - tprod; out.posicoes.push(visaoPolo.id); }
        }
      }
      else if (cruzamentos.length) {
        // sem visão por produto da rede: soma os polos lidos com o polo selecionado; os demais polos entram pelo total (visão por polo)
        const comCruz = new Set();
        for (const c of cruzamentos) { somaUnidades(complementoPosicao(c, cache)); out.posicoes.push(c.id); comCruz.add(ids(c.escopo_ids)[0]); }
        if (visaoPolo) {
          for (const u of complementoPosicao(visaoPolo, cache).unidades) if (!u.locais.some(l => comCruz.has(l))) out.semProduto += u.complemento;
          out.posicoes.push(visaoPolo.id);
        }
        out.fonte = 'cruzamentos';
      }
      else if (visaoPolo) { out.semProduto = complementoPosicao(visaoPolo, cache).unidades.reduce((a, u) => a + u.complemento, 0); out.fonte = 'visao_polo'; out.posicoes.push(visaoPolo.id); }
    }
    aplicarLista(cicloId, poloId, data, cache, out, vs);
    cache[k] = out; return out;
  }
  // A lista de alunos (quando importada) substitui a posição nos produtos que ela cobre, por polo × produto.
  // O total oficial do polo (visão por polo) continua valendo: o que sobrar fica como "produto não informado".
  function aplicarLista(cicloId, poloId, data, cache, out, vs) {
    const L = classificarLista(cicloId, data, cache);
    if (!L.tem || !L.cobertos.size) return;
    for (const pid of L.cobertos) {
      let n = 0;
      for (const [kk, q] of Object.entries(L.porPoloProduto)) { const [po, pr] = kk.split('|').map(Number); if (pr === pid && (!poloId || po === Number(poloId))) n += q; }
      if (n) out.porProduto[pid] = n; else delete out.porProduto[pid];
    }
    const visaoPolo = vs.find(p => p.dimensao === 'polo' && p.escopo_tipo === 'rede');
    if (visaoPolo) {
      const us = complementoPosicao(visaoPolo, cache).unidades;
      const oficial = poloId ? (us.find(x => x.locais.length === 1 && x.locais[0] === Number(poloId)) || { complemento: 0 }).complemento : us.reduce((a, x) => a + x.complemento, 0);
      const atribuido = Object.values(out.porProduto).reduce((a, n) => a + n, 0);
      out.semProduto = Math.max(oficial - atribuido, 0);
      if (!out.posicoes.includes(visaoPolo.id)) out.posicoes.push(visaoPolo.id);
    }
    out.lista = { produtos: [...L.cobertos] };
    if (!out.fonte) out.fonte = 'lista'; else out.fonte_lista = true;
  }
  const sedeLigada = (q) => q && (q.sede === '0' || q.sede === 0 || q.sede === false) ? false : q && (q.sede === '1' || q.sede === 1 || q.sede === true) ? true : (get("SELECT valor FROM config WHERE chave = 'incluir_sede_digital'") || { valor: '1' }).valor !== '0';

  // Quadro Sede/Digital por polo × produto numa data (relatório)
  function quadroSede(q, usuario) {
    const cicloId = Number(q.ciclo);
    if (!cicloId) falha(400, 'Selecione um processo');
    const ref = ISO.test(q.ref || '') ? q.ref : hojeISO();
    const restrito = filtroUsuario(usuario);
    const cache = {};
    const polos = all('SELECT id, nome FROM polos WHERE ativo = 1 ORDER BY ordem, nome').filter(p => !restrito || p.id === restrito);
    const linhas = polos.map(p => ({ polo_id: p.id, polo: p.nome, ...extrasSede(cicloId, p.id, ref, cache) }));
    const rede = restrito ? null : extrasSede(cicloId, 0, ref, cache);
    const det = (ids) => all(`SELECT id, data_posicao, hora_posicao, dimensao, escopo_tipo FROM ma_posicoes WHERE id IN (${ids.join(',') || 0})`);
    return { ref, linhas: linhas.map(l => ({ ...l, posicoes: det(l.posicoes) })), rede: rede ? { ...rede, posicoes: det(rede.posicoes) } : null };
  }

  
  function workerBoasVindasPendentes(limite=5){
    if(!autoWelcomeEnabled())return{itens:[]};
    const max=Math.max(1,Math.min(Number(limite)||5,20));
    const rows=all("SELECT id,ciclo_id,nome,ra,curso_cod,curso_nome,polo_fonte,celular,boas_vindas_chat_id FROM ma_lista_alunos WHERE ativo=1 AND ra<>'' AND celular IS NOT NULL AND celular<>'' AND boas_vindas_chat_status='PENDENTE' ORDER BY id LIMIT ?",max);
    return{itens:rows.map(r=>{const id=r.boas_vindas_chat_id||`matricula:${r.ciclo_id}:${r.id}`;if(!r.boas_vindas_chat_id)run('UPDATE ma_lista_alunos SET boas_vindas_chat_id=? WHERE id=?',id,r.id);return{id_externo:id,telefone:String(r.celular).replace(/\\D/g,''),nome:r.nome||'',mensagem:welcomeMessage(r)}})};
  }
  function workerBoasVindasResultado(c){
    const id=String(c.id_externo||'').trim();
    const status=String(c.status||'').toUpperCase();
    if(!id||!['ENVIADA','ERRO'].includes(status))falha(400,'Informe o envio e o status ENVIADA ou ERRO.');
    const row=get('SELECT id FROM ma_lista_alunos WHERE boas_vindas_chat_id=?',id);
    if(!row)falha(404,'Envio não encontrado.');
    if(status==='ENVIADA'){
      run("UPDATE ma_lista_alunos SET boas_vindas_chat_status='ENVIADA',boas_vindas_chat_erro=NULL,boas_vindas_em=COALESCE(boas_vindas_em,datetime('now','localtime')),boas_vindas_por=COALESCE(boas_vindas_por,'Worker automático') WHERE id=?",row.id);
    }else{
      run("UPDATE ma_lista_alunos SET boas_vindas_chat_status='ERRO',boas_vindas_chat_erro=? WHERE id=?",String(c.erro||'Falha no envio').slice(0,300),row.id);
    }
    return{ok:true};
  }
return { rotas, conciliacao, calcular, lerPosicao, norm, extrasSede, sedeLigada, quadroSede, classificarLista, listaResumo, previaLista, gravarLista, resetar, contarReset, raPorMatricula, workerBoasVindasPendentes, workerBoasVindasResultado };
};
