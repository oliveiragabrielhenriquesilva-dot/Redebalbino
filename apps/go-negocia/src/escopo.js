// Separação entre instituições — aplicada no servidor.
// Regra: toda rota de negócio passa por exigirEscopo(); todo SELECT de negócio filtra organizacao_id
// e, quando o acesso é restrito a unidades, filtra unidade_id. Objeto de outra instituição => 404 (não revela existência).

import { um, varios } from './db.js';

export class ErroHttp extends Error {
  constructor(status, mensagem, codigo) { super(mensagem); this.status = status; this.codigo = codigo || null; }
}

// Permissões por papel. ADMIN (global) pode tudo em qualquer instituição.
const PERMISSOES = {
  SUPERVISOR: new Set(['carteira.ver', 'carteira.importar', 'fila.ver', 'fila.distribuir', 'caso.trabalhar', 'conversa.ver', 'conversa.enviar', 'conexao.ver', 'teste.simular', 'dados.contato']),
  ATENDENTE: new Set(['carteira.ver', 'fila.ver', 'caso.trabalhar', 'conversa.ver', 'conversa.enviar', 'dados.contato']),
  REPRESENTANTE: new Set(['carteira.ver', 'lotes.ver']),
};
PERMISSOES.SUPERVISOR.add('lotes.ver');

export function exigirEscopo(usuario, organizacaoId, permissao) {
  if (!usuario) throw new ErroHttp(401, 'Sessão expirada. Entre novamente.', 'AUTH');
  const org = um('SELECT id, nome, tipo, regra_verificacao, dias_saldo_valido, ativa FROM organizacoes WHERE id=?', String(organizacaoId || ''));
  if (usuario.admin) {
    if (!org) throw new ErroHttp(404, 'Não encontrado');
    return { org, papel: 'ADMIN', todasUnidades: true, unidades: null, pode: () => true };
  }
  const acesso = org && org.ativa === 1 ? um('SELECT papel, todas_unidades FROM acessos WHERE usuario_id=? AND organizacao_id=?', usuario.id, org.id) : null;
  // Sem acesso: 404, igual a "não existe" — não confirma a existência da instituição.
  if (!acesso) throw new ErroHttp(404, 'Não encontrado');
  const unidades = acesso.todas_unidades === 1 ? null
    : varios('SELECT unidade_id FROM acesso_unidades WHERE usuario_id=? AND organizacao_id=?', usuario.id, org.id).map(r => r.unidade_id);
  const perms = PERMISSOES[acesso.papel] || new Set();
  if (permissao && !perms.has(permissao)) throw new ErroHttp(403, 'Seu perfil não permite esta ação nesta instituição', 'PERMISSAO');
  return { org, papel: acesso.papel, todasUnidades: unidades === null, unidades, pode: p => perms.has(p) };
}

// Fragmento SQL para restringir por unidade. `coluna` é a coluna unidade_id da tabela consultada.
// Acesso restrito não enxerga registros sem unidade.
export function filtroUnidade(escopo, coluna) {
  if (escopo.todasUnidades) return { sql: '1=1', params: [] };
  if (!escopo.unidades.length) return { sql: '1=0', params: [] };
  return { sql: `${coluna} IN (${escopo.unidades.map(() => '?').join(',')})`, params: [...escopo.unidades] };
}

// Responsável visível = tem ao menos um título numa unidade permitida.
export function responsavelVisivel(escopo, responsavelId) {
  const f = filtroUnidade(escopo, 't.unidade_id');
  const r = um(`SELECT r.* FROM responsaveis r WHERE r.organizacao_id=? AND r.id=?
                AND EXISTS(SELECT 1 FROM titulos t WHERE t.responsavel_id=r.id AND t.organizacao_id=r.organizacao_id AND ${f.sql})`,
  escopo.org.id, responsavelId, ...f.params);
  if (!r) throw new ErroHttp(404, 'Não encontrado');
  return r;
}

export function casoVisivel(escopo, casoId) {
  const c = um('SELECT * FROM casos WHERE organizacao_id=? AND id=?', escopo.org.id, String(casoId || ''));
  if (!c) throw new ErroHttp(404, 'Não encontrado');
  responsavelVisivel(escopo, c.responsavel_id);
  return c;
}
