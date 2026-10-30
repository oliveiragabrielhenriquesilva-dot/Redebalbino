// Propostas empresariais: recomenda cursos pelo segmento da empresa e monta a arte horizontal (1920×1080)
const fs = require('node:fs');
const path = require('node:path');
const { db, getConfig } = require('./db');
const render = require('./render');
const { iconeSVG, sugerirIcone } = require('./icones');

const MIN = 3, MAX = 6, PADRAO = 4;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const limpo = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

// Só cursos ativos e marcados "pode aparecer em propostas"
function cursosElegiveis() {
  return db.prepare("SELECT * FROM cursos WHERE ativo = 1 AND COALESCE(em_propostas, 1) = 1 ORDER BY curso, linha1").all();
}

function empresaCompleta(id) {
  const e = db.prepare(`SELECT e.*, s.nome AS segmento_nome, s.subtitulo AS segmento_subtitulo, p.nome AS polo_nome, t.nome AS tutora_nome
    FROM empresas e LEFT JOIN segmentos s ON s.id = e.segmento_id LEFT JOIN polos p ON p.id = e.polo_id LEFT JOIN tutoras t ON t.id = e.tutora_id
    WHERE e.id = ?`).get(id);
  if (!e) throw new Error('Empresa não encontrada.');
  let salva = null;
  try { salva = e.proposta ? JSON.parse(e.proposta) : null; } catch { salva = null; }
  return { ...e, proposta: salva };
}

// Cursos ligados ao segmento, na ordem de prioridade (vazio = o painel pede escolha manual)
function sugeridos(segmentoId) {
  if (!segmentoId) return [];
  return db.prepare(`SELECT c.*, cs.prioridade FROM curso_segmento cs JOIN cursos c ON c.id = cs.curso_id
    WHERE cs.segmento_id = ? AND c.ativo = 1 AND COALESCE(c.em_propostas, 1) = 1 ORDER BY cs.prioridade, c.curso`).all(segmentoId);
}

// O que a tela precisa para montar a proposta de uma empresa
function sugestao(empresaId) {
  const empresa = empresaCompleta(empresaId);
  const lista = sugeridos(empresa.segmento_id);
  // A seleção salva só vale se o segmento da empresa não mudou depois dela
  // (propostas antigas, sem o segmento gravado: descarta se o subtítulo é o padrão de outro segmento)
  let salva = empresa.proposta;
  if (salva) {
    const mudou = salva.segmento_id !== undefined ? Number(salva.segmento_id) !== Number(empresa.segmento_id)
      : Boolean(db.prepare("SELECT 1 FROM segmentos WHERE subtitulo = ? AND id != ? AND subtitulo != ''").get(salva.subtitulo || '', empresa.segmento_id || 0));
    if (mudou) salva = null;
  }
  const elegiveis = cursosElegiveis();
  const idsValidos = new Set(elegiveis.map(c => c.id));
  const escolhidos = salva && Array.isArray(salva.cursos) ? salva.cursos.filter(id => idsValidos.has(id)) : lista.slice(0, PADRAO).map(c => c.id);
  return {
    empresa, sugeridos: lista, elegiveis, escolhidos,
    tutora_id: (salva && salva.tutora_id) || empresa.tutora_id || null,
    subtitulo: salva && salva.subtitulo !== undefined ? salva.subtitulo : (empresa.segmento_subtitulo || ''),
    mostrar_faixa: salva && salva.mostrar_faixa !== undefined ? Boolean(salva.mostrar_faixa) : true,
    sem_associacao: !lista.length
  };
}

function validar({ empresa, tutora, polo, cursos }) {
  if (!empresa) throw new Error('Escolha a empresa.');
  if (!tutora) throw new Error('Escolha a consultora.');
  if (!polo) throw new Error('A consultora precisa estar ligada a um polo (tela Tutoras).');
  if (cursos.length < MIN || cursos.length > MAX) throw new Error(`Escolha de ${MIN} a ${MAX} cursos (hoje: ${cursos.length}).`);
}

function tamanhoNome(qtd, maior) {
  const base = qtd === 3 ? 54 : qtd === 4 ? 44 : 38;
  if (maior > 24) return base - 8;
  if (maior > 18) return base - 4;
  return base;
}

// Monta o HTML da arte a partir do pedido da tela
function montar({ empresa_id, tutora_id, cursos: ids, subtitulo, mostrar_faixa = true }, base) {
  const empresa = empresaCompleta(empresa_id);
  const tutora = tutora_id ? db.prepare('SELECT * FROM tutoras WHERE id = ?').get(tutora_id) : null;
  const polo = tutora ? db.prepare('SELECT * FROM polos WHERE id = ?').get(tutora.polo_id) : null;
  const elegiveis = new Map(cursosElegiveis().map(c => [c.id, c]));
  const cursos = (ids || []).map(Number).map(id => elegiveis.get(id)).filter(Boolean);
  validar({ empresa, tutora, polo, cursos });
  const cfg = getConfig();
  const qtd = cursos.length;
  const colunas = qtd === 3 ? 1 : 2;
  const maior = Math.max(...cursos.map(c => c.curso.length));
  const fonte = tamanhoNome(qtd, maior);
  const cursos_html = cursos.map(c => {
    const grau = [c.linha1, c.linha2].map(x => String(x || '').trim()).filter(Boolean).join(' · ');
    const icone = c.icone || sugerirIcone(c.curso);
    return `<div class="card-curso"><div class="ic">${iconeSVG(icone, '#00D0FF')}</div><div style="min-width:0"><div class="nm" style="font-size:${fonte}px">${esc(c.curso)}</div>${grau ? `<div class="gr">${esc(grau)}</div>` : ''}</div></div>`;
  }).join('');
  const nomeEmpresa = empresa.nome_fantasia || empresa.nome;
  const faixa = mostrar_faixa && cfg.proposta_faixa ? cfg.proposta_faixa.replace(/\{empresa\}/g, nomeEmpresa).toUpperCase() : '';
  const titulo = cfg.proposta_titulo || '';
  const wa = render.linkWhats(tutora.whatsapp || polo.whatsapp_vendas);
  const vars = {
    base,
    chamada_html: String(esc(cfg.proposta_chamada || '')).replace(/\*([^*]+)\*/g, '<span class="dest">$1</span>'),
    chamada_oculto: cfg.proposta_chamada ? '' : 'display: none;',
    foto_tutora: tutora.foto ? `<img src="fotos/${esc(tutora.foto)}" alt="">` : `<div class="sem-foto">${iconeSVG('pessoas', '#00D0FF')}</div>`,
    tutora: tutora.nome,
    nome_tamanho_h: tutora.nome.length <= 16 ? 56 : tutora.nome.length <= 22 ? 48 : 40,
    cargo_linha: [cfg.proposta_cargo, `Polo ${polo.nome}`].filter(Boolean).join(' · '),
    whats_rotulo: cfg.proposta_whats_rotulo || '', whats_rotulo_oculto: cfg.proposta_whats_rotulo ? '' : 'display: none;',
    whatsapp: tutora.whatsapp || polo.whatsapp_vendas || '',
    qr_url: wa ? 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&data=' + encodeURIComponent(wa) : '',
    qr_oculto: wa ? '' : 'display: none;',
    faixa, faixa_oculto: faixa ? '' : 'display: none;',
    titulo, titulo_tamanho: titulo.length > 60 ? 50 : qtd === 3 ? 66 : 60,
    subtitulo: subtitulo || '', subtitulo_oculto: subtitulo ? '' : 'display: none;',
    cursos_html, qtd, colunas,
    rodape: cfg.proposta_rodape || '', site: cfg.proposta_site || ''
  };
  return { html: render.htmlLivre('proposta-horizontal', vars), empresa, tutora, cursos, ...render.TAMANHOS.horizontal };
}

async function gerar(pedido, base) {
  const m = montar(pedido, base);
  const nome = `proposta-${m.empresa.id}-${limpo(m.empresa.nome_fantasia || m.empresa.nome)}`;
  const arquivo = await render.gerarDeHtml({ html: m.html, formato: 'horizontal', nome });
  const proposta = { segmento_id: m.empresa.segmento_id, cursos: m.cursos.map(c => c.id), tutora_id: m.tutora.id, subtitulo: pedido.subtitulo || '', mostrar_faixa: pedido.mostrar_faixa !== false };
  db.prepare("UPDATE empresas SET proposta = ?, arquivo = ?, gerado_em = datetime('now','localtime') WHERE id = ?").run(JSON.stringify(proposta), arquivo, m.empresa.id);
  return { arquivo, empresa_id: m.empresa.id };
}

// Uma arte para cada empresa ativa (opcional: só de um segmento). Usa a seleção salva ou a sugestão.
async function gerarLote({ segmento_id } = {}, base) {
  const empresas = db.prepare(`SELECT id FROM empresas WHERE ativo = 1 ${segmento_id ? 'AND segmento_id = ?' : ''} ORDER BY nome`).all(...(segmento_id ? [segmento_id] : []));
  const feitas = []; const puladas = [];
  for (const { id } of empresas) {
    const s = sugestao(id);
    const nome = s.empresa.nome_fantasia || s.empresa.nome;
    if (s.escolhidos.length < MIN) { puladas.push(`${nome}: menos de ${MIN} cursos (configure o segmento ou escolha à mão)`); continue; }
    if (!s.tutora_id) { puladas.push(`${nome}: sem consultora responsável`); continue; }
    try { feitas.push((await gerar({ empresa_id: id, tutora_id: s.tutora_id, cursos: s.escolhidos.slice(0, MAX), subtitulo: s.subtitulo, mostrar_faixa: s.mostrar_faixa }, base)).empresa_id); }
    catch (e) { puladas.push(`${nome}: ${e.message}`); }
  }
  return { feitas, puladas };
}

function arquivosDasEmpresas(ids) {
  return ids.map(id => db.prepare('SELECT arquivo FROM empresas WHERE id = ?').get(id))
    .filter(e => e && e.arquivo && fs.existsSync(path.join(render.ARTES_DIR, e.arquivo))).map(e => e.arquivo);
}

module.exports = { sugestao, montar, gerar, gerarLote, cursosElegiveis, arquivosDasEmpresas, MIN, MAX };
