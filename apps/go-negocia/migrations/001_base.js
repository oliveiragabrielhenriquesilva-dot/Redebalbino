// Migração 001 — base do incremento 1.
// Toda tabela de negócio carrega organizacao_id; consultas sempre filtram por ele (ver src/escopo.js).
// Valores monetários em centavos (INTEGER). Datas de negócio em 'AAAA-MM-DD'; instantes em ms (INTEGER).

export const id = '001_base';

export const up = `
CREATE TABLE organizacoes(
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'EDUCACAO',
  regra_verificacao TEXT NOT NULL DEFAULT 'MATRICULA_ALUNO',
  dias_saldo_valido INTEGER NOT NULL DEFAULT 7,
  ativa INTEGER NOT NULL DEFAULT 1,
  criada_em INTEGER NOT NULL
) STRICT;

CREATE TABLE unidades(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome TEXT NOT NULL,
  codigo TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organizacao_id, codigo)
) STRICT;

CREATE TABLE usuarios(
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_salt TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  admin INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL
) STRICT;

-- Acesso explícito por instituição. Sem linha aqui, o usuário não vê a instituição (padrão restritivo).
CREATE TABLE acessos(
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  papel TEXT NOT NULL CHECK(papel IN ('SUPERVISOR','ATENDENTE','REPRESENTANTE')),
  todas_unidades INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(usuario_id, organizacao_id)
) STRICT;

CREATE TABLE acesso_unidades(
  usuario_id TEXT NOT NULL,
  organizacao_id TEXT NOT NULL,
  unidade_id TEXT NOT NULL REFERENCES unidades(id),
  PRIMARY KEY(usuario_id, organizacao_id, unidade_id),
  FOREIGN KEY(usuario_id, organizacao_id) REFERENCES acessos(usuario_id, organizacao_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE sessoes(
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  criada_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL
) STRICT;

CREATE TABLE responsaveis(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  chave_origem TEXT NOT NULL,
  nome TEXT NOT NULL,
  documento_final TEXT,
  telefone TEXT,
  contato_autorizado INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id, chave_origem)
) STRICT;
CREATE INDEX idx_resp_org_tel ON responsaveis(organizacao_id, telefone);

CREATE TABLE alunos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  matricula TEXT NOT NULL,
  nome TEXT,
  unidade_id TEXT REFERENCES unidades(id),
  UNIQUE(organizacao_id, matricula)
) STRICT;

CREATE TABLE vinculos(
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  responsavel_id TEXT NOT NULL REFERENCES responsaveis(id),
  aluno_id TEXT NOT NULL REFERENCES alunos(id),
  PRIMARY KEY(responsavel_id, aluno_id)
) STRICT;

CREATE TABLE lotes(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('CARTEIRA','RETORNO')),
  escopo TEXT NOT NULL DEFAULT 'COMPLETA' CHECK(escopo IN ('COMPLETA','PARCIAL')),
  arquivo_nome TEXT NOT NULL,
  arquivo_hash TEXT NOT NULL,
  data_referencia TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL CHECK(status IN ('PREVIA','APLICADO','DESCARTADO')),
  resumo TEXT NOT NULL DEFAULT '{}',
  criado_em INTEGER NOT NULL,
  aplicado_em INTEGER
) STRICT;
CREATE INDEX idx_lotes_org ON lotes(organizacao_id, criado_em);

CREATE TABLE lote_linhas(
  lote_id TEXT NOT NULL REFERENCES lotes(id),
  linha INTEGER NOT NULL,
  status TEXT NOT NULL,
  motivo TEXT,
  dados TEXT NOT NULL,
  PRIMARY KEY(lote_id, linha)
) STRICT;

CREATE TABLE titulos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  id_origem TEXT NOT NULL,
  unidade_id TEXT REFERENCES unidades(id),
  responsavel_id TEXT NOT NULL REFERENCES responsaveis(id),
  aluno_id TEXT NOT NULL REFERENCES alunos(id),
  competencia TEXT,
  vencimento TEXT NOT NULL,
  valor_centavos INTEGER,
  saldo_centavos INTEGER NOT NULL,
  situacao TEXT NOT NULL CHECK(situacao IN ('ABERTO','PAGO','CANCELADO')),
  bloqueio TEXT CHECK(bloqueio IS NULL OR bloqueio IN ('CONTESTADO','COMPROVANTE_EM_ANALISE')),
  saldo_referencia TEXT NOT NULL,
  ausente_desde_lote TEXT REFERENCES lotes(id),
  ultimo_lote_id TEXT REFERENCES lotes(id),
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id, id_origem)
) STRICT;
CREATE INDEX idx_titulos_resp ON titulos(organizacao_id, responsavel_id);

-- Histórico: nada é apagado; cada alteração vinda de lote fica registrada.
CREATE TABLE titulo_historico(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organizacao_id TEXT NOT NULL,
  titulo_id TEXT NOT NULL REFERENCES titulos(id),
  lote_id TEXT REFERENCES lotes(id),
  usuario_id TEXT,
  campo TEXT NOT NULL,
  de TEXT,
  para TEXT,
  em INTEGER NOT NULL
) STRICT;

CREATE TABLE conexoes(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome TEXT NOT NULL,
  modo TEXT NOT NULL CHECK(modo IN ('OFICIAL','TESTE')),
  phone_number_id TEXT NOT NULL,
  waba_id TEXT,
  numero_exibicao TEXT,
  token_env TEXT,
  modelo_primeiro_contato TEXT,
  idioma_modelo TEXT NOT NULL DEFAULT 'pt_BR',
  ativa INTEGER NOT NULL DEFAULT 1,
  criada_em INTEGER NOT NULL,
  UNIQUE(modo, phone_number_id)
) STRICT;

-- Um caso por responsável financeiro por instituição: ativo e receptivo trabalham o mesmo caso.
CREATE TABLE casos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  responsavel_id TEXT NOT NULL REFERENCES responsaveis(id),
  status TEXT NOT NULL DEFAULT 'ABERTO' CHECK(status IN ('ABERTO','PAUSADO','ENCERRADO')),
  atendente_id TEXT REFERENCES usuarios(id),
  proxima_acao_em TEXT,
  proxima_acao_tipo TEXT,
  proxima_acao_nota TEXT,
  retorno_combinado_em INTEGER,
  trava_usuario_id TEXT REFERENCES usuarios(id),
  trava_ate INTEGER,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id, responsavel_id)
) STRICT;

CREATE TABLE contatos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  canal TEXT NOT NULL CHECK(canal IN ('WHATSAPP','TELEFONE','EMAIL','PRESENCIAL')),
  direcao TEXT NOT NULL CHECK(direcao IN ('ATIVO','RECEPTIVO')),
  resultado TEXT NOT NULL CHECK(resultado IN ('SEM_RESPOSTA','RESPONDEU','RETORNO_COMBINADO','PROMESSA','RECUSA','NUMERO_INVALIDO','OUTRO')),
  nota TEXT,
  promessa_data TEXT,
  promessa_centavos INTEGER,
  retorno_em INTEGER,
  em INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_contatos_caso ON contatos(caso_id, em);

CREATE TABLE conversas(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  conexao_id TEXT NOT NULL REFERENCES conexoes(id),
  telefone TEXT NOT NULL,
  caso_id TEXT REFERENCES casos(id),
  verificada_em INTEGER,
  verificada_por TEXT REFERENCES usuarios(id),
  criada_em INTEGER NOT NULL,
  atualizada_em INTEGER NOT NULL,
  UNIQUE(conexao_id, telefone)
) STRICT;

CREATE TABLE mensagens(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  conversa_id TEXT NOT NULL REFERENCES conversas(id),
  direcao TEXT NOT NULL CHECK(direcao IN ('ENTRADA','SAIDA')),
  texto TEXT NOT NULL,
  id_externo TEXT,
  status TEXT NOT NULL,
  erro TEXT,
  usuario_id TEXT REFERENCES usuarios(id),
  em INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_msg_conversa ON mensagens(conversa_id, em);
CREATE UNIQUE INDEX idx_msg_externo ON mensagens(conversa_id, id_externo) WHERE id_externo IS NOT NULL;

CREATE TABLE auditoria(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  em INTEGER NOT NULL,
  usuario_id TEXT,
  organizacao_id TEXT,
  acao TEXT NOT NULL,
  alvo_tipo TEXT,
  alvo_id TEXT,
  detalhes TEXT
) STRICT;
CREATE INDEX idx_auditoria_org ON auditoria(organizacao_id, em);
`;

// Reversão: remove apenas as tabelas desta migração (banco exclusivo da GO Negocia).
export const down = `
DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS mensagens;
DROP TABLE IF EXISTS conversas;
DROP TABLE IF EXISTS contatos;
DROP TABLE IF EXISTS casos;
DROP TABLE IF EXISTS conexoes;
DROP TABLE IF EXISTS titulo_historico;
DROP TABLE IF EXISTS titulos;
DROP TABLE IF EXISTS lote_linhas;
DROP TABLE IF EXISTS lotes;
DROP TABLE IF EXISTS vinculos;
DROP TABLE IF EXISTS alunos;
DROP TABLE IF EXISTS responsaveis;
DROP TABLE IF EXISTS sessoes;
DROP TABLE IF EXISTS acesso_unidades;
DROP TABLE IF EXISTS acessos;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS unidades;
DROP TABLE IF EXISTS organizacoes;
`;
