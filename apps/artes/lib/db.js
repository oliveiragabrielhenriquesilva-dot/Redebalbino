// Banco de dados local (SQLite embutido no Node.js, arquivo único em data/sistema.db)
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'sistema.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS polos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  endereco TEXT DEFAULT '',
  whatsapp_vendas TEXT DEFAULT '',
  whatsapp_pedagogico TEXT DEFAULT '',
  horario TEXT DEFAULT '',
  instagram TEXT DEFAULT '',
  ig_user_id TEXT DEFAULT '',
  ig_token TEXT DEFAULT '',
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tipos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT DEFAULT '',
  formatos TEXT NOT NULL,
  contato TEXT DEFAULT 'vendas',
  legenda_padrao TEXT DEFAULT '',
  campos TEXT NOT NULL,
  ordem INTEGER DEFAULT 0,
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS publicacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote TEXT,
  tipo TEXT NOT NULL REFERENCES tipos(id),
  polo_id INTEGER NOT NULL REFERENCES polos(id),
  formato TEXT NOT NULL,
  dados TEXT NOT NULL,
  foto TEXT DEFAULT '',
  legenda TEXT DEFAULT '',
  data_hora TEXT DEFAULT '',
  status TEXT DEFAULT 'rascunho',
  arquivo TEXT DEFAULT '',
  erro TEXT DEFAULT '',
  link TEXT DEFAULT '',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  publicado_em TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS cursos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curso TEXT NOT NULL,
  nivel TEXT DEFAULT 'GRADUAÇÃO EAD',
  linha1 TEXT DEFAULT '',
  linha2 TEXT DEFAULT '',
  detalhe TEXT DEFAULT '',
  palavras_foto TEXT DEFAULT '',
  foto TEXT DEFAULT '',
  ativo INTEGER DEFAULT 1,
  ultimo_post TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tutoras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  whatsapp TEXT DEFAULT '',
  polo_id INTEGER REFERENCES polos(id),
  foto TEXT DEFAULT '',
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS segmentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  subtitulo TEXT DEFAULT '',
  ordem INTEGER DEFAULT 0,
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS curso_segmento (
  curso_id INTEGER NOT NULL,
  segmento_id INTEGER NOT NULL,
  prioridade INTEGER DEFAULT 1,
  PRIMARY KEY (curso_id, segmento_id)
);
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  nome_fantasia TEXT DEFAULT '',
  segmento_id INTEGER,
  cidade TEXT DEFAULT '',
  polo_id INTEGER,
  tutora_id INTEGER,
  contato_nome TEXT DEFAULT '',
  contato_whatsapp TEXT DEFAULT '',
  contato_email TEXT DEFAULT '',
  observacoes TEXT DEFAULT '',
  ativo INTEGER DEFAULT 1,
  proposta TEXT DEFAULT '',
  arquivo TEXT DEFAULT '',
  gerado_em TEXT DEFAULT '',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS auto_ignoradas (
  chave TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS fotos_usadas (
  pexels_id TEXT PRIMARY KEY,
  arquivo TEXT,
  usado_em TEXT DEFAULT (datetime('now','localtime'))
);
`);

// ---------- Migrações (acrescentam colunas sem apagar dados) ----------
function garantirColuna(tabela, coluna, definicao) {
  const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some(c => c.name === coluna);
  if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}
garantirColuna('publicacoes', 'auto_chave', 'TEXT');
garantirColuna('publicacoes', 'origem', "TEXT DEFAULT 'manual'");
garantirColuna('tipos', 'palavras_foto', "TEXT DEFAULT ''");
garantirColuna('tipos', 'icone', "TEXT DEFAULT ''");
// Grupo do tipo na Nova publicação: 'comercial' (captação e campanhas) ou 'pedagogico' (avisos para alunos)
garantirColuna('tipos', 'grupo', "TEXT DEFAULT ''");
garantirColuna('cursos', 'icone', "TEXT DEFAULT ''");
for (const col of ['preco_cheio', 'preco_desconto', 'desconto', 'link', 'primeira']) garantirColuna('cursos', col, "TEXT DEFAULT ''");
garantirColuna('publicacoes', 'tutora_id', 'INTEGER');
garantirColuna('publicacoes', 'whatsapp_channel_id', 'TEXT');
garantirColuna('publicacoes', 'whatsapp_channel_name', 'TEXT');
garantirColuna('publicacoes', 'whatsapp_channel_message_id', 'TEXT');
garantirColuna('publicacoes', 'whatsapp_channel_published_at', 'TEXT');
garantirColuna('publicacoes', 'whatsapp_channel_status', "TEXT DEFAULT ''");
garantirColuna('publicacoes', 'whatsapp_channel_error', 'TEXT');
garantirColuna('publicacoes', 'whatsapp_agendada_em', 'TEXT');
garantirColuna('cursos', 'em_propostas', 'INTEGER DEFAULT 1');
// Grupo de campanha do curso (ex.: "Esquenta Black · Semanas 1 e 2"): marca os cursos da campanha na Nova publicação
garantirColuna('cursos', 'campanha', "TEXT DEFAULT ''");
// Opção "Mostrar o ano nas datas" por tipo (nasce ligada no Vencimento de atividades)
if (!db.prepare('PRAGMA table_info(tipos)').all().some(c => c.name === 'data_completa')) {
  db.exec('ALTER TABLE tipos ADD COLUMN data_completa INTEGER DEFAULT 0');
  db.exec("UPDATE tipos SET data_completa = 1 WHERE id = 'atividades'");
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ix_pub_auto ON publicacoes(auto_chave) WHERE auto_chave IS NOT NULL;');

// ---------- Dados iniciais (só na primeira execução) ----------
const CAMPOS_AGENDAMENTO = [
  { chave: 'agend_inicio', rotulo: 'Agendamento: início', tipo: 'date' },
  { chave: 'agend_fim', rotulo: 'Agendamento: fim', tipo: 'date' },
  { chave: 'real_inicio', rotulo: 'Realização: início', tipo: 'date' },
  { chave: 'real_fim', rotulo: 'Realização: fim', tipo: 'date' },
  { chave: 'orientacao', rotulo: 'Orientação (use *texto* para destacar)', tipo: 'text', padrao: 'Agende pelo link *Avaliação Digital* no Portal Stude' }
];
const CAMPOS_ARRASTO = [
  { chave: 'limite', rotulo: 'Data limite do desconto (o automático usa o dia 20)', tipo: 'date' },
  { chave: 'titulo', rotulo: 'Título', tipo: 'text', padrao: 'Solicite o seu boleto atualizado' },
  { chave: 'subtitulo', rotulo: 'Subtítulo (ciano)', tipo: 'text', padrao: 'e mantenha o seu desconto' },
  { chave: 'rotulo_data', rotulo: 'Texto acima da data', tipo: 'text', padrao: 'até o dia' },
  { chave: 'alerta', rotulo: 'Alerta (amarelo)', tipo: 'text', padrao: 'Depois dessa data, o desconto é perdido' },
  { chave: 'contato_titulo', rotulo: 'Cartão: título', tipo: 'text', padrao: 'Peça o seu boleto atualizado' },
  { chave: 'contato_texto', rotulo: 'Cartão: texto', tipo: 'text', padrao: 'Fale com o polo pelo WhatsApp.' }
];
const LEGENDA_ARRASTO = 'Atenção, aluno! Solicite o seu boleto atualizado até {limite} e mantenha o seu desconto.\n\nPeça pelo WhatsApp do Polo {polo}: {whatsapp}.';
const CHAMADA_CURSO = 'Você mais longe dos seus *objetivos*';
const LEGENDA_AGENDAMENTO = 'Atenção, aluno! O agendamento de provas está aberto.\n\nAgendamento: {agend_periodo}\nRealização: {real_periodo}\n\nO agendamento é feito pelo link Avaliação Digital, no menu do Portal Stude.\n\nDúvidas? Fale com o Polo {polo}: {whatsapp}';

// Esquenta Black por curso: nome, grau e ícone do curso (sem preço). Curso vazio = Esquenta geral.
const CAMPOS_CURSO_ESQUENTA = [
  { chave: 'linha1', rotulo: 'Grau (branco; só aparece com curso)', tipo: 'text', padrao: '' },
  { chave: 'linha2', rotulo: 'Modalidade (ciano; só aparece com curso)', tipo: 'text', padrao: '' },
  { chave: 'curso', rotulo: 'Nome do curso (vazio = Esquenta geral, com a chamada)', tipo: 'text', padrao: '' }
];
const ICONE_ESQUENTA = { chave: 'icone', rotulo: 'Ícone (vazio = automático pelo nome do curso)', tipo: 'icone', padrao: '' };
const LEGENDA_ESQUENTA_68 = 'Esquenta Black na UniCesumar, Polo {polo}!\n\n{contagem_frase}A Black Friday começa em {inicio}.\n{destaque_antes} {destaque} {destaque_depois}!\n\nGaranta a sua vaga antes: chame o polo no WhatsApp {whatsapp} e receba a oferta em primeira mão.';
const OBS_OFERTA = 'Consulte as condições comerciais vigentes.';

const TIPOS_INICIAIS = [
  {
    id: 'curso', nome: 'Divulgação de curso', ordem: 1, icone: 'capelo',
    descricao: 'Captação: divulga um curso com chamada para matrícula.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'nivel', rotulo: 'Selo (topo)', tipo: 'text', padrao: 'GRADUAÇÃO EAD' },
      { chave: 'linha1', rotulo: 'Linha 1 (branca)', tipo: 'text', padrao: 'Licenciatura' },
      { chave: 'linha2', rotulo: 'Linha 2 (ciano)', tipo: 'text', padrao: 'Semipresencial' },
      { chave: 'curso', rotulo: 'Nome do curso', tipo: 'text', padrao: '' },
      { chave: 'detalhe', rotulo: 'Detalhe (opcional)', tipo: 'text', padrao: '' },
      { chave: 'chamada', rotulo: 'Chamada ao lado do ícone', tipo: 'text', padrao: CHAMADA_CURSO },
      { chave: 'icone', rotulo: 'Ícone (vazio = automático pelo nome do curso)', tipo: 'icone', padrao: '' }
    ],
    legenda: '{curso} na UniCesumar, Polo {polo}.\n{linha1} {linha2}.\n\nMatricule-se: inscricoes.unicesumar.edu.br\nWhatsApp: {whatsapp}\nEndereço: {endereco}'
  },
  {
    id: 'agendamento', nome: 'Agendamento de provas', ordem: 2, icone: 'calendario',
    descricao: 'Período de agendamento e de realização das provas.',
    formatos: ['feed', 'story'], contato: 'pedagogico',
    campos: CAMPOS_AGENDAMENTO,
    legenda: LEGENDA_AGENDAMENTO
  },
  {
    id: 'sub', nome: 'Prova substitutiva', ordem: 3, icone: 'prancheta',
    descricao: 'Nota publicada e período da prova substitutiva.',
    formatos: ['feed'], contato: 'pedagogico',
    campos: [
      { chave: 'passo1_titulo', rotulo: 'Passo 1: título', tipo: 'text', padrao: 'A nota já foi publicada' },
      { chave: 'passo1_texto', rotulo: 'Passo 1: texto', tipo: 'text', padrao: 'Consulte em *Portal Stude › Boletim*' },
      { chave: 'passo2_titulo', rotulo: 'Passo 2: título', tipo: 'text', padrao: 'Média abaixo do mínimo? Agende a prova' },
      { chave: 'passo2_texto', rotulo: 'Passo 2: texto', tipo: 'text', padrao: 'Pelo link *Avaliação Digital* no Portal Stude' },
      { chave: 'agend_inicio', rotulo: 'Agendamento: início', tipo: 'date' },
      { chave: 'agend_fim', rotulo: 'Agendamento: fim', tipo: 'date' },
      { chave: 'real_inicio', rotulo: 'Realização: início', tipo: 'date' },
      { chave: 'real_fim', rotulo: 'Realização: fim', tipo: 'date' }
    ],
    legenda: 'Atenção, aluno! As notas já foram publicadas: consulte em Portal Stude > Boletim.\n\nCaso sua média esteja abaixo do mínimo exigido, agende a prova substitutiva pelo link Avaliação Digital no Portal Stude.\n\nAgendamento: {agend_periodo}\nRealização: {real_periodo}\n\nDúvidas? Polo {polo}: {whatsapp}'
  },
  {
    id: 'boleto', nome: 'Vencimento de boleto', ordem: 4, icone: 'boleto',
    descricao: 'Lembrete de vencimento com contato para negociação.',
    formatos: ['feed'], contato: 'vendas',
    campos: [
      { chave: 'vencimento', rotulo: 'Data de vencimento', tipo: 'date' },
      { chave: 'alerta', rotulo: 'Alerta (amarelo)', tipo: 'text', padrao: 'Pague até o vencimento e evite juros' },
      { chave: 'negociacao_titulo', rotulo: 'Cartão: título', tipo: 'text', padrao: 'Valores em aberto?' },
      { chave: 'negociacao_texto', rotulo: 'Cartão: texto', tipo: 'text', padrao: 'Negocie direto com o polo pelo WhatsApp.' }
    ],
    legenda: 'Atenção, aluno! Seu boleto vence em {vencimento}. Pague até o vencimento e evite juros.\n\nValores em aberto? Negocie com o Polo {polo} pelo WhatsApp {whatsapp}.'
  },
  {
    id: 'arrasto', nome: 'Arrasto de boleto', ordem: 5, icone: 'etiqueta',
    descricao: 'Depois do vencimento: ainda dá para pagar com desconto até o dia limite.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: CAMPOS_ARRASTO,
    legenda: LEGENDA_ARRASTO
  },
  {
    id: 'atividades', nome: 'Vencimento de atividades', ordem: 6, icone: 'checklist',
    descricao: 'Prazos da Atividade 1, 2, 3 e do MAPA. Linhas sem data não aparecem.',
    formatos: ['feed', 'story'], contato: 'pedagogico',
    campos: [
      { chave: 'modulo', rotulo: 'Módulo ou turma (opcional)', tipo: 'text', padrao: '' },
      { chave: 'nome1', rotulo: 'Nome 1', tipo: 'text', padrao: 'ATIVIDADE 1' }, { chave: 'ativ1', rotulo: 'Prazo 1', tipo: 'date' },
      { chave: 'nome2', rotulo: 'Nome 2', tipo: 'text', padrao: 'ATIVIDADE 2' }, { chave: 'ativ2', rotulo: 'Prazo 2', tipo: 'date' },
      { chave: 'nome3', rotulo: 'Nome 3', tipo: 'text', padrao: 'ATIVIDADE 3' }, { chave: 'ativ3', rotulo: 'Prazo 3', tipo: 'date' },
      { chave: 'nome4', rotulo: 'Nome 4', tipo: 'text', padrao: 'MAPA' }, { chave: 'ativ4', rotulo: 'Prazo 4', tipo: 'date' },
      { chave: 'orientacao', rotulo: 'Orientação (use *texto* para destacar)', tipo: 'text', padrao: 'Acesse o *Portal Stude* e não deixe para a última hora' }
    ],
    legenda: 'Atenção, aluno! Confira os prazos das atividades:\n\n{prazos}\n\nNão deixe para a última hora.\n\nDúvidas? Fale com o Polo {polo}: {whatsapp}'
  },
  {
    id: 'tutora', nome: 'Cartão da tutora', ordem: 7, icone: 'celular',
    descricao: 'Foto, nome e WhatsApp da tutora, para ela divulgar. Gere uma arte por tutora.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'chamada_topo', rotulo: 'Chamada acima do nome', tipo: 'text', padrao: 'Fale com' },
      { chave: 'cargo', rotulo: 'Cargo (abaixo do nome)', tipo: 'text', padrao: 'Consultora de matrículas' },
      { chave: 'mensagem', rotulo: 'Mensagem (use *texto* para destacar)', tipo: 'text', padrao: 'Tire suas dúvidas e garanta sua vaga na *UniCesumar*' },
      { chave: 'cta', rotulo: 'Texto do botão', tipo: 'text', padrao: 'Chame no WhatsApp' }
    ],
    legenda: 'Quer estudar na UniCesumar? Fale com {tutora}, do Polo {polo}, e tire todas as suas dúvidas.\n\nWhatsApp: {whatsapp}\nInscrições: inscricoes.unicesumar.edu.br'
  },
  {
    id: 'empresas', nome: 'Tutora para empresas', ordem: 8, icone: 'maleta',
    descricao: 'Proposta de parceria para RH e gestores, com a foto e o WhatsApp da tutora.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'selo', rotulo: 'Selo do topo', tipo: 'text', padrao: 'PARCERIA EMPRESARIAL' },
      { chave: 'titulo', rotulo: 'Título', tipo: 'text', padrao: 'Educação para a sua equipe' },
      { chave: 'subtitulo', rotulo: 'Subtítulo (ciano)', tipo: 'text', padrao: 'Graduação e pós-graduação para os seus colaboradores' },
      { chave: 'cargo', rotulo: 'Cargo da tutora', tipo: 'text', padrao: 'Consultora de parcerias empresariais' },
      { chave: 'beneficio1', rotulo: 'Benefício 1 (vazio = não aparece)', tipo: 'text', padrao: 'Cursos EAD e semipresenciais reconhecidos pelo MEC' },
      { chave: 'beneficio2', rotulo: 'Benefício 2', tipo: 'text', padrao: 'Condições especiais para colaboradores' },
      { chave: 'beneficio3', rotulo: 'Benefício 3', tipo: 'text', padrao: 'Apresentação e atendimento na sua empresa' },
      { chave: 'cta', rotulo: 'Chamada do cartão', tipo: 'text', padrao: 'Agende uma conversa' }
    ],
    legenda: 'Olá! Sou {tutora}, consultora do Polo {polo} da UniCesumar.\n\nQue tal oferecer graduação e pós-graduação para a sua equipe? Podemos montar uma parceria para os colaboradores da sua empresa, com cursos EAD e semipresenciais.\n\nPosso apresentar a proposta? Meu WhatsApp: {whatsapp}'
  },
  {
    id: 'oferta', nome: 'Oferta do curso', ordem: 9, icone: 'etiqueta',
    descricao: 'Captação com preço: 1ª mensalidade, desconto e mensalidade do curso no polo.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'selo', rotulo: 'Selo do topo', tipo: 'text', padrao: 'OFERTA ESPECIAL' },
      { chave: 'linha1', rotulo: 'Grau (branco)', tipo: 'text', padrao: 'Licenciatura' },
      { chave: 'linha2', rotulo: 'Modalidade (ciano)', tipo: 'text', padrao: 'Semipresencial' },
      { chave: 'curso', rotulo: 'Nome do curso', tipo: 'text', padrao: '' },
      { chave: 'primeira_rotulo', rotulo: 'Texto acima da 1ª mensalidade', tipo: 'text', padrao: '1ª mensalidade por' },
      { chave: 'primeira', rotulo: '1ª mensalidade', tipo: 'text', padrao: '' },
      { chave: 'desconto', rotulo: 'Desconto (amarelo; vazio = não aparece)', tipo: 'text', padrao: 'condição especial' },
      { chave: 'desconto_rotulo', rotulo: 'Texto do desconto', tipo: 'text', padrao: 'nas demais mensalidades' },
      { chave: 'mensalidade_rotulo', rotulo: 'Texto antes da mensalidade', tipo: 'text', padrao: 'Mensalidade com desconto:' },
      { chave: 'preco_cheio', rotulo: 'Mensalidade cheia (riscada; opcional)', tipo: 'text', padrao: '' },
      { chave: 'mensalidade', rotulo: 'Mensalidade com desconto (vazio = linha some)', tipo: 'text', padrao: '' },
      { chave: 'observacao', rotulo: 'Observação (rodapé da oferta)', tipo: 'text', padrao: OBS_OFERTA },
      { chave: 'icone', rotulo: 'Ícone (vazio = automático pelo nome do curso)', tipo: 'icone', padrao: '' }
    ],
    legenda: '{curso} na UniCesumar, Polo {polo}.\n{linha1} {linha2}.\n\n{primeira_rotulo} {primeira} e {desconto} {desconto_rotulo}.\n\n{observacao}\n\nMatricule-se: inscricoes.unicesumar.edu.br\nWhatsApp: {whatsapp}'
  },
  {
    id: 'numeros', nome: 'Por que a UniCesumar', ordem: 10, icone: 'trofeu',
    descricao: 'Captação institucional: quatro números da UniCesumar. Itens vazios não aparecem.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'titulo', rotulo: 'Título (use *texto* para destacar)', tipo: 'text', padrao: 'Por que estudar na *UniCesumar*?' },
      { chave: 'num1', rotulo: 'Número 1', tipo: 'text', padrao: 'Nota máxima' }, { chave: 'txt1', rotulo: 'Texto 1', tipo: 'text', padrao: 'no MEC' },
      { chave: 'num2', rotulo: 'Número 2', tipo: 'text', padrao: '' }, { chave: 'txt2', rotulo: 'Texto 2', tipo: 'text', padrao: 'dos alunos empregados' },
      { chave: 'num3', rotulo: 'Número 3', tipo: 'text', padrao: '' }, { chave: 'txt3', rotulo: 'Texto 3', tipo: 'text', padrao: 'dos alunos indicam a UniCesumar' },
      { chave: 'num4', rotulo: 'Número 4', tipo: 'text', padrao: '+400 mil' }, { chave: 'txt4', rotulo: 'Texto 4', tipo: 'text', padrao: 'alunos' },
      { chave: 'cta', rotulo: 'Chamada final', tipo: 'text', padrao: 'Venha estudar com a gente' }
    ],
    legenda: 'Por que estudar na UniCesumar?\n\n{num1} {txt1}\n{num2} {txt2}\n{num3} {txt3}\n{num4} {txt4}\n\nFale com o Polo {polo}: {whatsapp}\nInscrições: inscricoes.unicesumar.edu.br'
  },
  {
    id: 'ingresso', nome: 'Vestibular e ENEM', ordem: 11, icone: 'prancheta',
    descricao: 'Captação: formas de ingresso (vestibular on-line gratuito ou nota do ENEM).',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'selo', rotulo: 'Selo do topo', tipo: 'text', padrao: 'INSCRIÇÕES ABERTAS' },
      { chave: 'titulo', rotulo: 'Título (use *texto* para destacar)', tipo: 'text', padrao: 'Comece a sua *graduação*' },
      { chave: 'opcao1_titulo', rotulo: 'Opção 1: título', tipo: 'text', padrao: 'Vestibular on-line gratuito' },
      { chave: 'opcao1_texto', rotulo: 'Opção 1: texto', tipo: 'text', padrao: 'Faça de casa, só com o seu CPF' },
      { chave: 'opcao2_titulo', rotulo: 'Opção 2: título', tipo: 'text', padrao: 'Use a sua nota do ENEM' },
      { chave: 'opcao2_texto', rotulo: 'Opção 2: texto', tipo: 'text', padrao: 'Entre na graduação com o seu resultado do ENEM' },
      { chave: 'opcao3_titulo', rotulo: 'Opção 3: título (vazio = não aparece)', tipo: 'text', padrao: '' },
      { chave: 'opcao3_texto', rotulo: 'Opção 3: texto', tipo: 'text', padrao: '' },
      { chave: 'cta', rotulo: 'Chamada do cartão', tipo: 'text', padrao: 'Faça a sua inscrição com o polo' }
    ],
    legenda: 'Inscrições abertas na UniCesumar, Polo {polo}!\n\nFaça o vestibular on-line gratuito, só com o seu CPF, ou use a sua nota do ENEM.\n\nInscrições: inscricoes.unicesumar.edu.br\nWhatsApp: {whatsapp}'
  },
  {
    id: 'esquenta', nome: 'Esquenta Black', ordem: 12, icone: 'fogo',
    descricao: 'Campanha: aquece para a Black Friday, com a data de início e a contagem regressiva automática.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'selo', rotulo: 'Selo do topo', tipo: 'text', padrao: 'POR TEMPO LIMITADO' },
      { chave: 'titulo1', rotulo: 'Título: linha 1 (branca)', tipo: 'text', padrao: 'ESQUENTA' },
      { chave: 'titulo2', rotulo: 'Título: linha 2 (contorno)', tipo: 'text', padrao: 'BLACK' },
      { chave: 'chamada', rotulo: 'Chamada (use *texto* para destacar)', tipo: 'text', padrao: 'Os *maiores descontos do ano* para começar a sua graduação estão chegando' },
      ...CAMPOS_CURSO_ESQUENTA,
      { chave: 'inicio', rotulo: 'Início da Black Friday (vazio = não aparece)', tipo: 'date' },
      { chave: 'inicio_rotulo', rotulo: 'Texto acima da data', tipo: 'text', padrao: 'A Black começa em' },
      { chave: 'contagem', rotulo: 'Faltam quantos dias (vazio = calcula pela data de publicação)', tipo: 'text', padrao: '' },
      { chave: 'destaque_antes', rotulo: 'Faixa amarela: texto antes', tipo: 'text', padrao: 'Condição especial de' },
      { chave: 'destaque', rotulo: 'Faixa amarela: desconto (vazio = a faixa some)', tipo: 'text', padrao: 'condição especial' },
      { chave: 'destaque_depois', rotulo: 'Faixa amarela: texto depois', tipo: 'text', padrao: '(condição promocional)' },
      { chave: 'cta_titulo', rotulo: 'Cartão: título', tipo: 'text', padrao: 'Garanta a sua vaga antes' },
      { chave: 'cta_texto', rotulo: 'Cartão: texto', tipo: 'text', padrao: 'Chame o polo no WhatsApp e receba a oferta em primeira mão.' },
      ICONE_ESQUENTA
    ],
    legenda: 'Esquenta Black na UniCesumar, Polo {polo}!\n\n{curso_frase}{contagem_frase}A Black Friday começa em {inicio}.\n{destaque_antes} {destaque} {destaque_depois}!\n\nGaranta a sua vaga antes: chame o polo no WhatsApp {whatsapp} e receba a oferta em primeira mão.'
  },
  {
    id: 'black', nome: 'Black Friday', ordem: 13, icone: 'sacola',
    descricao: 'Campanha: oferta da Black Friday, geral ou de um curso cadastrado, com validade.',
    formatos: ['feed', 'story'], contato: 'vendas',
    campos: [
      { chave: 'selo', rotulo: 'Selo do topo', tipo: 'text', padrao: 'SÓ ESTA SEMANA' },
      { chave: 'titulo1', rotulo: 'Título: linha 1 (branca)', tipo: 'text', padrao: 'BLACK' },
      { chave: 'titulo2', rotulo: 'Título: linha 2 (contorno)', tipo: 'text', padrao: 'FRIDAY' },
      { chave: 'faixa', rotulo: 'Fita amarela (vazio = não aparece)', tipo: 'text', padrao: 'BLACK FRIDAY UNICESUMAR' },
      { chave: 'linha1', rotulo: 'Grau (branco)', tipo: 'text', padrao: 'Graduação' },
      { chave: 'linha2', rotulo: 'Modalidade (ciano)', tipo: 'text', padrao: 'EAD e semipresencial' },
      { chave: 'curso', rotulo: 'Nome do curso (vazio = oferta geral)', tipo: 'text', padrao: '' },
      { chave: 'primeira_rotulo', rotulo: 'Texto acima da 1ª mensalidade', tipo: 'text', padrao: '1ª mensalidade por' },
      { chave: 'primeira', rotulo: '1ª mensalidade', tipo: 'text', padrao: '' },
      { chave: 'desconto', rotulo: 'Desconto (amarelo; vazio = não aparece)', tipo: 'text', padrao: 'condição especial' },
      { chave: 'desconto_rotulo', rotulo: 'Texto do desconto', tipo: 'text', padrao: 'nas demais mensalidades' },
      { chave: 'mensalidade_rotulo', rotulo: 'Texto antes da mensalidade', tipo: 'text', padrao: 'Mensalidade com desconto:' },
      { chave: 'preco_cheio', rotulo: 'Mensalidade cheia (riscada; opcional)', tipo: 'text', padrao: '' },
      { chave: 'mensalidade', rotulo: 'Mensalidade com desconto (vazio = linha some)', tipo: 'text', padrao: '' },
      { chave: 'validade', rotulo: 'Oferta válida até (vazio = não aparece)', tipo: 'date' },
      { chave: 'validade_rotulo', rotulo: 'Texto antes da validade', tipo: 'text', padrao: 'Oferta válida até' },
      { chave: 'observacao', rotulo: 'Observação (rodapé da oferta)', tipo: 'text', padrao: OBS_OFERTA },
      { chave: 'cta', rotulo: 'Chamada do botão', tipo: 'text', padrao: 'Matricule-se' },
      { chave: 'icone', rotulo: 'Ícone (vazio = automático pelo nome do curso)', tipo: 'icone', padrao: '' }
    ],
    legenda: 'É Black Friday na UniCesumar, Polo {polo}!\n\n{curso_frase}{primeira_rotulo} {primeira} e {desconto} {desconto_rotulo}.\n{validade_frase}\n{observacao}\n\nMatricule-se: inscricoes.unicesumar.edu.br\nWhatsApp: {whatsapp}'
  }
];

function seed() {
  const temPolo = db.prepare('SELECT COUNT(*) n FROM polos').get().n;
  if (!temPolo) {
    db.prepare(`INSERT INTO polos (nome, endereco, whatsapp_vendas, whatsapp_pedagogico, horario, instagram)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'Unidade', '', '', '', '', '');
  }
  const insTipo = db.prepare(`INSERT OR IGNORE INTO tipos (id, nome, descricao, formatos, contato, legenda_padrao, campos, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const t of TIPOS_INICIAIS) {
    insTipo.run(t.id, t.nome, t.descricao, JSON.stringify(t.formatos), t.contato, t.legenda, JSON.stringify(t.campos), t.ordem);
  }
  if (!db.prepare("SELECT COUNT(*) n FROM config WHERE chave = 'ano_atividades_aplicado'").get().n) {
    db.exec("UPDATE tipos SET data_completa = 1 WHERE id = 'atividades'");
    db.prepare("INSERT OR IGNORE INTO config (chave, valor) VALUES ('ano_atividades_aplicado', '1')").run();
  }
  // Grupo padrão de cada tipo (só preenche os vazios: o que você mudar em Tipos e legendas fica)
  const PEDAGOGICOS = ['agendamento', 'sub', 'atividades', 'boleto', 'arrasto'];
  for (const t of db.prepare("SELECT id FROM tipos WHERE grupo IS NULL OR grupo = ''").all())
    db.prepare('UPDATE tipos SET grupo = ? WHERE id = ?').run(PEDAGOGICOS.includes(t.id) ? 'pedagogico' : 'comercial', t.id);
  // Ordem dentro das abas (uma vez): captação e campanhas, depois tutoras e empresas; avisos de aluno por último
  if (!db.prepare("SELECT 1 FROM config WHERE chave = 'ordem_grupos_aplicado'").get()) {
    ['curso', 'oferta', 'numeros', 'ingresso', 'esquenta', 'black', 'tutora', 'empresas', 'agendamento', 'sub', 'atividades', 'boleto', 'arrasto']
      .forEach((id, i) => db.prepare('UPDATE tipos SET ordem = ? WHERE id = ?').run(i + 1, id));
    db.prepare("INSERT INTO config (chave, valor) VALUES ('ordem_grupos_aplicado', '1')").run();
  }
  // Ícone padrão de cada tipo (as artes usam ícone no lugar de foto)
  const updIcone = db.prepare("UPDATE tipos SET icone = ? WHERE id = ? AND (icone IS NULL OR icone = '')");
  for (const t of TIPOS_INICIAIS) updIcone.run(t.icone, t.id);

  // Migração: o Agendamento de provas passou a ter período de agendamento e de realização (como a SUB)
  const ag = db.prepare("SELECT campos FROM tipos WHERE id = 'agendamento'").get();
  if (ag && ag.campos.includes('agendar_ate')) {
    db.prepare("UPDATE tipos SET campos = ?, legenda_padrao = ?, descricao = ? WHERE id = 'agendamento'")
      .run(JSON.stringify(CAMPOS_AGENDAMENTO), LEGENDA_AGENDAMENTO, 'Período de agendamento e de realização das provas.');
  }
  // Migração: Arrasto da versão 6.0 passa para o texto "Solicite o seu boleto atualizado... mantenha o desconto"
  const arr = db.prepare("SELECT campos, legenda_padrao FROM tipos WHERE id = 'arrasto'").get();
  if (arr && !arr.campos.includes('rotulo_data')) {
    db.prepare("UPDATE tipos SET campos = ?, legenda_padrao = ? WHERE id = 'arrasto'").run(JSON.stringify(CAMPOS_ARRASTO), LEGENDA_ARRASTO);
  }
  // Migração 6.9: o Esquenta Black ganhou curso (nome, grau e ícone), sem apagar textos que você já editou
  const esq = db.prepare("SELECT campos, legenda_padrao FROM tipos WHERE id = 'esquenta'").get();
  if (esq) {
    let campos = JSON.parse(esq.campos);
    if (!campos.some(c => c.chave === 'curso')) {
      const i = campos.findIndex(c => c.chave === 'chamada');
      campos.splice(i >= 0 ? i + 1 : campos.length, 0, ...CAMPOS_CURSO_ESQUENTA);
      if (!campos.some(c => c.chave === 'icone')) campos.push(ICONE_ESQUENTA);
      const leg = esq.legenda_padrao === LEGENDA_ESQUENTA_68 ? TIPOS_INICIAIS.find(t => t.id === 'esquenta').legenda : esq.legenda_padrao;
      db.prepare("UPDATE tipos SET campos = ?, legenda_padrao = ? WHERE id = 'esquenta'").run(JSON.stringify(campos), leg);
    }
  }
  // Migração: o tipo Curso ganhou chamada e ícone automático pelo nome do curso
  const tc = db.prepare("SELECT campos FROM tipos WHERE id = 'curso'").get();
  if (tc) {
    let campos = JSON.parse(tc.campos); const antes = JSON.stringify(campos);
    if (!campos.some(c => c.chave === 'chamada')) {
      const i = campos.findIndex(c => c.chave === 'detalhe');
      campos.splice(i >= 0 ? i + 1 : campos.length, 0, { chave: 'chamada', rotulo: 'Chamada ao lado do ícone', tipo: 'text', padrao: CHAMADA_CURSO });
    }
    const ic = campos.find(c => c.chave === 'icone');
    if (!ic || ic.padrao === 'maca') {
      campos = campos.filter(c => c.chave !== 'icone');
      campos.push({ chave: 'icone', rotulo: 'Ícone (vazio = automático pelo nome do curso)', tipo: 'icone', padrao: '' });
    }
    if (JSON.stringify(campos) !== antes) db.prepare("UPDATE tipos SET campos = ? WHERE id = 'curso'").run(JSON.stringify(campos));
  }

  // Catálogo comercial privado: cursos são carregados na interface ou no banco persistente.
  if (!db.prepare("SELECT 1 FROM config WHERE chave = 'catalogo20_aplicado'").get()) {
    db.prepare("INSERT INTO config (chave, valor) VALUES ('catalogo20_aplicado', '1')").run();
  }
  // Campanhas e cursos comerciais são carregados apenas dos dados privados do sistema.
  if (!db.prepare("SELECT 1 FROM config WHERE chave = 'esquenta_s12_aplicado'").get()) {
    db.prepare("INSERT INTO config (chave, valor) VALUES ('esquenta_s12_aplicado', '1')").run();
  }
  for (const c of db.prepare("SELECT id, curso FROM cursos WHERE icone IS NULL OR icone = ''").all())
    db.prepare('UPDATE cursos SET icone = ? WHERE id = ?').run(sugerirIcone(c.curso), c.id);

  // Propostas empresariais: segmentos iniciais e sugestão inicial de cursos (uma única vez; depois, pelo painel)
  if (!db.prepare("SELECT 1 FROM config WHERE chave = 'segmentos_aplicado'").get()) {
    const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const cursosDb = db.prepare('SELECT id, curso, linha1 FROM cursos').all();
    const acharCurso = ref => {
      const m = /^(.*?)\s*\((.+)\)$/.exec(ref); const nome = m ? m[1] : ref; const grau = m ? m[2] : '';
      return cursosDb.find(c => norm(c.curso) === norm(nome) && (!grau || norm(c.linha1) === norm(grau)));
    };
    const insSeg = db.prepare('INSERT INTO segmentos (nome, subtitulo, ordem) VALUES (?, ?, ?)');
    const insLig = db.prepare('INSERT OR IGNORE INTO curso_segmento (curso_id, segmento_id, prioridade) VALUES (?, ?, ?)');
    require('./segmentos-catalogo').forEach(([nome, lista], i) => {
      const existente = db.prepare('SELECT id FROM segmentos WHERE nome = ?').get(nome);
      const segId = existente ? existente.id : Number(insSeg.run(nome, nome === 'Outros' ? 'Cursos indicados para a sua equipe' : `Cursos indicados para ${nome.charAt(0).toLowerCase() + nome.slice(1)}`, i + 1).lastInsertRowid);
      lista.forEach((ref, k) => { const c = acharCurso(ref); if (c) insLig.run(c.id, segId, k + 1); });
    });
    db.prepare("INSERT INTO config (chave, valor) VALUES ('segmentos_aplicado', '1')").run();
  }

  const padrao = { porta: '3210', navegador: '', backup_pasta: '',
    supabase_url: '', supabase_key: '', supabase_bucket: 'artes', meta_versao: 'v25.0',
    // Automações
    auto_aprovar: '0', horizonte_dias: '14', feriados_extras: '',
    boleto_ativo: '1', boleto_dia: '10', boleto_dias_antes: '3', boleto_hora: '09:00', boleto_formatos: 'feed',
    arrasto_ativo: '1', arrasto_dia: '20', arrasto_dias_antes: '5,1', arrasto_hora: '09:00', arrasto_formatos: 'feed',
    cursos_ativo: '0', cursos_dias: '2,4', cursos_hora: '18:00', cursos_formatos: 'feed,story', cursos_por_dia: '1', cursos_modelo: 'alternar',
    // Propostas empresariais (textos da arte horizontal)
    proposta_chamada: 'Educação para a *sua equipe*', proposta_cargo: 'Consultora de carreiras',
    proposta_titulo: 'Capacitação para os colaboradores da sua empresa', proposta_faixa: 'PROPOSTA PARA {empresa}',
    proposta_whats_rotulo: 'Fale comigo no WhatsApp', proposta_rodape: 'Graduação EAD e semipresencial', proposta_site: 'unicesumar.edu.br' };
  const insCfg = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
  for (const [k, v] of Object.entries(padrao)) insCfg.run(k, v);
}
seed();

function getConfig() {
  const o = {};
  for (const r of db.prepare('SELECT chave, valor FROM config').all()) o[r.chave] = r.valor;
  return o;
}
function setConfig(obj) {
  const st = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(obj)) st.run(k, String(v ?? ''));
}

function tipoRow(r) {
  if (!r) return r;
  return { ...r, formatos: JSON.parse(r.formatos), campos: JSON.parse(r.campos) };
}

module.exports = { db, DB_PATH, DATA_DIR, getConfig, setConfig, tipoRow };
