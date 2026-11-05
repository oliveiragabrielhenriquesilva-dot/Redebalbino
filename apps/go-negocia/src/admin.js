// Cadastro de instituições, unidades, usuários, acessos e conexões — exclusivo do Administrador da GO Negocia.
import { um, varios, executar, novoId, transacao, auditar } from './db.js';
import { ErroHttp } from './escopo.js';
import { criarUsuario, hashSenha } from './auth.js';
import crypto from 'node:crypto';

export function exigirAdmin(usuario) {
  if (!usuario) throw new ErroHttp(401, 'Sessão expirada. Entre novamente.', 'AUTH');
  if (!usuario.admin) throw new ErroHttp(403, 'Apenas o administrador da GO Negocia', 'PERMISSAO');
}

const texto = (v, max = 120) => String(v ?? '').trim().slice(0, max);

export function listarOrganizacoes() {
  return varios(`SELECT o.*, (SELECT COUNT(*) FROM unidades u WHERE u.organizacao_id=o.id) unidades,
    (SELECT COUNT(*) FROM acessos a WHERE a.organizacao_id=o.id) usuarios,
    (SELECT COUNT(*) FROM conexoes c WHERE c.organizacao_id=o.id AND c.ativa=1) conexoes
    FROM organizacoes o ORDER BY o.nome`);
}

export function criarOrganizacao(admin, b) {
  const nome = texto(b.nome);
  if (nome.length < 3) throw new ErroHttp(400, 'Informe o nome da instituição');
  const regra = ['MATRICULA_ALUNO'].includes(b.regra_verificacao) ? b.regra_verificacao : 'MATRICULA_ALUNO';
  const dias = Number.isInteger(b.dias_saldo_valido) && b.dias_saldo_valido > 0 && b.dias_saldo_valido <= 90 ? b.dias_saldo_valido : 7;
  const id = novoId('org');
  executar("INSERT INTO organizacoes(id, nome, tipo, regra_verificacao, dias_saldo_valido, ativa, criada_em) VALUES(?,?,'EDUCACAO',?,?,1,?)", id, nome, regra, dias, Date.now());
  auditar({ usuarioId: admin.id, organizacaoId: id, acao: 'ORGANIZACAO_CRIADA', detalhes: { nome } });
  return { id };
}

export function atualizarOrganizacao(admin, id, b) {
  const o = um('SELECT * FROM organizacoes WHERE id=?', id);
  if (!o) throw new ErroHttp(404, 'Não encontrado');
  const nome = b.nome != null ? texto(b.nome) : o.nome;
  const dias = Number.isInteger(b.dias_saldo_valido) ? Math.min(90, Math.max(1, b.dias_saldo_valido)) : o.dias_saldo_valido;
  const ativa = b.ativa == null ? o.ativa : (b.ativa ? 1 : 0);
  executar('UPDATE organizacoes SET nome=?, dias_saldo_valido=?, ativa=? WHERE id=?', nome, dias, ativa, id);
  auditar({ usuarioId: admin.id, organizacaoId: id, acao: 'ORGANIZACAO_ATUALIZADA', detalhes: { nome, dias, ativa } });
  return { ok: true };
}

export function listarUnidades(orgId) {
  return varios('SELECT id, nome, codigo, ativa FROM unidades WHERE organizacao_id=? ORDER BY nome', orgId);
}

export function criarUnidade(admin, orgId, b) {
  if (!um('SELECT 1 FROM organizacoes WHERE id=?', orgId)) throw new ErroHttp(404, 'Não encontrado');
  const nome = texto(b.nome), codigo = texto(b.codigo, 40);
  if (!nome || !codigo) throw new ErroHttp(400, 'Informe nome e código da unidade (o código é o usado no arquivo da escola)');
  if (um('SELECT 1 FROM unidades WHERE organizacao_id=? AND lower(codigo)=lower(?)', orgId, codigo)) throw new ErroHttp(409, 'Já existe unidade com este código');
  const id = novoId('uni');
  executar('INSERT INTO unidades(id, organizacao_id, nome, codigo, ativa) VALUES(?,?,?,?,1)', id, orgId, nome, codigo);
  auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: 'UNIDADE_CRIADA', alvoId: id, detalhes: { nome, codigo } });
  return { id };
}

export function listarUsuarios() {
  const us = varios('SELECT id, nome, login, admin, ativo FROM usuarios ORDER BY nome');
  const acessos = varios('SELECT a.usuario_id, a.organizacao_id, a.papel, a.todas_unidades, o.nome org_nome FROM acessos a JOIN organizacoes o ON o.id=a.organizacao_id');
  const unidades = varios('SELECT usuario_id, organizacao_id, unidade_id FROM acesso_unidades');
  return us.map(u => ({
    ...u, admin: u.admin === 1, ativo: u.ativo === 1,
    acessos: acessos.filter(a => a.usuario_id === u.id).map(a => ({
      organizacao_id: a.organizacao_id, organizacao: a.org_nome, papel: a.papel, todas_unidades: a.todas_unidades === 1,
      unidades: unidades.filter(x => x.usuario_id === u.id && x.organizacao_id === a.organizacao_id).map(x => x.unidade_id),
    })),
  }));
}

export function cadastrarUsuario(admin, b) {
  const id = criarUsuario({ nome: b.nome, login: b.login, senha: b.senha, admin: Boolean(b.admin) });
  auditar({ usuarioId: admin.id, acao: 'USUARIO_CRIADO', alvoTipo: 'usuario', alvoId: id, detalhes: { login: b.login, admin: Boolean(b.admin) } });
  return { id };
}

export function redefinirSenha(admin, usuarioId, senha) {
  if (!senha || String(senha).length < 10) throw new ErroHttp(400, 'A senha precisa ter pelo menos 10 caracteres');
  if (!um('SELECT 1 FROM usuarios WHERE id=?', usuarioId)) throw new ErroHttp(404, 'Não encontrado');
  const salt = crypto.randomBytes(16).toString('hex');
  executar('UPDATE usuarios SET senha_salt=?, senha_hash=? WHERE id=?', salt, hashSenha(senha, salt), usuarioId);
  executar('DELETE FROM sessoes WHERE usuario_id=?', usuarioId);
  auditar({ usuarioId: admin.id, acao: 'SENHA_REDEFINIDA', alvoTipo: 'usuario', alvoId: usuarioId });
  return { ok: true };
}

export function definirAtivo(admin, usuarioId, ativo) {
  if (usuarioId === admin.id && !ativo) throw new ErroHttp(400, 'Você não pode desativar o próprio usuário');
  executar('UPDATE usuarios SET ativo=? WHERE id=?', ativo ? 1 : 0, usuarioId);
  if (!ativo) executar('DELETE FROM sessoes WHERE usuario_id=?', usuarioId);
  auditar({ usuarioId: admin.id, acao: ativo ? 'USUARIO_ATIVADO' : 'USUARIO_DESATIVADO', alvoTipo: 'usuario', alvoId: usuarioId });
  return { ok: true };
}

// Define (ou remove, com papel=null) o acesso de um usuário a uma instituição, com unidades opcionais.
export function definirAcesso(admin, usuarioId, orgId, { papel, unidades = null }) {
  if (!um('SELECT 1 FROM usuarios WHERE id=?', usuarioId) || !um('SELECT 1 FROM organizacoes WHERE id=?', orgId)) throw new ErroHttp(404, 'Não encontrado');
  return transacao(() => {
    executar('DELETE FROM acesso_unidades WHERE usuario_id=? AND organizacao_id=?', usuarioId, orgId);
    executar('DELETE FROM acessos WHERE usuario_id=? AND organizacao_id=?', usuarioId, orgId);
    if (papel) {
      if (!['SUPERVISOR', 'ATENDENTE', 'REPRESENTANTE'].includes(papel)) throw new ErroHttp(400, 'Perfil inválido');
      const lista = Array.isArray(unidades) && unidades.length ? unidades : null;
      if (lista) {
        const validas = new Set(varios('SELECT id FROM unidades WHERE organizacao_id=?', orgId).map(u => u.id));
        if (!lista.every(u => validas.has(u))) throw new ErroHttp(400, 'Unidade não pertence a esta instituição');
      }
      executar('INSERT INTO acessos(usuario_id, organizacao_id, papel, todas_unidades) VALUES(?,?,?,?)', usuarioId, orgId, papel, lista ? 0 : 1);
      for (const u of lista || []) executar('INSERT INTO acesso_unidades(usuario_id, organizacao_id, unidade_id) VALUES(?,?,?)', usuarioId, orgId, u);
    }
    auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: papel ? 'ACESSO_DEFINIDO' : 'ACESSO_REMOVIDO', alvoTipo: 'usuario', alvoId: usuarioId, detalhes: { papel, unidades } });
    return { ok: true };
  });
}

export function listarConexoesAdmin(orgId) {
  return varios('SELECT id, nome, modo, phone_number_id, waba_id, numero_exibicao, token_env, modelo_primeiro_contato, idioma_modelo, ativa FROM conexoes WHERE organizacao_id=? ORDER BY nome', orgId)
    .map(c => ({ ...c, ativa: c.ativa === 1, token_configurado: c.modo === 'OFICIAL' ? Boolean(c.token_env && process.env[c.token_env]) : null }));
}

export function criarConexao(admin, orgId, b) {
  if (!um('SELECT 1 FROM organizacoes WHERE id=?', orgId)) throw new ErroHttp(404, 'Não encontrado');
  const modo = b.modo === 'OFICIAL' ? 'OFICIAL' : 'TESTE';
  const nome = texto(b.nome);
  if (!nome) throw new ErroHttp(400, 'Informe o nome da conexão');
  let phoneNumberId = texto(b.phone_number_id, 40);
  if (modo === 'OFICIAL') {
    if (!/^\d{6,20}$/.test(phoneNumberId)) throw new ErroHttp(400, 'Phone Number ID inválido (somente números, conforme o painel da Meta)');
    if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(texto(b.token_env, 60))) throw new ErroHttp(400, 'Informe o NOME da variável de ambiente com o token (ex.: META_TOKEN_ESCOLA_A). O token não é gravado no banco.');
  } else phoneNumberId = phoneNumberId || `teste-${crypto.randomBytes(4).toString('hex')}`;
  if (um('SELECT 1 FROM conexoes WHERE modo=? AND phone_number_id=?', modo, phoneNumberId)) throw new ErroHttp(409, 'Este número já está cadastrado em outra conexão (de qualquer instituição)');
  const id = novoId('cnx');
  executar(`INSERT INTO conexoes(id, organizacao_id, nome, modo, phone_number_id, waba_id, numero_exibicao, token_env, modelo_primeiro_contato, idioma_modelo, ativa, criada_em)
            VALUES(?,?,?,?,?,?,?,?,?,?,1,?)`, id, orgId, nome, modo, phoneNumberId, texto(b.waba_id, 40) || null, texto(b.numero_exibicao, 30) || null,
  modo === 'OFICIAL' ? texto(b.token_env, 60) : null, texto(b.modelo_primeiro_contato, 100) || null, texto(b.idioma_modelo, 10) || 'pt_BR', Date.now());
  auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: 'CONEXAO_CRIADA', alvoTipo: 'conexao', alvoId: id, detalhes: { modo, nome } });
  return { id, phone_number_id: phoneNumberId };
}

export function definirConexaoAtiva(admin, orgId, conexaoId, ativa) {
  const c = um('SELECT id FROM conexoes WHERE id=? AND organizacao_id=?', conexaoId, orgId);
  if (!c) throw new ErroHttp(404, 'Não encontrado');
  executar('UPDATE conexoes SET ativa=? WHERE id=?', ativa ? 1 : 0, c.id);
  auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: ativa ? 'CONEXAO_ATIVADA' : 'CONEXAO_DESATIVADA', alvoTipo: 'conexao', alvoId: c.id });
  return { ok: true };
}

export function listarAuditoria(orgId, limite = 200) {
  return varios(`SELECT a.em, a.acao, a.alvo_tipo, a.alvo_id, a.detalhes, u.nome usuario FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id
                 WHERE (? IS NULL OR a.organizacao_id=?) ORDER BY a.id DESC LIMIT ?`, orgId || null, orgId || null, limite);
}
