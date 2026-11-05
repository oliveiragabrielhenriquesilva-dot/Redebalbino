// Importação de carteira (arquivo de títulos em aberto enviado pela escola).
// Fluxo: prévia (nada muda na carteira) -> aplicar (transação única) . Reprocessar o mesmo arquivo não duplica.
// Linha ausente numa carteira posterior NÃO significa pagamento: o título só é sinalizado como ausente.

import crypto from 'node:crypto';
import { db, um, varios, executar, novoId, transacao, auditar } from './db.js';
import { lerPlanilha } from './planilha.js';
import { normalizarData, normalizarCompetencia, paraCentavos, normalizarTelefone, semAcento, hoje, dataValida } from './util.js';
import { ErroHttp } from './escopo.js';

const ALIASES = {
  id_titulo: ['id_titulo', 'titulo_id', 'id_origem', 'codigo_titulo', 'titulo'],
  unidade: ['unidade', 'codigo_unidade', 'unidade_codigo'],
  responsavel_id: ['responsavel_id', 'id_responsavel', 'codigo_responsavel'],
  responsavel_nome: ['responsavel_nome', 'nome_responsavel', 'responsavel'],
  responsavel_documento: ['responsavel_documento', 'documento', 'cpf'],
  telefone: ['telefone', 'celular', 'whatsapp', 'contato_telefone'],
  contato_autorizado: ['contato_autorizado', 'autoriza_contato', 'autorizado'],
  email: ['email', 'e_mail'],
  aluno_matricula: ['aluno_matricula', 'matricula', 'matricula_aluno'],
  aluno_nome: ['aluno_nome', 'nome_aluno', 'aluno'],
  competencia: ['competencia', 'referencia', 'mes_referencia'],
  vencimento: ['vencimento', 'data_vencimento'],
  valor: ['valor', 'valor_original'],
  saldo: ['saldo', 'saldo_aberto', 'valor_aberto', 'saldo_devedor'],
  situacao: ['situacao', 'status'],
};
const OBRIGATORIAS = ['id_titulo', 'responsavel_id', 'responsavel_nome', 'aluno_matricula', 'vencimento', 'saldo', 'situacao'];

const SITUACOES = {
  ABERTO: ['aberto', 'em aberto', 'vencido', 'a vencer', 'pendente', 'inadimplente'],
  PAGO: ['pago', 'quitado', 'liquidado', 'baixado'],
  CANCELADO: ['cancelado', 'cancelada', 'excluido'],
};

const LIMITE_LINHAS = 50000;

function chaveCabecalho(s) { return semAcento(s).replace(/[\s\-./]+/g, '_'); }

export function mapearCabecalho(cabecalho) {
  const mapa = {};
  cabecalho.forEach((c, i) => {
    const k = chaveCabecalho(c);
    for (const [campo, nomes] of Object.entries(ALIASES)) if (mapa[campo] == null && nomes.includes(k)) mapa[campo] = i;
  });
  const faltando = OBRIGATORIAS.filter(c => mapa[c] == null);
  return { mapa, faltando };
}

function situacaoDe(v) {
  const s = semAcento(v);
  for (const [k, nomes] of Object.entries(SITUACOES)) if (nomes.includes(s)) return k;
  return null;
}

function simNao(v) { return ['sim', 's', '1', 'true', 'x', 'yes'].includes(semAcento(v)); }

// Normaliza e valida uma linha (independente do banco).
function normalizarLinha(bruta, unidadesPorCodigo) {
  const motivos = [], avisos = [];
  const g = c => String(bruta[c] ?? '').trim();
  const d = {
    id_titulo: g('id_titulo'),
    unidade: g('unidade'),
    responsavel_id: g('responsavel_id'),
    responsavel_nome: g('responsavel_nome'),
    documento_final: null,
    telefone: null,
    contato_autorizado: 0,
    email: g('email') || null,
    aluno_matricula: g('aluno_matricula'),
    aluno_nome: g('aluno_nome') || null,
    competencia: null,
    vencimento: null,
    valor_centavos: null,
    saldo_centavos: null,
    situacao: null,
    unidade_id: null,
  };
  if (!d.id_titulo) motivos.push('ID do título vazio');
  if (!d.responsavel_id) motivos.push('Identificador do responsável vazio');
  if (!d.responsavel_nome) motivos.push('Nome do responsável vazio');
  if (!d.aluno_matricula) motivos.push('Matrícula do aluno vazia');
  if (d.unidade) {
    const u = unidadesPorCodigo.get(semAcento(d.unidade));
    if (!u) motivos.push(`Unidade "${d.unidade}" não cadastrada nesta instituição`);
    else d.unidade_id = u.id;
  }
  const doc = g('responsavel_documento').replace(/\D/g, '');
  if (doc) d.documento_final = doc.slice(-4); // só os 4 últimos dígitos são guardados
  const telBruto = g('telefone');
  if (telBruto) {
    d.telefone = normalizarTelefone(telBruto);
    if (!d.telefone) avisos.push('Telefone inválido — título importado sem contato');
  }
  d.contato_autorizado = d.telefone && simNao(g('contato_autorizado')) ? 1 : 0;
  const comp = normalizarCompetencia(g('competencia'));
  if (comp === undefined) motivos.push(`Competência inválida ("${g('competencia')}")`);
  else d.competencia = comp;
  d.vencimento = normalizarData(bruta.vencimento);
  if (!d.vencimento) motivos.push(`Vencimento inválido ("${g('vencimento')}")`);
  if (g('valor')) {
    d.valor_centavos = paraCentavos(bruta.valor);
    if (d.valor_centavos == null || d.valor_centavos < 0) motivos.push(`Valor inválido ("${g('valor')}")`);
  }
  d.saldo_centavos = paraCentavos(bruta.saldo);
  if (d.saldo_centavos == null) motivos.push(`Saldo inválido ("${g('saldo')}")`);
  else if (d.saldo_centavos < 0) motivos.push('Saldo negativo');
  d.situacao = situacaoDe(g('situacao'));
  if (!d.situacao) motivos.push(`Situação desconhecida ("${g('situacao')}")`);
  if (d.situacao === 'ABERTO' && d.saldo_centavos === 0) motivos.push('Situação em aberto com saldo zero');
  if (d.situacao === 'PAGO' || d.situacao === 'CANCELADO') d.saldo_centavos = 0;
  return { dados: d, motivos, avisos };
}

const CAMPOS_TITULO = ['unidade_id', 'competencia', 'vencimento', 'valor_centavos', 'saldo_centavos', 'situacao'];

function assinatura(d) {
  return JSON.stringify([d.id_titulo, d.unidade_id, d.responsavel_id, d.aluno_matricula, d.competencia, d.vencimento, d.valor_centavos, d.saldo_centavos, d.situacao]);
}

// Classifica as linhas contra o estado atual do banco. Não grava nada.
function analisar(orgId, linhasBrutas, dataReferencia, escopoLote) {
  const unidades = varios('SELECT id, codigo, nome FROM unidades WHERE organizacao_id=? AND ativa=1', orgId);
  const unidadesPorCodigo = new Map(unidades.map(u => [semAcento(u.codigo), u]));
  const resultado = linhasBrutas.map(l => ({ linha: l.linha, bruta: l.bruta, ...normalizarLinha(l.bruta, unidadesPorCodigo) }));

  // Repetidos dentro do arquivo: idênticos => REPETIDO (ignorado); conflitantes => todos rejeitados.
  const porId = new Map();
  for (const r of resultado) {
    if (!r.dados.id_titulo) continue;
    if (!porId.has(r.dados.id_titulo)) porId.set(r.dados.id_titulo, []);
    porId.get(r.dados.id_titulo).push(r);
  }
  for (const grupo of porId.values()) {
    if (grupo.length < 2) continue;
    const assinaturas = new Set(grupo.map(g => assinatura(g.dados)));
    if (assinaturas.size > 1) for (const g of grupo) g.motivos.push('ID do título repetido no arquivo com valores diferentes');
    else grupo.slice(1).forEach(g => { g.repetido = true; });
  }

  const tituloAtual = um.bind(null, `SELECT t.*, r.chave_origem AS resp_chave, a.matricula AS aluno_matricula
    FROM titulos t JOIN responsaveis r ON r.id=t.responsavel_id JOIN alunos a ON a.id=t.aluno_id
    WHERE t.organizacao_id=? AND t.id_origem=?`);

  for (const r of resultado) {
    if (r.motivos.length) { r.status = 'REJEITADO'; continue; }
    if (r.repetido) { r.status = 'REPETIDO'; r.motivos.push('Linha idêntica a outra do mesmo arquivo'); continue; }
    const atual = tituloAtual(orgId, r.dados.id_titulo);
    if (!atual) { r.status = 'NOVO'; continue; }
    if (atual.resp_chave !== r.dados.responsavel_id) { r.status = 'REJEITADO'; r.motivos.push(`Título já pertence a outro responsável (${atual.resp_chave}); confirme com a escola`); continue; }
    if (atual.aluno_matricula !== r.dados.aluno_matricula) { r.status = 'REJEITADO'; r.motivos.push(`Título já pertence a outro aluno (matrícula ${atual.aluno_matricula})`); continue; }
    if (atual.saldo_referencia > dataReferencia) { r.status = 'REJEITADO'; r.motivos.push(`Arquivo mais antigo que o saldo atual (referência ${atual.saldo_referencia})`); continue; }
    const mudou = CAMPOS_TITULO.filter(c => (atual[c] ?? null) !== (r.dados[c] ?? null));
    r.alteracoes = mudou.map(c => ({ campo: c, de: atual[c], para: r.dados[c] }));
    r.status = mudou.length ? 'ALTERADO' : 'SEM_MUDANCA';
  }

  // Ausentes: só em carteira COMPLETA, e só nas unidades que aparecem no arquivo.
  let ausentes = [];
  if (escopoLote === 'COMPLETA') {
    const validos = resultado.filter(r => ['NOVO', 'ALTERADO', 'SEM_MUDANCA', 'REPETIDO'].includes(r.status));
    const ids = new Set(validos.map(r => r.dados.id_titulo));
    const unidadesNoArquivo = new Set(validos.map(r => r.dados.unidade_id || '__sem__'));
    ausentes = varios("SELECT id, id_origem, unidade_id FROM titulos WHERE organizacao_id=? AND situacao='ABERTO'", orgId)
      .filter(t => unidadesNoArquivo.has(t.unidade_id || '__sem__') && !ids.has(t.id_origem));
  }
  return { resultado, ausentes };
}

function resumir(resultado, ausentes, extras = {}) {
  const cont = { NOVO: 0, ALTERADO: 0, SEM_MUDANCA: 0, REPETIDO: 0, REJEITADO: 0 };
  for (const r of resultado) cont[r.status]++;
  return {
    total: resultado.length,
    validos: cont.NOVO + cont.ALTERADO + cont.SEM_MUDANCA,
    novos: cont.NOVO, alterados: cont.ALTERADO, sem_mudanca: cont.SEM_MUDANCA,
    repetidos: cont.REPETIDO, rejeitados: cont.REJEITADO,
    com_aviso: resultado.filter(r => r.avisos.length).length,
    ausentes: ausentes.length,
    ausentes_ids: ausentes.slice(0, 50).map(a => a.id_origem),
    ...extras,
  };
}

export function criarPrevia({ escopo, usuario, arquivoNome, conteudo, dataReferencia, tipo = 'CARTEIRA', escopoLote = 'COMPLETA' }) {
  const orgId = escopo.org.id;
  if (tipo === 'RETORNO') throw new ErroHttp(501, 'Importação de retorno financeiro está prevista para o incremento 3.');
  if (tipo !== 'CARTEIRA') throw new ErroHttp(400, 'Tipo de arquivo inválido');
  if (!['COMPLETA', 'PARCIAL'].includes(escopoLote)) throw new ErroHttp(400, 'Escopo inválido');
  if (!dataValida(dataReferencia || '')) throw new ErroHttp(400, 'Informe a data de referência do arquivo (AAAA-MM-DD)');
  if (dataReferencia > hoje()) throw new ErroHttp(400, 'A data de referência não pode estar no futuro');
  if (!conteudo?.length) throw new ErroHttp(400, 'Arquivo vazio');
  if (conteudo.length > 15 * 1024 * 1024) throw new ErroHttp(413, 'Arquivo acima de 15 MB');

  let linhas;
  try { linhas = lerPlanilha(conteudo, arquivoNome); } catch (e) { throw new ErroHttp(400, `Não foi possível ler o arquivo: ${e.message}`); }
  if (linhas.length < 2) throw new ErroHttp(400, 'O arquivo não tem linhas de dados');
  if (linhas.length - 1 > LIMITE_LINHAS) throw new ErroHttp(413, `Arquivo com mais de ${LIMITE_LINHAS} linhas`);
  const { mapa, faltando } = mapearCabecalho(linhas[0]);
  if (faltando.length) throw new ErroHttp(400, `Colunas obrigatórias ausentes: ${faltando.join(', ')}`);

  const brutas = linhas.slice(1).map((cols, i) => {
    const bruta = {};
    for (const [campo, idx] of Object.entries(mapa)) bruta[campo] = cols[idx] ?? '';
    return { linha: i + 2, bruta };
  });

  const hash = crypto.createHash('sha256').update(conteudo).digest('hex');
  const jaAplicado = um("SELECT id, aplicado_em FROM lotes WHERE organizacao_id=? AND arquivo_hash=? AND status='APLICADO' ORDER BY aplicado_em DESC LIMIT 1", orgId, hash);
  const { resultado, ausentes } = analisar(orgId, brutas, dataReferencia, escopoLote);
  const resumo = resumir(resultado, ausentes, { arquivo_ja_aplicado_em: jaAplicado?.aplicado_em || null, colunas: Object.keys(mapa) });

  const loteId = novoId('lot');
  transacao(() => {
    executar(`INSERT INTO lotes(id, organizacao_id, tipo, escopo, arquivo_nome, arquivo_hash, data_referencia, usuario_id, status, resumo, criado_em)
              VALUES(?,?,?,?,?,?,?,?,'PREVIA',?,?)`, loteId, orgId, tipo, escopoLote, String(arquivoNome || 'arquivo').slice(0, 200), hash, dataReferencia, usuario.id, JSON.stringify(resumo), Date.now());
    const ins = db().prepare('INSERT INTO lote_linhas(lote_id, linha, status, motivo, dados) VALUES(?,?,?,?,?)');
    for (const r of resultado) {
      ins.run(loteId, r.linha, r.status, [...r.motivos, ...r.avisos].join(' · ') || null,
        JSON.stringify({ bruta: r.bruta, alteracoes: r.alteracoes || [] }));
    }
  });
  auditar({ usuarioId: usuario.id, organizacaoId: orgId, acao: 'LOTE_PREVIA', alvoTipo: 'lote', alvoId: loteId, detalhes: { arquivo: arquivoNome, ...resumo, ausentes_ids: undefined } });
  return { id: loteId, status: 'PREVIA', resumo };
}

export function aplicarLote({ escopo, usuario, loteId }) {
  const orgId = escopo.org.id;
  const lote = um('SELECT * FROM lotes WHERE organizacao_id=? AND id=?', orgId, loteId);
  if (!lote) throw new ErroHttp(404, 'Não encontrado');
  if (lote.status !== 'PREVIA') throw new ErroHttp(409, `Este lote já está ${lote.status === 'APLICADO' ? 'aplicado' : 'descartado'}`);

  return transacao(() => {
    const brutas = varios('SELECT linha, dados FROM lote_linhas WHERE lote_id=? ORDER BY linha', lote.id)
      .map(l => ({ linha: l.linha, bruta: JSON.parse(l.dados).bruta }));
    // Reanalisa dentro da transação: se a carteira mudou desde a prévia, vale o estado atual.
    const { resultado, ausentes } = analisar(orgId, brutas, lote.data_referencia, lote.escopo);
    const agora = Date.now();
    const respPorChave = new Map(), alunoPorMat = new Map();
    const responsaveisComAberto = new Set();

    const upsertResp = d => {
      if (respPorChave.has(d.responsavel_id)) return respPorChave.get(d.responsavel_id);
      let r = um('SELECT id FROM responsaveis WHERE organizacao_id=? AND chave_origem=?', orgId, d.responsavel_id);
      if (!r) {
        r = { id: novoId('rsp') };
        executar(`INSERT INTO responsaveis(id, organizacao_id, chave_origem, nome, documento_final, telefone, contato_autorizado, email, criado_em, atualizado_em)
                  VALUES(?,?,?,?,?,?,?,?,?,?)`, r.id, orgId, d.responsavel_id, d.responsavel_nome, d.documento_final, d.telefone, d.contato_autorizado, d.email, agora, agora);
      } else {
        executar(`UPDATE responsaveis SET nome=?, documento_final=COALESCE(?, documento_final), telefone=?, contato_autorizado=?, email=COALESCE(?, email), atualizado_em=?
                  WHERE id=? AND organizacao_id=?`, d.responsavel_nome, d.documento_final, d.telefone, d.contato_autorizado, d.email, agora, r.id, orgId);
      }
      respPorChave.set(d.responsavel_id, r.id);
      return r.id;
    };
    const upsertAluno = d => {
      if (alunoPorMat.has(d.aluno_matricula)) return alunoPorMat.get(d.aluno_matricula);
      let a = um('SELECT id FROM alunos WHERE organizacao_id=? AND matricula=?', orgId, d.aluno_matricula);
      if (!a) {
        a = { id: novoId('alu') };
        executar('INSERT INTO alunos(id, organizacao_id, matricula, nome, unidade_id) VALUES(?,?,?,?,?)', a.id, orgId, d.aluno_matricula, d.aluno_nome, d.unidade_id);
      } else {
        executar('UPDATE alunos SET nome=COALESCE(?, nome), unidade_id=COALESCE(?, unidade_id) WHERE id=? AND organizacao_id=?', d.aluno_nome, d.unidade_id, a.id, orgId);
      }
      alunoPorMat.set(d.aluno_matricula, a.id);
      return a.id;
    };
    const hist = db().prepare('INSERT INTO titulo_historico(organizacao_id, titulo_id, lote_id, usuario_id, campo, de, para, em) VALUES(?,?,?,?,?,?,?,?)');

    for (const r of resultado) {
      if (!['NOVO', 'ALTERADO', 'SEM_MUDANCA'].includes(r.status)) continue;
      const d = r.dados;
      const respId = upsertResp(d);
      const alunoId = upsertAluno(d);
      executar('INSERT OR IGNORE INTO vinculos(organizacao_id, responsavel_id, aluno_id) VALUES(?,?,?)', orgId, respId, alunoId);
      if (r.status === 'NOVO') {
        const tid = novoId('tit');
        executar(`INSERT INTO titulos(id, organizacao_id, id_origem, unidade_id, responsavel_id, aluno_id, competencia, vencimento, valor_centavos, saldo_centavos, situacao, saldo_referencia, ultimo_lote_id, criado_em, atualizado_em)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, tid, orgId, d.id_titulo, d.unidade_id, respId, alunoId, d.competencia, d.vencimento, d.valor_centavos, d.saldo_centavos, d.situacao, lote.data_referencia, lote.id, agora, agora);
        hist.run(orgId, tid, lote.id, usuario.id, 'criado', null, JSON.stringify({ saldo_centavos: d.saldo_centavos, situacao: d.situacao }), agora);
      } else {
        const t = um('SELECT id FROM titulos WHERE organizacao_id=? AND id_origem=?', orgId, d.id_titulo);
        for (const a of r.alteracoes || []) hist.run(orgId, t.id, lote.id, usuario.id, a.campo, a.de == null ? null : String(a.de), a.para == null ? null : String(a.para), agora);
        executar(`UPDATE titulos SET unidade_id=?, competencia=?, vencimento=?, valor_centavos=?, saldo_centavos=?, situacao=?, saldo_referencia=?, ausente_desde_lote=NULL, ultimo_lote_id=?, atualizado_em=?
                  WHERE id=? AND organizacao_id=?`, d.unidade_id, d.competencia, d.vencimento, d.valor_centavos, d.saldo_centavos, d.situacao, lote.data_referencia, lote.id, agora, t.id, orgId);
      }
      if (d.situacao === 'ABERTO') responsaveisComAberto.add(respId);
    }

    for (const a of ausentes) {
      executar('UPDATE titulos SET ausente_desde_lote=COALESCE(ausente_desde_lote, ?), atualizado_em=? WHERE id=? AND organizacao_id=?', lote.id, agora, a.id, orgId);
      hist.run(orgId, a.id, lote.id, usuario.id, 'ausente_na_carteira', null, lote.id, agora);
    }

    for (const respId of responsaveisComAberto) {
      executar(`INSERT OR IGNORE INTO casos(id, organizacao_id, responsavel_id, status, criado_em, atualizado_em) VALUES(?,?,?,'ABERTO',?,?)`, novoId('cas'), orgId, respId, agora, agora);
    }

    // Atualiza a classificação final de cada linha (pode ter mudado desde a prévia).
    const upd = db().prepare('UPDATE lote_linhas SET status=?, motivo=? WHERE lote_id=? AND linha=?');
    for (const r of resultado) upd.run(r.status, [...r.motivos, ...r.avisos].join(' · ') || null, lote.id, r.linha);
    const resumo = resumir(resultado, ausentes, { ...JSON.parse(lote.resumo), aplicado: true });
    resumo.ausentes = ausentes.length; resumo.ausentes_ids = ausentes.slice(0, 50).map(a => a.id_origem);
    executar("UPDATE lotes SET status='APLICADO', aplicado_em=?, resumo=? WHERE id=?", agora, JSON.stringify(resumo), lote.id);
    auditar({ usuarioId: usuario.id, organizacaoId: orgId, acao: 'LOTE_APLICADO', alvoTipo: 'lote', alvoId: lote.id, detalhes: { novos: resumo.novos, alterados: resumo.alterados, rejeitados: resumo.rejeitados, ausentes: resumo.ausentes } });
    return { id: lote.id, status: 'APLICADO', resumo };
  });
}

export function descartarLote({ escopo, usuario, loteId }) {
  const lote = um('SELECT * FROM lotes WHERE organizacao_id=? AND id=?', escopo.org.id, loteId);
  if (!lote) throw new ErroHttp(404, 'Não encontrado');
  if (lote.status !== 'PREVIA') throw new ErroHttp(409, 'Só é possível descartar uma prévia');
  executar("UPDATE lotes SET status='DESCARTADO' WHERE id=?", lote.id);
  auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'LOTE_DESCARTADO', alvoTipo: 'lote', alvoId: lote.id });
  return { id: lote.id, status: 'DESCARTADO' };
}

export function obterLote(escopo, loteId, { status = null, limite = 500 } = {}) {
  const lote = um('SELECT l.*, u.nome AS usuario_nome FROM lotes l JOIN usuarios u ON u.id=l.usuario_id WHERE l.organizacao_id=? AND l.id=?', escopo.org.id, loteId);
  if (!lote) throw new ErroHttp(404, 'Não encontrado');
  const linhas = varios(`SELECT linha, status, motivo, dados FROM lote_linhas WHERE lote_id=? ${status ? 'AND status=?' : ''} ORDER BY linha LIMIT ?`,
    ...(status ? [lote.id, status, limite] : [lote.id, limite])).map(l => {
    const d = JSON.parse(l.dados);
    return { linha: l.linha, status: l.status, motivo: l.motivo, id_titulo: d.bruta.id_titulo, responsavel: d.bruta.responsavel_nome, aluno: d.bruta.aluno_matricula, saldo: d.bruta.saldo, alteracoes: d.alteracoes };
  });
  return { ...publicoLote(lote), linhas };
}

export function publicoLote(l) {
  return { id: l.id, tipo: l.tipo, escopo: l.escopo, arquivo_nome: l.arquivo_nome, data_referencia: l.data_referencia, status: l.status, resumo: JSON.parse(l.resumo), criado_em: l.criado_em, aplicado_em: l.aplicado_em, usuario_nome: l.usuario_nome };
}

export function listarLotes(escopo) {
  return varios('SELECT l.*, u.nome AS usuario_nome FROM lotes l JOIN usuarios u ON u.id=l.usuario_id WHERE l.organizacao_id=? ORDER BY l.criado_em DESC LIMIT 100', escopo.org.id).map(publicoLote);
}
