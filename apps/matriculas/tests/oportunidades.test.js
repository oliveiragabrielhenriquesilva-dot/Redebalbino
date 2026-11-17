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


test('produto identifica Pós por EPOS, HPOS e sufixo sem depender de mapeamento prévio',()=>{
  db.exec(`INSERT INTO ciclos(id,nome,padrao) VALUES(90,'Teste produtos',0);
    INSERT INTO produtos(id,nome,categoria_id,subgrupo) VALUES
      (81,'Pós',1,NULL),(82,'Semi - Bem Estar',1,NULL),(83,'Semi - Farmácia e Biomedicina',1,'Semi - Saúde'),
      (84,'Semi - Nutrição',1,'Semi - Saúde'),(85,'Semi - Engenharia',1,NULL);
    INSERT INTO cursos(nome,produto_id,apelidos,polos) VALUES
      ('Estética e Cosmética',82,'Estética','1'),('Saúde Capital',82,'Saúde e Estética Capilar','1'),
      ('Farmácia',83,NULL,'1'),('Biomedicina',83,NULL,'1'),('Nutrição',84,NULL,'1'),('Engenharia',85,NULL,'1');`);
  const entries=[
    ['p1','EPOS_123','Gestão de Pessoas','Franca'],['p2','HPOS_456','Fisioterapia','Franca'],
    ['p3','','Nutrição Clínica (PÓS-GRADUAÇÃO - EAD)','Franca'],
    ['b1','ESPRE_1','Estética e Cosmética (GRADUAÇÃO - SEMIPRESENCIAL)','Franca'],
    ['b2','ESPRE_2','Saúde e Estética Capilar','Franca'],['s1','ESPRE_3','Bacharelado em Farmácia','Franca'],
    ['s2','ESPRE_4','Nutrição','Franca'],['e1','ESPRE_5','Engenharia Civil','Franca'],
    ['g1','EGRAD_55','Engenharia de Software','Franca'],['fora','ESPRE_6','Estética','Batatais']
  ];
  op.importar({ciclo:90,confirmado:true,linhas:entries.map(([identificador,curso_cod,curso_nome,polo_fonte])=>({identificador,curso_cod,curso_nome,polo_fonte,nome:'Teste '+identificador}))},admin);
  const options=op.opcoes({ciclo:90},admin);assert.ok(options.produtos.some(p=>p.value==='81'));assert.ok(options.produtos.some(p=>p.value==='grupo:semi saude'));
  const pos=op.lista({ciclo:90,produto:'81'},admin);assert.strictEqual(pos.total,3);assert.deepStrictEqual(pos.linhas.map(r=>r.identificador).sort(),['p1','p2','p3']);
  assert.strictEqual(op.painel({ciclo:90,tipo_produto:'pos'},admin).kpis.total,3);
  assert.strictEqual(op.painel({ciclo:90,produto:'82'},admin).kpis.total,2);
  assert.strictEqual(op.painel({ciclo:90,produto:'grupo:semi saude'},admin).kpis.total,2);
  assert.strictEqual(op.painel({ciclo:90,produto:'85'},admin).kpis.total,1);
  assert.strictEqual(op.lista({ciclo:90,q:'fora'},admin).linhas[0].produto,'');
  assert.strictEqual(op.lista({ciclo:90,q:'g1'},admin).linhas[0].produto,'Graduação');
  const csv=op.exportar({ciclo:90,produto:'81',formato:'csv'},admin).corpo.toString('utf8');assert.strictEqual(csv.trim().split('\r\n').length-1,3);
});

test('cards por polo respeitam recorte, retornos e acesso mesmo quando o polo está vazio',()=>{
  const full=op.painel({ciclo:90},admin);
  assert.strictEqual(full.por_polo.reduce((n,p)=>n+p.total,0),full.kpis.total);
  const f=full.por_polo.find(p=>p.key==='1');assert.ok(f);
  const onlyPos=op.painel({ciclo:90,produto:'81'},admin);
  assert.strictEqual(onlyPos.por_polo.find(p=>p.key==='1').total,3);
  const vazio=onlyPos.por_polo.find(p=>p.key==='2');assert.strictEqual(vazio.total,0);assert.strictEqual(vazio.taxa,null);
  const restricted=op.painel({ciclo:90,produto:'81'},tutorFranca);
  assert.deepStrictEqual(restricted.por_polo.map(p=>p.key),['1']);
  const selected=op.painel({ciclo:90,produto:'81',polo:'2'},admin);assert.strictEqual(selected.por_polo.length,1);assert.strictEqual(selected.por_polo[0].total,0);
  const p1=op.painel({ciclo:2},admin).por_polo.find(p=>p.key==='1');
  assert.strictEqual(p1.vencidos,op.painel({ciclo:2,polo:'1',retorno:'vencido'},admin).kpis.total);
  assert.strictEqual(p1.hoje,op.painel({ciclo:2,polo:'1',retorno:'hoje'},admin).kpis.total);
  assert.strictEqual(p1.proximos7,op.painel({ciclo:2,polo:'1',retorno:'proximos7'},admin).kpis.total);
});

test('snapshot invalida após atendimento, alteração de cadastro e escrita por outra conexão',()=>{
 const q={ciclo:90},initial=op.painel(q,admin);const id=db.prepare("SELECT id FROM ma_oportunidades WHERE ciclo_id=90 AND identificador='b1'").get().id;
 op.registrarAtendimento(id,{data:'2026-11-01',resultado:'Teste invalidação',canal:'telefone'},admin);
 assert.strictEqual(op.painel(q,admin).kpis.atendimentos_registrados,initial.kpis.atendimentos_registrados+1);
 const before=op.lista({ciclo:90,q:'b1'},admin).linhas[0].produto;
 db.prepare("UPDATE cursos SET produto_id=85 WHERE nome='Estética e Cosmética'").run();
 assert.notStrictEqual(op.lista({ciclo:90,q:'b1'},admin).linhas[0].produto,before);
 const {DatabaseSync}=require('node:sqlite');const other=new DatabaseSync(path.join(dir,'matriculas.db'));
 try{other.prepare('UPDATE ma_oportunidades SET nome=? WHERE id=?').run('Nome Atualizado Externamente',id);}finally{other.close();}
 assert.strictEqual(op.detalhe(id,admin).oportunidade.nome,'Nome Atualizado Externamente');
 assert.ok(op.painel(q,tutorFranca).por_polo.every(p=>p.key==='1'));
});

test('Educação Física distingue bacharelado, licenciatura e EAD com nomes reais do catálogo',()=>{
 db.exec(`INSERT INTO produtos(id,nome,categoria_id) VALUES(91,'Semi - Bacharel em Educação Física',1),(92,'Semi - Licenciatura',1);
 INSERT INTO cursos(nome,produto_id,apelidos,polos) VALUES('Bacharel em Ed. Física',91,'Educação Física','1'),('Licenciatura em Educação Física',92,'Educação Física','1');`);
 const source=[
 ['ef-bach','ESPRE_BEDU','EDUCAÇÃO FÍSICA - BACHARELADO (GRADUAÇÃO - SEMIPRESENCIAL)'],
 ['ef-lic','ESPRE_EDU','EDUCAÇÃO FÍSICA - LICENCIATURA (GRADUAÇÃO - SEMIPRESENCIAL)'],
 ['ef-ead','EGRAD_BEDU','EDUCAÇÃO FÍSICA - BACHARELADO (GRADUAÇÃO - EAD)'],
 ['ef-amb','','Educação Física']
 ];
 op.importar({ciclo:90,confirmado:true,linhas:source.map(([identificador,curso_cod,curso_nome])=>({identificador,curso_cod,curso_nome,polo_fonte:'Franca',nome:'Candidato '+identificador}))},admin);
 assert.deepStrictEqual(op.lista({ciclo:90,produto:'91'},admin).linhas.map(r=>r.identificador),['ef-bach']);
 assert.deepStrictEqual(op.lista({ciclo:90,produto:'92'},admin).linhas.map(r=>r.identificador),['ef-lic']);
 assert.strictEqual(op.lista({ciclo:90,q:'ef-ead'},admin).linhas[0].produto,'Graduação');
 assert.strictEqual(op.lista({ciclo:90,q:'ef-amb'},admin).linhas[0].produto,'');
});

test('relatório real com código na coluna Curso classifica registros antigos sem reimportação',()=>{
 db.exec(`INSERT INTO ciclos(id,nome,padrao) VALUES(94,'Códigos do relatório',0);
 INSERT INTO cursos(nome,produto_id,polos) VALUES('Pedagogia',92,'1');`);
 const entries=[['codigo-ped','ESPRE_PED'],['codigo-bach','ESPRE_BEDU'],['codigo-pos','EPOS_123'],['codigo-grad','EGRAD_ADM'],['codigo-saude','ESPRE_FAR'],['codigo-incerto','ESPRE_NOVO']];
 const insert=db.prepare('INSERT INTO ma_oportunidades(ciclo_id,identificador,nome,curso_cod,curso_nome,polo_fonte) VALUES(94,?,?,\'\',?,\'Franca\')');
 for(const [id,curso] of entries)insert.run(id,'Teste '+id,curso);
 assert.deepStrictEqual(op.lista({ciclo:94,produto:'92',polo:'1'},admin).linhas.map(r=>r.identificador),['codigo-ped']);
 assert.strictEqual(op.lista({ciclo:94,produto:'91'},admin).total,1);
 assert.strictEqual(op.lista({ciclo:94,produto:'81'},admin).total,1);
 assert.strictEqual(op.lista({ciclo:94,produto:'1'},admin).total,1);
 assert.strictEqual(op.lista({ciclo:94,produto:'83'},admin).total,1);
 assert.strictEqual(op.lista({ciclo:94,produto:'sem'},admin).total,1);
 assert.strictEqual(op.painel({ciclo:94,produto:'92'},admin).kpis.total,1);
 assert.match(op.lista({ciclo:94,produto:'92'},admin).linhas[0].curso,/PEDAGOGIA/);
 assert.strictEqual(db.prepare("SELECT curso_nome FROM ma_oportunidades WHERE identificador='codigo-ped'").get().curso_nome,'ESPRE_PED');
});

test('ação da supervisão vincula somente leads existentes e preserva fonte e histórico',()=>{
 db.exec(`INSERT INTO ciclos(id,nome,padrao) VALUES(95,'Ação supervisão',0);
 INSERT INTO tutores(id,nome,apelidos) VALUES(95,'Beatriz','Bia'),(96,'Emilly',NULL);
 INSERT INTO tutor_polos(tutor_id,polo_id) VALUES(95,1),(96,2),(96,1);`);
 op.importar({ciclo:95,confirmado:true,linhas:[
  {identificador:'acao-1',nome:'Lead ação',cpf:'52998224725',curso_cod:'ESPRE_PED',curso_nome:'Pedagogia',polo_fonte:'Franca',status_origem:'Inscrito'},
  {identificador:'acao-2',nome:'Outro lead ação',cpf:'11144477735',curso_cod:'ESPRE_PED',polo_fonte:'Batatais'}]},admin);
 const id=db.prepare("SELECT id FROM ma_oportunidades WHERE identificador='acao-1'").get().id;
 op.salvar(id,{observacao:'Preservar anotação',etapa:'negociacao'},admin);
 const count=db.prepare('SELECT count(*) n FROM ma_oportunidades').get().n;
 const input={ciclo:95,nome:'Ação da supervisão',inicio:'2026-01-01',linhas:[
  {aba:'Bia',cpf:'52998224725',curso_cod:'ESPRE_PED',nome:'Lead ação'},
  {aba:'Emilly',cpf:'11144477735',curso_cod:'ESPRE_PED',nome:'Outro lead'},
  {aba:'Bia',cpf:'39053344705',curso_cod:'ESPRE_PED',nome:'Ausente'}]};
 const preview=op.acoes.previa(input,admin);assert.deepStrictEqual(preview.totais,{linhas:3,vinculaveis:2,pendentes:1});
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_op_acoes').get().n,0);
 assert.throws(()=>op.acoes.criar(input,admin),/Revise/);
 assert.throws(()=>op.acoes.previa(input,tutorFranca),/acesso/);
 const created=op.acoes.criar({...input,confirmado:true},admin);
 assert.strictEqual(created.vinculados,2);assert.strictEqual(created.pendentes,1);
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_oportunidades').get().n,count);
 const after=db.prepare('SELECT * FROM ma_oportunidades WHERE id=?').get(id);
 assert.deepStrictEqual([after.responsavel_tutor_id,after.observacao,after.etapa,after.status_origem],[null,'Preservar anotação','negociacao','Inscrito']);
 assert.strictEqual(op.acoes.criar({...input,confirmado:true},admin).id,created.id);
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_op_acoes').get().n,1);
 assert.strictEqual(op.acoes.relatorio(created.id,admin).kpis.total,2);
 assert.strictEqual(op.acoes.relatorio(created.id,tutorFranca).kpis.total,1);
 assert.strictEqual(op.acoes.relatorio(created.id,tutorFranca).pendencias.length,0);
 assert.strictEqual(op.acoes.listar({ciclo:95},tutorFranca).acoes[0].total,1);
 const asBia={...tutorFranca,tutor_id:95};
 op.registrarAtendimento(id,{canal:'telefone',resultado:'Atendimento da ação'},asBia);
 const result=op.acoes.relatorio(created.id,admin);
 assert.strictEqual(result.kpis.atendidos,1);assert.strictEqual(result.kpis.taxa_atendimento,50);
 assert.strictEqual(result.linhas.find(r=>r.id===id).atendido_pela_tutora,true);
 db.prepare("INSERT INTO ma_lista_alunos(ciclo_id,candidato,ra,nome,cpf,polo_fonte,ativo) VALUES(95,'ACAO1','ACAO-RA','Lead ação','52998224725','Franca',1)").run();
 const converted=op.acoes.relatorio(created.id,admin);
 assert.strictEqual(converted.kpis.novas_conversoes,1);assert.strictEqual(converted.kpis.taxa_conversao,50);
 const second=op.acoes.criar({...input,nome:'Outro recorte',linhas:[input.linhas[0]],confirmado:true},admin);
 const baseline=op.acoes.relatorio(second.id,admin);assert.strictEqual(baseline.kpis.ja_convertidos,1);assert.strictEqual(baseline.kpis.novas_conversoes,0);assert.strictEqual(baseline.kpis.taxa_conversao,null);
});

test('distribuição mantém repetições entre tutoras sem mudar o curso por CPF',()=>{
 const input={ciclo:95,nome:'Conflitos',inicio:'2026-01-01',linhas:[
 {aba:'Bia',cpf:'52998224725',curso_cod:'ESPRE_PED'},
 {aba:'Emilly',cpf:'52998224725',curso_cod:'ESPRE_PED'},
 {aba:'Bia',cpf:'11144477735',curso_cod:'ESPRE_BEDU'}]};
 const p=op.acoes.previa(input,admin);assert.strictEqual(p.totais.vinculaveis,2);
 assert.ok(p.linhas.slice(0,2).every(r=>!r.motivo));
 assert.match(p.linhas[2].motivo,/curso não corresponde/);
 assert.strictEqual(op.acoes.criar({...input,confirmado:true},admin).vinculados,2);
 assert.strictEqual(op.acoes.previa({...input,linhas:[{...input.linhas[0],aba:'Apelido desconhecido'}]},admin).totais.pendentes,1);
 assert.strictEqual(op.acoes.previa({...input,linhas:[{...input.linhas[0],aba:'Apelido desconhecido'}],tutores:{'Apelido desconhecido':95}},admin).totais.vinculaveis,1);
});

test('CPF numérico do Excel em notação científica mantém os dígitos e a validação',()=>{
 for(const value of ['5.2998224725E10','5.2998224725e+10','52998224725.0',52998224725])assert.strictEqual(op.cpfNormalizado(value).valor,'52998224725');
 assert.strictEqual(op.cpfNormalizado('529.982.247-25').valor,'52998224725');
 for(const value of ['5.2998224724E10','1e100','52998224725.5'])assert.strictEqual(op.cpfNormalizado(value).valido,false);
 const input={ciclo:95,nome:'Excel científico',inicio:'2026-01-01',linhas:[{aba:'Bia',cpf:'5.2998224725E10',curso_cod:'ESPRE_PED'}]};
 assert.strictEqual(op.acoes.previa(input,admin).totais.vinculaveis,1);
});

test('ação encontra curso guardado no campo nome pela importação antiga',()=>{
 db.exec(`INSERT INTO ciclos(id,nome) VALUES(96,'Ação com importação antiga');
 INSERT INTO ma_oportunidades(ciclo_id,identificador,nome,cpf,curso_cod,curso_nome,polo_fonte) VALUES(96,'acao-legado','Teste legado','52998224725','','ESPRE_PED','Franca');`);
 const preview=op.acoes.previa({ciclo:96,nome:'Legado',inicio:'2026-11-17',linhas:[{aba:'Bia',cpf:'52998224725',curso_cod:'ESPRE_PED'}]},admin);
 assert.strictEqual(preview.totais.vinculaveis,1);
 assert.strictEqual(op.carregarBase(96,admin).base[0].curso_cod,'ESPRE_PED');
});

test('resolve pendência agrupada com inscrição e tutora explícitas sem duplicar a ação',()=>{
 db.exec(`INSERT INTO ciclos(id,nome) VALUES(97,'Revisão de pendências');
 INSERT INTO ma_oportunidades(ciclo_id,identificador,nome,cpf,curso_nome,polo_fonte,data_registro) VALUES
 (97,'REVA','Pessoa revisão','52998224725','ESPRE_PED','Franca','2026-10-01'),
 (97,'REVB','Pessoa revisão','52998224725','ESPRE_PED','Franca','2026-11-10'),
 (97,'REVC','Outro lead','11144477735','ESPRE_PED','Franca','2026-11-01');`);
 const c={ciclo:97,nome:'Revisão',inicio:'2026-11-17',confirmado:true,linhas:[{aba:'Bia',nome:'Pessoa revisão',cpf:'52998224725',curso_cod:'ESPRE_PED'},{aba:'Emilly',nome:'Pessoa revisão',cpf:'52998224725',curso_cod:'ESPRE_PED'},{aba:'Bia',nome:'Outro lead',cpf:'11144477735',curso_cod:'ESPRE_PED'}]};
 const created=op.acoes.criar(c,admin),report=op.acoes.relatorio(created.id,admin),group=report.grupos_pendentes[0];
 assert.strictEqual(group.candidatos.length,2);assert.strictEqual(group.candidatos[0].identificador,'REVB');assert.strictEqual(group.origens.length,2);
 const body={grupo:group.key,versao:report.pendencias_versao,oportunidade_id:group.candidatos[0].id,tutor_id:95};
 assert.throws(()=>op.acoes.resolver(created.id,body,tutorFranca),/acesso/);
 assert.throws(()=>op.acoes.resolver(created.id,{...body,oportunidade_id:999999},admin),/correspondente/);
 const result=op.acoes.resolver(created.id,body,admin);assert.strictEqual(result.resolvidas,2);
 const after=op.acoes.relatorio(created.id,admin);assert.strictEqual(after.kpis.total,3);assert.strictEqual(after.pendencias.length,0);
 assert.strictEqual(db.prepare('SELECT responsavel_tutor_id FROM ma_oportunidades WHERE id=?').get(body.oportunidade_id).responsavel_tutor_id,null);
 assert.strictEqual(db.prepare("SELECT responsavel_tutor_id FROM ma_oportunidades WHERE identificador='REVA'").get().responsavel_tutor_id,null);
 assert.throws(()=>op.acoes.resolver(created.id,body,admin),/pendências mudaram/);
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_op_acao_eventos WHERE acao_id=?').get(created.id).n,1);
 assert.strictEqual(op.acoes.listar({ciclo:97},admin).acoes[0].pendentes,0);
});

test('excluir e restaurar ação preserva leads, responsáveis e histórico e exige permissão',()=>{
 const a=op.acoes.listar({ciclo:97},admin).acoes[0],before=op.acoes.relatorio(a.id,admin);
 const leads=db.prepare('SELECT count(*) n FROM ma_oportunidades').get().n;
 assert.throws(()=>op.acoes.excluir(a.id,tutorFranca),/acesso/);
 op.acoes.excluir(a.id,admin);
 assert.strictEqual(op.acoes.listar({ciclo:97},admin).acoes.length,0);
 assert.throws(()=>op.acoes.relatorio(a.id,admin),/não encontrada/);
 assert.strictEqual(op.acoes.listar({ciclo:97,excluidas:'1'},admin).acoes[0].id,a.id);
 assert.throws(()=>op.acoes.listar({ciclo:97,excluidas:'1'},tutorFranca),/acesso/);
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_oportunidades').get().n,leads);
 op.acoes.excluir(a.id,admin,true);
 const restored=op.acoes.relatorio(a.id,admin);assert.deepStrictEqual(restored.linhas,before.linhas);
 assert.strictEqual(op.acoes.listar({ciclo:97},admin).acoes.length,1);
 assert.strictEqual(op.acoes.listar({ciclo:97,excluidas:'1'},admin).acoes.length,0);
});

test('ação sem CPF pode localizar nome, telefone e curso e mantém conferência das linhas após resolução',()=>{
 db.exec(`INSERT INTO ma_oportunidades(ciclo_id,identificador,nome,telefone,curso_nome,polo_fonte) VALUES(97,'SEMCPF','Gabriel Teste Silva','16990000000','EGRAD_ADM','Franca');`);
 const c={ciclo:97,nome:'Sem CPF',inicio:'2026-11-17',linhas:[{aba:'Bia',nome:'Gabriel Teste Silv a',telefone:'16990000000',curso_cod:'EGRAD_ADM'}]};
 assert.strictEqual(op.acoes.previa(c,admin).totais.vinculaveis,1);
 const manual=op.acoes.criar({...c,nome:'Revisão sem CPF',confirmado:true,linhas:[{...c.linhas[0],telefone:''},{aba:'Bia',nome:'Outro lead',cpf:'11144477735',curso_cod:'ESPRE_PED'}]},admin);
 const d=op.acoes.relatorio(manual.id,admin),g=d.grupos_pendentes[0];assert.strictEqual(g.candidatos.length,1);
 op.acoes.resolver(manual.id,{grupo:g.key,versao:d.pendencias_versao,oportunidade_id:g.candidatos[0].id,tutor_id:95},admin);
 assert.strictEqual(op.acoes.relatorio(manual.id,admin).kpis.total,2);
 const acao=op.acoes.listar({ciclo:97},admin).acoes.find(a=>a.nome==='Revisão');
 const check=op.acoes.relatorio(acao.id,admin).conferencia;
 assert.deepStrictEqual([check.recebidas,check.vinculados,check.pendentes,check.repetidas_resolvidas],[3,3,0,0]);
 assert.strictEqual(check.por_aba.reduce((n,a)=>n+a.recebidas,0),3);
});

test('cada linha repetida vira participação e atendimento fica restrito à participação escolhida',()=>{
 const input={ciclo:95,nome:'Carteiras repetidas',inicio:'2026-01-01',confirmado:true,linhas:[
 {aba:'Bia',linha:7,nome:'Lead ação',cpf:'52998224725',curso_cod:'ESPRE_PED'},
 {aba:'Emilly',linha:11,nome:'Lead ação',cpf:'52998224725',curso_cod:'ESPRE_PED'}]};
 const before=db.prepare('SELECT count(*) n FROM ma_oportunidades').get().n;
 const created=op.acoes.criar(input,admin),report=op.acoes.relatorio(created.id,admin);
 assert.strictEqual(report.kpis.total,2);assert.strictEqual(report.kpis.leads_unicos,1);assert.strictEqual(report.kpis.atendidos,0);
 assert.strictEqual(new Set(report.linhas.map(l=>l.participacao_id)).size,2);
 assert.ok(report.por_tutora.every(t=>t.total===1));
 const bia=report.linhas.find(l=>l.tutor_id===95);
 op.registrarAtendimento(bia.id,{canal:'telefone',resultado:'Contato para a carteira Bia',participacao_id:bia.participacao_id},admin);
 const after=op.acoes.relatorio(created.id,admin);
 assert.strictEqual(after.por_tutora.find(t=>t.id===95).atendidos,1);
 assert.strictEqual(after.por_tutora.find(t=>t.id===96).atendidos,0);
 assert.strictEqual(after.kpis.atendidos,1);assert.strictEqual(after.kpis.taxa_atendimento,50);
 assert.strictEqual(op.acoes.listar({ciclo:95},admin).acoes.find(a=>a.id===created.id).atendidos,1);
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_oportunidades').get().n,before);
 assert.deepStrictEqual(after.conferencia.por_aba.map(a=>a.recebidas),[1,1]);
 assert.throws(()=>op.registrarAtendimento(bia.id,{resultado:'Não existe',participacao_id:999999},admin),/Participação inválida/);
});


test('importação de atendimento atualiza ações por período e tutora e preserva o histórico',()=>{
 db.exec("INSERT INTO ciclos(id,nome) VALUES(98,'Atendimento importado');");
 const fonte={identificador:'FONTE-ACAO',nome:'Lead relatório',cpf:'52998224725',polo_fonte:'Franca',curso_cod:'ESPRE_PED',curso_nome:'ESPRE_PED',ultimo_atendimento:'13/11/2026',responsavel_origem:'Beatriz Carvalhaes Vila Nova',status_origem:'LEAD',interacoes:1};
 const importar=campos=>op.importar({ciclo:98,confirmado:true,arquivo:'acompanhamento.xlsx',linhas:[{...fonte,...campos}]},admin);
 importar({});
 const input={ciclo:98,nome:'Ação integrada',inicio:'2026-11-14',fim:'2026-11-17',confirmado:true,linhas:[{aba:'Bia',linha:2,nome:fonte.nome,cpf:fonte.cpf,curso_cod:'ESPRE_PED'},{aba:'Emilly',linha:2,nome:fonte.nome,cpf:fonte.cpf,curso_cod:'ESPRE_PED'}]};
 const a=op.acoes.criar(input,admin);
 assert.strictEqual(op.acoes.relatorio(a.id,admin).kpis.atendidos,0);
 const res=importar({ultimo_atendimento:'14/11/2026',status_origem:'QUALIFICADO'});
 assert.strictEqual(res.acoes.acoes_atualizadas,1);
 const d=op.acoes.relatorio(a.id,admin),bia=d.linhas.find(r=>r.tutor_id===95);
 assert.strictEqual(d.kpis.atendidos,1);assert.strictEqual(d.kpis.taxa_atendimento,50);
 assert.strictEqual(d.por_tutora.find(t=>t.id===95).atendidos,1);assert.strictEqual(d.por_tutora.find(t=>t.id===96).atendidos,0);
 assert.strictEqual(bia.atendido_planilha,true);assert.strictEqual(bia.status_origem,'QUALIFICADO');assert.strictEqual(bia.contato_planilha_data,'2026-11-14');
 const qtd=db.prepare('SELECT count(*) n FROM ma_op_contatos_fonte WHERE oportunidade_id=?').get(bia.id).n;
 importar({ultimo_atendimento:'14/11/2026',status_origem:'QUALIFICADO'});
 assert.strictEqual(db.prepare('SELECT count(*) n FROM ma_op_contatos_fonte WHERE oportunidade_id=?').get(bia.id).n,qtd);
 assert.strictEqual(op.acoes.relatorio(a.id,admin).kpis.atendidos,1);
 op.registrarAtendimento(bia.id,{resultado:'Contato também registrado aqui',canal:'telefone',data:'2026-11-14',participacao_id:bia.participacao_id},admin);
 assert.strictEqual(op.acoes.relatorio(a.id,admin).kpis.atendidos,1);
 importar({ultimo_atendimento:'16/11/2026',responsavel_origem:'Emilly Barbosa de Oliveira',interacoes:2});
 const ambas=op.acoes.relatorio(a.id,admin);assert.strictEqual(ambas.kpis.atendidos,2);assert.strictEqual(ambas.kpis.taxa_atendimento,100);assert.ok(ambas.linhas.every(r=>r.atendido_planilha));
 assert.strictEqual(op.acoes.listar({ciclo:98},admin).acoes[0].atendidos,2);
 const curta=op.acoes.criar({...input,nome:'Período encerrado',fim:'2026-11-15'},admin);
 assert.strictEqual(op.acoes.relatorio(curta.id,admin).kpis.atendidos,1);
 importar({ultimo_atendimento:'17/11/2026',responsavel_origem:'Responsável não cadastrado'});
 assert.strictEqual(op.acoes.relatorio(a.id,admin).atualizacao_atendimento.responsavel_nao_identificado,1);
 importar({ultimo_atendimento:'17/11/2026',responsavel_origem:''});
 assert.strictEqual(op.acoes.relatorio(a.id,admin).atualizacao_atendimento.responsavel_nao_identificado,2);
 importar({ultimo_atendimento:'18/11/2026',responsavel_origem:'Emilly'});
 assert.strictEqual(db.prepare("SELECT count(*) n FROM ma_op_contatos_fonte WHERE oportunidade_id=? AND data='2026-11-18'").get(bia.id).n,0);
 db.prepare("INSERT INTO ma_lista_alunos(ciclo_id,candidato,ra,nome,cpf,polo_fonte,ativo) VALUES(98,'FONTE-ACAO','RA-FONTE','Lead relatório','52998224725','Franca',1)").run();
 const convertidas=op.acoes.relatorio(a.id,admin);assert.strictEqual(convertidas.kpis.novas_conversoes,2);assert.strictEqual(convertidas.kpis.atendidos,2);
});

test('responsável ambíguo no relatório não é atribuído pela primeira correspondência',()=>{
 const a=op.acoes.listar({ciclo:98},admin).acoes.find(a=>a.nome==='Ação integrada');
 db.exec("INSERT INTO tutores(id,nome,apelidos) VALUES(98,'Outra colaboradora','Beatriz');INSERT INTO tutor_polos VALUES(98,1);");
 const d=op.acoes.relatorio(a.id,admin);
 assert.strictEqual(d.linhas.find(r=>r.tutor_id===95).atendido_planilha,false);
 assert.ok(d.atualizacao_atendimento.responsavel_nao_identificado>0);
 db.prepare('UPDATE tutores SET ativo=0 WHERE id=98').run();
 assert.strictEqual(op.acoes.relatorio(a.id,admin).linhas.find(r=>r.tutor_id===95).atendido_planilha,true);
});
