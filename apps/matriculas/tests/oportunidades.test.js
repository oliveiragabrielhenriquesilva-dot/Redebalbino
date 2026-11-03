'use strict';
// Testes das regras do Balbino Oportunidades: importação com prévia, preservação de dados manuais,
// conciliação de RA, permissões por polo e exportação. Usa um banco temporário (nunca o banco real).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oportunidades-teste-'));
process.env.MATRICULAS_DATA_DIR = dir;
const { db, oportunidades: op } = require('../server.js');

db.exec(`INSERT OR IGNORE INTO categorias(id,nome,ordem) VALUES(1,'Graduação',1);
INSERT OR IGNORE INTO produtos(id,nome,categoria_id) VALUES(1,'Graduação',1);
INSERT OR IGNORE INTO polos(id,nome,ordem) VALUES(1,'Franca',1),(2,'Batatais',2);
INSERT OR IGNORE INTO tutores(id,nome) VALUES(1,'Ana'),(2,'Bruno');
INSERT OR IGNORE INTO tutor_polos(tutor_id,polo_id) VALUES(1,1),(2,2);
INSERT OR IGNORE INTO ciclos(id,nome,padrao) VALUES(1,'2026.1',0),(2,'2026.2',1);
INSERT OR IGNORE INTO usuarios(id,nome,login,senha_hash,papel) VALUES(1,'Admin','admin','x:y','admin');
INSERT OR IGNORE INTO ma_lista_alunos(ciclo_id,candidato,ra,nome,cpf,polo_fonte,ativo) VALUES
 (2,'C1','RA1','MARIA SOUZA','52998224725','FRANCA SP',1),
 (2,'C2','RA2','JOAO DUPLO','11144477735','FRANCA SP',1),(2,'C3','RA3','JOAO DUPLO','11144477735','FRANCA SP',1),
 (2,'C4','RA4','PEDRO SEM CPF',NULL,'BATATAIS SP',1),
 (1,'C9','RA9','LUCAS OUTRO CICLO','39053344705','BATATAIS SP',1);`);

const admin = { id: 1, nome: 'Admin', login: 'admin', papel: 'admin' };
const tutorFranca = { id: -1, nome: 'Ana', login: 'ana', papel: 'visualizador', polo_id: 1, tutor_id: 1, portal: true };
const linhas = [
  { linha: 2, identificador: '1001', nome: 'Maria Souza', cpf: '529.982.247-25', polo_fonte: 'Franca', status_origem: 'Inscrito', responsavel_origem: 'ANA', data_registro: '05/09/2026' },
  { linha: 3, identificador: '1002', nome: 'Joao Duplo', cpf: '11144477735', polo_fonte: 'Franca', status_origem: 'Boleto vencido', responsavel_origem: 'ANA', data_registro: '46280' },
  { linha: 4, identificador: '1003', nome: 'Pedro Sem Cpf', polo_fonte: 'Batatais', status_origem: 'Qualificado', responsavel_origem: 'BRUNO' },
  { linha: 5, identificador: '1004', nome: 'Lucas Outro Ciclo', cpf: '39053344705', polo_fonte: 'Batatais', status_origem: 'Boleto não gerado' },
  { linha: 6, identificador: '', nome: 'Sem chave', polo_fonte: 'Franca' },
  { linha: 7, identificador: '1001', nome: 'Repetida', polo_fonte: 'Franca' }
];

test.after(() => { try { db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });

test('prévia classifica linhas e não grava nada', () => {
  const pv = op.previaImportacao({ ciclo: 2, linhas }, admin);
  assert.deepStrictEqual([pv.totais.novos, pv.totais.ignorados], [4, 2]);
  assert.match(pv.linhas.find(l => l.linha === 6).motivos[0], /Identificador/);
  assert.match(pv.linhas.find(l => l.linha === 7).motivos[0], /Repetido/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM ma_oportunidades').get().n, 0);
  assert.throws(() => op.importar({ ciclo: 2, linhas }, admin), /confirme/);
});

test('importa, concilia RA só com CPF único no mesmo processo', () => {
  const r = op.importar({ ciclo: 2, linhas, confirmado: true, arquivo: 'a.xlsx' }, admin);
  assert.strictEqual(r.novos, 4);
  const p = op.painel({ ciclo: 2 }, admin);
  assert.strictEqual(p.kpis.total, 4);
  assert.deepStrictEqual(p.kpis.ra, { confirmado: 1, aguardando: 2, sem_ra: 1 }); // Maria; João (2 RAs) e Pedro (só nome) aguardam; Lucas tem RA em outro processo
  assert.strictEqual(p.kpis.taxa_conversao, 25);
  assert.deepStrictEqual(p.por_status.map(s => s.label).sort(), ['Boleto não gerado', 'Boleto vencido', 'Inscrito', 'Qualificado']);
});

test('tutor vê só o próprio polo e não importa nem troca responsável', () => {
  const l = op.lista({ ciclo: 2 }, tutorFranca);
  assert.strictEqual(l.total, 2);
  assert.ok(l.linhas.every(x => x.polo === 'Franca'));
  const outro = db.prepare("SELECT id FROM ma_oportunidades WHERE identificador='1003'").get().id;
  assert.throws(() => op.detalhe(outro, tutorFranca), /não encontrada/);
  const meu = db.prepare("SELECT id FROM ma_oportunidades WHERE identificador='1002'").get().id;
  assert.throws(() => op.salvar(meu, { responsavel: 't:1' }, tutorFranca), /responsável/);
  op.registrarAtendimento(meu, { data: '2026-10-20', canal: 'whatsapp', resultado: 'Contato feito', etapa: 'aguardando', proximo_contato: '2026-11-10' }, tutorFranca);
  op.salvar(meu, { responsavel: 't:1', etapa: 'negociacao', observacao: 'nota' }, admin);
});

test('reimportação atualiza a fonte e preserva etapa, responsável, atendimentos e registros ausentes', () => {
  const meu = db.prepare("SELECT id FROM ma_oportunidades WHERE identificador='1002'").get().id;
  const r = op.importar({ ciclo: 2, linhas: [{ ...linhas[1], status_origem: 'Inscrito' }], confirmado: true }, admin);
  assert.strictEqual(r.atualizados, 1);
  const o = db.prepare('SELECT * FROM ma_oportunidades WHERE id=?').get(meu);
  assert.deepStrictEqual([o.status_origem, o.etapa, o.responsavel_tutor_id, o.observacao], ['Inscrito', 'negociacao', 1, 'nota']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM ma_oportunidade_atendimentos WHERE oportunidade_id=?').get(meu).n, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM ma_oportunidades WHERE ciclo_id=2').get().n, 4);
  const d = op.detalhe(meu, admin);
  assert.ok(d.eventos.some(e => e.tipo === 'responsavel') && d.eventos.some(e => e.tipo === 'importacao'));
});

test('conciliação manual confirma RA e entra na conversão', () => {
  const meu = db.prepare("SELECT id FROM ma_oportunidades WHERE identificador='1002'").get().id;
  const lid = db.prepare("SELECT id FROM ma_lista_alunos WHERE ra='RA3'").get().id;
  assert.throws(() => op.conciliar(meu, { acao: 'confirmar', lista_id: lid }, tutorFranca), /lança/);
  op.conciliar(meu, { acao: 'confirmar', lista_id: lid }, admin);
  assert.strictEqual(op.painel({ ciclo: 2 }, admin).kpis.ra.confirmado, 2);
});

test('linha sem Identificador atualiza pelo CPF sem duplicar', () => {
  const r = op.importar({ ciclo: 2, linhas: [{ linha: 2, identificador: '', cpf: '529.982.247-25', nome: 'Maria S.', polo_fonte: 'Franca', status_origem: 'Inscrito' }], confirmado: true }, admin);
  assert.strictEqual(r.novos, 0);
  assert.strictEqual(db.prepare("SELECT identificador FROM ma_oportunidades WHERE cpf='52998224725'").get().identificador, '1001');
});

test('exportação tem o mesmo total da tela e não traz CPF completo nem telefone', () => {
  const f = { ciclo: 2, polo: '1' };
  const total = op.painel(f, admin).kpis.total;
  const csv = op.exportar({ ...f, formato: 'csv' }, admin).corpo.toString('utf8');
  assert.strictEqual(csv.trim().split('\r\n').length - 1, total);
  assert.ok(!csv.includes('52998224725') && !/telefone/i.test(csv.split('\r\n')[0]));
  const x = op.exportar({ ...f, formato: 'xlsx' }, admin).corpo;
  assert.strictEqual(x.readUInt32LE(0), 0x04034b50);
});

test('datas da planilha', () => {
  assert.strictEqual(op.dataFonte('05/09/2026').valor, '2026-09-05');
  assert.strictEqual(op.dataFonte('46270').valor, '2026-09-05');
  assert.strictEqual(op.dataFonte('31/02/2026').ok, false);
});
