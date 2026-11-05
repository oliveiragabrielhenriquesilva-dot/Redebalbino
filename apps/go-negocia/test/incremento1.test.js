// Testes do incremento 1 — duas instituições fictícias, um telefone em comum.
// Rodar: npm test   (banco temporário, conexões só de TESTE, nenhum envio real)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'go-negocia-teste-'));
process.env.GO_NEGOCIA_RUNTIME_DIR = tmp;
process.env.GO_NEGOCIA_ENVIO_REAL = '0';
process.env.META_APP_SECRET = 'segredo-de-teste';
process.env.GO_NEGOCIA_WEBHOOK_VERIFY_TOKEN = 'verificacao-teste';
process.env.GO_NEGOCIA_ADMIN_SENHA = '';

const { iniciar } = await import('../server.js');
const { arquivoDemo } = await import('../scripts/fixtures-sinteticas.js');
const { popular, SENHA_DEMO } = await import('../scripts/seed-sintetico.js');
const db = await import('../src/db.js');
const { filaDeHoje } = await import('../src/carteira.js');
const { exigirEscopo } = await import('../src/escopo.js');
const { hoje } = await import('../src/util.js');

let servidor, base, S;

async function entrar(login, senha = SENHA_DEMO) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, senha }) });
  const ck = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, cookie: ck };
}
function cliente(cookie) {
  return async (metodo, caminho, corpo) => {
    const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { cookie, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    let j = null; try { j = await r.json(); } catch { /* vazio */ }
    return { status: r.status, corpo: j };
  };
}
const usuarios = {};
const caso = (org, chave) => db.um('SELECT c.id FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE c.organizacao_id=? AND r.chave_origem=?', org, chave).id;
const b64 = arquivo => arquivoDemo(arquivo).toString('base64');

before(async () => {
  servidor = await iniciar({ dbFile: path.join(tmp, 'teste.sqlite'), porta: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${servidor.address().port}`;
  S = popular();
  for (const l of ['admin', 'supervisora', 'atendente.horizonte', 'atendente.centro', 'atendente.valeverde', 'representante.horizonte']) {
    const e = await entrar(l);
    assert.equal(e.status, 200, `login ${l}`);
    usuarios[l] = cliente(e.cookie);
  }
});
after(() => { servidor?.close(); db.fecharBanco(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('senha vazia ou errada é recusada; sem sessão a API responde 401', async () => {
  assert.equal((await entrar('admin', '')).status, 401);
  assert.equal((await entrar('admin', 'errada-errada')).status, 401);
  const anonimo = cliente('');
  assert.equal((await anonimo('GET', `/api/o/${S.hz}/carteira`)).status, 401);
});

test('importação: CSV e XLSX, válidos/repetidos/rejeitados com motivo', () => {
  assert.deepEqual([S.resumos.hz.total, S.resumos.hz.novos, S.resumos.hz.repetidos, S.resumos.hz.rejeitados], [12, 7, 1, 4]);
  assert.deepEqual([S.resumos.vv.total, S.resumos.vv.novos, S.resumos.vv.rejeitados], [3, 3, 0]);
  const motivos = db.varios("SELECT ll.motivo FROM lote_linhas ll JOIN lotes l ON l.id=ll.lote_id WHERE l.organizacao_id=? AND ll.status='REJEITADO' ORDER BY ll.linha", S.hz).map(r => r.motivo);
  assert.match(motivos[0], /Vencimento inválido/);
  assert.match(motivos[1], /Saldo negativo/);
  assert.match(motivos[2], /Unidade "NORTE" não cadastrada/);
  assert.match(motivos[3], /Nome do responsável vazio.*Situação desconhecida/);
  // Responsável, aluno e título separados; irmãos em unidades diferentes no mesmo responsável.
  const mariana = db.um("SELECT id, documento_final FROM responsaveis WHERE organizacao_id=? AND chave_origem='R-501'", S.hz);
  assert.equal(mariana.documento_final, '8901', 'só os 4 últimos dígitos do documento');
  const unidadesFilhos = db.varios('SELECT DISTINCT a.unidade_id FROM vinculos v JOIN alunos a ON a.id=v.aluno_id WHERE v.responsavel_id=?', mariana.id);
  assert.equal(unidadesFilhos.length, 2);
  // Valores em centavos
  assert.equal(db.um("SELECT saldo_centavos s FROM titulos WHERE organizacao_id=? AND id_origem='HZ-1011'", S.hz).s, 62500);
  assert.equal(db.um("SELECT saldo_centavos s FROM titulos WHERE organizacao_id=? AND id_origem='VV-78'", S.vv).s, 44550);
});

test('reimportar o mesmo arquivo não duplica', async () => {
  const sup = usuarios.supervisora;
  const antes = db.um('SELECT (SELECT COUNT(*) FROM titulos) t, (SELECT COUNT(*) FROM responsaveis) r, (SELECT COUNT(*) FROM alunos) a, (SELECT COUNT(*) FROM casos) c');
  const p = await sup('POST', `/api/o/${S.hz}/lotes`, { arquivo_nome: 'carteira-colegio-horizonte.csv', conteudo_base64: b64('carteira-colegio-horizonte.csv'), data_referencia: hoje() });
  assert.equal(p.status, 201);
  assert.equal(p.corpo.resumo.novos, 0);
  assert.equal(p.corpo.resumo.alterados, 0);
  assert.equal(p.corpo.resumo.sem_mudanca, 7);
  assert.ok(p.corpo.resumo.arquivo_ja_aplicado_em, 'avisa que o arquivo já foi aplicado');
  const a = await sup('POST', `/api/o/${S.hz}/lotes/${p.corpo.id}/aplicar`, {});
  assert.equal(a.status, 200);
  assert.deepEqual(db.um('SELECT (SELECT COUNT(*) FROM titulos) t, (SELECT COUNT(*) FROM responsaveis) r, (SELECT COUNT(*) FROM alunos) a, (SELECT COUNT(*) FROM casos) c'), antes);
  assert.equal((await sup('POST', `/api/o/${S.hz}/lotes/${p.corpo.id}/aplicar`, {})).status, 409, 'lote não é aplicado duas vezes');
});

test('carteira posterior: alteração gera histórico, ausência sinaliza sem dar baixa, arquivo antigo é rejeitado', async () => {
  const adm = usuarios.admin;
  const linhas = arquivoDemo('carteira-colegio-horizonte.csv').toString('utf8').split('\n');
  const novo = linhas.filter(l => !l.startsWith('HZ-1020')).map(l => l.startsWith('HZ-1011') ? l.replace(/;625,00;aberto/, ';300,00;aberto') : l).join('\n');
  const p = await adm('POST', `/api/o/${S.hz}/lotes`, { arquivo_nome: 'carteira-v2.csv', conteudo_base64: Buffer.from(novo).toString('base64'), data_referencia: hoje() });
  assert.equal(p.status, 201, JSON.stringify(p.corpo));
  assert.equal(p.corpo.resumo.alterados, 1);
  assert.equal(p.corpo.resumo.ausentes, 1);
  assert.deepEqual(p.corpo.resumo.ausentes_ids, ['HZ-1020']);
  // prévia não altera nada
  assert.equal(db.um("SELECT saldo_centavos s FROM titulos WHERE organizacao_id=? AND id_origem='HZ-1011'", S.hz).s, 62500);
  await adm('POST', `/api/o/${S.hz}/lotes/${p.corpo.id}/aplicar`, {});
  const t = db.um("SELECT * FROM titulos WHERE organizacao_id=? AND id_origem='HZ-1020'", S.hz);
  assert.equal(t.situacao, 'ABERTO', 'ausente continua em aberto (ausência não é pagamento)');
  assert.ok(t.ausente_desde_lote);
  const hist = db.um("SELECT h.de, h.para FROM titulo_historico h JOIN titulos t ON t.id=h.titulo_id WHERE t.id_origem='HZ-1011' AND h.campo='saldo_centavos'");
  assert.deepEqual([hist.de, hist.para], ['62500', '30000']);
  // Arquivo com data anterior ao saldo atual: linhas rejeitadas
  const ontem = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
  const velho = await adm('POST', `/api/o/${S.hz}/lotes`, { arquivo_nome: 'antigo.csv', conteudo_base64: b64('carteira-colegio-horizonte.csv'), data_referencia: ontem, escopo: 'PARCIAL' });
  assert.equal(velho.corpo.resumo.validos, 0);
  const l = await adm('GET', `/api/o/${S.hz}/lotes/${velho.corpo.id}?status=REJEITADO`);
  assert.ok(l.corpo.linhas.some(x => /mais antigo que o saldo atual/.test(x.motivo)));
  await adm('POST', `/api/o/${S.hz}/lotes/${velho.corpo.id}/descartar`, {});
  // Colunas obrigatórias ausentes
  const ruim = await adm('POST', `/api/o/${S.hz}/lotes`, { arquivo_nome: 'x.csv', conteudo_base64: Buffer.from('nome;valor\na;1').toString('base64'), data_referencia: hoje() });
  assert.equal(ruim.status, 400);
  assert.match(ruim.corpo.erro, /Colunas obrigatórias ausentes/);
  // Retorno financeiro ainda não existe neste incremento
  assert.equal((await adm('POST', `/api/o/${S.hz}/lotes`, { arquivo_nome: 'r.csv', conteudo_base64: b64('carteira-colegio-horizonte.csv'), data_referencia: hoje(), tipo: 'RETORNO' })).status, 501);
});

test('bloqueio de acesso cruzado por URL e API', async () => {
  const atB = usuarios['atendente.valeverde'];
  const casoMariana = caso(S.hz, 'R-501');
  const casoRogerio = caso(S.hz, 'R-504');
  // Atendente da Vale Verde não vê nada do Horizonte, nem trocando a instituição na URL
  assert.equal((await atB('GET', `/api/o/${S.hz}/carteira`)).status, 404);
  assert.equal((await atB('GET', `/api/o/${S.hz}/casos/${casoMariana}`)).status, 404);
  assert.equal((await atB('GET', `/api/o/${S.vv}/casos/${casoMariana}`)).status, 404, 'caso de outra instituição pela rota da própria instituição');
  assert.equal((await atB('POST', `/api/o/${S.vv}/casos/${casoMariana}/assumir`, {})).status, 404);
  const lotesHz = db.um('SELECT id FROM lotes WHERE organizacao_id=? LIMIT 1', S.hz).id;
  assert.equal((await atB('GET', `/api/o/${S.vv}/lotes/${lotesHz}`)).status, 403, 'atendente não vê lotes');
  assert.equal((await usuarios.supervisora('GET', `/api/o/${S.vv}/lotes/${lotesHz}`)).status, 404, 'lote do Horizonte pela rota da Vale Verde');
  const eu = await atB('GET', '/api/eu');
  assert.deepEqual(eu.corpo.instituicoes.map(i => i.organizacao_id), [S.vv]);
  // Atendente restrita à unidade Centro
  const atC = usuarios['atendente.centro'];
  const cm = await atC('GET', `/api/o/${S.hz}/casos/${casoMariana}`);
  assert.equal(cm.status, 200);
  assert.ok(cm.corpo.titulos.every(t => t.unidade_nome === 'Unidade Centro'), 'só títulos da unidade autorizada');
  assert.equal(cm.corpo.alunos.length, 1, 'só o filho da unidade autorizada');
  assert.equal((await atC('GET', `/api/o/${S.hz}/casos/${casoRogerio}`)).status, 404, 'responsável só da unidade Jardim');
  const cart = await atC('GET', `/api/o/${S.hz}/carteira`);
  assert.ok(!cart.corpo.itens.some(i => i.chave_origem === 'R-504'));
  assert.equal((await atC('POST', `/api/o/${S.hz}/lotes`, { arquivo_nome: 'a.csv', conteudo_base64: 'YQ==', data_referencia: hoje() })).status, 403);
  // Representante: vê carteira (com telefone mascarado), não opera fila nem conversa
  const rep = usuarios['representante.horizonte'];
  const rc = await rep('GET', `/api/o/${S.hz}/carteira`);
  assert.equal(rc.status, 200);
  assert.ok(rc.corpo.itens.every(i => !i.telefone || i.telefone.includes('•')));
  assert.equal((await rep('GET', `/api/o/${S.hz}/fila`)).status, 403);
  assert.equal((await rep('GET', `/api/o/${S.hz}/casos/${casoMariana}`)).status, 403);
  assert.equal((await rep('GET', `/api/o/${S.hz}/conversas`)).status, 403);
  assert.equal((await rep('GET', `/api/o/${S.vv}/carteira`)).status, 404);
  // Rotas de administração
  assert.equal((await usuarios.supervisora('GET', '/api/admin/usuarios')).status, 403);
  // Instituição inexistente e inexistente para o usuário respondem igual
  assert.equal((await atB('GET', '/api/o/org_naoexiste/carteira')).status, 404);
});

test('mesmo telefone em duas instituições: a conexão decide a instituição; candidatos só da própria', async () => {
  const sup = usuarios.supervisora;
  const tel = '00000000001';
  const rVV = await sup('POST', `/api/o/${S.vv}/teste/receber`, { conexao_id: S.conexoes.vv.id, telefone: tel, texto: 'Olá, quero falar do boleto' });
  assert.equal(rVV.status, 201);
  assert.equal(rVV.corpo.organizacaoId, S.vv);
  const cvVV = await sup('GET', `/api/o/${S.vv}/conversas/${rVV.corpo.conversaId}`);
  assert.deepEqual(cvVV.corpo.candidatos.map(c => c.nome), ['Demo VV-R1']);
  assert.equal(cvVV.corpo.caso, null, 'sem verificação não há títulos na conversa');
  // A conversa da Vale Verde não aparece no Horizonte, nem por ID direto
  assert.equal((await sup('GET', `/api/o/${S.hz}/conversas/${rVV.corpo.conversaId}`)).status, 404);
  assert.ok(!(await sup('GET', `/api/o/${S.hz}/conversas`)).corpo.some(c => c.id === rVV.corpo.conversaId));
  // Usar a conexão de outra instituição para simular é recusado
  assert.equal((await sup('POST', `/api/o/${S.hz}/teste/receber`, { conexao_id: S.conexoes.vv.id, telefone: tel, texto: 'x' })).status, 404);
  // Atendente de outra instituição não lê a conversa
  assert.equal((await usuarios['atendente.horizonte']('GET', `/api/o/${S.vv}/conversas/${rVV.corpo.conversaId}`)).status, 404);
});

test('fila de hoje respeita próxima ação, retorno combinado e trava', async () => {
  const atA = usuarios['atendente.horizonte'];
  const sup = usuarios.supervisora;
  const casoCarlos = caso(S.hz, 'R-502');
  const escopoAdmin = exigirEscopo({ id: S.usuarios.admin, admin: true }, S.hz);
  const naFila = (agora = Date.now()) => filaDeHoje(escopoAdmin, { id: S.usuarios.admin }, {}, agora).itens.map(i => i.caso_id);
  assert.ok(naFila().includes(casoCarlos));
  assert.ok(!naFila().includes(caso(S.hz, 'R-503')), 'título ausente da carteira pausa o caso');
  // Sem trava não registra
  assert.equal((await atA('POST', `/api/o/${S.hz}/casos/${casoCarlos}/contatos`, { resultado: 'SEM_RESPOSTA', proxima_acao_em: hoje() })).status, 409);
  assert.equal((await atA('POST', `/api/o/${S.hz}/casos/${casoCarlos}/assumir`, {})).status, 200);
  // Outro usuário não assume nem registra enquanto a trava vale
  const s1 = await sup('POST', `/api/o/${S.hz}/casos/${casoCarlos}/assumir`, {});
  assert.equal(s1.status, 409);
  assert.equal(s1.corpo.codigo, 'CASO_EM_USO');
  assert.equal((await sup('POST', `/api/o/${S.hz}/casos/${casoCarlos}/contatos`, { resultado: 'SEM_RESPOSTA', proxima_acao_em: hoje() })).status, 409);
  // Próxima ação obrigatória
  assert.equal((await atA('POST', `/api/o/${S.hz}/casos/${casoCarlos}/contatos`, { resultado: 'SEM_RESPOSTA' })).status, 400);
  const amanha = hoje(Date.now() + 86400000);
  assert.equal((await atA('POST', `/api/o/${S.hz}/casos/${casoCarlos}/contatos`, { canal: 'TELEFONE', resultado: 'SEM_RESPOSTA', proxima_acao_em: amanha })).status, 201);
  assert.ok(!naFila().includes(casoCarlos), 'com próxima ação amanhã sai da fila de hoje');
  assert.ok(naFila(Date.now() + 86400000).includes(casoCarlos), 'volta amanhã');
  // Retorno combinado em 3 dias: some da fila até lá e bloqueia contato ativo
  const retorno = Date.now() + 3 * 86400000;
  assert.equal((await atA('POST', `/api/o/${S.hz}/casos/${casoCarlos}/contatos`, { resultado: 'RETORNO_COMBINADO', retorno_em: new Date(retorno).toISOString() })).status, 201);
  assert.ok(!naFila(Date.now() + 86400000).includes(casoCarlos));
  assert.ok(naFila(retorno + 60000).includes(casoCarlos));
  const at = await atA('POST', `/api/o/${S.hz}/casos/${casoCarlos}/contato-ativo`, {});
  assert.equal(at.status, 409);
  assert.ok(at.corpo.bloqueios.some(b => b.codigo === 'RETORNO_COMBINADO'));
  // Supervisor pode assumir à força (fica auditado)
  assert.equal((await sup('POST', `/api/o/${S.hz}/casos/${casoCarlos}/assumir`, { forcar: true })).status, 200);
  assert.ok(db.um("SELECT 1 FROM auditoria WHERE acao='CASO_TRAVA_ASSUMIDA_A_FORCA'"));
});

test('contato ativo pela conexão da instituição correta, sem débito antes da confirmação', async () => {
  const atA = usuarios['atendente.horizonte'];
  const casoMariana = caso(S.hz, 'R-501');
  await atA('POST', `/api/o/${S.hz}/casos/${casoMariana}/assumir`, {});
  // Conexão de outra instituição é recusada
  assert.equal((await atA('POST', `/api/o/${S.hz}/casos/${casoMariana}/contato-ativo`, { conexao_id: S.conexoes.vv.id })).status, 404);
  const r = await atA('POST', `/api/o/${S.hz}/casos/${casoMariana}/contato-ativo`, {});
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.status, 'SIMULADA');
  assert.equal(r.corpo.conexao.id, S.conexoes.hz.id);
  const cv = db.um('SELECT * FROM conversas WHERE id=?', r.corpo.conversa_id);
  assert.equal(cv.organizacao_id, S.hz);
  assert.equal(cv.telefone, '5500000000001');
  const m = db.um("SELECT texto FROM mensagens WHERE conversa_id=? AND direcao='SAIDA'", cv.id).texto;
  assert.equal(m, 'Olá, Demo! Aqui é André, da GO Negocia. Somos a equipe de atendimento financeiro do Colégio Horizonte (fictício). Podemos falar com você por aqui sobre um assunto administrativo?');
  assert.doesNotMatch(m, /R\$|\d+,\d{2}/, 'primeiro contato sem valores');
  const escopoAdmin = exigirEscopo({ id: S.usuarios.admin, admin: true }, S.hz);
  const naFila = () => filaDeHoje(escopoAdmin, { id: S.usuarios.admin }, {}).itens.map(i => i.caso_id);
  assert.ok(!naFila().includes(casoMariana), 'após o contato ativo, aguarda resposta até amanhã');
  assert.ok(db.um("SELECT 1 FROM contatos WHERE caso_id=? AND direcao='ATIVO'", casoMariana), 'tentativa registrada no histórico');
  // Segundo contato ativo no mesmo dia é bloqueado (frequência)
  const r2 = await atA('POST', `/api/o/${S.hz}/casos/${casoMariana}/contato-ativo`, {});
  assert.equal(r2.status, 409);
  assert.ok(r2.corpo.bloqueios.some(b => b.codigo === 'CONTATO_RECENTE'));
  // Responsável sem autorização de contato
  const casoFernanda = db.um("SELECT c.id FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE r.chave_origem='R-503'").id;
  await atA('POST', `/api/o/${S.hz}/casos/${casoFernanda}/assumir`, {});
  const rf = await atA('POST', `/api/o/${S.hz}/casos/${casoFernanda}/contato-ativo`, {});
  assert.ok(rf.corpo.bloqueios.some(b => b.codigo === 'CONTATO_NAO_AUTORIZADO'));
  // A família responde: cai na MESMA conversa (mesma conexão + telefone) e no mesmo caso
  const sup = usuarios.supervisora;
  const resp = await sup('POST', `/api/o/${S.hz}/teste/receber`, { conexao_id: S.conexoes.hz.id, telefone: '00000000001', texto: 'Oi, sou a Mariana. Quero parcelar.' });
  assert.equal(resp.corpo.conversaId, cv.id);
  assert.ok(naFila().includes(casoMariana), 'resposta da família devolve o caso à fila de hoje');
  // Antes da confirmação, valores são bloqueados
  const v1 = await atA('POST', `/api/o/${S.hz}/conversas/${cv.id}/mensagens`, { texto: 'Seu débito é de R$ 3.480,00' });
  assert.equal(v1.status, 409);
  assert.equal(v1.corpo.codigo, 'DADOS_ANTES_DA_VERIFICACAO');
  assert.equal((await atA('POST', `/api/o/${S.hz}/conversas/${cv.id}/mensagens`, { texto: 'Pode me informar a matrícula de um dos alunos?' })).corpo.status, 'SIMULADA');
  const mariana = db.um("SELECT id FROM responsaveis WHERE organizacao_id=? AND chave_origem='R-501'", S.hz).id;
  const errada = await atA('POST', `/api/o/${S.hz}/conversas/${cv.id}/verificar`, { responsavel_id: mariana, matricula: 'VV-A1' });
  assert.equal(errada.status, 422);
  const ok = await atA('POST', `/api/o/${S.hz}/conversas/${cv.id}/verificar`, { responsavel_id: mariana, matricula: 'M-2002' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.caso_id, casoMariana);
  const det = await atA('GET', `/api/o/${S.hz}/conversas/${cv.id}`);
  assert.equal(det.corpo.caso.titulos.length, 3, 'após confirmação, os títulos dos dois filhos aparecem na conversa');
  assert.equal((await atA('POST', `/api/o/${S.hz}/conversas/${cv.id}/mensagens`, { texto: 'São 3 mensalidades, total de R$ 3.480,00.' })).status, 201);
  // O responsável da Vale Verde não pode ser vinculado a uma conversa do Horizonte
  const paulo = db.um("SELECT id FROM responsaveis WHERE chave_origem='VV-R1'").id;
  const novaHz = await sup('POST', `/api/o/${S.hz}/teste/receber`, { conexao_id: S.conexoes.hz.id, telefone: '16 91111-2222', texto: 'oi' });
  assert.equal((await sup('POST', `/api/o/${S.hz}/conversas/${novaHz.corpo.conversaId}/verificar`, { responsavel_id: paulo, matricula: 'VV-A1' })).status, 404);
});

test('API oficial: webhook com assinatura, instituição pela conexão, envio real desligado', async () => {
  const adm = usuarios.admin;
  const semToken = await adm('POST', `/api/admin/organizacoes/${S.hz}/conexoes`, { nome: 'Oficial HZ', modo: 'OFICIAL', phone_number_id: '1098765432' });
  assert.equal(semToken.status, 400, 'exige nome da variável do token');
  const cx = await adm('POST', `/api/admin/organizacoes/${S.hz}/conexoes`, { nome: 'Oficial HZ', modo: 'OFICIAL', phone_number_id: '1098765432', token_env: 'META_TOKEN_HZ', modelo_primeiro_contato: 'go_negocia_primeiro_contato' });
  assert.equal(cx.status, 201);
  assert.equal((await adm('POST', `/api/admin/organizacoes/${S.vv}/conexoes`, { nome: 'Dup', modo: 'OFICIAL', phone_number_id: '1098765432', token_env: 'META_TOKEN_VV' })).status, 409, 'o mesmo número não pode servir duas instituições');
  assert.equal(db.um('SELECT token_env FROM conexoes WHERE id=?', cx.corpo.id).token_env, 'META_TOKEN_HZ');
  // Verificação do webhook
  const g = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verificacao-teste&hub.challenge=42`);
  assert.equal(await g.text(), '42');
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1098765432' }, messages: [{ from: '5500000000001', id: 'wamid.T1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Recebi a mensagem' } }] } }] }] });
  const ruim = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, body: payload });
  assert.equal(ruim.status, 401);
  const assinatura = 'sha256=' + crypto.createHmac('sha256', 'segredo-de-teste').update(payload).digest('hex');
  const okw = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinatura }, body: payload });
  assert.equal(okw.status, 200);
  // repetição do mesmo evento não duplica
  await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinatura }, body: payload });
  const cvs = db.varios("SELECT cv.* FROM conversas cv WHERE cv.conexao_id=?", cx.corpo.id);
  assert.equal(cvs.length, 1);
  assert.equal(cvs[0].organizacao_id, S.hz);
  assert.equal(db.um("SELECT COUNT(*) n FROM mensagens WHERE conversa_id=?", cvs[0].id).n, 1);
  // Dentro da janela de 24h; envio real desligado => não chama a Meta
  const sup = usuarios.supervisora;
  const e = await sup('POST', `/api/o/${S.hz}/conversas/${cvs[0].id}/mensagens`, { texto: 'Olá! Pode confirmar a matrícula de um dos alunos?' });
  assert.equal(e.status, 201);
  assert.equal(e.corpo.status, 'NAO_ENVIADA_ENVIO_DESLIGADO');
  // Mensagem para phone_number_id desconhecido é ignorada (não cai em nenhuma instituição)
  const p2 = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [{ from: '5500000000001', id: 'wamid.X', timestamp: '1', type: 'text', text: { body: 'x' } }] } }] }] });
  await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', 'segredo-de-teste').update(p2).digest('hex') }, body: p2 });
  assert.equal(db.um("SELECT COUNT(*) n FROM mensagens WHERE id_externo='wamid.X'").n, 0);
});

test('API oficial com envio ligado: chamada à Meta usa a conexão e o token da instituição (Meta simulada)', async () => {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return original(url, opts);
    chamadas.push({ url: String(url), auth: opts.headers.Authorization, corpo: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.ENVIADA1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  process.env.GO_NEGOCIA_ENVIO_REAL = '1';
  process.env.META_TOKEN_HZ = 'token-ficticio-hz';
  try {
    const cv = db.um("SELECT cv.id FROM conversas cv JOIN conexoes cx ON cx.id=cv.conexao_id WHERE cx.phone_number_id='1098765432'");
    const r = await usuarios.supervisora('POST', `/api/o/${S.hz}/conversas/${cv.id}/mensagens`, { texto: 'Pode confirmar a matrícula de um dos alunos?' });
    assert.equal(r.corpo.status, 'ENVIADA');
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, 'https://graph.facebook.com/v23.0/1098765432/messages');
    assert.equal(chamadas[0].auth, 'Bearer token-ficticio-hz');
    assert.equal(chamadas[0].corpo.to, '5500000000001');
    assert.equal(db.um("SELECT id_externo FROM mensagens WHERE id=?", r.corpo.id).id_externo, 'wamid.ENVIADA1');
  } finally {
    globalThis.fetch = original;
    process.env.GO_NEGOCIA_ENVIO_REAL = '0';
    delete process.env.META_TOKEN_HZ;
  }
});

test('identidade GO Negocia: nome da escola dinâmico, variáveis do modelo, aliases de transição e assets', async () => {
  const { textoPrimeiroContato, variaveisPrimeiroContato, comPreposicao } = await import('../src/conversas.js');
  assert.equal(comPreposicao('Escola Vale Verde (fictícia)'), 'da Escola Vale Verde (fictícia)');
  assert.equal(comPreposicao('Colégio Horizonte'), 'do Colégio Horizonte');
  assert.equal(comPreposicao('Sesi Franca'), 'de Sesi Franca');
  assert.deepEqual(variaveisPrimeiroContato('Paulo Mendes', 'Escola Vale Verde (fictícia)', 'Bruno Atendente'), ['Paulo', 'Bruno', 'da Escola Vale Verde (fictícia)']);
  assert.match(textoPrimeiroContato('Paulo Mendes', 'Escola Vale Verde (fictícia)', 'Bruno Atendente'), /^Olá, Paulo! Aqui é Bruno, da GO Negocia\. Somos a equipe de atendimento financeiro da Escola Vale Verde \(fictícia\)\./);
  // Contato ativo real pela Vale Verde usa o nome da Vale Verde (não o do Horizonte)
  const atB = usuarios['atendente.valeverde'];
  const casoHelena = caso(S.vv, 'VV-R2');
  await atB('POST', `/api/o/${S.vv}/casos/${casoHelena}/assumir`, {});
  const r = await atB('POST', `/api/o/${S.vv}/casos/${casoHelena}/contato-ativo`, {});
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const m = db.um('SELECT texto FROM mensagens WHERE id=?', r.corpo.mensagem_id).texto;
  assert.match(m, /Aqui é Bruno, da GO Negocia\. Somos a equipe de atendimento financeiro da Escola Vale Verde/);
  assert.doesNotMatch(m, /Horizonte|R\$/);
  // Alias OLIVELO_* continua valendo quando o nome novo não está definido
  const { config } = await import('../src/config.js');
  process.env.OLIVELO_TRAVA_MINUTOS = '45';
  assert.equal(config().travaMinutos, 45);
  process.env.GO_NEGOCIA_TRAVA_MINUTOS = '20';
  assert.equal(config().travaMinutos, 20, 'nome novo tem prioridade');
  delete process.env.OLIVELO_TRAVA_MINUTOS; delete process.env.GO_NEGOCIA_TRAVA_MINUTOS;
  // Banco: se só existir o arquivo do nome anterior, ele continua em uso; senão, go-negocia.sqlite
  const pastaAntiga = fs.mkdtempSync(path.join(tmp, 'runtime-antigo-'));
  fs.writeFileSync(path.join(pastaAntiga, 'olivelo.sqlite'), '');
  process.env.GO_NEGOCIA_RUNTIME_DIR = pastaAntiga;
  assert.equal(path.basename(config().dbFile), 'olivelo.sqlite');
  process.env.GO_NEGOCIA_RUNTIME_DIR = fs.mkdtempSync(path.join(tmp, 'runtime-novo-'));
  assert.equal(path.basename(config().dbFile), 'go-negocia.sqlite');
  process.env.GO_NEGOCIA_RUNTIME_DIR = tmp;
  // Cookie do nome anterior ainda autentica; login novo emite go_negocia.sid e expira olivelo.sid
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'supervisora', senha: SENHA_DEMO }) });
  const cookies = login.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('go_negocia.sid=') && !c.includes('Max-Age=0')));
  assert.ok(cookies.some(c => c.startsWith('olivelo.sid=;') && c.includes('Max-Age=0')));
  const token = cookies.find(c => c.startsWith('go_negocia.sid=')).split(';')[0].split('=')[1];
  const antigo = await fetch(`${base}/api/eu`, { headers: { cookie: `olivelo.sid=${token}` } });
  assert.equal(antigo.status, 200);
  assert.equal((await antigo.json()).produto, 'GO Negocia');
  // Assets referenciados carregam; asset antigo saiu; página de erro é da marca
  for (const a of ['/brand/logo-go-negocia.png', '/brand/logo-go-negocia-negativo.png', '/brand/monograma-go-negativo.png', '/brand/favicon-32.png', '/brand/favicon-64.png', '/brand/apple-touch-icon.png', '/brand/icone-192.png', '/brand/icone-512.png', '/manifest.webmanifest']) {
    assert.equal((await fetch(base + a)).status, 200, a);
  }
  assert.equal((await fetch(base + '/brand/logo-olivelo.png')).status, 404, 'asset antigo removido');
  const e404 = await fetch(base + '/nao-existe.png', { headers: { accept: 'text/html' } });
  assert.equal(e404.status, 404);
  assert.match(await e404.text(), /GO Negocia/);
  const idx = await (await fetch(base + '/')).text();
  assert.match(idx, /<title>GO Negocia<\/title>/);
  assert.doesNotMatch(idx, /Olivelo/i);
});

test('auditoria registra ações sensíveis', () => {
  const acoes = new Set(db.varios('SELECT DISTINCT acao FROM auditoria').map(r => r.acao));
  for (const a of ['LOGIN', 'LOGIN_FALHOU', 'LOTE_PREVIA', 'LOTE_APLICADO', 'CONTATO_REGISTRADO', 'CONTATO_ATIVO_INICIADO', 'CONVERSA_VERIFICADA', 'VERIFICACAO_FALHOU', 'WEBHOOK_ASSINATURA_INVALIDA', 'MENSAGEM_SEM_CONEXAO']) assert.ok(acoes.has(a), a);
});

test('migração reversível', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const arq = path.join(tmp, 'migracao.sqlite');
  const d = new DatabaseSync(arq);
  d.close();
  // usa o módulo em outro arquivo: fecha o banco do servidor só no fim (último teste)
  servidor.close();
  db.abrirBanco(arq);
  assert.deepEqual(db.migrar(), ['001_base']);
  assert.equal(db.reverterUltima(), '001_base');
  assert.equal(db.um("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='titulos'").n, 0);
  assert.deepEqual(db.migrar(), ['001_base']);
});
