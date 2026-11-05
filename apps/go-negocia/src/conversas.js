// Conversas de WhatsApp: recebimento (receptivo), primeiro contato (ativo), verificação de identidade e envio.
// A instituição de uma mensagem recebida vem SEMPRE da conexão que a recebeu — nunca do telefone.
import { um, varios, executar, novoId, transacao, auditar } from './db.js';
import { ErroHttp, casoVisivel, responsavelVisivel } from './escopo.js';
import { detalheCaso, exigirTrava } from './carteira.js';
import { config } from './config.js';
import { mascararTelefone, normalizarTelefone, hoje } from './util.js';
import * as oficial from './canais/oficial.js';

const JANELA_24H = 24 * 3600_000;
const INTERVALO_MINIMO_ATIVO = 24 * 3600_000; // política do piloto: no máximo 1 contato ativo por caso a cada 24h
const PARECE_DEBITO = /R\$|\b\d{1,3}(\.\d{3})*,\d{2}\b|d[ée]bito|em atraso|inadimpl|mensalidade[s]? (vencida|atrasada|em aberto)|saldo devedor/i;

export function conexoesDaOrg(orgId) {
  return varios('SELECT id, nome, modo, numero_exibicao, phone_number_id, modelo_primeiro_contato, ativa FROM conexoes WHERE organizacao_id=? ORDER BY nome', orgId);
}

// ----- Recebimento -----
export function receberMensagem({ modo, phoneNumberId, telefone, texto, idExterno, em = Date.now() }) {
  const conexao = um('SELECT * FROM conexoes WHERE modo=? AND phone_number_id=? AND ativa=1', modo, String(phoneNumberId || ''));
  if (!conexao) {
    auditar({ acao: 'MENSAGEM_SEM_CONEXAO', detalhes: { modo, phoneNumberId: String(phoneNumberId || '').slice(0, 40) } });
    return { ignorada: true, motivo: 'CONEXAO_DESCONHECIDA' };
  }
  const tel = normalizarTelefone(telefone) || String(telefone || '').replace(/\D/g, '');
  if (!tel) return { ignorada: true, motivo: 'TELEFONE_INVALIDO' };
  const orgId = conexao.organizacao_id;
  return transacao(() => {
    let conversa = um('SELECT * FROM conversas WHERE conexao_id=? AND telefone=?', conexao.id, tel);
    if (!conversa) {
      conversa = { id: novoId('cnv') };
      executar('INSERT INTO conversas(id, organizacao_id, conexao_id, telefone, criada_em, atualizada_em) VALUES(?,?,?,?,?,?)', conversa.id, orgId, conexao.id, tel, em, em);
    } else executar('UPDATE conversas SET atualizada_em=? WHERE id=?', em, conversa.id);
    if (idExterno && um('SELECT 1 FROM mensagens WHERE conversa_id=? AND id_externo=?', conversa.id, idExterno)) return { duplicada: true, conversaId: conversa.id, organizacaoId: orgId };
    executar("INSERT INTO mensagens(id, organizacao_id, conversa_id, direcao, texto, id_externo, status, em) VALUES(?,?,?,'ENTRADA',?,?,'RECEBIDA',?)",
      novoId('msg'), orgId, conversa.id, String(texto || '').slice(0, 4096), idExterno || null, em);
    // Receptivo e ativo trabalham o mesmo caso: resposta da família põe o caso na fila de hoje.
    const casoId = um('SELECT caso_id FROM conversas WHERE id=?', conversa.id)?.caso_id;
    if (casoId) executar("UPDATE casos SET proxima_acao_em=?, proxima_acao_tipo='RESPONDER_MENSAGEM', atualizado_em=? WHERE id=? AND organizacao_id=?", hoje(em), Date.now(), casoId, orgId);
    return { conversaId: conversa.id, organizacaoId: orgId };
  });
}

// ----- Consulta -----
export function listarConversas(escopo) {
  const linhas = varios(`SELECT cv.*, cx.nome AS conexao_nome, cx.modo AS conexao_modo, r.nome AS resp_nome,
      (SELECT texto FROM mensagens m WHERE m.conversa_id=cv.id ORDER BY em DESC LIMIT 1) AS ultima,
      (SELECT direcao FROM mensagens m WHERE m.conversa_id=cv.id ORDER BY em DESC LIMIT 1) AS ultima_direcao
    FROM conversas cv JOIN conexoes cx ON cx.id=cv.conexao_id
    LEFT JOIN casos c ON c.id=cv.caso_id LEFT JOIN responsaveis r ON r.id=c.responsavel_id
    WHERE cv.organizacao_id=? ORDER BY cv.atualizada_em DESC LIMIT 200`, escopo.org.id);
  const visiveis = [];
  for (const cv of linhas) {
    if (cv.caso_id) { try { casoVisivel(escopo, cv.caso_id); } catch { continue; } }
    else if (!escopo.todasUnidades) continue; // conversa sem vínculo não tem unidade: só quem vê todas as unidades
    visiveis.push({
      id: cv.id, telefone: cv.telefone, conexao: { nome: cv.conexao_nome, modo: cv.conexao_modo }, caso_id: cv.caso_id,
      responsavel: cv.resp_nome, verificada: Boolean(cv.verificada_em), atualizada_em: cv.atualizada_em,
      ultima: cv.verificada_em ? cv.ultima : (cv.ultima || '').slice(0, 80), ultima_direcao: cv.ultima_direcao,
    });
  }
  return visiveis;
}

function conversaVisivel(escopo, conversaId) {
  const cv = um('SELECT cv.*, cx.modo, cx.nome AS conexao_nome FROM conversas cv JOIN conexoes cx ON cx.id=cv.conexao_id WHERE cv.organizacao_id=? AND cv.id=?', escopo.org.id, String(conversaId || ''));
  if (!cv) throw new ErroHttp(404, 'Não encontrado');
  if (cv.caso_id) casoVisivel(escopo, cv.caso_id);
  else if (!escopo.todasUnidades) throw new ErroHttp(404, 'Não encontrado');
  return cv;
}

export function detalheConversa(escopo, conversaId) {
  const cv = conversaVisivel(escopo, conversaId);
  const mensagens = varios(`SELECT m.id, m.direcao, m.texto, m.status, m.erro, m.em, u.nome AS usuario_nome FROM mensagens m LEFT JOIN usuarios u ON u.id=m.usuario_id
                            WHERE m.conversa_id=? AND m.organizacao_id=? ORDER BY m.em, m.rowid`, cv.id, escopo.org.id);
  // Candidatos: só nesta instituição. Serve de dica; o vínculo exige verificação.
  const candidatos = cv.verificada_em ? [] : cv.caso_id
    ? varios('SELECT r.id, r.nome FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE c.id=? AND c.organizacao_id=?', cv.caso_id, escopo.org.id)
    : varios('SELECT id, nome FROM responsaveis WHERE organizacao_id=? AND telefone=?', escopo.org.id, cv.telefone)
    .filter(r => { try { responsavelVisivel(escopo, r.id); return true; } catch { return false; } });
  const ultimaEntrada = um("SELECT MAX(em) em FROM mensagens WHERE conversa_id=? AND direcao='ENTRADA'", cv.id)?.em || null;
  return {
    id: cv.id, telefone: cv.telefone, conexao: { id: cv.conexao_id, nome: cv.conexao_nome, modo: cv.modo },
    caso_id: cv.caso_id, verificada: Boolean(cv.verificada_em), verificada_em: cv.verificada_em,
    regra_verificacao: escopo.org.regra_verificacao, organizacao: escopo.org.nome,
    candidatos, mensagens,
    janela_aberta_ate: ultimaEntrada ? ultimaEntrada + JANELA_24H : null,
    caso: cv.caso_id && cv.verificada_em ? detalheCaso(escopo, cv.caso_id) : null,
  };
}

// ----- Verificação de identidade -----
// Regra do piloto (configurável por instituição): MATRICULA_ALUNO — a pessoa informa a matrícula de um aluno vinculado.
export function verificarConversa(escopo, usuario, conversaId, { responsavel_id, matricula }) {
  const cv0 = conversaVisivel(escopo, conversaId);
  const r0 = responsavelVisivel(escopo, responsavel_id);
  if (escopo.org.regra_verificacao === 'MATRICULA_ALUNO') {
    const ok = um('SELECT 1 FROM vinculos v JOIN alunos a ON a.id=v.aluno_id WHERE v.organizacao_id=? AND v.responsavel_id=? AND a.matricula=?', escopo.org.id, r0.id, String(matricula || '').trim());
    if (!ok) {
      // fora de transação: a tentativa falha fica registrada
      auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'VERIFICACAO_FALHOU', alvoTipo: 'conversa', alvoId: cv0.id });
      throw new ErroHttp(422, 'A matrícula informada não confere com os alunos deste responsável', 'VERIFICACAO_FALHOU');
    }
  }
  return transacao(() => {
    const cv = conversaVisivel(escopo, conversaId);
    const r = responsavelVisivel(escopo, responsavel_id);
    let caso = um('SELECT * FROM casos WHERE organizacao_id=? AND responsavel_id=?', escopo.org.id, r.id);
    if (!caso) {
      caso = { id: novoId('cas') };
      executar("INSERT INTO casos(id, organizacao_id, responsavel_id, status, criado_em, atualizado_em) VALUES(?,?,?,'ABERTO',?,?)", caso.id, escopo.org.id, r.id, Date.now(), Date.now());
    }
    if (cv.caso_id && cv.caso_id !== caso.id) throw new ErroHttp(409, 'Esta conversa já está vinculada a outro responsável', 'CONVERSA_OUTRO_CASO');
    executar('UPDATE conversas SET caso_id=?, verificada_em=?, verificada_por=?, atualizada_em=? WHERE id=?', caso.id, Date.now(), usuario.id, Date.now(), cv.id);
    auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'CONVERSA_VERIFICADA', alvoTipo: 'conversa', alvoId: cv.id, detalhes: { responsavel_id: r.id, telefone_confere: r.telefone === cv.telefone } });
    return { caso_id: caso.id, telefone_confere: r.telefone === cv.telefone };
  });
}

// ----- Envio -----
async function despachar(conexao, para, { texto, modelo = false, variaveis = [] }) {
  if (conexao.modo === 'TESTE') return { status: 'SIMULADA', idExterno: null };
  if (!config().envioReal) return { status: 'NAO_ENVIADA_ENVIO_DESLIGADO', idExterno: null };
  try {
    const id = modelo ? await oficial.enviarModelo(conexao, para, variaveis) : await oficial.enviarTexto(conexao, para, texto);
    return { status: 'ENVIADA', idExterno: id };
  } catch (e) {
    return { status: 'FALHOU', idExterno: null, erro: e.message };
  }
}

function conexaoParaEnvio(escopo, conexaoId) {
  const ativas = varios('SELECT * FROM conexoes WHERE organizacao_id=? AND ativa=1', escopo.org.id);
  if (conexaoId) {
    const c = ativas.find(x => x.id === conexaoId);
    if (!c) throw new ErroHttp(404, 'Conexão não encontrada nesta instituição');
    return c;
  }
  if (!ativas.length) throw new ErroHttp(409, 'Esta instituição não tem conexão de WhatsApp ativa', 'SEM_CONEXAO');
  if (ativas.length > 1) throw new ErroHttp(400, 'Escolha a conexão de envio', 'ESCOLHER_CONEXAO');
  return ativas[0];
}

const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';

// "do Colégio X", "da Escola Y", "de Z": preposição a partir da primeira palavra do nome da instituição.
export function comPreposicao(nomeInstituicao) {
  const nome = String(nomeInstituicao || '').trim();
  const primeira = nome.split(/\s+/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const masc = ['colegio', 'instituto', 'centro', 'liceu', 'educandario', 'ginasio', 'curso', 'sistema', 'grupo', 'complexo'];
  const fem = ['escola', 'faculdade', 'universidade', 'creche', 'rede', 'associacao', 'fundacao', 'academia', 'casa'];
  return `${masc.includes(primeira) ? 'do' : fem.includes(primeira) ? 'da' : 'de'} ${nome}`;
}

// Apresentação do primeiro contato. Identifica atendente, GO Negocia e instituição; nunca traz valores.
// Na API oficial o texto equivalente é o modelo aprovado pela Meta (docs/modelos-whatsapp.md), com as mesmas 3 variáveis.
export function variaveisPrimeiroContato(nomeResponsavel, nomeInstituicao, nomeAtendente) {
  return [primeiroNome(nomeResponsavel), primeiroNome(nomeAtendente), comPreposicao(nomeInstituicao)];
}
export function textoPrimeiroContato(nomeResponsavel, nomeInstituicao, nomeAtendente) {
  const [resp, atendente, instituicao] = variaveisPrimeiroContato(nomeResponsavel, nomeInstituicao, nomeAtendente);
  return `Olá${resp ? `, ${resp}` : ''}! Aqui é ${atendente || 'a equipe'}, da GO Negocia. Somos a equipe de atendimento financeiro ${instituicao}. Podemos falar com você por aqui sobre um assunto administrativo?`;
}

// Verificações refeitas imediatamente antes de qualquer envio ativo.
export function bloqueiosDoEnvioAtivo(escopo, caso, agora = Date.now()) {
  const bloqueios = [];
  const det = detalheCaso(escopo, caso.id);
  if (caso.status !== 'ABERTO') bloqueios.push({ codigo: 'CASO_PAUSADO', texto: 'Caso pausado ou encerrado' });
  if (!det.responsavel.contato_autorizado) bloqueios.push({ codigo: 'CONTATO_NAO_AUTORIZADO', texto: 'A escola não autorizou contato por WhatsApp para este responsável' });
  if (det.totais.titulos_negociaveis === 0) bloqueios.push({ codigo: 'SEM_TITULO_NEGOCIAVEL', texto: 'Nenhum título em aberto sem pausa (pagos, contestados, em análise ou ausentes da carteira)' });
  if (det.titulos.some(t => t.negociavel && t.alertas.some(a => a.codigo === 'DESATUALIZADO'))) bloqueios.push({ codigo: 'SALDO_DESATUALIZADO', texto: 'Saldo desatualizado — importe a carteira atualizada antes do contato' });
  if (caso.retorno_combinado_em && caso.retorno_combinado_em > agora) bloqueios.push({ codigo: 'RETORNO_COMBINADO', texto: `Retorno combinado para ${new Date(caso.retorno_combinado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` });
  const ultimoAtivo = um(`SELECT MAX(m.em) em FROM mensagens m JOIN conversas cv ON cv.id=m.conversa_id WHERE cv.caso_id=? AND m.direcao='SAIDA' AND m.organizacao_id=?`, caso.id, escopo.org.id)?.em;
  if (ultimoAtivo && agora - ultimoAtivo < INTERVALO_MINIMO_ATIVO) bloqueios.push({ codigo: 'CONTATO_RECENTE', texto: 'Já houve mensagem enviada para este caso nas últimas 24 horas' });
  return { bloqueios, det };
}

export async function iniciarContatoAtivo(escopo, usuario, casoId, { conexao_id } = {}) {
  const caso = casoVisivel(escopo, casoId);
  exigirTrava(escopo, usuario, caso);
  const conexao = conexaoParaEnvio(escopo, conexao_id);
  const resp = um('SELECT * FROM responsaveis WHERE id=? AND organizacao_id=?', caso.responsavel_id, escopo.org.id);
  const { bloqueios } = bloqueiosDoEnvioAtivo(escopo, caso);
  if (!resp.telefone) bloqueios.push({ codigo: 'SEM_TELEFONE', texto: 'Responsável sem telefone válido' });
  if (conexao.modo === 'OFICIAL' && !conexao.modelo_primeiro_contato) bloqueios.push({ codigo: 'SEM_MODELO', texto: 'Conexão oficial sem modelo de primeiro contato aprovado' });
  if (bloqueios.length) throw Object.assign(new ErroHttp(409, bloqueios.map(b => b.texto).join(' · '), 'ENVIO_BLOQUEADO'), { extra: { bloqueios } });

  // Conversa (conexão + telefone) — se o número já está ligado a outro caso desta instituição, não mistura.
  let cv = um('SELECT * FROM conversas WHERE conexao_id=? AND telefone=?', conexao.id, resp.telefone);
  if (cv && cv.caso_id && cv.caso_id !== caso.id) throw new ErroHttp(409, 'Este número já conversa sobre outro responsável nesta instituição; resolva com o supervisor', 'TELEFONE_EM_OUTRO_CASO');
  const agora = Date.now();
  if (!cv) {
    cv = { id: novoId('cnv') };
    executar('INSERT INTO conversas(id, organizacao_id, conexao_id, telefone, caso_id, criada_em, atualizada_em) VALUES(?,?,?,?,?,?,?)', cv.id, escopo.org.id, conexao.id, resp.telefone, caso.id, agora, agora);
  } else executar('UPDATE conversas SET caso_id=?, atualizada_em=? WHERE id=?', caso.id, agora, cv.id);

  const nomeAtendente = um('SELECT nome FROM usuarios WHERE id=?', usuario.id)?.nome;
  const texto = textoPrimeiroContato(resp.nome, escopo.org.nome, nomeAtendente);
  const r = await despachar(conexao, resp.telefone, { texto, modelo: true, variaveis: variaveisPrimeiroContato(resp.nome, escopo.org.nome, nomeAtendente) });
  const msgId = novoId('msg');
  executar("INSERT INTO mensagens(id, organizacao_id, conversa_id, direcao, texto, id_externo, status, erro, usuario_id, em) VALUES(?,?,?,'SAIDA',?,?,?,?,?,?)",
    msgId, escopo.org.id, cv.id, texto, r.idExterno, r.status, r.erro || null, usuario.id, agora);
  // Registra a tentativa no histórico do caso e tira o caso da fila até amanhã (aguardando resposta).
  executar(`INSERT INTO contatos(id, organizacao_id, caso_id, usuario_id, canal, direcao, resultado, nota, em) VALUES(?,?,?,?,'WHATSAPP','ATIVO','SEM_RESPOSTA',?,?)`,
    novoId('ctt'), escopo.org.id, caso.id, usuario.id, `Primeiro contato enviado (${r.status.toLowerCase().replace(/_/g, ' ')})`, agora);
  executar("UPDATE casos SET proxima_acao_em=?, proxima_acao_tipo='AGUARDAR_RESPOSTA', proxima_acao_nota=NULL, atendente_id=COALESCE(atendente_id, ?), atualizado_em=? WHERE id=? AND organizacao_id=?",
    hoje(agora + 86400000), usuario.id, agora, caso.id, escopo.org.id);
  auditar({ usuarioId: usuario.id, organizacaoId: escopo.org.id, acao: 'CONTATO_ATIVO_INICIADO', alvoTipo: 'caso', alvoId: caso.id, detalhes: { conexao_id: conexao.id, modo: conexao.modo, status: r.status, para: mascararTelefone(resp.telefone) } });
  return { conversa_id: cv.id, mensagem_id: msgId, status: r.status, conexao: { id: conexao.id, nome: conexao.nome, modo: conexao.modo }, erro: r.erro || null };
}

export async function enviarMensagem(escopo, usuario, conversaId, { texto }) {
  const cv = conversaVisivel(escopo, conversaId);
  const t = String(texto || '').trim();
  if (!t) throw new ErroHttp(400, 'Mensagem vazia');
  if (t.length > 4096) throw new ErroHttp(400, 'Mensagem longa demais');
  if (cv.caso_id) {
    const caso = casoVisivel(escopo, cv.caso_id);
    exigirTrava(escopo, usuario, caso);
    if (caso.status !== 'ABERTO') throw new ErroHttp(409, 'Caso pausado ou encerrado', 'CASO_PAUSADO');
  }
  if (!cv.verificada_em && PARECE_DEBITO.test(t)) {
    throw new ErroHttp(409, 'Confirme a identidade do responsável antes de falar de valores ou débitos', 'DADOS_ANTES_DA_VERIFICACAO');
  }
  const conexao = um('SELECT * FROM conexoes WHERE id=? AND organizacao_id=?', cv.conexao_id, escopo.org.id);
  if (!conexao || conexao.ativa !== 1) throw new ErroHttp(409, 'Conexão desta conversa está inativa', 'SEM_CONEXAO');
  if (conexao.modo === 'OFICIAL') {
    const ultimaEntrada = um("SELECT MAX(em) em FROM mensagens WHERE conversa_id=? AND direcao='ENTRADA'", cv.id)?.em;
    if (!ultimaEntrada || Date.now() - ultimaEntrada > JANELA_24H) throw new ErroHttp(409, 'Fora da janela de 24h da API oficial: use o contato ativo com modelo aprovado', 'JANELA_24H');
  }
  const r = await despachar(conexao, cv.telefone, { texto: t });
  const id = novoId('msg');
  executar("INSERT INTO mensagens(id, organizacao_id, conversa_id, direcao, texto, id_externo, status, erro, usuario_id, em) VALUES(?,?,?,'SAIDA',?,?,?,?,?,?)",
    id, escopo.org.id, cv.id, t, r.idExterno, r.status, r.erro || null, usuario.id, Date.now());
  executar('UPDATE conversas SET atualizada_em=? WHERE id=?', Date.now(), cv.id);
  return { id, status: r.status, erro: r.erro || null };
}
