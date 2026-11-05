// Leitura de CSV e XLSX sem dependências externas (a base atual também não tem biblioteca de planilha).
// XLSX: lê o ZIP pelo diretório central, descompacta com zlib e interpreta a primeira planilha.
import { inflateRawSync } from 'node:zlib';

export function lerPlanilha(buffer, nomeArquivo = '') {
  const nome = nomeArquivo.toLowerCase();
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return lerXlsx(buffer);
  if (nome.endsWith('.xls')) throw new Error('Formato .xls antigo não suportado. Salve como .xlsx ou .csv.');
  return lerCsv(decodificarTexto(buffer));
}

function decodificarTexto(buf) {
  let txt = buf.toString('utf8');
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  // Arquivo salvo em Windows-1252 (Excel BR) gera caracteres de substituição em UTF-8.
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);
  return txt;
}

export function lerCsv(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(c => c.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some(c => c.trim() !== '')) linhas.push(linha);
  return linhas;
}

function lerZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Arquivo XLSX inválido (ZIP sem diretório central)');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Arquivo XLSX corrompido');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28), lenExtra = buf.readUInt16LE(p + 30), lenCom = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    p += 46 + lenNome + lenExtra + lenCom;
    const inicio = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
    const dados = buf.subarray(inicio, inicio + tamComp);
    arquivos.set(nome, () => {
      if (metodo === 0) return dados.toString('utf8');
      if (metodo === 8) {
        const out = inflateRawSync(dados);
        if (out.length > 200 * 1024 * 1024) throw new Error('Planilha grande demais');
        return out.toString('utf8');
      }
      throw new Error(`Compressão ZIP não suportada (${metodo})`);
    });
  }
  return arquivos;
}

function desescapar(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function textoDe(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => desescapar(m[1])).join('');
}

function colunaIndice(ref) {
  const letras = ref.replace(/\d+/g, '');
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function lerXlsx(buf) {
  const zip = lerZip(buf);
  const ler = nome => (zip.get(nome) || (() => null))();
  const compartilhadas = [];
  const ss = ler('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) compartilhadas.push(textoDe(m[1]));
  // Primeira planilha pela ordem do workbook.
  let caminho = 'xl/worksheets/sheet1.xml';
  const wb = ler('xl/workbook.xml'), rels = ler('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
    const alvo = rid && (rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`)) || [])[1];
    if (alvo) caminho = alvo.startsWith('/') ? alvo.slice(1) : 'xl/' + alvo.replace(/^\.\//, '');
  }
  const sheet = ler(caminho);
  if (!sheet) throw new Error('Planilha não encontrada no arquivo XLSX');
  const linhas = [];
  for (const mRow of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha = [];
    for (const mC of mRow[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = mC[1], corpo = mC[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const tipo = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      let valor = '';
      if (tipo === 's') valor = compartilhadas[Number((corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1])] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(corpo);
      else { const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; valor = v == null ? '' : desescapar(v); }
      const idx = ref ? colunaIndice(ref) : linha.length;
      while (linha.length < idx) linha.push('');
      linha[idx] = valor;
    }
    if (linha.some(c => String(c).trim() !== '')) linhas.push(linha);
  }
  return linhas;
}
