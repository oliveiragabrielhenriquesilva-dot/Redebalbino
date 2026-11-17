'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../apps/oportunidades/public/app.js'), 'utf8');
const mapping = source.slice(source.indexOf('  const normHeader ='), source.indexOf('  const CAMPO ='));
const context = vm.createContext({});
vm.runInContext(mapping + '\nthis.mapSheet = mapSheet;', context);

test('cabeçalho real do acompanhamento separa código do curso e ignora a coluna Aluno como nome', () => {
 const headers = ['Prioridade','Identificador','Aluno','Nome completo','CPF','Telefone','E-mail','Curso','Polo','Dt. Últ. Atendimento','Dt. Retorno','Dt. Registro','Últ. Registro','Interações','Status','Origem','Localização','Contato','Resp. Último Atendimento'];
 for (const code of ['ESPRE_PED','ESPRE_BEDU','ESPRE_FAR','EGRAD_ADM','EPOS_123','HPOS_123']) {
  const row = []; row[1] = 'Teste'; row[2]='Número do aluno'; row[3]='Candidato teste'; row[7]=code; row[8]='FRANCA - SP';
  const result = context.mapSheet([headers,row]).linhas[0];
  assert.equal(result.curso_cod,code); assert.equal(result.curso_nome,code); assert.equal(result.nome,'Candidato teste'); assert.equal(result.polo_fonte,'FRANCA - SP');
 }
});

test('importação mantém curso escrito por extenso e aceita CD_CURSO com NM_CURSO',()=>{
 const result = context.mapSheet([['Identificador','Nome completo','CD_CURSO','NM_CURSO'],['Teste','Candidato','ESPRE_PED','Pedagogia']]).linhas[0];
 assert.equal(result.curso_cod,'ESPRE_PED'); assert.equal(result.curso_nome,'Pedagogia');
 const named = context.mapSheet([['Identificador','Curso'],['Teste','Pedagogia']]).linhas[0];
 assert.equal(named.curso_cod,''); assert.equal(named.curso_nome,'Pedagogia');
});

test('ação lê todas as abas e mantém a tutora indicada na aba para cada linha',()=>{
 const start=source.indexOf('  function mapActionSheets('),end=source.indexOf('  async function startAction(',start);
 vm.runInContext(source.slice(start,end)+'\nthis.mapActionSheets=mapActionSheets;',context);
 const input=['Bia','Tainara','Marcelly','Emilly'].map(nome=>({nome,rows:[['Nome completo','CPF','Telefone','Curso'],['Candidato teste',52998224725,'16990000000','ESPRE_PED'],['Outro teste','11144477735.0','','EGRAD_ADM']]}));
 const mapped=context.mapActionSheets(input);
 assert.equal(mapped.length,8);assert.deepEqual(Array.from(new Set(mapped.map(r=>r.aba))),['Bia','Tainara','Marcelly','Emilly']);
 assert.equal(mapped[1].cpf,'11144477735.0');assert.equal(mapped[2].aba,'Tainara');
 assert.throws(()=>context.mapActionSheets([{nome:'Sem CPF',rows:[['Curso']]}]),/CPF/);
});
