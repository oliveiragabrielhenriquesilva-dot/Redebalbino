'use strict';
// Balbino Informa — dados SOMENTE do Calendário Administrativo Unicesumar
// (https://secretaria-unicesumar.github.io/calendariounicesumar/).
// Aquele site lê uma planilha Google publicada em CSV (colunas Ano, Produto, Categoria, Evento, Coluna, Inicio, Fim)
// e a combina com os dados base do próprio código. Aqui fazemos o mesmo, no servidor:
//  1. planilha publicada (lida no máximo a cada 30 minutos e guardada em cache no runtime);
//  2. se a planilha falhar, a última cópia em cache;
//  3. sem cache, os dados base do código do site (src/data/calendarData.js), com aviso na tela.
const fs = require('node:fs');
const path = require('node:path');

const SITE_URL = 'https://secretaria-unicesumar.github.io/calendariounicesumar/';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQxYhTSF-WIvQqITKcusez42NaZAulAFE9crM9RBwjgybElcsVV2ub1m1kMQBWMjV6t9F-594AjNY2c/pub?output=csv';
const CACHE_MS = 30 * 60 * 1000;

// Mesma configuração de produtos e ordem de categorias do site (src/utils/productConfig.js).
const PRODUTOS = {
  graduacao: { nome: 'Graduação EAD', modulos: ['51', '52', '53', '54'], tipo: 'modular' },
  profissionalizante: { nome: 'Profissionalizante', modulos: ['71', '72', '73', '74'], tipo: 'modular' },
  tecnicos: { nome: 'Técnicos', modulos: ['91', '92', '93', '94'], tipo: 'modular' },
  pos_hibrida: { nome: 'Pós-graduação Híbrida', modulos: ['81', '82', '83', '84'], tipo: 'modular' },
  presencial: { nome: 'Presencial', modulos: ['1S', '2S'], tipo: 'semestral' }
};
const ORDEM_CATEGORIAS = ['Período letivo', 'Período de Captação', 'Rematrícula automátical', 'Rematrícula automática', 'Aproveitamento de Estudos', 'Divisão de turmas', 'Lançamento de notas', 'Fechamento de Período e Rematrícula', 'Serviços atendidos pelo CSC - Secretaria e Financeiro', 'Outros serviços atendidos pela Secretaria', 'Outras rotinas'];

// Dados base copiados de src/data/calendarData.js do repositório do site (commit 8faa9ab, 26/05/2026).
const BASE = { '2026': {
  graduacao: [
    { categoria: 'Período letivo', eventos: [
      { nome: 'Período letivo', datas: { 51: ['23/02/26', '02/05/26'], 52: ['04/05/26', '11/07/26'], 53: ['20/07/26', '26/09/26'], 54: ['28/09/26', '05/12/26'] } },
      { nome: 'Período de Captação', datas: { 51: ['14/10/25', '16/03/26'], 52: ['17/03/26', '25/05/26'], 53: ['26/05/26', '17/08/26'], 54: ['18/08/26', '19/10/26'] } }] },
    { categoria: 'Rotinas automatizadas', eventos: [
      { nome: 'Geração de RA', datas: { 51: ['18/10/25', '20/03/26'], 52: ['21/03/26', '29/05/26'], 53: ['30/05/26', '21/08/26'], 54: ['22/08/26', '23/10/26'] } }] }],
  profissionalizante: [{ categoria: 'Período letivo', eventos: [{ nome: 'Período letivo', datas: { 71: ['16/02/26', '25/04/26'], 72: ['27/04/26', '04/07/26'], 73: ['13/07/26', '19/09/26'], 74: ['21/09/26', '28/11/26'] } }] }],
  tecnicos: [{ categoria: 'Período letivo', eventos: [{ nome: 'Período letivo', datas: { 91: ['09/02/26', '17/04/26'], 92: ['21/04/26', '26/06/26'], 93: ['06/07/26', '11/09/26'], 94: ['14/09/26', '20/11/26'] } }] }],
  pos_hibrida: [{ categoria: 'Período letivo', eventos: [{ nome: 'Período letivo', datas: { 81: ['02/03/26', '09/05/26'], 82: ['11/05/26', '18/07/26'], 83: ['27/07/26', '03/10/26'], 84: ['05/10/26', '12/12/26'] } }] }],
  presencial: [{ categoria: 'Período letivo', eventos: [{ nome: 'Período letivo', datas: { '1S': ['09/02/26', '03/07/26'], '2S': ['27/07/26', '04/12/26'] } }] }]
} };

function linhaCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function produtoDe(texto) {
  const p = String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (p.includes('pos')) return 'pos_hibrida';
  if (p.includes('graduacao')) return 'graduacao';
  if (p.includes('profissionalizante')) return 'profissionalizante';
  if (p.includes('tecnico')) return 'tecnicos';
  if (p.includes('presencial')) return 'presencial';
  return '';
}
// Mesma transformação do site (transformCSVToProducts), com leitura de CSV que respeita aspas e quebras de linha.
function lerPlanilha(texto) {
  const linhas = String(texto || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (linhas.length < 2) throw new Error('A planilha publicada está vazia.');
  const cab = linhaCsv(linhas[0]).map(h => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  const col = (...n) => cab.findIndex(h => n.includes(h));
  const ix = { ano: col('ano'), produto: col('produto'), categoria: col('categoria'), evento: col('evento'), coluna: col('coluna'), inicio: col('inicio'), fim: col('fim', 'termino'), observacao: col('observacao', 'observacoes', 'observacao da planilha', 'obs', 'nota') };
  if ([ix.produto, ix.categoria, ix.evento, ix.coluna].some(i => i < 0)) throw new Error('A planilha publicada não tem as colunas esperadas (Produto, Categoria, Evento, Coluna).');
  const out = {};
  for (const l of linhas.slice(1)) {
    const c = linhaCsv(l), v = i => (i < 0 ? '' : String(c[i] ?? '').trim());
    const produto = produtoDe(v(ix.produto)), categoria = v(ix.categoria), evento = v(ix.evento), coluna = v(ix.coluna);
    const inicio = v(ix.inicio) || '-', fim = v(ix.fim) || '-', observacao = v(ix.observacao);
    if (!produto || !categoria || !evento || !coluna) continue;
    let ano = v(ix.ano);
    if (!ano && inicio !== '-') { const p = inicio.split('/'); if (p.length === 3) { let y = parseInt(p[2], 10); if (y < 100) y += 2000; ano = String(y); } }
    if (!ano) ano = '2026';
    out[ano] ||= { graduacao: [], profissionalizante: [], tecnicos: [], pos_hibrida: [], presencial: [] };
    let cat = out[ano][produto].find(x => x.categoria === categoria);
    if (!cat) { cat = { categoria, eventos: [] }; out[ano][produto].push(cat); }
    let ev = cat.eventos.find(x => x.nome === evento);
    if (!ev) { ev = { nome: evento, datas: {}, observacoes: {} }; cat.eventos.push(ev); }
    ev.datas[coluna] = [inicio, fim];
    if (observacao) ev.observacoes[coluna] = observacao;
  }
  if (!Object.keys(out).length) throw new Error('A planilha publicada não tem eventos válidos.');
  return out;
}
// Combina como o site: a planilha substitui o produto/ano quando trouxer dados para ele.
function combinar(planilha) {
  const r = JSON.parse(JSON.stringify(BASE));
  for (const [ano, prods] of Object.entries(planilha || {})) {
    r[ano] ||= {};
    for (const [p, cats] of Object.entries(prods)) if (cats && cats.length) r[ano][p] = cats;
  }
  return r;
}
function isoDe(br) {
  const m = String(br || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(iso + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
const ordemCat = n => { const i = ORDEM_CATEGORIAS.findIndex(c => c.toLowerCase() === String(n).toLowerCase()); return i < 0 ? 999 : i; };
// Formato entregue à tela: uma lista plana de ocorrências (produto + módulo + evento + datas ISO), fácil de buscar e ordenar.
function normalizar(dados) {
  const anos = Object.keys(dados).sort();
  const ocorrencias = [];
  for (const ano of anos) for (const [pid, cats] of Object.entries(dados[ano])) {
    const prod = PRODUTOS[pid]; if (!prod) continue;
    for (const cat of cats) for (const ev of cat.eventos) for (const [mod, par] of Object.entries(ev.datas)) {
      const [ini, fim] = Array.isArray(par) ? par : [par.inicio, par.fim];
      const inicio = isoDe(ini), termino = isoDe(fim) || inicio;
      if (!inicio && !termino) continue;
      const observacao = ev.observacoes?.[mod] || ev.observacao || '';
      ocorrencias.push({ ano, produto: pid, modulo: String(mod), categoria: cat.categoria, ordem_categoria: ordemCat(cat.categoria), evento: ev.nome, inicio: inicio || termino, fim: termino && inicio && termino < inicio ? inicio : termino, inicio_texto: ini, fim_texto: fim, observacao });
    }
  }
  return { anos, produtos: Object.entries(PRODUTOS).map(([id, p]) => ({ id, ...p })), ocorrencias };
}

function criarFonte(runtimeDir) {
  const dir = path.join(runtimeDir, 'informa');
  const arquivo = path.join(dir, 'calendario-unicesumar-cache.json');
  let emAndamento = null;
  const lerCache = () => { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; } };
  async function baixar() {
    const res = await fetch(SHEET_URL, { signal: AbortSignal.timeout(12000), redirect: 'follow', headers: { 'User-Agent': 'BalbinoInforma/1.0' } });
    if (!res.ok) throw new Error(`Planilha respondeu ${res.status}`);
    const planilha = lerPlanilha(await res.text());
    const cache = { buscado_em: new Date().toISOString(), planilha };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = arquivo + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache)); fs.renameSync(tmp, arquivo);
    return cache;
  }
  async function calendario({ forcar = false } = {}) {
    let cache = lerCache(), aviso = null, origem = 'planilha';
    const velho = !cache || Date.now() - Date.parse(cache.buscado_em) > CACHE_MS;
    if (forcar || velho) {
      try { emAndamento ||= baixar().finally(() => { emAndamento = null; }); cache = await emAndamento; }
      catch (e) {
        if (cache) { origem = 'cache'; aviso = `Não consegui ler a planilha do calendário agora (${e.message}). Mostrando a última cópia, obtida em ${new Date(cache.buscado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`; }
        else { origem = 'base'; aviso = `Não consegui ler a planilha do calendário (${e.message}). Mostrando somente os dados base publicados no código do site, que podem estar incompletos.`; }
      }
    }
    const dados = origem === 'base' ? BASE : combinar(cache.planilha);
    return { fonte: { site: SITE_URL, origem, atualizado_em: origem === 'base' ? null : cache.buscado_em, aviso }, ...normalizar(dados) };
  }
  return { calendario };
}

module.exports = { criarFonte, lerPlanilha, combinar, normalizar, BASE, SHEET_URL, SITE_URL };
