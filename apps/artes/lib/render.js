// Monta o HTML de cada arte a partir dos templates e gera o PNG com o navegador do computador (Edge ou Chrome)
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { DATA_DIR, getConfig } = require('./db');
const { iconeSVG, sugerirIcone } = require('./icones');

const TPL_DIR = path.join(__dirname, '..', 'templates');
const ARTES_DIR = path.join(DATA_DIR, 'artes');
const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(FOTOS_DIR, { recursive: true });
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(ARTES_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const TAMANHOS = { feed: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 }, horizontal: { w: 1920, h: 1080 } };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// *texto* vira destaque ciano
function destaque(s) {
  return esc(s).replace(/\*([^*]+)\*/g, '<span class="dest">$1</span>');
}
// Data no formato DD/MM, ou DD/MM/AAAA quando o tipo pede o ano ("Mostrar o ano nas datas")
function dataCurta(iso, completa = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? (completa ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`) : (iso || (completa ? '[DD/MM/AAAA]' : '[DD/MM]'));
}
function preencher(tpl, vars) {
  return tpl
    .replace(/\{\{\{\s*([\w]+)\s*\}\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => esc(vars[k] ?? ''));
}
function tamanhoCurso(nome, story) {
  const n = (nome || '').length;
  const base = n <= 10 ? 132 : n <= 13 ? 112 : n <= 16 ? 96 : n <= 20 ? 80 : 68;
  return story ? base + 8 : base;
}
function linkWhats(numero) {
  let d = String(numero || '').replace(/\D/g, '');
  if (!d) return '';
  if (!d.startsWith('55')) d = '55' + d;
  return 'https://wa.me/' + d;
}

// Dias entre a data de publicação e a data-alvo (contagem regressiva do Esquenta Black)
function diasAte(alvoIso, quando) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(alvoIso || ''); const q = /^(\d{4})-(\d{2})-(\d{2})/.exec(quando || '');
  if (!a || !q) return null;
  return Math.round((Date.UTC(a[1], a[2] - 1, a[3]) - Date.UTC(q[1], q[2] - 1, q[3])) / 86400000);
}
// Título gigante (BLACK / FRIDAY): o tamanho diminui sozinho para a palavra mais longa caber na largura
function tamanhoTitulo(textos, largura, maximo) {
  const n = Math.max(1, ...textos.map(t => String(t || '').trim().length));
  return Math.min(maximo, Math.floor(largura / (n * 0.74)));
}

// Variáveis usadas pelos templates e pelas legendas.
// "quando" é a data e hora da publicação (usada pela contagem regressiva).
function montarVariaveis(tipo, polo, dados, tutora = null, quando = '') {
  const v = {};
  const comAno = Boolean(tipo.data_completa);
  for (const c of tipo.campos) {
    const bruto = dados[c.chave] ?? c.padrao ?? '';
    v[c.chave] = c.tipo === 'date' ? dataCurta(bruto, comAno) : bruto;
    v[c.chave + '_html'] = c.tipo === 'date' ? esc(dataCurta(bruto, comAno)) : destaque(bruto);
    v[c.chave + '_oculto'] = String(bruto).trim() ? '' : 'display: none;';
  }
  // Pares de datas xxx_inicio / xxx_fim viram xxx_periodo ("25/10 a 29/10", ou "até 29/10" sem início)
  for (const c of tipo.campos) {
    if (c.tipo !== 'date' || !c.chave.endsWith('_inicio')) continue;
    const base = c.chave.slice(0, -7);
    if (!tipo.campos.some(x => x.chave === base + '_fim')) continue;
    const ini = dados[c.chave] ? dataCurta(dados[c.chave], comAno) : '';
    const fim = dados[base + '_fim'] ? dataCurta(dados[base + '_fim'], comAno) : '';
    v[base + '_periodo'] = ini && fim ? (ini === fim ? ini : `${ini} a ${fim}`) : fim ? `até ${fim}` : ini ? `a partir de ${ini}` : '[DD/MM] a [DD/MM]';
  }
  // Ícone: o escolhido; se não houver, o sugerido pelo nome do curso; senão, o do tipo
  const sugerido = dados.curso ? sugerirIcone(dados.curso) : '';
  // Lista de prazos (pares nomeN + ativN preenchidos) para a legenda das atividades
  const prazos = [];
  for (let i = 1; i <= 9; i++) {
    if (!tipo.campos.some(c => c.chave === 'ativ' + i)) break;
    if (dados['ativ' + i]) prazos.push(`${String(v['nome' + i] || '').trim()}: até ${dataCurta(dados['ativ' + i], comAno)}`);
  }
  v.prazos = prazos.join('\n');
  v.icone_svg = iconeSVG(dados.icone || (sugerido !== 'capelo' ? sugerido : '') || tipo.icone || 'capelo');
  v.polo = polo.nome;
  v.whatsapp = tipo.contato === 'pedagogico' ? (polo.whatsapp_pedagogico || polo.whatsapp_vendas) : (polo.whatsapp_vendas || polo.whatsapp_pedagogico);
  // Arte de uma tutora: o contato passa a ser o dela
  if (tutora && tutora.whatsapp) v.whatsapp = tutora.whatsapp;
  v.tutora = tutora ? tutora.nome : '';
  v.rodape_nome = tutora ? `${tutora.nome} · Polo ${polo.nome}` : `Polo ${polo.nome}`;
  v.nome_destaque = tutora ? tutora.nome : `Polo ${polo.nome}`;
  const tamNome = v.nome_destaque.length;
  v.nome_tamanho = tamNome <= 12 ? 110 : tamNome <= 18 ? 90 : tamNome <= 24 ? 74 : 62;
  v.foto_tutora = tutora && tutora.foto ? `<img src="fotos/${esc(tutora.foto)}" alt="">` : `<div class="sem-foto">${iconeSVG('pessoas')}</div>`;
  v.endereco = polo.endereco;
  v.horario = polo.horario;
  v.instagram = polo.instagram;
  v.curso_tamanho = tamanhoCurso(v.curso, false);
  v.curso_tamanho_story = tamanhoCurso(v.curso, true);
  const wa = linkWhats(v.whatsapp);
  v.qr_url = wa ? 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&data=' + encodeURIComponent(wa) : '';

  // Campanhas (Esquenta Black e Black Friday)
  if (tipo.campos.some(c => c.chave === 'titulo1')) {
    // Tamanho máximo de cada linha do título: [linha 1, linha 2] no feed e no story
    const caps = tipo.id === 'esquenta' ? { feed: [128, 250], story: [150, 290] } : { feed: [178, 178], story: [175, 175] };
    v.titulo1_tamanho = tamanhoTitulo([v.titulo1], 936, caps.feed[0]);
    v.titulo2_tamanho = tamanhoTitulo([v.titulo2], 936, caps.feed[1]);
    v.titulo1_tamanho_story = tamanhoTitulo([v.titulo1], 920, caps.story[0]);
    v.titulo2_tamanho_story = tamanhoTitulo([v.titulo2], 920, caps.story[1]);
  }
  if (tipo.campos.some(c => c.chave === 'contagem')) {
    // Contagem: o número digitado ou, se vazio, os dias entre a publicação e o início da Black
    const manual = parseInt(String(dados.contagem ?? '').replace(/\D/g, ''), 10);
    const dias = Number.isFinite(manual) ? manual : diasAte(dados.inicio, quando);
    const ok = dias !== null && dias >= 0;
    v.contagem_topo = !ok ? '' : dias === 0 ? 'É' : dias === 1 ? 'FALTA' : 'FALTAM';
    v.contagem_num = !ok ? '' : dias === 0 ? 'HOJE' : String(dias);
    v.contagem_base = !ok ? '' : dias === 0 ? '' : dias === 1 ? 'DIA' : 'DIAS';
    v.contagem_num_tamanho = dias === 0 ? 0.62 : String(dias).length > 2 ? 0.7 : 1;
    v.contagem_oculto = ok ? '' : 'display: none;';
    v.contagem_frase = !ok ? '' : dias === 0 ? 'É hoje! ' : dias === 1 ? 'Falta só 1 dia! ' : `Faltam ${dias} dias! `;
    v.inicio_oculto = dados.inicio ? '' : 'display: none;';
    v.destaque_oculto = String(v.destaque || '').trim() ? '' : 'display: none;';
    // Esquenta por curso: o bloco do curso entra no lugar da chamada
    if (String(v.curso || '').trim()) {
      v.chamada_oculto = 'display: none;';
      v.bloco_curso_oculto = '';
      v.curso_frase = `Quer fazer ${v.curso}${[v.linha1, v.linha2].filter(Boolean).length ? ' (' + [v.linha1, v.linha2].filter(Boolean).join(' ') + ')' : ''}? `;
      v.curso_tamanho = tamanhoCurso(v.curso, false) - 16;
      v.curso_tamanho_story = tamanhoCurso(v.curso, true) - 16;
    } else { v.bloco_curso_oculto = 'display: none;'; v.curso_frase = ''; }
  }
  if (tipo.id === 'black') {
    v.curso_frase = String(v.curso || '').trim() ? `${v.curso} (${[v.linha1, v.linha2].filter(Boolean).join(' ')}).\n` : '';
    v.validade_frase = dados.validade ? `${v.validade_rotulo} ${v.validade}.\n` : '';
    // Sem curso, o grau e a modalidade sobem de tamanho e viram o título da oferta
    v.curso_tamanho = tamanhoCurso(v.curso, false) - 12;
    v.curso_tamanho_story = tamanhoCurso(v.curso, true) - 12;
    v.sub_tamanho = String(v.curso || '').trim() ? 40 : 54;
    v.sub_tamanho_story = String(v.curso || '').trim() ? 46 : 60;
  }
  return v;
}

function legenda(tipo, polo, dados, tutora = null, quando = '') {
  const v = montarVariaveis(tipo, polo, dados, tutora, quando);
  return (tipo.legenda_padrao || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
}

function templateExiste(tipoId, formato) {
  return fs.existsSync(path.join(TPL_DIR, `${tipoId}-${formato}.html`));
}

function htmlArte({ tipo, polo, formato, dados, base, tutora = null, quando = '' }) {
  const arq = path.join(TPL_DIR, `${tipo.id}-${formato}.html`);
  if (!fs.existsSync(arq)) throw new Error(`Não existe template para ${tipo.nome} no formato ${formato}.`);
  const v = montarVariaveis(tipo, polo, dados, tutora, quando);
  v.base = base;
  const conteudo = preencher(fs.readFileSync(arq, 'utf8'), v);
  return preencher(fs.readFileSync(path.join(TPL_DIR, '_base.html'), 'utf8'), { base, conteudo });
}

// ---------- Navegador ----------
function acharNavegador() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cfg = getConfig();
  if (cfg.navegador && fs.existsSync(cfg.navegador)) return cfg.navegador;
  const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const candidatos = [
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    local && path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
  ].filter(Boolean);
  return candidatos.find(p => fs.existsSync(p)) || '';
}

function screenshot(urlOuArquivo, saida, w, h) {
  if (process.env.CLOUD_CHROMIUM === '1') return screenshotCloud(urlOuArquivo, saida, w, h);
  return new Promise((resolve, reject) => {
    const nav = acharNavegador();
    if (!nav) return reject(new Error('Não encontrei o Edge nem o Chrome. Informe o caminho do navegador em Configurações.'));
    const perfil = path.join(TMP_DIR, 'perfil-navegador');
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--force-device-scale-factor=1', `--user-data-dir=${perfil}`,
      `--window-size=${w},${h}`, '--virtual-time-budget=6000', '--run-all-compositor-stages-before-draw',
      `--screenshot=${saida}`, urlOuArquivo
    ];
    if (process.platform === 'linux') args.unshift('--no-sandbox');
    try { fs.rmSync(saida, { force: true }); } catch {}
    execFile(nav, args, { timeout: 90000, windowsHide: true }, (err) => {
      if (fs.existsSync(saida)) return resolve(saida);
      reject(new Error('O navegador não gerou a imagem. ' + (err ? err.message : '')));
    });
  });
}

async function screenshotCloud(urlOuArquivo, saida, w, h) {
  let browser;
  try {
    const chromiumModule = await import('@sparticuz/chromium');
    const puppeteerModule = await import('puppeteer-core');
    const chromium = chromiumModule.default || chromiumModule;
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const executablePath = process.env.CHROME_PATH || await chromium.executablePath();
    browser = await puppeteer.launch({ args: chromium.args, executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(urlOuArquivo, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.screenshot({ path: saida, type: 'png' });
    return saida;
  } catch (e) {
    throw new Error('Não foi possível iniciar o Chromium na hospedagem: ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function gerarPNG({ tipo, polo, formato, dados, base, nome, tutora = null, quando = '' }) {
  const html = htmlArte({ tipo, polo, formato, dados, base, tutora, quando });
  const tmp = path.join(TMP_DIR, `${nome}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const { w, h } = TAMANHOS[formato];
  const saida = path.join(ARTES_DIR, `${nome}.png`);
  await screenshot('file:///' + tmp.replace(/\\/g, '/').replace(/^\//, ''), saida, w, h);
  try { fs.rmSync(tmp, { force: true }); } catch {}
  return `${nome}.png`;
}

// Templates fora dos tipos (ex.: proposta empresarial): as variáveis já chegam prontas
function htmlLivre(nomeTemplate, vars) {
  const arq = path.join(TPL_DIR, `${nomeTemplate}.html`);
  if (!fs.existsSync(arq)) throw new Error(`Template ${nomeTemplate}.html não encontrado.`);
  const conteudo = preencher(fs.readFileSync(arq, 'utf8'), vars);
  return preencher(fs.readFileSync(path.join(TPL_DIR, '_base.html'), 'utf8'), { base: vars.base, conteudo });
}
async function gerarDeHtml({ html, formato, nome }) {
  const tmp = path.join(TMP_DIR, `${nome}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const { w, h } = TAMANHOS[formato];
  const saida = path.join(ARTES_DIR, `${nome}.png`);
  await screenshot('file:///' + tmp.replace(/\\/g, '/').replace(/^\//, ''), saida, w, h);
  try { fs.rmSync(tmp, { force: true }); } catch {}
  return `${nome}.png`;
}

// A Meta só aceita JPEG: converte a arte PNG pelo próprio navegador (sem instalar nada)
async function gerarJPG(arquivoPng) {
  const png = path.join(ARTES_DIR, arquivoPng);
  if (!fs.existsSync(png)) throw new Error('A arte ainda não foi gerada.');
  const { w, h } = lerTamanhoPNG(png);
  const nome = arquivoPng.replace(/\.png$/i, '');
  const tmp = path.join(TMP_DIR, `${nome}-jpg.html`);
  const src = 'file:///' + png.replace(/\\/g, '/').replace(/^\//, '');
  fs.writeFileSync(tmp, `<!doctype html><html><body style="margin:0;background:#03132D;overflow:hidden"><img src="${src}" style="display:block;width:${w}px;height:${h}px"></body></html>`, 'utf8');
  const saida = path.join(ARTES_DIR, `${nome}.jpg`);
  await screenshot('file:///' + tmp.replace(/\\/g, '/').replace(/^\//, ''), saida, w, h);
  try { fs.rmSync(tmp, { force: true }); } catch {}
  return `${nome}.jpg`;
}
function lerTamanhoPNG(arq) {
  const b = fs.readFileSync(arq).subarray(0, 24);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

module.exports = { FOTOS_DIR, htmlArte, htmlLivre, gerarPNG, gerarDeHtml, gerarJPG, legenda, montarVariaveis, acharNavegador, templateExiste, TAMANHOS, ARTES_DIR, linkWhats };
