// Consulta da carteira, casos e fila de hoje — sempre dentro do escopo (instituição + unidades).
import { um, varios, executar, novoId, transacao, auditar } from './db.js';
import { ErroHttp, filtroUnidade, responsavelVisivel, casoVisivel } from './escopo.js';
import { hoje, diasEntre, mascararTelefone } from './util.js';
import { config } from './config.js';

// Situação "trabalhável" de um título: aberto, sem bloqueio e presente na última carteira.
export function estadoTitulo(t, org, dataHoje = hoje()) {
  const alertas = [];
  if (t.bloqueio === 'CONTESTADO') alertas.push({ codigo: 'CONTESTADO', texto: 'Contestado — contato pausado' });
  if (t.bloqueio === 'COMPROVANTE_EM_ANALISE') alertas.push({ codigo: 'COMPROVANTE', texto: 'Comprovante em análise — contato pausado' });
  if (t.ausente_desde_lote) alertas.push({ codigo: 'AUSENTE', texto: 'Não veio na última carteira — confirmar com a escola antes de negociar' });
  const idadeSaldo = diasEntre(t.saldo_referencia, dataHoje);
  if (t.situacao === 'ABERTO' && idadeSaldo > org.dias_saldo_valido) alertas.push({ codigo: 'DESATUALIZADO', texto: `Saldo de ${idadeSaldo} dias atrás — atualizar antes de negociar` });
  const negociavel = t.situacao === 'ABERTO' && !t.bloqueio && !t.ausente_desde_lote;
  return { negociavel, alertas, dias_atraso: t.situacao === 'ABERTO' ? Math.max(0, diasEntre(t.vencimento, dataHoje)) : 0, idade_saldo_dias: idadeSaldo };
}

function publicoTitulo(t, org) {
  return {
    id: t.id, id_origem: t.id_origem, unidade_id: t.unidade_id, unidade_nome: t.unidade_nome || null,
    aluno_id: t.aluno_id, aluno_nome: t.aluno_nome, aluno_matricula: t.aluno_matricula,
    competencia: t.competencia, vencimento: t.vencimento, valor_centavos: t.valor_centavos, saldo_centavos: t.saldo_centavos,
    situacao: t.situacao, bloqueio: t.bloqueio, saldo_referencia: t.saldo_referencia, ausente: Boolean(t.ausente_desde_lote),
    ...estadoTitulo(t, org),
  };
}

const SQL_TITULOS = `SELECT t.*, a.nome AS aluno_nome, a.matricula AS aluno_matricula, u.nome AS unidade_nome
  FROM titulos t JOIN alunos a ON a.id=t.aluno_id LEFT JOIN unidades u ON u.id=t.unidade_id`;

export function titulosDoResponsavel(escopo, responsavelId) {
  const f = filtroUnidade(escopo, 't.unidade_id');
  return varios(`${SQL_TITULOS} WHERE t.organizacao_id=? AND t.responsavel_id=? AND ${f.sql} ORDER BY t.vencimento`,
    escopo.org.id, responsavelId, ...f.params).map(t => publicoTitulo(t, escopo.org));
}

function publicoResponsavel(r, escopo) {
  const verContato = escopo.papel === 'ADMIN' || escopo.pode('dados.contato');
  return {
    id: r.id, chave_origem: r.chave_origem, nome: r.nome,
    telefone: verContato ? r.telefone : mascararTelefone(r.telefone),
    contato_autorizado: r.contato_autorizado === 1,
    documento_final: r.documento_final ? `•••${r.documento_final}` : null,
  };
}

export function listarCarteira(escopo, { busca = '', unidadeId = '', situacao = '', pagina = 1 } = {}) {
  const f = filtroUnidade(escopo, 't.unidade_id');
  const cond = ['r.organizacao_id=?'];
  const params = [escopo.org.id];
  const condT = [`t.organizacao_id=r.organizacao_id`, `t.responsavel_id=r.id`, f.sql];
  const paramsT = [...f.params];
  if (unidadeId) { condT.push('t.unidade_id=?'); paramsT.push(unidadeId); }
  if (busca) {
    const b = `%${String(busca).trim().toLowerCase()}%`;
    const dig = String(busca).replace(/\D/g, '');
    cond.push(`(lower(r.nome) LIKE ? OR r.chave_origem LIKE ? ${dig.length >= 4 ? 'OR r.telefone LIKE ?' : ''}
      OR EXISTS(SELECT 1 FROM vinculos v JOIN alunos a ON a.id=v.aluno_id WHERE v.responsavel_id=r.id AND (lower(a.nome) LIKE ? OR a.matricula LIKE ?)))`);
    params.push(b, b, ...(dig.length >= 4 ? [`%${dig}%`] : []), b, b);
  }
  const lim = 50, off = (Math.max(1, Number(pagina) || 1) - 1) * lim;
  const where = `${cond.join(' AND ')} AND EXISTS(SELECT 1 FROM titulos t WHERE ${condT.join(' AND ')}${situacao === 'ABERTO' ? " AND t.situacao='ABERTO'" : ''})`;
  const linhas = varios(`SELECT r.*,
      (SELECT COALESCE(SUM(t.saldo_centavos),0) FROM titulos t WHERE ${condT.join(' AND ')} AND t.situacao='ABERTO') AS saldo_aberto,
      (SELECT COUNT(*) FROM titulos t WHERE ${condT.join(' AND ')} AND t.situacao='ABERTO') AS titulos_abertos,
      (SELECT MIN(t.vencimento) FROM titulos t WHERE ${condT.join(' AND ')} AND t.situacao='ABERTO') AS vencimento_mais_antigo,
      (SELECT MIN(t.saldo_referencia) FROM titulos t WHERE ${condT.join(' AND ')} AND t.situacao='ABERTO') AS referencia_mais_antiga,
      (SELECT COUNT(*) FROM titulos t WHERE ${condT.join(' AND ')} AND (t.bloqueio IS NOT NULL OR t.ausente_desde_lote IS NOT NULL)) AS titulos_com_alerta,
      c.id AS caso_id
    FROM responsaveis r LEFT JOIN casos c ON c.responsavel_id=r.id AND c.organizacao_id=r.organizacao_id
    WHERE ${where} ORDER BY saldo_aberto DESC, r.nome LIMIT ? OFFSET ?`,
  ...paramsT, ...paramsT, ...paramsT, ...paramsT, ...paramsT, ...params, ...paramsT, lim, off);
  const total = um(`SELECT COUNT(*) n FROM responsaveis r WHERE ${where}`, ...params, ...paramsT).n;
  const dataHoje = hoje();
  return {
    total, pagina: Number(pagina) || 1, por_pagina: lim,
    itens: linhas.map(r => ({
      ...publicoResponsavel(r, escopo), caso_id: r.caso_id,
      saldo_aberto_centavos: r.saldo_aberto, titulos_abertos: r.titulos_abertos,
      dias_atraso: r.vencimento_mais_antigo ? Math.max(0, diasEntre(r.vencimento_mais_antigo, dataHoje)) : 0,
      saldo_desatualizado: r.referencia_mais_antiga ? diasEntre(r.referencia_mais_antiga, dataHoje) > escopo.org.dias_saldo_valido : false,
      titulos_com_alerta: r.titulos_com_alerta,
    })),
  };
}

export function resumoCarteira(escopo) {
  const f = filtroUnidade(escopo, 't.unidade_id');
  const r = um(`SELECT COUNT(DISTINCT t.responsavel_id) responsaveis, COUNT(*) titulos, COALESCE(SUM(t.saldo_centavos),0) saldo,
      MAX(t.saldo_referencia) ref_max, MIN(t.saldo_referencia) ref_min,
      SUM(CASE WHEN t.bloqueio IS NOT NULL OR t.ausente_desde_lote IS NOT NULL THEN 1 ELSE 0 END) alertas
    FROM titulos t WHERE t.organizacao_id=? AND t.situacao='ABERTO' AND ${f.sql}`, escopo.org.id, ...f.params);
  return { responsaveis: r.responsaveis, titulos_abertos: r.titulos, saldo_aberto_centavos: r.saldo, referencia_mais_recente: r.ref_max, referencia_mais_antiga: r.ref_min, titulos_com_alerta: r.alertas || 0 };
}

// ---------- Casos ----------

function travaAtiva(c, agora = Date.now()) { return c.trava_usuario_id && c.trava_ate && c.trava_ate > agora; }

export function detalheCaso(escopo, casoId) {
  const c = casoVisivel(escopo, casoId);
  const r = responsavelVisivel(escopo, c.responsavel_id);
  const f = filtroUnidade(escopo, 'al.unidade_id');
  const alunos = varios(`SELECT al.id, al.nome, al.matricula, un.nome AS unidade_nome FROM vinculos v JOIN alunos al ON al.id=v.aluno_id
                         LEFT JOIN unidades un ON un.id=al.unidade_id WHERE v.responsavel_id=? AND v.organizacao_id=? AND ${f.sql} ORDER BY al.nome`,
  r.id, escopo.org.id, ...f.params);
  const titulos = titulosDoResponsavel(escopo, r.id);
  const contatos = varios(`SELECT ct.*, u.nome AS usuario_nome FROM contatos ct JOIN usuarios u ON u.id=ct.usuario_id
                           WHERE ct.caso_id=? AND ct.organizacao_id=? ORDER BY ct.em DESC LIMIT 100`, c.id, escopo.org.id);
  const conversas = varios(`SELECT cv.id, cv.telefone, cv.verificada_em, cx.nome AS conexao_nome, cx.modo AS conexao_modo FROM conversas cv JOIN conexoes cx ON cx.id=cv.conexao_id
                            WHERE cv.caso_id=? AND cv.organizacao_id=? ORDER BY cv.atualizada_em DESC`, c.id, escopo.org.id);
  const usuarios = um('SELECT (SELECT nome FROM usuarios WHERE id=?) atendente, (SELECT nome FROM usuarios WHERE id=?) trava', c.atendente_id, c.trava_usuario_id);
  const negociaveis = titulos.filter(t => t.negociavel);
  return {
    id: c.id, status: c.status, organizacao: { id: escopo.org.id, nome: escopo.org.nome, regra_verificacao: escopo.org.regra_verificacao },
    responsavel: publicoResponsavel(r, escopo), alunos, titulos, contatos, conversas,
    atendente: c.atendente_id ? { id: c.atendente_id, nome: usuarios.atendente } : null,
    trava: travaAtiva(c) ? { usuario_id: c.trava_usuario_id, nome: usuarios.trava, ate: c.trava_ate } : null,
    proxima_acao: { em: c.proxima_acao_em, tipo: c.proxima_acao_tipo, nota: c.proxima_acao_nota },
    retorno_combinado_em: c.retorno_combinado_em,
    totais: {
      saldo_negociavel_centavos: negociaveis.reduce((s, t) => s + t.saldo_centavos, 0),
      titulos_negociaveis: negociaveis.length,
      titulos_pausados: titulos.filter(t => t.situacao === 'ABERTO' && !t.negociavel).length,
    },
  };
}

// Assume o caso por alguns minutos — impede que dois atendentes trabalhem/contatem o mesmo caso ao mesmo tempo.
export function assumirCaso(escopo, usuario, casoId, { forcar = false } = {}) {
  return transacao(() => {
    const c = casoVisivel(escopo, casoId);
    const agora = Date.now();
    if (travaAtiva(c, agora) && c.trava_usuario_id !== usuario.id) {
      const pode = forcar && (escopo.papel === 'ADMIN' || escopo.pode('fila.distribuir'));
      if (!pode) {
        const quem = um('SELECT nome FROM usuarios WHERE id=?', c.trava_usuario_id)?.nome;
        throw new ErroHttp(409, `${quem || 'Outro atendente'} já está trabalhando este caso`, 'CASO_EM_USO');
      }
    }
    const ate = agora + config().travaMinutos * 60_000;
    executar('UPDATE casos SET trava_usuario_id=?, trava_ate=?, atendente_id=COALESCE(atendente_id, ?), atualizado_em=? WHERE id=? AND organizacao_id=?',
      usuario.id, ate, usuario.id, agora, c.id, escopo.org.id);
    if (forcar && c.trava_usuario_id && c.trava_usuario_id !== usuario.id) auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'CASO_TRAVA_ASSUMIDA_A_FORCA', alvoTipo: 'caso', alvoId: c.id, detalhes: { anterior: c.trava_usuario_id } });
    return { trava_ate: ate };
  });
}

export function liberarCaso(escopo, usuario, casoId) {
  const c = casoVisivel(escopo, casoId);
  if (c.trava_usuario_id === usuario.id) executar('UPDATE casos SET trava_usuario_id=NULL, trava_ate=NULL WHERE id=? AND organizacao_id=?', c.id, escopo.org.id);
  return { ok: true };
}

export function exigirTrava(escopo, usuario, caso) {
  if (!travaAtiva(caso) || caso.trava_usuario_id !== usuario.id) throw new ErroHttp(409, 'Assuma o caso antes de registrar ou enviar (evita contato duplicado)', 'SEM_TRAVA');
}

const RESULTADOS = ['SEM_RESPOSTA', 'RESPONDEU', 'RETORNO_COMBINADO', 'PROMESSA', 'RECUSA', 'NUMERO_INVALIDO', 'OUTRO'];
const CANAIS = ['WHATSAPP', 'TELEFONE', 'EMAIL', 'PRESENCIAL'];

// Registra tentativa/resposta/retorno/promessa e define a próxima ação (obrigatória, exceto em recusa/número inválido).
export function registrarContato(escopo, usuario, casoId, b) {
  return transacao(() => {
    const c = casoVisivel(escopo, casoId);
    exigirTrava(escopo, usuario, c);
    const resultado = String(b.resultado || '');
    if (!RESULTADOS.includes(resultado)) throw new ErroHttp(400, 'Resultado do contato inválido');
    const canal = String(b.canal || 'WHATSAPP');
    if (!CANAIS.includes(canal)) throw new ErroHttp(400, 'Canal inválido');
    const direcao = b.direcao === 'RECEPTIVO' ? 'RECEPTIVO' : 'ATIVO';
    let retornoEm = null, promessaData = null, promessaCentavos = null;
    if (resultado === 'RETORNO_COMBINADO') {
      retornoEm = Number(new Date(b.retorno_em));
      if (!retornoEm || retornoEm < Date.now() - 60_000) throw new ErroHttp(400, 'Informe data e hora futuras para o retorno combinado');
    }
    if (resultado === 'PROMESSA') {
      promessaData = String(b.promessa_data || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(promessaData) || promessaData < hoje()) throw new ErroHttp(400, 'Informe a data prometida (hoje ou futura)');
      promessaCentavos = Number.isInteger(b.promessa_centavos) && b.promessa_centavos > 0 ? b.promessa_centavos : null;
    }
    let proxima = b.proxima_acao_em ? String(b.proxima_acao_em) : null;
    if (resultado === 'RETORNO_COMBINADO') proxima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(retornoEm));
    if (resultado === 'PROMESSA' && !proxima) proxima = promessaData;
    const dispensaProxima = ['RECUSA', 'NUMERO_INVALIDO'].includes(resultado);
    if (!proxima && !dispensaProxima) throw new ErroHttp(400, 'Defina a próxima ação (data)');
    if (proxima && (!/^\d{4}-\d{2}-\d{2}$/.test(proxima) || proxima < hoje())) throw new ErroHttp(400, 'A próxima ação precisa ser hoje ou uma data futura');
    const id = novoId('ctt');
    const agora = Date.now();
    executar(`INSERT INTO contatos(id, organizacao_id, caso_id, usuario_id, canal, direcao, resultado, nota, promessa_data, promessa_centavos, retorno_em, em)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, escopo.org.id, c.id, usuario.id, canal, direcao, resultado, String(b.nota || '').slice(0, 2000) || null, promessaData, promessaCentavos, retornoEm, agora);
    executar(`UPDATE casos SET proxima_acao_em=?, proxima_acao_tipo=?, proxima_acao_nota=?, retorno_combinado_em=?, atendente_id=COALESCE(atendente_id, ?), atualizado_em=? WHERE id=? AND organizacao_id=?`,
      proxima, String(b.proxima_acao_tipo || (resultado === 'PROMESSA' ? 'CONFERIR_PROMESSA' : resultado === 'RETORNO_COMBINADO' ? 'RETORNO_COMBINADO' : 'NOVO_CONTATO')),
      String(b.proxima_acao_nota || '').slice(0, 500) || null, retornoEm, usuario.id, agora, c.id, escopo.org.id);
    auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'CONTATO_REGISTRADO', alvoTipo: 'caso', alvoId: c.id, detalhes: { resultado, canal, direcao } });
    return { id };
  });
}

export function distribuirCaso(escopo, usuario, casoId, atendenteId) {
  const c = casoVisivel(escopo, casoId);
  if (atendenteId) {
    const ok = um("SELECT 1 FROM acessos WHERE usuario_id=? AND organizacao_id=? AND papel IN ('ATENDENTE','SUPERVISOR')", atendenteId, escopo.org.id);
    if (!ok) throw new ErroHttp(400, 'Atendente sem acesso a esta instituição');
  }
  executar('UPDATE casos SET atendente_id=?, atualizado_em=? WHERE id=? AND organizacao_id=?', atendenteId || null, Date.now(), c.id, escopo.org.id);
  auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'CASO_DISTRIBUIDO', alvoTipo: 'caso', alvoId: c.id, detalhes: { atendenteId } });
  return { ok: true };
}

// ---------- Fila de hoje ----------
// Entra na fila: caso ABERTO, com saldo negociável > 0, próxima ação vencida/hoje (ou nunca trabalhado)
// e sem retorno combinado no futuro. Ordem: próxima ação mais antiga, depois maior atraso.
export function filaDeHoje(escopo, usuario, { unidadeId = '', atendente = '', atrasoMin = 0, incluirTravados = true } = {}, agora = Date.now()) {
  const dataHoje = hoje(agora);
  const f = filtroUnidade(escopo, 't.unidade_id');
  const condT = [`t.organizacao_id=c.organizacao_id`, `t.responsavel_id=c.responsavel_id`, `t.situacao='ABERTO'`, `t.bloqueio IS NULL`, `t.ausente_desde_lote IS NULL`, f.sql];
  const paramsT = [...f.params];
  if (unidadeId) { condT.push('t.unidade_id=?'); paramsT.push(unidadeId); }
  const cond = ['c.organizacao_id=?', "c.status='ABERTO'", '(c.proxima_acao_em IS NULL OR c.proxima_acao_em<=?)', '(c.retorno_combinado_em IS NULL OR c.retorno_combinado_em<=?)'];
  const params = [escopo.org.id, dataHoje, agora];
  if (atendente === 'meus') { cond.push('(c.atendente_id=? OR c.atendente_id IS NULL)'); params.push(usuario.id); }
  else if (atendente === 'sem') cond.push('c.atendente_id IS NULL');
  else if (atendente) { cond.push('c.atendente_id=?'); params.push(atendente); }
  const sub = `FROM titulos t WHERE ${condT.join(' AND ')}`;
  const linhas = varios(`SELECT c.*, r.nome AS resp_nome, r.telefone, r.contato_autorizado, ua.nome AS atendente_nome, ut.nome AS trava_nome,
       (SELECT SUM(t.saldo_centavos) ${sub}) AS saldo, (SELECT COUNT(*) ${sub}) AS qtd, (SELECT MIN(t.vencimento) ${sub}) AS venc,
       (SELECT MIN(t.saldo_referencia) ${sub}) AS ref,
       (SELECT MAX(em) FROM contatos ct WHERE ct.caso_id=c.id) AS ultimo_contato
     FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id AND r.organizacao_id=c.organizacao_id
     LEFT JOIN usuarios ua ON ua.id=c.atendente_id LEFT JOIN usuarios ut ON ut.id=c.trava_usuario_id
     WHERE ${cond.join(' AND ')} AND EXISTS(SELECT 1 ${sub})`,
  ...paramsT, ...paramsT, ...paramsT, ...paramsT, ...params, ...paramsT);
  let itens = linhas.map(c => ({
    caso_id: c.id, responsavel: c.resp_nome, telefone_mascarado: mascararTelefone(c.telefone), contato_autorizado: c.contato_autorizado === 1,
    saldo_negociavel_centavos: c.saldo, titulos: c.qtd, dias_atraso: Math.max(0, diasEntre(c.venc, dataHoje)),
    saldo_desatualizado: diasEntre(c.ref, dataHoje) > escopo.org.dias_saldo_valido,
    proxima_acao: { em: c.proxima_acao_em, tipo: c.proxima_acao_tipo, nota: c.proxima_acao_nota },
    atendente: c.atendente_id ? { id: c.atendente_id, nome: c.atendente_nome } : null,
    em_uso_por: c.trava_usuario_id && c.trava_ate > agora && c.trava_usuario_id !== usuario.id ? c.trava_nome : null,
    ultimo_contato_em: c.ultimo_contato,
  }));
  if (atrasoMin) itens = itens.filter(i => i.dias_atraso >= Number(atrasoMin));
  if (!incluirTravados) itens = itens.filter(i => !i.em_uso_por);
  itens.sort((a, b) => (a.proxima_acao.em || '0000') < (b.proxima_acao.em || '0000') ? -1 : (a.proxima_acao.em || '0000') > (b.proxima_acao.em || '0000') ? 1 : b.dias_atraso - a.dias_atraso);
  return { data: dataHoje, total: itens.length, itens };
}

export { publicoResponsavel };
