// Dados produzidos em memória, sem planilhas de origem nem contatos reais.
import { crc32 } from 'node:zlib';

const colunas = 'id_titulo;unidade;responsavel_id;responsavel_nome;responsavel_documento;telefone;contato_autorizado;aluno_matricula;aluno_nome;competencia;vencimento;valor;saldo;situacao'.split(';');
const linha = (id, unidade, responsavel, aluno, mes, vencimento, valor, saldo, situacao = 'aberto', autoriza = 'sim') => {
  const sufixo = Number(responsavel.split('-').at(-1).replace('R', ''));
  return [id, unidade, responsavel, responsavel === 'R-507' ? '' : 'Demo ' + responsavel,
    responsavel === 'R-501' ? '8901' : '', '0000000' + String(sufixo % 100).padStart(4, '0'),
    autoriza, aluno, 'Aluno demo ' + aluno, mes, vencimento, valor, saldo, situacao];
};
const horizonte = [
  linha('HZ-1001', 'CEN', 'R-501', 'M-2001', '08/2026', '10/08/2026', '1250,00', '1250,00'),
  linha('HZ-1002', 'CEN', 'R-501', 'M-2001', '09/2026', '10/09/2026', '1250,00', '1250,00'),
  linha('HZ-1003', 'JAR', 'R-501', 'M-2002', '09/2026', '10/09/2026', '980,00', '980,00'),
  linha('HZ-1010', 'CEN', 'R-502', 'M-2010', '07/2026', '10/07/2026', '1250,00', '1250,00', 'vencido'),
  linha('HZ-1011', 'CEN', 'R-502', 'M-2010', '08/2026', '10/08/2026', '1250,00', '625,00'),
  linha('HZ-1020', 'JAR', 'R-503', 'M-2020', '09/2026', '10/09/2026', '980,00', '980,00', 'aberto', 'nao'),
  linha('HZ-1030', 'JAR', 'R-504', 'M-2030', '10/2026', '10/10/2026', '980,00', '980,00'),
  linha('HZ-1040', 'CEN', 'R-505', 'M-2040', '09/2026', '31/02/2026', '1250,00', '1250,00'),
  linha('HZ-1041', 'CEN', 'R-505', 'M-2040', '09/2026', '10/09/2026', '1250,00', '-10,00'),
  linha('HZ-1042', 'NORTE', 'R-506', 'M-2050', '09/2026', '10/09/2026', '1250,00', '1250,00'),
  linha('HZ-1043', 'CEN', 'R-507', 'M-2060', '09/2026', '10/09/2026', '1250,00', '1250,00', 'em negociação', ''),
];
const valeVerde = [
  linha('VV-77', '', 'VV-R1', 'VV-A1', '2026-09', '2026-09-05', '890.00', '890.00'),
  linha('VV-78', '', 'VV-R2', 'VV-A2', '2026-08', '2026-08-05', '890.00', '445.50'),
  linha('VV-79', '', 'VV-R2', 'VV-A2', '2026-07', '2026-07-05', '890.00', '0', 'pago'),
];

function zipPlanilha(xml) {
  const nome = Buffer.from('xl/worksheets/sheet1.xml');
  const conteudo = Buffer.from(xml);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(conteudo), 14);
  local.writeUInt32LE(conteudo.length, 18);
  local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(nome.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  local.copy(central, 16, 14, 28);

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 8);
  fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(central.length + nome.length, 12);
  fim.writeUInt32LE(local.length + nome.length + conteudo.length, 16);
  return Buffer.concat([local, nome, conteudo, central, nome, fim]);
}

export function arquivoDemo(nome) {
  if (nome.endsWith('.csv')) return Buffer.from([colunas, ...horizonte, horizonte[6]].map(r => r.join(';')).join('\n'));
  if (nome.endsWith('.xlsx')) {
    const linhas = [colunas, ...valeVerde].map(r => '<row>' + r.map(c => '<c t="inlineStr"><is><t>' + c + '</t></is></c>').join('') + '</row>');
    return zipPlanilha('<worksheet><sheetData>' + linhas.join('') + '</sheetData></worksheet>');
  }
  throw new Error('Formato de demonstração desconhecido');
}
