// Banco de dados (SQLite embutido no Node 22.13+ / 24) — sem dependências externas
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.MATRICULAS_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'dados');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'matriculas.db');

require('./restauracao').aplicarPendente(DATA_DIR);
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);

CREATE TABLE IF NOT EXISTS metas_ritmo_semanal (
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
  polo_id INTEGER NOT NULL REFERENCES polos(id),
  tutor_id INTEGER NOT NULL REFERENCES tutores(id),
  semana TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK(quantidade >= 0),
  PRIMARY KEY (ciclo_id, polo_id, tutor_id, semana)
);

CREATE TABLE IF NOT EXISTS metas_ritmo_diario (
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id), polo_id INTEGER NOT NULL REFERENCES polos(id),
  tutor_id INTEGER NOT NULL REFERENCES tutores(id), semana TEXT NOT NULL, data TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
  PRIMARY KEY (ciclo_id, polo_id, tutor_id, semana, data)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin','lancador','visualizador')),
  polo_id INTEGER REFERENCES polos(id) ON DELETE SET NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tutores (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tutor_polos (
  tutor_id INTEGER NOT NULL REFERENCES tutores(id) ON DELETE CASCADE,
  polo_id INTEGER NOT NULL REFERENCES polos(id) ON DELETE CASCADE,
  PRIMARY KEY (tutor_id, polo_id)
);

CREATE TABLE IF NOT EXISTS origens (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ordem INTEGER NOT NULL DEFAULT 0,
  grupo TEXT
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ciclos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  data_inicio TEXT,
  data_fim TEXT,
  padrao INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY,
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  data TEXT NOT NULL,
  percentual REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS metas (
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
  polo_id INTEGER NOT NULL REFERENCES polos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ciclo_id, polo_id, produto_id)
);

CREATE TABLE IF NOT EXISTS mundo_azul (
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
  polo_id INTEGER NOT NULL REFERENCES polos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ciclo_id, polo_id, produto_id)
);

CREATE TABLE IF NOT EXISTS matriculas (
  id INTEGER PRIMARY KEY,
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
  data TEXT NOT NULL,
  polo_id INTEGER NOT NULL REFERENCES polos(id),
  tutor_id INTEGER NOT NULL REFERENCES tutores(id),
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  origem_id INTEGER NOT NULL REFERENCES origens(id),
  aluno TEXT,
  cpf TEXT,
  curso TEXT,
  valor REAL NOT NULL DEFAULT 0,
  obs TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_mat_ciclo ON matriculas(ciclo_id, data);
CREATE INDEX IF NOT EXISTS ix_mat_polo ON matriculas(polo_id);
CREATE INDEX IF NOT EXISTS ix_mat_cpf ON matriculas(cpf);

CREATE TABLE IF NOT EXISTS polo_produtos (
  polo_id INTEGER NOT NULL REFERENCES polos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  PRIMARY KEY (polo_id, produto_id)
);

CREATE TABLE IF NOT EXISTS feriados (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  nome TEXT NOT NULL,
  polo_id INTEGER REFERENCES polos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_feriados_data ON feriados(data);

CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY,
  quando TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  usuario TEXT,
  acao TEXT NOT NULL,
  detalhe TEXT
);
`);

// Banco já existente: versões anteriores criaram categorias sem a coluna usada pelas migrações.
if (!db.prepare('PRAGMA table_info(categorias)').all().some(c => c.name === 'grupo')) {
  db.exec('ALTER TABLE categorias ADD COLUMN grupo TEXT');
}

// ---------------------------------------------------------------------------
// Carga inicial dos CADASTROS (não das matrículas) com base na planilha
// "Acompanhamento de Matrículas - 51/2026". Tudo pode ser editado no painel.
// ---------------------------------------------------------------------------
function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM polos').get().n) return;
  const set = db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)');
  set.run('nome_sistema', 'Acompanhamento de Matrículas');
  set.run('nome_rede', 'Rede Balbino');
  set.run('contagem_dias', 'seg-sex');
  set.run('exigir_cpf', '1');
  set.run('exigir_aluno', '0');
}
seed();

// ---------------------------------------------------------------------------
// Atualizações de versão (rodam uma vez só, sem mexer nas matrículas)
// ---------------------------------------------------------------------------
function migrar() {
  const versao = Number((db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get() || {}).valor || 1);
  if (versao < 2) {
    db.exec('BEGIN');
    try {
      const set = db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)');
      // Projeção SAVE/GAP passa a usar dias úteis (seg–sex, sem feriados) por padrão
      set.run('contagem_dias', 'seg-sex');
      set.run('nome_sistema', 'Acompanhamento de Matrículas');
      set.run('nome_rede', 'Rede Balbino');
      const ins = db.prepare('INSERT INTO feriados (data, nome) VALUES (?, ?)');
      const existe = db.prepare('SELECT 1 FROM feriados WHERE data = ? AND polo_id IS NULL');
      // Feriados nacionais no período dos ciclos atuais (edite/complete em Cadastros › Feriados)
      for (const [d, n] of [
        ['2026-10-12', 'Nossa Senhora Aparecida'], ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-11-20', 'Consciência Negra'],
        ['2026-12-25', 'Natal'], ['2027-01-01', 'Confraternização Universal'],
        ['2027-02-08', 'Carnaval (ponto facultativo)'], ['2027-02-09', 'Carnaval (ponto facultativo)'],
        ['2027-03-26', 'Sexta-feira Santa'], ['2027-04-21', 'Tiradentes'], ['2027-05-01', 'Dia do Trabalho'],
      ]) if (!existe.get(d)) ins.run(d, n);
      set.run('versao', '2');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 3) {
    db.exec('BEGIN');
    try {
      // Produtos que cada polo vende: os que têm meta em algum ciclo; polo sem nenhuma meta recebe todos os ativos.
      const polos = db.prepare('SELECT id FROM polos').all();
      const ins = db.prepare('INSERT OR IGNORE INTO polo_produtos (polo_id, produto_id) VALUES (?, ?)');
      for (const p of polos) {
        const comMeta = db.prepare('SELECT DISTINCT produto_id FROM metas WHERE polo_id = ? AND quantidade > 0').all(p.id);
        const vendidos = db.prepare('SELECT DISTINCT produto_id FROM matriculas WHERE polo_id = ?').all(p.id);
        const lista = comMeta.length ? [...comMeta, ...vendidos] : db.prepare('SELECT id produto_id FROM produtos WHERE ativo = 1').all();
        for (const r of lista) ins.run(p.id, r.produto_id);
      }
      const set = db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)');
      set.run('dias_min_projecao', '5');
      set.run('versao', '3');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 4) {
    db.exec('BEGIN');
    try {
      // Ciclo 51/2027 começa em 27/10/2026
      let c = db.prepare("SELECT id, data_inicio FROM ciclos WHERE nome LIKE '%51/2027%'").get();
      if (!c) {
        const antigo = db.prepare("SELECT id FROM ciclos WHERE nome = 'Ciclo 51/2026'").get();
        if (antigo) { db.prepare("UPDATE ciclos SET nome = 'Ciclo 51/2027' WHERE id = ?").run(antigo.id); c = { id: antigo.id, data_inicio: null }; }
      }
      if (c && !c.data_inicio) db.prepare("UPDATE ciclos SET data_inicio = '2026-10-27' WHERE id = ?").run(c.id);
      // SEDE deixa de ser polo (excluída se não tiver matrículas; senão, desativada)
      const sede = db.prepare("SELECT id FROM polos WHERE nome = 'SEDE'").get();
      if (sede) {
        const usada = db.prepare('SELECT COUNT(*) n FROM matriculas WHERE polo_id = ?').get(sede.id).n
          + db.prepare('SELECT COUNT(*) n FROM usuarios WHERE polo_id = ?').get(sede.id).n;
        if (usada) db.prepare('UPDATE polos SET ativo = 0 WHERE id = ?').run(sede.id);
        else db.prepare('DELETE FROM polos WHERE id = ?').run(sede.id);
      }
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '4')").run();
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 5) {
    db.exec('BEGIN');
    try {
      // Meta de RPV (mensalidade média com desconto) por polo e produto; polo_id = 0 → padrão para todos os polos
      db.exec(`CREATE TABLE IF NOT EXISTS metas_rpv (
        ciclo_id INTEGER NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
        polo_id INTEGER NOT NULL DEFAULT 0,
        produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        valor REAL NOT NULL,
        PRIMARY KEY (ciclo_id, polo_id, produto_id))`);
      // Faixa esperada da mensalidade por produto (aviso no lançamento)
      const cols = db.prepare('PRAGMA table_info(produtos)').all().map(c => c.name);
      if (!cols.includes('valor_min')) db.exec('ALTER TABLE produtos ADD COLUMN valor_min REAL');
      if (!cols.includes('valor_max')) db.exec('ALTER TABLE produtos ADD COLUMN valor_max REAL');
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '5')").run();
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 6) {
    db.exec('BEGIN');
    try {
      // Cursos (cada curso aponta para um produto) — usados no lançamento e na importação do WhatsApp
      db.exec(`CREATE TABLE IF NOT EXISTS cursos (
        id INTEGER PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
        produto_id INTEGER NOT NULL REFERENCES produtos(id),
        apelidos TEXT,
        ativo INTEGER NOT NULL DEFAULT 1)`);
      const addCol = (tab, col, tipo) => { if (!db.prepare(`PRAGMA table_info(${tab})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${tab} ADD COLUMN ${col} ${tipo}`); };
      // "apelidos": outras formas de escrever o nome (ajudam a reconhecer o texto do WhatsApp)
      addCol('polos', 'apelidos', 'TEXT'); addCol('tutores', 'apelidos', 'TEXT'); addCol('origens', 'apelidos', 'TEXT');
      // dados extras que vêm na mensagem de matrícula
      addCol('matriculas', 'valor_primeira', 'REAL'); addCol('matriculas', 'bolsa', 'TEXT'); addCol('matriculas', 'cupom', 'TEXT'); addCol('matriculas', 'importado', 'TEXT');
      const ao = db.prepare('UPDATE origens SET apelidos = ? WHERE nome = ? AND apelidos IS NULL');
      ao.run('PAP, Panfletagem, Porta a porta', 'PAP/Panfletagem'); ao.run('Instagram, Facebook, Google, Site, Redes sociais, Tráfego', 'Marketing Digital');
      ao.run('Parceria, Convênio, Empresa', 'Parcerias'); ao.run('Indicacao, Indicou', 'Indicação'); ao.run('Resgate', 'Resgate de Base');
      ao.run('Ex aluno, Exaluno', 'Ex-Aluno'); ao.run('Pré-matrícula, Pre matricula', 'Pré'); ao.run('Recepção, Passante, Balcão, Telefone, WhatsApp', 'Receptivo');
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '6')").run();
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 7) {
    db.exec('BEGIN');
    try {
      // Nova origem "Já é aluno/aluna" (mensagens do WhatsApp: "Já é aluna", "Já sou aluno"…)
      const apel = 'Já é aluna, Já é aluno, Já é aluna/o, Já é aluno/a, Já sou aluna, Já sou aluno, Aluna da casa, Aluno da casa, Aluno ativo, Aluna ativa';
      const existe = db.prepare("SELECT id FROM origens WHERE nome = 'Já é aluno/aluna'").get();
      if (existe) db.prepare('UPDATE origens SET apelidos = ?, ativo = 1 WHERE id = ?').run(apel, existe.id);
      else {
        const ordem = (db.prepare('SELECT MAX(ordem) m FROM origens').get().m || 0) + 1;
        db.prepare('INSERT INTO origens (nome, ordem, ativo, apelidos) VALUES (?, ?, 1, ?)').run('Já é aluno/aluna', ordem, apel);
      }
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '7')").run();
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 8) {
    db.exec('BEGIN');
    try {
      const addCol = (tab, col, tipo) => { if (!db.prepare(`PRAGMA table_info(${tab})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${tab} ADD COLUMN ${col} ${tipo}`); };
      // apelidos da categoria = como ela aparece no BI (GRAD, HIB, POS, TEC…)
      addCol('categorias', 'apelidos', 'TEXT');
      const ap = db.prepare('UPDATE categorias SET apelidos = ? WHERE nome = ? AND apelidos IS NULL');
      ap.run('Graduação, Graduacao, Gradução EAD, EAD', 'GRAD'); ap.run('POS, Pós-graduação, Pos graduacao, Especialização', 'PÓS');
      ap.run('Profissionalizante, Livre, Cursos livres', 'PROF'); ap.run('Técnico, Tecnico', 'TEC'); ap.run('HIB, Hibrido, Semipresencial', 'HÍBRIDO');
      // Conferências com o BI (Power BI): cada uma é uma "foto" dos números do BI numa data
      db.exec(`CREATE TABLE IF NOT EXISTS conferencias (
        id INTEGER PRIMARY KEY,
        ciclo_id INTEGER NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
        polo_id INTEGER REFERENCES polos(id) ON DELETE CASCADE,
        data_ref TEXT NOT NULL,
        fonte TEXT,
        obs TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        criado_por TEXT)`);
      db.exec(`CREATE TABLE IF NOT EXISTS conferencia_linhas (
        conferencia_id INTEGER NOT NULL REFERENCES conferencias(id) ON DELETE CASCADE,
        rotulo TEXT NOT NULL,
        categoria_id INTEGER REFERENCES categorias(id),
        meta_qtd REAL, real_qtd REAL, meta_ticket REAL, real_ticket REAL, meta_rpv REAL, real_rpv REAL)`);
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '8')").run();
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 9) {
    db.exec('BEGIN');
    try {
      if (!db.prepare('PRAGMA table_info(cursos)').all().some(c => c.name === 'polos')) {
        db.exec(`CREATE TABLE cursos_novo (
          id INTEGER PRIMARY KEY, nome TEXT NOT NULL COLLATE NOCASE, produto_id INTEGER NOT NULL REFERENCES produtos(id),
          apelidos TEXT, ativo INTEGER NOT NULL DEFAULT 1, polos TEXT NOT NULL DEFAULT '', UNIQUE (nome, polos))`);
        db.exec("INSERT INTO cursos_novo (id, nome, produto_id, apelidos, ativo, polos) SELECT id, nome, produto_id, apelidos, ativo, '' FROM cursos");
        db.exec('DROP TABLE cursos'); db.exec('ALTER TABLE cursos_novo RENAME TO cursos');
      }
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '9')").run();
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (versao < 10) {
    db.exec(`CREATE TABLE IF NOT EXISTS campanhas (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      inicio TEXT NOT NULL,
      fim TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('meta', 'escalonada', 'a_cada', 'por_matricula')),
      qtd INTEGER NOT NULL DEFAULT 1,
      valor REAL NOT NULL DEFAULT 0,
      adicional REAL NOT NULL DEFAULT 0,
      produtos TEXT NOT NULL DEFAULT '',
      polos TEXT NOT NULL DEFAULT '',
      beneficiario TEXT NOT NULL DEFAULT 'tutor' CHECK (beneficiario IN ('tutor', 'polo')),
      obs TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '10')").run();
  }
}
migrar();

// Os cadastros e regras por polo são restaurados do banco privado da instalação.

// Polo de referência da meta individual; registros antigos continuam usando o polo da matrícula.
if (!db.prepare('PRAGMA table_info(matriculas)').all().some(c => c.name === 'tutor_polo_id')) db.exec('ALTER TABLE matriculas ADD COLUMN tutor_polo_id INTEGER REFERENCES polos(id)');

// v11: Saúde como categoria (Biomedicina e Farmácia + Nutrição, metas separadas) · nome Saúde Capilar · meta do tutor no processo
function migrarV11() {
  const versao = Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1);
  if (versao >= 11) return;
  const norm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  try {
    const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const copia = path.join(dir, `antes-v11-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
  } catch (e) { console.error('Aviso: não consegui criar o backup antes da v11:', e.message); }
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS metas_tutor (
      ciclo_id INTEGER NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
      polo_id INTEGER NOT NULL REFERENCES polos(id) ON DELETE CASCADE,
      tutor_id INTEGER NOT NULL REFERENCES tutores(id) ON DELETE CASCADE,
      quantidade INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ciclo_id, polo_id, tutor_id))`);
    const cats = db.prepare('SELECT id, nome, ordem, grupo FROM categorias').all();
    const hib = cats.find(c => norm(c.nome) === 'hibrido');
    const prods = db.prepare('SELECT id, nome, categoria_id FROM produtos').all();
    const saudeProds = prods.filter(p => ['biomedicina e farmacia', 'bio farm', 'nutricao'].includes(norm(p.nome)));
    if (!cats.some(c => norm(c.nome) === 'saude') && saudeProds.length) {
      // abre espaço logo depois do HÍBRIDO na ordem
      const ordemHib = hib ? hib.ordem : 2;
      db.prepare('UPDATE categorias SET ordem = ordem + 1 WHERE ordem > ?').run(ordemHib);
      const id = Number(db.prepare('INSERT INTO categorias (nome, ordem, apelidos, grupo) VALUES (?, ?, ?, ?)').run('Saúde', ordemHib + 1, 'Saude, HIB', hib ? hib.grupo : 'Híbrido').lastInsertRowid);
      for (const p of saudeProds) db.prepare('UPDATE produtos SET categoria_id = ? WHERE id = ?').run(id, p.id);
    }
    for (const c of db.prepare('SELECT id, nome, apelidos FROM cursos').all().filter(c => norm(c.nome) === 'saude capital')) {
      const jaTem = db.prepare('SELECT id FROM cursos WHERE nome = ? AND polos = (SELECT polos FROM cursos WHERE id = ?)').get('Saúde Capilar', c.id);
      if (jaTem) db.prepare('UPDATE cursos SET ativo = 0 WHERE id = ?').run(c.id);
      else db.prepare('UPDATE cursos SET nome = ?, apelidos = ? WHERE id = ?').run('Saúde Capilar', 'Saude Capilar, Saúde Capital, Saude Capital', c.id);
    }
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '11')").run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
migrarV11();

// v12: nomenclatura da campanha base "Quem Estuda Sabe o Porquê" (só nomes; ids, metas e matrículas continuam iguais)
function migrarV12() {
  const versao = Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1);
  if (versao >= 12) return;
  const norm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  db.exec('BEGIN');
  try {
    const renomear = (tabela, de, para) => {
      const r = db.prepare(`SELECT id, nome FROM ${tabela}`).all().find(x => de.includes(norm(x.nome)));
      if (r && !db.prepare(`SELECT 1 FROM ${tabela} WHERE nome = ? AND id != ?`).get(para, r.id)) db.prepare(`UPDATE ${tabela} SET nome = ? WHERE id = ?`).run(para, r.id);
    };
    renomear('produtos', ['ead', 'graduacao'], 'Graduação');
    renomear('produtos', ['licenciatura', 'licenciaturas'], 'Semi - Licenciaturas');
    renomear('produtos', ['bacharel em ed fisica', 'bacharel em educacao fisica'], 'Semi - Bacharelado Educação Física');
    renomear('produtos', ['engenharia', 'engenharias'], 'Semi - Engenharias');
    renomear('categorias', ['saude'], 'Semi - Saúde');
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '12')").run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
migrarV12();

// v13: Bem Estar também segue a nomenclatura "Semi -"
function migrarV13() {
  const versao = Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1);
  if (versao >= 13) return;
  const norm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const r = db.prepare('SELECT id, nome FROM produtos').all().find(x => norm(x.nome) === 'bem estar');
  if (r && !db.prepare('SELECT 1 FROM produtos WHERE nome = ? AND id != ?').get('Semi - Bem Estar', r.id)) db.prepare('UPDATE produtos SET nome = ? WHERE id = ?').run('Semi - Bem Estar', r.id);
  db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '13')").run();
}
migrarV13();

// v14: estrutura da planilha de metas — Categoria (Graduação | Continuada) › Produto, com "Semi - Saúde" como subgrupo
//      de produtos (Farmácia e Biomedicina + Nutrição, metas separadas). Ids, metas, matrículas e cursos são preservados.
function migrarV14() {
  const versao = Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1);
  if (versao >= 14) return;
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  try {
    const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
    db.exec(`VACUUM INTO '${path.join(dir, `antes-v14-${Date.now()}.db`).replace(/'/g, "''")}'`);
  } catch (e) { console.error('Aviso: não consegui criar o backup antes da v14:', e.message); }
  db.exec('BEGIN');
  try {
    if (!db.prepare('PRAGMA table_info(produtos)').all().some(c => c.name === 'subgrupo')) db.exec('ALTER TABLE produtos ADD COLUMN subgrupo TEXT');
    const cats = db.prepare('SELECT id, nome FROM categorias ORDER BY ordem, id').all();
    const ehCont = (c) => /^(pos|tec|prof|continuada)/.test(norm(c.nome));
    const garantir = (nome, ordem, base) => {
      let c = cats.find(x => norm(x.nome) === norm(nome)) || base;
      if (c) db.prepare('UPDATE categorias SET nome = ?, grupo = ?, ordem = ?, apelidos = NULL WHERE id = ?').run(nome, nome, ordem, c.id);
      else c = { id: Number(db.prepare('INSERT INTO categorias (nome, ordem, grupo) VALUES (?, ?, ?)').run(nome, ordem, nome).lastInsertRowid) };
      return c.id;
    };
    const gradBase = cats.find(c => norm(c.nome) === 'grad') || cats.find(c => !ehCont(c));
    const contBase = cats.find(c => /^pos/.test(norm(c.nome))) || cats.find(ehCont);
    const idGrad = garantir('Graduação', 1, gradBase), idCont = garantir('Continuada', 2, contBase);
    for (const c of cats) {
      if (c.id === idGrad || c.id === idCont) continue;
      const destino = ehCont(c) ? idCont : idGrad;
      if (norm(c.nome) === 'saude' || norm(c.nome) === 'semi saude') db.prepare("UPDATE produtos SET subgrupo = 'Semi - Saúde' WHERE categoria_id = ?").run(c.id);
      db.prepare('UPDATE produtos SET categoria_id = ? WHERE categoria_id = ?').run(destino, c.id);
      db.prepare('UPDATE conferencia_linhas SET categoria_id = ? WHERE categoria_id = ?').run(destino, c.id);
      db.prepare('DELETE FROM categorias WHERE id = ?').run(c.id);
    }
    // nomes e ordem exatamente como na planilha de metas
    const nomes = [
      [['graduacao', 'ead'], 'Graduação', null],
      [['semi licenciaturas', 'semi licenciatura', 'licenciatura'], 'Semi - Licenciatura', null],
      [['semi bacharelado educacao fisica', 'bacharel em ed fisica', 'semi bacharel em educacao fisica'], 'Semi - Bacharel em Educação Física', null],
      [['semi engenharias', 'semi engenharia', 'engenharia'], 'Semi - Engenharia', null],
      [['biomedicina e farmacia', 'bio farm', 'semi farmacia e biomedicina'], 'Semi - Farmácia e Biomedicina', 'Semi - Saúde'],
      [['nutricao', 'semi nutricao'], 'Semi - Nutrição', 'Semi - Saúde'],
      [['semi bem estar', 'bem estar'], 'Semi - Bem Estar', null],
      [['fono', 'semi fono'], 'Semi - Fono', null],
      [['powertech engenharia', 'powertech engenharias'], 'PowerTech - Engenharias', null],
      [['powertech saude'], 'PowerTech - Saúde', null],
      [['pos'], 'Pós', null], [['tecnico'], 'Técnico', null], [['prof'], 'Prof', null],
    ];
    const prods = db.prepare('SELECT id, nome FROM produtos').all();
    nomes.forEach(([de, para, sub], i) => {
      const p = prods.find(x => de.includes(norm(x.nome)) || norm(x.nome) === norm(para));
      if (!p) return;
      if (!db.prepare('SELECT 1 FROM produtos WHERE nome = ? AND id != ?').get(para, p.id)) db.prepare('UPDATE produtos SET nome = ? WHERE id = ?').run(para, p.id);
      db.prepare('UPDATE produtos SET ordem = ?, subgrupo = COALESCE(?, subgrupo) WHERE id = ?').run(i + 1, sub, p.id);
    });
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '14')").run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
migrarV14();

// v19: prazo próprio por produto ("Meta até") + metas da Educação Continuada do 51/2027 (comunicado de 27/10/2026)
//      Pós = meta do 4º trimestre (até 31/12/2026) · Técnico = processo inteiro
function migrarV19() {
  const versao = Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1);
  if (versao >= 19) return;
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  try {
    const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
    db.exec(`VACUUM INTO '${path.join(dir, `antes-v19-${Date.now()}.db`).replace(/'/g, "''")}'`);
  } catch (e) { console.error('Aviso: não consegui criar o backup antes da v19:', e.message); }
  db.exec('BEGIN');
  try {
    if (!db.prepare('PRAGMA table_info(produtos)').all().some(c => c.name === 'meta_ate')) db.exec('ALTER TABLE produtos ADD COLUMN meta_ate TEXT');
    const prods = db.prepare('SELECT id, nome FROM produtos').all();
    const pos = prods.find(p => /^pos/.test(norm(p.nome))), tec = prods.find(p => /^tecnico/.test(norm(p.nome)));
    if (pos) db.prepare("UPDATE produtos SET meta_ate = '2026-12-31' WHERE id = ?").run(pos.id);
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '19')").run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// v18: semana de meta de terça a segunda, com meta em todos os dias menos domingo
if (Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1) < 18) {
  db.prepare("INSERT OR IGNORE INTO config (chave, valor) VALUES ('inicio_semana', '2')").run();
  db.prepare("INSERT OR IGNORE INTO config (chave, valor) VALUES ('dias_meta_semana', '1,2,3,4,5,6')").run();
}
// v17: data de referência do painel = hoje
if (Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1) < 17) {
  db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('lancamento', 'mesmo_dia')").run();
  db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '17')").run();
}
if (Number(db.prepare("SELECT valor FROM config WHERE chave = 'versao'").get()?.valor || 1) < 18) db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao', '18')").run();
migrarV19();

// v27: origem do crédito é independente da oferta do polo de destino.
if (!db.prepare('PRAGMA table_info(tutores)').all().some(c=>c.name==='polo_origem_id'))
  db.exec('ALTER TABLE tutores ADD COLUMN polo_origem_id INTEGER REFERENCES polos(id)');
if (!db.prepare("SELECT 1 FROM config WHERE chave='credito_origem_v27'").get()) {
  const fonte=path.join(__dirname,'tutores-recuperacao.json');
  let referencia=[];try{referencia=JSON.parse(fs.readFileSync(fonte,'utf8'));}catch{}
  const tutores=db.prepare('SELECT id,nome FROM tutores').all(),origens=[];
  for(const t of tutores){
    const vinculos=db.prepare('SELECT tp.polo_id,p.nome FROM tutor_polos tp JOIN polos p ON p.id=tp.polo_id WHERE tp.tutor_id=?').all(t.id);
    const ref=referencia.filter(r=>r.nome.trim().toLowerCase()===t.nome.trim().toLowerCase());
    const conhecido=ref.length===1&&ref[0].polos.length===1?vinculos.find(p=>p.nome.trim().toLowerCase()===ref[0].polos[0].trim().toLowerCase()):null;
    const origem=conhecido?.polo_id||(vinculos.length===1?vinculos[0].polo_id:null);
    if(origem)origens.push({tutor:t.id,polo:origem});
  }
  if(db.prepare('SELECT COUNT(*) n FROM matriculas').get().n){
    const dir=path.join(DATA_DIR,'backups');fs.mkdirSync(dir,{recursive:true});
    const backup=path.join(dir,'antes-credito-origem-v27-'+Date.now()+'.db');
    db.exec("VACUUM INTO '"+backup.replace(/'/g,"''")+"'");
  }
  db.exec('BEGIN');try{
    const salvar=db.prepare('UPDATE tutores SET polo_origem_id=? WHERE id=? AND polo_origem_id IS NULL');
    for(const o of origens)salvar.run(o.polo,o.tutor);
    const n=db.prepare(`UPDATE matriculas SET tutor_polo_id=(SELECT polo_origem_id FROM tutores WHERE id=matriculas.tutor_id)
      WHERE EXISTS(SELECT 1 FROM tutores t WHERE t.id=matriculas.tutor_id AND t.polo_origem_id IS NOT NULL)
      AND (tutor_polo_id IS NULL OR (tutor_polo_id=polo_id AND polo_id<>(SELECT polo_origem_id FROM tutores WHERE id=matriculas.tutor_id)))`).run().changes;
    if(n)db.prepare("INSERT INTO historico(usuario,acao,detalhe) VALUES('sistema','corrigiu crédito de origem v27',?)").run(n+' matrícula(s). Polo de destino e produto preservados; backup anterior criado.');
    db.prepare("INSERT INTO config(chave,valor) VALUES('credito_origem_v27','1')").run();db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}

db.exec(`CREATE TABLE IF NOT EXISTS credito_excecoes (
 id INTEGER PRIMARY KEY, matricula_id INTEGER REFERENCES matriculas(id) ON DELETE SET NULL,
 ciclo_id INTEGER NOT NULL REFERENCES ciclos(id), tutor_id INTEGER NOT NULL REFERENCES tutores(id),
 polo_destino_id INTEGER NOT NULL REFERENCES polos(id), credito_anterior INTEGER,credito_novo INTEGER NOT NULL,
 motivo TEXT NOT NULL,usuario TEXT NOT NULL,criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')));
 CREATE INDEX IF NOT EXISTS ix_credito_excecoes_matricula ON credito_excecoes(matricula_id);`);
module.exports = { db, DB_FILE, DATA_DIR };
