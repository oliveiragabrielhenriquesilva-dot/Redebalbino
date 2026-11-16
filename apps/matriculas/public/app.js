'use strict';
/* Sistema de Acompanhamento de Matrículas — interface */

// ======================================================================= utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (v) => v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR');
const dec1 = (v) => v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const pctTxt = (v) => v == null ? '—' : `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dataBR = (iso) => iso ? iso.split('-').reverse().join('/') : '';
const ticket = (valor, qtd) => (qtd ? valor / qtd : 0);
const ls = {
  get(k, d) { try { const v = localStorage.getItem('mat:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mat:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

async function fetchJsonComLimite(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    let dados = null;
    try { dados = await r.json(); } catch { /* sem corpo */ }
    return { r, dados };
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`O servidor não respondeu em 15 segundos (${url}).`);
    throw e;
  } finally { clearTimeout(timer); }
}

async function api(url, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const { r, dados } = await fetchJsonComLimite(url, o);
  if (r.status === 401 && B && !url.includes('/api/login')) { B = null; fecharModal(); iniciar(); throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error((dados && dados.erro) || `Erro ${r.status}`);
  return dados;
}

function toast(msg, erro = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (erro ? ' erro' : '');
  t.textContent = msg;
  $('#toast-raiz').appendChild(t);
  setTimeout(() => t.remove(), erro ? 6000 : 3000);
}

function barra(valor, total, marco = null) {
  const p = Math.min(pct(valor, total), 100);
  const cls = !total ? '' : p >= 100 ? 'ok' : marco != null ? (p >= marco ? 'ok' : p >= marco * 0.85 ? 'warn' : 'bad') : '';
  return `<div class="barra ${cls}"><i style="width:${p}%"></i>${marco != null ? `<span class="marco" style="left:${Math.min(marco, 100)}%"></span>` : ''}</div>`;
}
function miniBarra(valor, total, marco = null) {
  if (!total) return '<span class="muted">—</span>';
  return `<div class="mini-barra">${barra(valor, total, marco)}<span>${pctTxt(pct(valor, total))}</span></div>`;
}

// Identidade oficial Rede Balbino — símbolo modular de conexão.
function marcaSVG(tam = 40, escuro = true) {
  const imagem = 'rede-balbino-simbolo.svg';
  return `<img class="marca-oficial" width="${tam}" height="${tam}" src="/brand/${imagem}" alt="Rede Balbino">`;
} function logoHTML(cfgs, escuro = true) {
  const nome = String(cfgs.nome_rede || 'Rede Balbino').trim();
  const [p1, ...resto] = nome.split(/\s+/);
  return `<div class="logo ${escuro ? '' : 'claro'}">${marcaSVG(40, escuro)}<div class="logo-txt">${resto.length ? `<small>${esc(p1)}</small><b>${esc(resto.join(' '))}</b>` : `<b>${esc(nome)}</b>`}</div></div>`;
}
function saveGap(saldo, compacto = false) {
  if (saldo == null) return '<span class="muted">—</span>';
  const v = Math.round(saldo);
  return v >= 0 ? `<span class="tag ok">SAVE${compacto ? '' : ' +' + int(v)}</span>` : `<span class="tag bad">GAP${compacto ? '' : ' ' + int(v)}</span>`;
}
const MODO_TXT = { corridos: 'dias corridos', 'seg-sex': 'dias úteis (seg–sex, sem feriados)', 'seg-sab': 'dias de seg–sáb (sem feriados)' };

const ICONES = {
  painel: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  ritmo: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  matriculas: '<path d="M4 4h16v4H4zM4 10h16v4H4zM4 16h10v4H4z"/>',
  mundo: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  metas: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6"/>',
  cadastros: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l-2.1-.7-.6-1.5 1-2-1.6-1.6-2 1-1.5-.6L13.5 4h-3l-.7 2.1-1.5.6-2-1L4.7 7.3l1 2-.6 1.5L3 11.5v3l2.1.7.6 1.5-1 2 1.6 1.6 2-1 1.5.6.7 2.1h3l.7-2.1 1.5-.6 2 1 1.6-1.6-1-2 .6-1.5 2.1-.7z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  campanha: '<path d="M7 4h10v3a5 5 0 01-10 0V4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 5H4v1a3 3 0 003 3M17 5h3v1a3 3 0 01-3 3M12 12v4M8 20h8M9 16h6v4H9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const icone = (n) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONES[n]}</svg>`;

const VERSAO_TELA = '30.4.0';

// ======================================================================= estado
let B = null; // bootstrap (cadastros + usuário)
const estado = { ciclo: null, polo: '' };
let contextoURLAplicado=false;
let semanaEscolhida = '';

const eAdmin = () => B && B.usuario.papel === 'admin';
const podeLancar = () => B && (B.usuario.papel === 'admin' || B.usuario.papel === 'lancador');
const poloTravado = () => B && B.usuario.papel === 'visualizador' && B.usuario.polo_id;
const nomePor = (lista, id) => (B[lista].find(x => x.id === Number(id)) || {}).nome || '';
const cicloAtual = () => B.ciclos.find(c => c.id === Number(estado.ciclo));
const categoriasDe = () => B.categorias;
const produtosAtivos = () => B.produtos.filter(p => p.ativo);

async function recarregarBootstrap() {
  B = await api('/api/bootstrap');
  B.ciclos = B.ciclos.map(c => ({ ...c, nome: 'Processo ' + String(c.nome || '').replace(/^(?:ciclo|processo)\s*:?\s*/i, '') }));
  const padrao = (B.ciclos.find(c => c.padrao) || B.ciclos[0] || {}).id || null;
  const contextoURL=new URLSearchParams(location.search);
  const salvo = (!contextoURLAplicado && Number(contextoURL.get('ciclo'))) || ls.get('ciclo',null);
  const refURL=contextoURL.get('ref');
  if(!contextoURLAplicado && refURL && /^\d{4}-\d{2}-\d{2}$/.test(refURL)) posicaoEscolhida=refURL;
  contextoURLAplicado=true;
  estado.ciclo = B.ciclos.some(c => c.id === salvo) ? salvo : padrao;
  estado.polo = poloTravado() ? B.usuario.polo_id : ls.get('polo', '');
  if (estado.polo && !B.polos.some(p => p.id === Number(estado.polo))) estado.polo = '';
  document.title = B.config.nome_sistema || 'Acompanhamento de Matrículas';
}

// ======================================================================= inicialização / login
async function iniciar() {
  const app = $('#app');
  try {
    const { dados: st } = await fetchJsonComLimite('/api/estado');
    if (st.precisa_configurar) return telaPrimeiroAcesso(st);
    try { await recarregarBootstrap(); } catch { return telaLogin(st); }
    montarShell();
    rotear();
  } catch (e) {
    app.innerHTML = `<div class="carregando">A resposta do servidor demorou ou falhou. Tente novamente em instantes.<br><small>${esc(e.message)}</small></div>`;
  }
}

function telaLogin(st) {
  $('#app').innerHTML = `
  <div class="login-wrap"><form class="login" id="f-login">
    <div class="login-logo">${logoHTML(st, false)}</div>
    <h1>${esc(st.nome_sistema || 'Acompanhamento de Matrículas')}</h1>
    <p>${esc(st.subtitulo || '')}</p>
    <div id="login-erro"></div>
    <label class="campo"><span>Login</span><input type="text" name="login" autocomplete="username" required autofocus></label>
    <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
    <button class="btn prim" type="submit">Entrar</button>
  </form></div>`;
  $('#f-login').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      await api('/api/login', { method: 'POST', body: { login: f.get('login'), senha: f.get('senha') } });
      iniciar();
    } catch (e) { $('#login-erro').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  };
}

function telaPrimeiroAcesso(st) {
  $('#app').innerHTML = `
  <div class="login-wrap"><form class="login" id="f-pa">
    <h1>Primeiro acesso</h1>
    <p>Crie o usuário administrador. É com ele que você vai lançar as matrículas e mexer nos cadastros.</p>
    <div id="pa-erro"></div>
    <label class="campo"><span>Seu nome</span><input type="text" name="nome" required autofocus></label>
    <label class="campo"><span>Login</span><input type="text" name="login" required></label>
    <label class="campo"><span>Senha (mín. 6 caracteres)</span><input type="password" name="senha" minlength="6" required></label>
    <button class="btn prim" type="submit">Criar administrador</button>
  </form></div>`;
  $('#f-pa').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      await api('/api/primeiro-acesso', { method: 'POST', body: f });
      await api('/api/login', { method: 'POST', body: { login: f.login, senha: f.senha } });
      iniciar();
    } catch (e) { $('#pa-erro').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  };
}

// ======================================================================= shell + rotas
const ROTAS = [
  { id: 'tutor', nome: 'Tutor', ic: 'painel', oculto: true },
  { id: 'painel', nome: 'Painel', ic: 'painel' },
  { id: 'gestao', nome: 'Gestão e qualidade', ic: 'ritmo' },
  { id: 'relatorios', nome: 'Relatórios', ic: 'matriculas' },
  { id: 'matriculas', nome: 'Matrículas', ic: 'matriculas' },
  { id: 'campanhas', nome: 'Campanhas', ic: 'campanha' },
  { id: 'mundo-azul', nome: 'Conferência', ic: 'mundo' },
  { id: 'cadastros', nome: 'Configuração', ic: 'cadastros', admin: true },
];
// endereços antigos continuam funcionando
const APELIDOS = { ritmo: '#/painel/spaces', metas: '#/cadastros/metas' };

function montarShell() {
  const u = B.usuario;
  const papel = { admin: 'Administrador', lancador: 'Lançador', visualizador: 'Visualização' }[u.papel];
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <div class="marca">${logoHTML(B.config)}<div class="marca-sis"><b>${esc(B.config.nome_sistema)}</b><span>${esc(B.config.subtitulo || '')}</span></div></div>
      <nav class="nav">${ROTAS.filter(r => !r.oculto && (!r.admin || eAdmin())).map(r => `<a href="#/${r.id}" data-r="${r.id}">${icone(r.ic)}${r.nome}</a>`).join('')}</nav>
      <div class="rodape"><b>${esc(u.nome)}</b>${papel}${u.polo_id ? ' · ' + esc(nomePor('polos', u.polo_id)) : ''}<br>
        <button id="b-senha">Trocar senha</button><button id="b-sair">Sair</button></div>
    </aside>
    <div class="main">
      <header class="topo">
        <button class="btn icone menu-btn" id="b-menu" aria-label="Menu">${icone('menu').replace('fill="currentColor"', 'fill="none"')}</button>
        <h1 id="titulo"></h1>
        <a class="btn portal-link" href="/" aria-label="Voltar ao Portal da Rede Balbino">Portal</a>
        <button class="btn" id="b-tema" type="button" title="Alternar tema"></button>
        <select class="sel-topo" id="sel-ciclo" title="Processo">${B.ciclos.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
        <select class="sel-topo" id="sel-polo" title="Polo" ${poloTravado() ? 'disabled' : ''}>
          <option value="">Todos os polos</option>${B.polos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select>
        ${podeLancar() ? '<button class="btn prim" id="b-nova">+ Nova matrícula</button>' : ''}
      </header>
      ${B.config.organizacao_produtos_2026_10_erro ? `<div class="faixa-versao">A organização dos produtos não foi aplicada: ${esc(B.config.organizacao_produtos_2026_10_erro)}. Os dados foram preservados; confira os cadastros antes de tentar novamente.</div>` : ''}
      ${B.versao !== VERSAO_TELA ? `<div class="faixa-versao">${location.hostname.endsWith('redebalbino.com.br') ? 'A interface e o servidor estão em versões diferentes. Atualize a página com Ctrl+F5; se o aviso continuar, avise o administrador para verificar a implantação.' : 'O servidor está rodando outra versão do sistema. Feche a janela preta do servidor e abra o <b>iniciar.bat</b> de novo; depois aperte F5.'}</div>` : ''}
      <section class="conteudo" id="conteudo"></section>
    </div>
  </div>`;
  const atualizarTema = () => { const escuro = document.documentElement.dataset.tema === 'escuro'; $('#b-tema').textContent = escuro ? '☀️ Tema claro' : '🌙 Tema escuro'; const logo = $('.side .marca .marca-oficial'); if (logo) logo.src = '/brand/rede-balbino-simbolo.svg'; };
  atualizarTema();
  $('#b-tema').onclick = () => { const tema = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro'; document.documentElement.dataset.tema = tema; ls.set('tema', tema); atualizarTema(); };
  $('#sel-ciclo').value = estado.ciclo || '';
  $('#sel-polo').value = estado.polo || '';
  $('#sel-ciclo').onchange = (e) => { estado.ciclo = Number(e.target.value); ls.set('ciclo', estado.ciclo); rotear(); };
  $('#sel-polo').onchange = (e) => { estado.polo = e.target.value ? Number(e.target.value) : ''; ls.set('polo', estado.polo); rotear(); };
  $('#b-sair').onclick = async () => { await api('/api/logout', { method: 'POST' }); if (location.pathname.startsWith('/matriculas')) { location.href = '/'; return; } B = null; iniciar(); };
  $('#b-senha').onclick = modalTrocarSenha;
  $('#b-menu').onclick = () => $('#side').classList.toggle('aberta');
  if ($('#b-nova')) $('#b-nova').onclick = () => modalMatricula(null, () => rotear());
}

window.addEventListener('hashchange', () => {
  if (!B) return;
  if (!$('#conteudo') && !/^#\/relatorio(?:[/-]|$)/.test(location.hash)) montarShell();
  rotear();
});

function rotear() {
  const [rota = 'painel', sub = '', ...partes] = location.hash.replace(/^#\/?/, '').split('/');
  if (APELIDOS[rota]) { location.replace(APELIDOS[rota]); return; }
  if (rota === 'relatorio-fechamento') return telaFechamento(sub);
  if (rota === 'relatorio-visao-space') return telaRelatorioVisaoSpace();
  if (rota === 'relatorio-rede-produtos') return telaRelatorioRedeProdutos();
  if (rota === 'relatorio') return telaRelatorio(sub);
  if (rota === 'relatorio-campanha') return telaRelatorioCampanha(sub);
  if (rota === 'relatorio-tutor') return telaRelatorioTutor(sub, partes);
  if (rota === 'relatorio-produto-space') return telaRelatorioProdutoSpace();
  if (rota === 'relatorio-equipe') return telaRelatorioEquipe(sub, partes[0]);
  if (rota === 'relatorio-metas') return telaRelatorioMetas(sub);
  if (rota === 'relatorio-mundo-azul') { location.replace('#/relatorio-sede-digital'); return; } // relatório das posições do print: substituído pela lista de alunos
  if (rota === 'relatorio-sede-digital') return telaRelatorioSedeDigital();
  if (rota === 'relatorio-previsao-semana') return telaRelatorioPrevisaoSemana();
  if (rota === 'relatorio-diario') return telaRelatorioDiario();
  if (rota === 'relatorio-origens') return telaRelatorioOrigens();
  const r = ROTAS.find(x => x.id === rota && (!x.admin || eAdmin())) || ROTAS.find(x => x.id === 'painel');
  $$('.nav a').forEach(a => a.classList.toggle('ativo', a.dataset.r === (r.id === 'tutor' ? 'painel' : r.id)));
  $('#side').classList.remove('aberta');
  fecharModal();
  $('#titulo').textContent = r.nome;
  const c = $('#conteudo');
  if (!estado.ciclo && r.id !== 'cadastros') {
    c.innerHTML = `<div class="card"><div class="vazio">Nenhum processo cadastrado. ${eAdmin() ? '<a href="#/cadastros/metas">Crie um processo em Metas e Spaces</a>.' : 'Peça ao administrador para criar um processo.'}</div></div>`;
    return;
  }
  c.innerHTML = '<div class="carregando">Carregando…</div>';
  const telas = { gestao: telaGestao, relatorios: telaCentralRelatorios, tutor: telaTutor, painel: telaPainel, matriculas: telaMatriculas, campanhas: telaCampanhas, 'mundo-azul': telaMundoAzul, cadastros: telaCadastros };
  Promise.resolve(telas[r.id](c, sub, partes)).catch(e => { c.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; });
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

// ======================================================================= ESTRUTURA DAS TABELAS (igual à planilha de metas)
// Categoria (Graduação / Continuada) › produtos na ordem do cadastro › subgrupo (ex.: Semi - Saúde) com subtotal › total da categoria.
// prods: objetos com .id (produto) e .categoria_id; somar(ids) = objeto do subtotal; totalCat(cid) = objeto da categoria
function hierarquia(prods, somar) {
  // lista única de produtos na ordem do cadastro (igual à planilha); subgrupo (ex.: Semi - Saúde) com subtotal
  const ps = [...prods].sort((a, b) => B.produtos.findIndex(x => x.id === a.id) - B.produtos.findIndex(x => x.id === b.id));
  const out = [], feitos = new Set();
  for (const p of ps) {
    if (feitos.has(p.id)) continue;
    const sg = (B.produtos.find(x => x.id === p.id) || {}).subgrupo;
    if (sg) {
      const g = ps.filter(x => (B.produtos.find(y => y.id === x.id) || {}).subgrupo === sg);
      g.forEach(x => feitos.add(x.id));
      const tot = somar(g.map(x => x.id));
      out.push({ tipo: 'subcab', nome: sg, ids: g.map(x => x.id), x: tot }, ...g.map(x => ({ tipo: 'prod', x, dentro: true })), { tipo: 'sub', nome: `${sg} — total`, ids: g.map(x => x.id), x: tot });
    } else { feitos.add(p.id); out.push({ tipo: 'prod', x: p }); }
  }
  return out;
}
// nome do produto + prazo próprio da meta, quando houver (ex.: "Pós (meta até 31/12)")
const nomeP = (id, nome) => { const pr = B.produtos.find(x => x.id === id); return pr && pr.meta_ate ? `${nome} (meta até ${dataBR(pr.meta_ate).slice(0, 5)})` : nome; };
// desenha as linhas; row(x, classe, nome, item) devolve o <tr> de produto/subtotal/total
function linhasHier(itens, ncol, row) {
  return itens.map(i => i.tipo === 'cab' ? `<tr class="novo-grupo"><td colspan="${ncol}">${esc(i.nome)}</td></tr>`
    : i.tipo === 'subcab' ? `<tr class="g-subcab"><td colspan="${ncol}">${esc(i.nome)}</td></tr>`
    : i.tipo === 'vazio' ? `<tr class="sub"><td colspan="${ncol}" class="muted">${esc(i.nome)}</td></tr>`
    : row(i.x, i.tipo === 'prod' ? (i.dentro ? 'sub' : '') : 'sub-total', i.tipo === 'prod' ? nomeP(i.x.id, i.x.nome) : i.nome, i)).join('');
}
// soma de produtos do painel (porProduto) para subtotal/total
function somaProdutos(d, ids) {
  const ps = d.porProduto.filter(p => ids.includes(p.id));
  const x = { qtd: 0, qtd_tutores: 0, sede: 0, meta: 0, valor: 0 }; let rm = 0, temRm = false;
  for (const p of ps) { x.qtd += p.qtd; x.qtd_tutores += qtdT(p); x.sede += p.sede || 0; x.meta += p.meta || 0; x.valor += p.valor; if (p.rpv_meta != null) { rm += p.rpv_meta; temRm = true; } }
  x.meta_rpv_parcial=ps.some(p=>p.meta_rpv_parcial); x.meta_qtd_total=ps.reduce((a,p)=>a+(p.meta_qtd_total||0),0); x.meta_qtd_coberta=ps.reduce((a,p)=>a+(p.meta_qtd_coberta||0),0);
  x.rpv_real = x.valor; x.rpv_meta = temRm ? rm : null; x.rpv_ating = temRm && rm && !x.meta_rpv_parcial ? x.valor / rm : null;
  x.ticket_meta = temRm && x.meta ? rm / x.meta : null; x.ticket_dif = qtdT(x) && x.ticket_meta != null ? x.valor / qtdT(x) - x.ticket_meta : null;
  return x;
}
// linha de ritmo (hoje_situacao, um Space ou a meta final) para produto / subtotal / total da categoria / total geral
function ritmoDe(lin, it) {
  if (!lin) return null;
  if (it.tipo === 'total') return lin.total;
  const ps = lin.linhas.flatMap(l => l.produtos || []);
  if (it.tipo === 'prod') return ps.find(p => p.produto_id === it.x.id) || null;
  const g = ps.filter(p => it.ids.includes(p.produto_id));
  if (!g.length) return null;
  const o = {}; for (const k of ['meta', 'esperado', 'realizado', 'falta']) o[k] = k === 'esperado' && g.some(p=>p.meta && p.esperado==null) ? null : g.reduce((a, p) => a + (p[k] || 0), 0);
  o.saldo = g.every(p => p.saldo == null) ? null : g.reduce((a, p) => a + (p.saldo || 0), 0);
  if (it.tipo === 'tot') { const l = lin.linhas.find(z => z.categoria_id === it.cid); if (l) Object.assign(o, { esperado: l.esperado, realizado: l.realizado, falta: l.falta ?? o.falta, saldo: l.saldo ?? o.saldo, por_dia: l.por_dia }); }
  if (o.por_dia === undefined) o.por_dia = lin.dias > 0 ? o.falta / lin.dias : null;
  return o;
}

// ======================================================================= PAINEL
const grupos = () => [...new Set(B.categorias.map(k => k.grupo).filter(Boolean))];
const DIAS_SEMANA = { 'seg-sex': 5, 'seg-sab': 6, corridos: 7 };
// "Precisa": por dia quando ≥ 1/dia; abaixo disso, por semana (mais fácil de virar ação)
function precisaTxt(porDia, modo) {
  if (porDia == null) return '<span class="muted">—</span>';
  if (porDia <= 0) return '<span class="pos">✓</span>';
  return porDia >= 1 ? `${dec1(porDia)}<small class="muted">/dia</small>` : `${dec1(porDia * (DIAS_SEMANA[modo] || 5))}<small class="muted">/sem</small>`;
}
function saldoTag(x) {
  if (!x) return '<span class="muted">—</span>';
  if (x.status === 'AGUARDANDO') return '<span class="tag cinza" title="Pouco histórico para projetar">aguardando</span>';
  return saveGap(x.saldo);
}
function difTicket(dif, grande = false) {
  if (dif == null) return '';
  const v = Math.round(dif * 100) / 100;
  return `<span class="tag ${v >= 0 ? 'ok' : 'bad'} ${grande ? '' : 'mini'}" title="diferença para a meta de ticket">${v >= 0 ? 'SAVE +' : 'GAP −'}${brl(Math.abs(v)).replace('R$', 'R$ ').replace('R$  ', 'R$ ')}</span>`;
}
function atingTag(x) {
  if(x?.meta_rpv_parcial)return '<span class="tag warn mini">meta incompleta</span>';
  if (!x || x.rpv_ating == null) return '<span class="muted">—</span>';
  const p = x.rpv_ating * 100;
  return `<span class="tag ${p >= 100 ? 'ok' : p >= 90 ? 'warn' : 'bad'} mini">${pctTxt(p)}</span>`;
}
// qtd = realizado da meta (lançadas pelos tutores + Sede/Digital do Mundo Azul); qtd_tutores = só lançadas (ticket, RPV, participação)
const qtdT = (x) => (x && x.qtd_tutores != null ? x.qtd_tutores : (x && x.qtd) || 0);
const tkTxt = (x) => x && qtdT(x) ? brl(x.valor / qtdT(x)) : '<span class="muted">—</span>';
// CPF e R.A. embaixo do nome do aluno (R.A. vem da lista do Mundo Azul; visualizador vê o CPF mascarado)
const idAluno = (x) => x && (x.cpf || x.ra) ? `<div class="id-aluno">${x.cpf ? 'CPF ' + esc(x.cpf) : ''}${x.cpf && x.ra ? ' · ' : ''}${x.ra ? 'R.A. ' + esc(x.ra) : ''}</div>` : '';
const sedeTxt = (x) => x && x.sede ? ` <small class="sede-tag" title="Inclui ${int(x.sede)} matrícula(s) Sede/Digital: Mundo Azul menos o que os tutores lançaram">incl. ${int(x.sede)} S/D</small>` : '';
function parseValorBR(t) {
  let v = String(t ?? '').replace(/[^\d.,-]/g, '');
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = Number(v); return Number.isFinite(n) ? n : 0;
}
function diasSemVendaTag(t) {
  if (t.ultima == null) return '<span class="tag warn">sem vendas</span>';
  const d = t.dias_sem_venda;
  if (d <= 1) return `<span class="muted">${d === 0 ? 'hoje' : '1 dia'}</span>`;
  return `<span class="tag ${d >= 4 ? 'bad' : 'warn'}">${d} dias</span>`;
}

// Dias corridos desde a última matrícula, considerando a data de referência da tela.
function diasCorridosSemVenda(ultima, ref) {
  if (!ultima || !ref) return null;
  const parse = x => { const [a, m, d] = x.slice(0, 10).split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.max(0, Math.round((parse(ref) - parse(ultima)) / 86400000));
}
function situacaoVenda(t, ref) {
  const dias = diasCorridosSemVenda(t.ultima, ref);
  if (dias === null) return { classe: 'warn', texto: 'Ainda não vendeu', detalhe: 'Nenhuma matrícula neste processo' };
  return { classe: dias === 0 ? 'ok' : dias < 3 ? 'warn' : 'bad', texto: dias === 0 ? 'Vendeu no dia' : `${dias} ${dias === 1 ? 'dia' : 'dias'} sem vender`, detalhe: `Última matrícula: ${dataBR(t.ultima)}` };
}
function quadroSemVendas(d, ref, umPolo) {
  const lista = [...d.porTutor].sort((a, b) => {
    const da = diasCorridosSemVenda(a.ultima, ref), db = diasCorridosSemVenda(b.ultima, ref);
    return (db === null ? Infinity : db) - (da === null ? Infinity : da) || a.nome.localeCompare(b.nome);
  });
  return `<div class="card mt"><div class="card-cab"><h2>Vendas por tutor</h2><span class="muted">Dias corridos · posição em ${dataBR(ref)} · processo selecionado</span></div><div class="corpo sem-pad"><table class="t"><thead><tr><th>Tutor</th>${umPolo ? '' : '<th>Polo</th>'}<th>Situação</th><th>Última matrícula</th></tr></thead><tbody>${lista.map(t => { const s = situacaoVenda(t, ref), podeAbrir = !B.usuario?.tutor_id || Number(B.usuario.tutor_id) === Number(t.tutor_id); return `<tr><td>${podeAbrir ? `<a href="#/tutor/${t.polo_id}/${t.tutor_id}">${esc(t.nome)}</a>` : esc(t.nome)}</td>${umPolo ? '' : `<td>${esc(t.polo)}</td>`}<td><span class="tag ${s.classe}">${s.texto}</span></td><td>${t.ultima ? dataBR(t.ultima) : '—'}</td></tr>`; }).join('') || `<tr><td colspan="4" class="vazio">Nenhum tutor encontrado neste recorte.</td></tr>`}</tbody></table></div></div>`;
}

// Posição do painel (data de referência). Vazio = padrão do sistema (último dia fechado). Não fica salva: volta ao padrão ao recarregar.
let posicaoEscolhida = '';
const posicaoAtual = () => posicaoEscolhida || B.ref_padrao || B.hoje;
const rotuloDia = (ref) => ref === B.hoje ? 'hoje' : ref === addDiasISO(B.hoje, -1) ? 'ontem' : `em ${dataBR(ref).slice(0, 5)}`;
const addDiasISO = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function telaPainel(c, aba) {
  const filtro = { tutor: '', origem: '', de: '', ate: '', prod: '', ...ls.get('painel-filtro', {}) };
  const [tipoP, idP] = (filtro.prod || '').split(':');
  const comSede = ls.get('painel-sede', true);
  const d = await api('/api/painel?' + qs({ ciclo: estado.ciclo, polo: estado.polo, ref: posicaoEscolhida, sede: comSede ? '1' : '0', tutor: filtro.tutor, origem: filtro.origem, de: filtro.de, ate: filtro.ate,
    categoria: tipoP === 'c' ? idP : '', produto: tipoP === 'p' ? idP : '', grupo: tipoP === 'g' ? idP : '', subgrupo: tipoP === 's' ? (filtro.prod || '').slice(2) : '' }));
  const semana = aba === 'equipe' ? await api('/api/ritmo-semanal?' + qs({ ciclo: estado.ciclo, polo: estado.polo, semana: semanaEscolhida || posicaoAtual(), ref: semanaEscolhida ? '' : posicaoAtual() })) : null;
  const T = d.totais, R = d.ritmo, modo = R.modo;
  const prox = R.spaces.find(s => s.proximo), fin = R.final;
  const nomeDias = modo === 'corridos' ? 'dias corridos' : modo === 'seg-sab' ? 'dias de segunda a sábado' : 'dias de segunda a sexta';
  const vazio = T.qtd === 0;
  const umPolo = !!(estado.polo || poloTravado());
  const catsUsadas = d.categorias.filter(k => d.porProduto.some(p => p.categoria_id === k.id));
  const tutoresFiltro = B.tutores.filter(t => !estado.polo || t.polos.includes(Number(estado.polo)));
  const linhaRitmo = (sp, cid) => sp ? (cid == null ? sp.total : sp.linhas.find(l => l.categoria_id === cid)) : null;

  // ---------------- cards do topo
  const H = R.hoje_situacao;
  const temMeta = d.usaMeta && Number(T.meta) > 0;
  const processoVazio = d.usaMeta && !temMeta && vazio;
  const kpis = d.usaMeta ? `
    <div class="card kpi"><div class="rot">Matrículas</div><div class="val">${int(T.qtd)}${sedeTxt(T)}</div>
      <div class="sub">${temMeta ? `de ${int(T.meta)} da meta · ${pctTxt(pct(T.qtd, T.meta))}` : 'Meta não cadastrada neste recorte'}</div>
      ${temMeta ? barra(T.qtd, T.meta, H.percentual) : ''}</div>
    <div class="card kpi"><div class="rot">Resultado até hoje</div>
      <div class="val">${temMeta ? saveGap(H.total.saldo) : '<span class="muted">—</span>'}</div>
      <div class="sub">${temMeta ? `realizadas ${int(H.total.realizado)} · esperadas ${int(H.total.esperado)}` : 'Cadastre uma meta para comparar o resultado'}</div></div>
    <div class="card kpi"><div class="rot">Meta final</div><div class="val">${temMeta ? int(T.meta) : '<span class="muted">—</span>'}</div>
      <div class="sub">${temMeta ? `${int(Math.max(0,T.meta-T.qtd))} matrícula(s) restantes${fin ? ` · até ${dataBR(fin.data)}` : ''}` : 'Nenhuma meta cadastrada neste recorte'}</div></div>
    <div class="card kpi"><div class="rot">RPV</div><div class="val">${brl(T.rpv_real)}</div>
      ${T.rpv_meta ? `<div class="sub">meta ${brl(T.rpv_meta)} ${atingTag(T)}</div>` : ''}
      <div class="sub">Ticket médio: ${!qtdT(T) ? '—' : brl(ticket(T.valor, qtdT(T)))}</div>
      </div>`
    : `<div class="card kpi"><div class="rot">Matrículas no recorte</div><div class="val">${int(T.qtd)}</div><div class="sub">filtros de tutor/origem/período ativos</div></div>
    <div class="card kpi"><div class="rot">RPV no recorte</div><div class="val">${brl(T.valor)}</div><div class="sub">Ticket médio: ${!qtdT(T) ? '—' : brl(ticket(T.valor, qtdT(T)))}</div></div>`;

  // ---------------- tabela única de produtos
  // ---------------- visão por grupo (Graduação EAD / Híbrido / Continuada)
  const tabGrupos = () => {
    const gs = grupos();
    if (gs.length < 2) return '';
    const soma = (lista, f) => lista.reduce((a, x) => a + (Number(f(x)) || 0), 0);
    const linhas = gs.map(g => {
      const ids = B.categorias.filter(k => k.grupo === g).map(k => k.id);
      const cats = d.porCategoria.filter(k => ids.includes(k.id));
      const hl = H.linhas.filter(l => ids.includes(l.categoria_id)), pl = prox ? prox.linhas.filter(l => ids.includes(l.categoria_id)) : [];
      const x = { nome: g, qtd: soma(cats, c => c.qtd), qtd_tutores: soma(cats, c => qtdT(c)), sede: soma(cats, c => c.sede), meta: soma(cats, c => c.meta), valor: soma(cats, c => c.valor), rpv_meta: soma(cats, c => c.rpv_meta),
        esperado: somarConhecido(hl,'esperado'), falta: soma(pl, l => l.falta), dias: prox ? prox.dias : 0 };
      x.saldo = x.esperado == null ? null : x.qtd - x.esperado; x.ticket_meta = x.rpv_meta && x.meta ? x.rpv_meta / x.meta : null;
      x.ticket_dif = qtdT(x) && x.ticket_meta != null ? x.valor / qtdT(x) - x.ticket_meta : null;x.meta_rpv_parcial=cats.some(c=>c.meta_rpv_parcial); x.rpv_ating = x.rpv_meta && !x.meta_rpv_parcial ? x.valor / x.rpv_meta : null;
      return x;
    }).filter(x => x.qtd || x.meta);
    if (linhas.length < 2) return '';
    return `<div class="card mt"><div class="card-cab"><h2>Por grupo</h2><span class="muted">${linhas.map(l => esc(l.nome)).join(' · ')}</span></div><div class="corpo sem-pad"><table class="t">
      <thead><tr><th>Grupo</th><th class="num">Realizado</th><th class="num">Meta</th><th>Atingido</th><th class="num">Esperado</th><th>SAVE/GAP</th>${prox ? `<th class="num">Falta p/ ${esc(prox.nome)}</th><th class="num">Precisa</th>` : ''}<th class="num">Ticket</th><th>Dif. ticket</th><th class="num">RPV</th><th>Ating. RPV</th></tr></thead><tbody>
      ${linhas.map(x => `<tr><td><b>${esc(x.nome)}</b></td><td class="num"><b>${int(x.qtd)}</b></td><td class="num muted">${int(x.meta)}</td><td>${miniBarra(x.qtd, x.meta)}</td><td class="num">${int(x.esperado)}</td><td>${saveGap(x.saldo)}</td>
        ${prox ? `<td class="num">${int(x.falta)}</td><td class="num">${precisaTxt(x.dias ? x.falta / x.dias : null, modo)}</td>` : ''}<td class="num">${qtdT(x) ? brl(x.valor / qtdT(x)) : '—'}</td><td>${difTicket(x.ticket_dif)}</td><td class="num">${brl(x.valor)}</td><td>${atingTag(x)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  };

  const tabProdutos = () => {
    const sp = prox;
    if (!d.usaMeta) {
      const l = (x, sub) => `<tr class="${sub ? 'sub' : ''}"><td>${esc(x.nome)}</td><td class="num">${int(x.qtd)}</td><td class="num">${pctTxt(pct(x.qtd, T.qtd))}</td><td class="num">${qtdT(x) ? brl(ticket(x.valor, qtdT(x))) : '—'}</td><td class="num">${brl(x.valor)}</td></tr>`;
      return `<table class="t"><thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Part.</th><th class="num">Ticket</th><th class="num">RPV</th></tr></thead><tbody>
        ${linhasHier(hierarquia(d.porProduto, ids => somaProdutos(d, ids)), 5, (x, cls, nome) => l({ ...x, nome }, true).replace('class="sub"', `class="${cls}"`))}
        <tr class="total"><td>Total</td><td class="num">${int(T.qtd)}</td><td class="num">100%</td><td class="num">${qtdT(T) ? brl(ticket(T.valor, qtdT(T))) : '—'}</td><td class="num">${brl(T.valor)}</td></tr></tbody></table>`;
    }
    const subDe = (lin, x) => { const l = lin && lin.find(z => z.categoria_id === x.categoria_id); return l && l.produtos ? l.produtos.find(z => z.produto_id === x.id) : null; };
    const comMetaTk = d.tem_meta_ticket;
    const linha = (x, it, cls) => {
      const h = ritmoDe(H, it), r = ritmoDe(sp, it), f = ritmoDe(fin, it);
      return `<tr class="${cls}"><td>${esc(x.nome)}</td><td class="num"><b>${int(x.qtd)}</b>${sedeTxt(x)}</td><td class="num muted">${int(x.meta)}</td><td>${miniBarra(x.qtd, x.meta)}</td>
        <td class="num col-g">${h ? int(h.esperado) : ''}</td><td>${h ? saveGap(h.saldo) : ''}</td>
        ${sp ? `<td class="num col-g">${r ? int(r.esperado) : ''}</td><td class="num">${x.meta && r ? int(r.falta) : '—'}</td><td class="num">${x.meta && r ? precisaTxt(r.por_dia, modo) : '—'}</td>` : ''}
        ${fin ? `<td class="num col-g">${f ? precisaTxt(f.por_dia, modo) : ''}</td>` : ''}
        <td class="num col-g">${tkTxt(x)}</td>${comMetaTk ? `<td class="num muted">${x.ticket_meta != null ? brl(x.ticket_meta) : '—'}</td><td>${difTicket(x.ticket_dif)}</td>` : ''}
        <td class="num col-g">${brl(x.rpv_real ?? x.valor)}</td>${comMetaTk ? `<td>${atingTag(x)}</td>` : ''}</tr>`;
    };
    return `<table class="t"><thead>
      <tr><th rowspan="2">Produto</th><th rowspan="2" class="num">Realizado</th><th rowspan="2" class="num">Meta</th><th rowspan="2">Atingido</th>
        <th colspan="2" class="grupo">Posição · ${dataBR(R.hoje)}</th>
        ${sp ? `<th colspan="3" class="grupo">${esc(sp.nome)} · ${dataBR(sp.data)}</th>` : ''}${fin ? '<th class="grupo">Meta final</th>' : ''}<th ${comMetaTk ? 'colspan="3"' : 'rowspan="2"'} class="grupo">Ticket</th><th ${comMetaTk ? 'colspan="2"' : 'rowspan="2"'} class="grupo">RPV (receita)</th></tr>
      <tr><th class="num col-g">Esperado</th><th>SAVE/GAP</th>${sp ? '<th class="num col-g">Esperado</th><th class="num">Falta</th><th class="num">Precisa</th>' : ''}${fin ? '<th class="num col-g">Precisa</th>' : ''}${comMetaTk ? '<th class="num col-g">Real</th><th class="num">Meta</th><th>Dif.</th><th class="num col-g">Real</th><th>Ating.</th>' : ''}</tr></thead><tbody>
      ${linhasHier(hierarquia(d.porProduto, ids => somaProdutos(d, ids)), 20, (x, cls, nome, it) => linha({ ...x, nome }, it, cls))}
      ${linha({ nome: 'Total', ...T }, { tipo: 'total' }, 'total')}
    </tbody></table>`;
  };

  // ---------------- equipe
  const tabEquipe = () => {
    const comMeta = d.tem_meta_tutor;
    const lista = comMeta ? [...d.porTutor].sort((a, b) => (a.saldo ?? 1e9) - (b.saldo ?? 1e9) || b.qtd - a.qtd) : d.porTutor;
    const metaTxt = (t) => t.meta == null ? '<span class="muted">—</span>' : `${dec1(t.meta).replace(',0', '')}${t.meta_origem === 'dividida' ? '<small class="muted" title="Meta do polo dividida igualmente pela equipe — cadastre metas individuais em Configuração › Metas e Spaces"> ÷</small>' : ''}`;
    return `<table class="t"><thead><tr><th>Tutor</th>${umPolo ? '' : '<th>Polo</th>'}${(d.produtosEquipe || d.porProduto).map(k => `<th class="num">${esc(k.nome)}</th>`).join('')}<th class="num">Total</th>
      ${comMeta ? `<th class="num col-g">Meta</th><th>Atingido</th><th class="num">Esperado</th><th>SAVE/GAP</th>${prox ? `<th class="num">Precisa até ${esc(prox.nome)}</th>` : ''}` : '<th class="num">Part.</th>'}
      <th class="num col-g">Ticket</th><th class="num">RPV</th><th>Última venda</th><th>Sem vender</th></tr></thead><tbody>
    ${lista.map(t => `<tr><td><a href="#" data-ver-tutor="${t.tutor_id}-${t.polo_id}">${esc(t.nome)}</a></td>${umPolo ? '' : `<td class="muted">${esc(t.polo)}</td>`}${(d.produtosEquipe || d.porProduto).map(k => `<td class="num">${t.produtos[k.id] ? int(t.produtos[k.id]) : '<span class="muted">0</span>'}</td>`).join('')}
      <td class="num"><b>${int(t.qtd)}</b></td>
      ${comMeta ? `<td class="num col-g">${metaTxt(t)}</td><td>${t.meta != null ? miniBarra(t.qtd, t.meta) : ''}</td><td class="num">${t.esperado != null ? int(t.esperado) : '—'}</td><td>${t.saldo != null ? saveGap(t.saldo) : '<span class="muted">—</span>'}</td>
        ${prox ? `<td class="num">${t.proximo ? precisaTxt(t.proximo.por_dia, modo) : '—'}</td>` : ''}` : `<td class="num">${pctTxt(pct(t.qtd,d.total_credito_tutores?.qtd ?? qtdT(T)))}</td>`}
      <td class="num col-g">${tkTxt(t)} ${difTicket(t.ticket_dif)}</td><td class="num">${brl(t.valor)}</td>
      <td class="muted">${t.ultima ? dataBR(t.ultima) : '—'}</td><td>${diasSemVendaTag(t)}</td></tr>`).join('') || `<tr><td colspan="${d.porProduto.length + 12}" class="vazio">Nenhum tutor ativo vinculado. Cadastre em Configuração › Tutores.</td></tr>`}
    ${T.sede ? `<tr class="sub"><td><b>Sede/Digital</b> <span class="sede-tag">Mundo Azul</span></td>${umPolo ? '' : '<td class="muted">—</td>'}${(d.produtosEquipe || d.porProduto).map(k => `<td class="num">${k.sede ? int(k.sede) : '<span class="muted">0</span>'}</td>`).join('')}<td class="num"><b>${int(T.sede)}</b>${T.sede_sem_produto ? `<br><small class="muted">${int(T.sede_sem_produto)} sem produto</small>` : ''}</td><td colspan="12" class="muted">não lançadas pelos tutores (central, site) · sem meta de tutor, ticket ou RPV</td></tr>` : ''}
    </tbody></table>
    ${comMeta ? `<div class="nota">Meta do tutor no processo: individual quando cadastrada em ${eAdmin() ? '<a href="#/cadastros/metas">Metas e Spaces › Meta por tutor</a>' : 'Metas e Spaces'}; sem isso, a meta do polo é dividida igualmente pela equipe ativa (marcada com ÷). ${filtro.prod ? 'Com filtro de produto vale a fatia proporcional. ' : ''}O esperado usa o mesmo ritmo do polo. A equipe usa o polo de crédito; o total comercial usa o polo de destino da matrícula.</div>` : ''}`;
  };

  // ---------------- evolução diária com linha do necessário
  const evolucao = () => {
    const ini = d.porDia.length ? d.porDia[0].data : R.inicio;
    const mapa = Object.fromEntries(d.porDia.map(x => [x.data, x.qtd]));
    const dias = [];
    for (let dt = new Date(ini + 'T12:00:00'), fim = new Date(B.hoje + 'T12:00:00'); dt <= fim; dt.setDate(dt.getDate() + 1)) {
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      dias.push({ data: iso, qtd: mapa[iso] || 0, fds: dt.getDay() === 0 || dt.getDay() === 6 });
    }
    const ult = dias.slice(-60);
    if (!ult.length) return '<div class="vazio">Ainda não há evolução para exibir neste período.</div>';
    const nec = d.usaMeta && prox && prox.total.por_dia ? prox.total.por_dia : null; // ritmo necessário até o próximo Space
    const max = Math.max(1, nec || 0, ...ult.map(x => x.qtd));
    return `<div class="colunas">${ult.map(x => `<div class="col ${x.fds ? 'fds' : ''} ${nec && x.qtd >= nec ? 'bateu' : ''}" style="height:${Math.max(x.qtd ? 3 : 1, (x.qtd / max) * 100)}%" title="${dataBR(x.data)}: ${x.qtd} matrícula(s)"></div>`).join('')}
      ${nec ? `<div class="linha-nec" style="bottom:${(nec / max) * 100}%"><span>ritmo necessário: ${dec1(nec)} por dia da contagem</span></div>` : ''}</div>
      <div class="colunas-eixo"><span>${dataBR(ult[0].data)}</span><span>${nec ? 'verde = bateu o necessário do dia' : `pico: ${max}/dia`}</span><span>${dataBR(ult[ult.length - 1].data)}</span></div>`;
  };

  // ---------------- ranking de polos (só na visão geral)
  const tabPolos = () => {
    const ord = [...d.porPolo].sort((a, b) => (a.hoje?.saldo ?? 1e9) - (b.hoje?.saldo ?? 1e9));
    return `<table class="t"><thead><tr><th>Polo</th>${d.porProduto.map(k => `<th class="num">${esc(k.nome)}</th>`).join('')}<th class="num">Total</th><th class="num">Meta</th><th>Atingido</th>
      <th class="num">Esperado</th><th>SAVE/GAP</th>${prox ? `<th class="num">Precisa até ${esc(prox.nome)}</th>` : ''}<th class="num">Ticket</th><th>Ating. RPV</th></tr></thead><tbody>
      ${ord.map(p => `<tr class="clicavel" data-abrir-polo="${p.id}"><td><a href="#" data-abrir-polo="${p.id}">${esc(p.nome)}</a></td>${d.porProduto.map(k => { const v = p.produtos[k.id] || 0, mt = p.metaProdutos[k.id] || 0; return `<td class="num">${mt || v ? `${int(v)}<span class="muted">/${int(mt)}</span>` : '<span class="muted">—</span>'}</td>`; }).join('')}
        <td class="num"><b>${int(p.qtd)}</b>${sedeTxt(p)}</td><td class="num muted">${int(p.meta)}</td><td>${miniBarra(p.qtd, p.meta)}</td>
        <td class="num">${p.hoje ? int(p.hoje.esperado) : '—'}</td><td>${p.hoje ? saveGap(p.hoje.saldo) : '—'}</td>
        ${prox ? `<td class="num">${p.proximo ? precisaTxt(p.proximo.por_dia, modo) : '—'}</td>` : ''}<td class="num">${tkTxt(p)} ${difTicket(p.ticket_dif)}</td><td>${atingTag(p)}</td></tr>`).join('')}
    </tbody></table>`;
  };

  const maxOrigem = Math.max(1, ...d.porOrigem.map(o => o.qtd));
  // RPV está temporariamente suspenso na interface; dados e APIs são preservados.
  const abas = [['resumo', 'Resumo'], ...(umPolo ? [] : [['produtos', 'Produtos × Polos'], ['polos', 'Ranking de polos']]), ['equipe', 'Equipe'], ['origens', 'Origens'], ['spaces', 'Spaces']];
  if (!abas.some(x => x[0] === aba)) aba = 'resumo';
  const avisoVazio = (o) => `<div class="card mt"><div class="vazio">Nenhuma matrícula lançada ${umPolo ? 'neste polo ' : ''}neste processo ainda. ${o}</div></div>`;
  const tabMatriz = () => {
    const polosM = d.porPolo;
    const celula = (p, k) => {
      const h = p.hojeProduto[k.id];
      if (!h || (!h.meta && !h.realizado)) return '<td class="mz nd">—</td>';
      if(h.saldo==null||!h.meta)return `<td class="mz nd" title="${esc(p.nome)} · ${esc(k.nome)}: ${!h.meta?'sem meta cadastrada':'aguardando definição dos Spaces'}"><b>—</b><small>${int(h.realizado)}/${int(h.meta)}</small></td>`;
      const cls = h.saldo >= 0 ? 'ok' : 'bad';
      return `<td class="mz ${cls}" data-polo="${p.id}" data-prod="${k.id}" title="${esc(p.nome)} · ${esc(k.nome)}: realizado ${h.realizado}, esperado até hoje ${h.esperado}, meta ${h.meta}">
        <b>${h.saldo >= 0 ? '+' : ''}${int(h.saldo)}</b><small>${int(h.realizado)}/${int(h.meta)}</small></td>`;
    };
    return `<table class="t matriz"><thead><tr><th>Polo</th>${d.porProduto.map(k => `<th class="num">${esc(k.nome)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
      ${polosM.map(p => `<tr><td><a href="#" data-abrir-polo="${p.id}">${esc(p.nome)}</a></td>${d.porProduto.map(k => celula(p, k)).join('')}<td class="num">${p.hoje ? saveGap(p.hoje.saldo) : '—'}</td></tr>`).join('')}
      <tr class="total"><td>Rede</td>${d.porProduto.map(k => { const l = (H.linhas.find(x => x.categoria_id === k.categoria_id)?.produtos || []).find(x => x.produto_id === k.id); return `<td class="num">${l ? saveGap(l.saldo) : '—'}</td>`; }).join('')}<td class="num">${saveGap(H.total.saldo)}</td></tr>
    </tbody></table>`;
  };
  const tabRPV = () => {
    const linhaR = (x, sub, curto = false) => `<tr class="${sub ? 'sub' : ''}"><td>${esc(x.nome)}</td><td class="num">${int(qtdT(x))}</td><td class="num"><b>${tkTxt(x)}</b></td>
      <td class="num muted">${x.ticket_meta != null ? brl(x.ticket_meta) : '—'}</td><td>${difTicket(x.ticket_dif) || '<span class="muted">—</span>'}</td>
      <td class="num col-g">${brl(x.rpv_real ?? x.valor)}</td>${curto ? '' : `<td class="num muted">${metaRpvTxt(x)}</td><td>${atingTag(x)}</td>`}</tr>`;
    const cab = (t, curto = false) => `<thead><tr><th>${t}</th><th class="num">Matr.</th><th class="num">Ticket</th><th class="num">Meta ticket</th><th>Dif.</th><th class="num col-g">RPV</th>${curto ? '' : '<th class="num">Meta RPV</th><th>Ating. RPV</th>'}</tr></thead>`;
    const sem = d.rpvSemanas;
    return `${avisoFinanceiro(d)}${!d.tem_meta_ticket ? `<div class="info">A meta de ticket ainda não foi cadastrada. ${eAdmin() ? 'Cadastre em <a href="#/cadastros/metas">Configuração › Metas e Spaces</a> (quadro "Meta de ticket").' : ''} Por enquanto aparecem só os valores realizados.</div>` : ''}
    <div class="grid g4">
      <div class="card kpi"><div class="rot">Ticket médio</div><div class="val">${!qtdT(T) ? '<span class="muted">—</span>' : brl(T.valor / qtdT(T))}</div><div class="sub">mensalidade média com desconto</div></div>
      <div class="card kpi"><div class="rot">Meta de ticket</div><div class="val">${T.ticket_meta != null ? brl(T.ticket_meta) : '<span class="muted">—</span>'}</div><div class="sub">${T.ticket_dif != null ? difTicket(T.ticket_dif) + ' por matrícula' : 'meta de RPV ÷ meta de matrículas'}</div></div>
      <div class="card kpi"><div class="rot">RPV realizado</div><div class="val">${brl(T.rpv_real)}</div><div class="sub">receita = matrículas × ticket</div></div>
      <div class="card kpi"><div class="rot">Atingimento do RPV</div><div class="val">${T.rpv_ating != null ? pctTxt(T.rpv_ating * 100) : '<span class="muted">—</span>'}</div><div class="sub">${T.meta_rpv_parcial ? 'Meta incompleta: atingimento indisponível' : T.rpv_meta ? `meta ${brl(T.rpv_meta)}` : d.usaMeta ? 'sem meta de ticket' : 'Sem meta de RPV para este recorte'}</div></div>
    </div>
    <div class="card mt"><div class="card-cab"><h2>Ticket e RPV por produto</h2><span class="muted">padrão do BI: meta de RPV = meta de matrículas × meta de ticket</span></div><div class="corpo sem-pad"><table class="t">${cab('Produto')}<tbody>
      ${linhasHier(hierarquia(d.porProduto, ids => somaProdutos(d, ids)), 8, (x, cls, nome) => linhaR({ ...x, nome }, true).replace('<tr class="sub">', `<tr class="${cls}">`))}
      ${linhaR({ nome: 'Total', ...T }, false).replace('<tr class="">', '<tr class="total">')}</tbody></table></div></div>
    <div class="card mt"><div class="card-cab"><h2>Ticket semana a semana</h2><span class="muted">se o ticket cai ao longo do processo, normalmente é desconto aumentando</span></div><div class="corpo sem-pad">
      ${sem.length ? `<table class="t"><thead><tr><th>Semana (início)</th><th class="num">Matrículas</th><th class="num">Ticket</th><th>Variação</th><th class="num">Meta ticket</th><th>Diferença</th><th class="num">RPV</th></tr></thead><tbody>
        ${sem.map((w, i) => { const ant = i ? sem[i - 1] : null; const var_ = ant && ant.ticket && w.ticket ? w.ticket - ant.ticket : null;
          return `<tr><td>${dataBR(w.semana)}</td><td class="num">${int(w.qtd)}</td><td class="num"><b>${w.ticket != null ? brl(w.ticket) : '—'}</b></td>
            <td>${var_ == null ? '<span class="muted">—</span>' : `<span class="${var_ >= 0 ? 'pos' : 'neg'}">${var_ >= 0 ? '▲' : '▼'} ${brl(Math.abs(var_))}</span>`}</td>
            <td class="num muted">${w.ticket_meta != null ? brl(w.ticket_meta) : '—'}</td><td>${difTicket(w.ticket_dif) || '<span class="muted">—</span>'}</td><td class="num">${brl(w.rpv_real)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="vazio">Sem matrículas ainda.</div>'}
    </div></div>
    <div class="grid g2 mt">
      <div class="card"><h2>Por origem</h2><div class="corpo sem-pad"><table class="t">${cab('Origem', true)}<tbody>${[...d.porOrigem].sort((a, b) => b.qtd - a.qtd).map(o => linhaR(o, false, true)).join('') || '<tr><td colspan="6" class="vazio">Sem matrículas ainda.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h2>${umPolo ? 'Por tutor' : 'Por polo'}</h2><div class="corpo sem-pad"><table class="t">${cab(umPolo ? 'Tutor' : 'Polo', true)}<tbody>
        ${(umPolo ? d.porTutor.filter(t => t.qtd) : d.porPolo).map(x => linhaR(x, false, true)).join('') || '<tr><td colspan="6" class="vazio">Sem matrículas ainda.</td></tr>'}</tbody></table></div></div>
    </div>`;
  };
  const conteudoAba = () => {
    if (aba === 'rpv') return tabRPV();
    if (aba === 'produtos') return d.usaMeta ? `<div class="card"><div class="card-cab"><h2>SAVE / GAP — polo × produto</h2><span class="muted">número grande = SAVE/GAP · embaixo = realizado/meta · clique na célula para abrir o polo naquele produto</span></div><div class="corpo sem-pad">${tabMatriz()}</div></div>`
      : '<div class="card"><div class="vazio">A matriz usa as metas — remova os filtros de tutor, origem e período para vê-la.</div></div>';
    if (aba === 'spaces') return d.usaMeta ? '<div id="aba-spaces"></div>' : '<div class="card"><div class="vazio">Os Spaces usam as metas — remova os filtros de tutor, origem e período para vê-los.</div></div>';
    if (aba === 'equipe') {
      const ed = eAdmin() && semana.editavel;
      const ferDe = (dt) => (semana.feriados || []).find(f => f.data === dt);
      const proxSeg = addDiasISO(semana.inicio, 7);
      return `<div class="card"><div class="card-cab"><h2>Meta semanal por tutor</h2>
        <button class="btn peq" id="ritmo-ant" title="Semana anterior">‹</button><b>${dataBR(semana.inicio).slice(0, 5)} a ${dataBR(semana.fim).slice(0, 5)}</b><button class="btn peq" id="ritmo-prox" data-sem="${proxSeg}" title="Próxima semana">›</button>
        <button class="btn peq" id="ritmo-atual">Semana atual</button>
        ${ed ? `<span class="espaco"></span><button class="btn peq" id="ritmo-sug-todos" title="Copia a meta sugerida de cada tutor para o campo da meta">Usar sugeridas</button><button class="btn peq prim" id="ritmo-salvar-todas">Salvar todas</button>` : ''}</div>
      <div class="nota">${ed ? `Digite a meta da semana de cada tutor e clique em <b>Salvar todas</b>: o sistema divide automaticamente pelos dias de venda${diasMetaCfg().includes(0) ? '' : ' (sem domingo)'}, <b>pulando feriados</b> (nacionais e do polo). A semana vai de ${NOME_DIA_LONGO[inicioSemanaCfg()].toLowerCase()} a ${NOME_DIA_LONGO[(inicioSemanaCfg() + 6) % 7].toLowerCase()}. Para mudar dia a dia, use <b>Por dia</b>. ` : semana.inicio < semana.hoje ? 'Semana encerrada — só consulta. ' : ''}<b>Sugerida</b> = ritmo do plano: a parte da meta do tutor (Configuração › Metas e Spaces › Meta por tutor) que o calendário prevê para esta semana${Number(B.config.ritmo_minimo_semanal) > 0 ? `, nunca abaixo do mínimo de ${int(B.config.ritmo_minimo_semanal)} por semana` : ''}. Não sobe quando o tutor atrasa — o <b>Atraso</b> aparece à parte, só para acompanhar. Embaixo de cada dia: realizado e, em cinza, a meta do dia.</div>
      <div class="corpo sem-pad"><table class="t"><thead><tr><th>Tutor</th>${umPolo ? '' : '<th>Polo</th>'}${semana.datas.map((dt) => { const fe = ferDe(dt); return `<th class="num ${diasMetaCfg().includes(diaDaSemana(dt)) ? '' : 'muted'}" ${fe ? `title="Feriado: ${esc(fe.nome)}"` : ''}>${NOME_DIA[diaDaSemana(dt)]}<br>${dataBR(dt).slice(0,5)}${fe ? '<br><span class="tag warn mini">feriado</span>' : ''}</th>`; }).join('')}<th class="num">Semana</th><th class="num" title="Ritmo do plano: a parte da meta do tutor que o calendário prevê para esta semana (nunca abaixo do mínimo configurado)">Sugerida</th><th class="num" title="Quanto o tutor já está atrasado em relação ao esperado no começo da semana — informativo, não entra na sugerida">Atraso</th><th class="num">Meta da semana</th><th class="num">Faltam</th>${ed ? '<th></th>' : ''}<th>Relatório (PDF)</th></tr></thead><tbody>
      ${semana.tutores.map(t => `<tr><td>${esc(t.nome)}</td>${umPolo ? '' : `<td>${esc(t.polo)}</td>`}${semana.datas.map(dt => `<td class="num">${dt > semana.hoje ? '<span class="muted">—</span>' : int(t.dias[dt] || 0)}${t.metas_dias ? `<br><small class="muted">meta ${int(t.metas_dias[dt] || 0)}</small>` : ''}</td>`).join('')}<td class="num"><b>${int(t.total)}</b></td>
        <td class="num">${t.sugestao == null ? '<span class="muted">—</span>' : `${int(t.sugestao)}${t.sugestao_minimo ? ' <small class="muted" title="mínimo semanal configurado">mín.</small>' : ''}${ed ? ` <button class="btn peq" data-usar-sug="${t.tutor_id}-${t.polo_id}" data-v="${t.sugestao}" title="Copiar para a meta da semana">usar</button>` : ''}`}</td><td class="num">${t.atraso == null ? '<span class="muted">—</span>' : t.atraso ? `<span class="tag bad mini">${int(t.atraso)}</span>` : '<span class="muted">0</span>'}</td>
        <td class="num">${ed ? `<input type="number" class="qtd" min="0" max="100000" step="1" aria-label="Meta semanal de ${esc(t.nome)} em ${esc(t.polo)}" data-meta-tutor="${t.tutor_id}" data-meta-polo="${t.polo_id}" data-orig="${t.meta == null ? '' : t.meta}" value="${t.meta == null ? '' : t.meta}" placeholder="—">` : (t.meta == null ? '—' : int(t.meta))}</td>
        <td class="num">${t.meta == null ? '—' : int(Math.max(0, t.meta - t.total))}</td>
        ${ed ? `<td class="acoes" style="white-space:nowrap"><button class="btn peq" data-salvar-ritmo="${t.tutor_id}-${t.polo_id}">Salvar</button> <button class="btn peq" data-distribuir="${t.tutor_id}-${t.polo_id}" title="Ajustar a meta de cada dia">Por dia</button></td>` : ''}
        <td style="white-space:nowrap"><a class="btn peq" target="_blank" rel="noopener" href="#/relatorio-tutor/${t.tutor_id}/${t.polo_id}/${estado.ciclo}/${semana.inicio}/${semana.hoje}" title="Relatório da semana do tutor (PDF)">Semana</a> <a class="btn peq" target="_blank" rel="noopener" href="#/relatorio-equipe/${t.polo_id}/${t.tutor_id}" title="Relatório do tutor no processo inteiro (PDF)">Processo</a></td></tr>`).join('') || '<tr><td colspan="16" class="vazio">Nenhum tutor vinculado a este polo.</td></tr>'}</tbody></table></div></div>
      <div class="card mt"><div class="card-cab"><h2>${umPolo ? `Equipe — ${esc(nomePor('polos', estado.polo || B.usuario.polo_id))}` : 'Equipe — todos os polos'}</h2><span class="muted">${d.tem_meta_tutor && !R.aguardando_spaces ? 'meta do processo · do maior GAP para o maior SAVE' : 'tutores ativos, inclusive quem ainda não vendeu'}</span></div><div class="corpo sem-pad">${tabEquipe()}</div></div>`;
    }
    if (aba === 'polos') return `<div class="card"><div class="card-cab"><h2>Ranking de polos</h2><span class="muted">${R.aguardando_spaces?'realizado e atingimento · aguardando definição dos Spaces':'do maior GAP para o maior SAVE na posição'}</span></div><div class="corpo sem-pad">${tabPolos()}</div></div>`;
    if (aba === 'origens') return vazio ? avisoVazio('As origens aparecem a partir do primeiro lançamento.') : `
      <div class="card"><h2>Por origem</h2><div class="corpo">
        ${d.porOrigem.sort((a, b) => b.qtd - a.qtd).map(o => `<div class="hbar"><div class="nome" title="${esc(o.nome)}">${esc(o.nome)}</div>${barra(o.qtd, maxOrigem).replace('class="barra ok"', 'class="barra neutra"')}<div class="v">${int(o.qtd)} <small>${pctTxt(pct(o.qtd, qtdT(T)))}</small></div></div>`).join('')}
      </div></div>
      <div class="card mt"><h2>Origem × produto</h2><div class="corpo sem-pad"><table class="t">
        <thead><tr><th>Origem</th>${d.porProduto.map(k => `<th class="num">${esc(k.nome)}</th><th class="num">%</th>`).join('')}<th class="num">Total</th><th class="num">%</th></tr></thead>
        <tbody>${d.porOrigem.map(o => `<tr><td>${esc(o.nome)}</td>${d.porProduto.map(k => { const tc = qtdT(k); const v = o.produtos[k.id] || 0; return `<td class="num">${v ? int(v) : '<span class="muted">0</span>'}</td><td class="num muted">${tc ? pctTxt(pct(v, tc)) : '—'}</td>`; }).join('')}<td class="num"><b>${int(o.qtd)}</b></td><td class="num">${pctTxt(pct(o.qtd, qtdT(T)))}</td></tr>`).join('')}
        <tr class="total"><td>Total</td>${d.porProduto.map(k => { const tc = qtdT(k); return `<td class="num">${int(tc)}</td><td class="num">${tc ? '100%' : '—'}</td>`; }).join('')}<td class="num">${int(qtdT(T))}</td><td class="num">100%</td></tr>
        </tbody></table></div></div>`;
    return painelGestor(d, { umPolo, temMeta, processoVazio, vazio, modo, prox, nomeDias, tabProdutos });
  };
  const nomeProd = (v) => { const [t, id] = (v || '').split(':'); return t === 'g' || t === 's' ? (v || '').slice(2) : t === 'c' ? nomePor('categorias', id) : t === 'p' ? nomePor('produtos', id) : ''; };
  const etiquetas = [
    ...(posicaoEscolhida ? [['ref', `Posição em ${dataBR(posicaoEscolhida)}`]] : []),
    ...(estado.polo && !poloTravado() ? [['polo', `Polo: ${nomePor('polos', estado.polo)}`]] : []),
    ...(filtro.prod ? [['prod', `Produto: ${nomeProd(filtro.prod)}`]] : []),
    ...(filtro.tutor ? [['tutor', `Tutor: ${nomePor('tutores', filtro.tutor)}`]] : []),
    ...(filtro.origem ? [['origem', `Origem: ${nomePor('origens', filtro.origem)}`]] : []),
    ...(filtro.de || filtro.ate ? [['periodo', `Período: ${filtro.de ? dataBR(filtro.de) : '…'} a ${filtro.ate ? dataBR(filtro.ate) : '…'}`]] : []),
  ];
  const maisAberto = ls.get('painel-mais', false) || !!(filtro.tutor || filtro.origem || filtro.de || filtro.ate);
  c.innerHTML = `
  <div class="filtros">
    <label class="campo"><span>Produto</span><select id="f-prod"><option value="">Todos</option>${[...new Set(B.produtos.map(p => p.subgrupo).filter(Boolean))].map(n => `<option value="s:${esc(n)}">${esc(n)} — todos</option>`).join('')}${B.produtos.filter(p => p.ativo).map(p => `<option value="p:${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label class="campo"><span>Posição em</span><input type="date" id="f-ref" value="${posicaoAtual()}" max="${B.hoje}" title="Data de referência do painel. Padrão: ${B.config.lancamento === 'dia_seguinte' ? 'último dia fechado' : 'hoje'}"></label>
    <label class="check" title="Soma no realizado do polo e do produto as matrículas do Mundo Azul que os tutores não lançaram (Sede/Digital). Tutores, ticket e RPV continuam só com as lançadas."><input type="checkbox" id="f-sede" ${comSede ? 'checked' : ''}> Incluir Sede/Digital (Mundo Azul)</label>
    <button class="btn" id="f-mais" aria-expanded="${maisAberto}">${maisAberto ? 'Menos filtros' : 'Mais filtros'}</button>
    <span class="espaco"></span>
    <button class="btn prim" id="resumo-dia">Resumo p/ WhatsApp</button>
    <a class="btn" href="#/relatorios">Relatórios</a>
  </div>
  <div class="filtros mais" id="f-mais-box" ${maisAberto ? '' : 'hidden'}>
    <label class="campo"><span>Tutor</span><select id="f-tutor"><option value="">Todos</option>${tutoresFiltro.map(t => `<option value="${t.id}">${esc(t.nome)}${t.ativo ? '' : ' (inativo)'}</option>`).join('')}</select></label>
    <label class="campo"><span>Origem</span><select id="f-origem"><option value="">Todas</option>${B.origens.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></label>
    <label class="campo"><span>De</span><input type="date" id="f-de"></label>
    <label class="campo"><span>Até</span><input type="date" id="f-ate"></label>
    <span class="muted dica-filtro">Tutor, origem e período mostram só o realizado (sem meta e SAVE/GAP).</span>
  </div>
  ${etiquetas.length ? `<div class="etiquetas">${etiquetas.map(([k, t]) => `<button class="etiqueta" data-tira="${k}" title="Remover filtro">${esc(t)} <span aria-hidden="true">×</span></button>`).join('')}<button class="btn peq" id="f-limpar">Limpar tudo</button></div>` : ''}
  ${d.usaMeta && R.aguardando_spaces ? avisoSpaces() : ''}
  ${d.usaMeta && R.inicio_estimado && eAdmin() ? `<div class="aviso">O processo está sem data de início — o ritmo está sendo medido a partir de ${dataBR(R.inicio)}. <a href="#/cadastros/metas">Cadastre o início em Metas e Spaces</a>.</div>` : ''}
  ${d.pendentes_ra ? `<div class="aviso">Há <b>${int(d.pendentes_ra)} lançamento(s) no total aguardando confirmação de R.A. no Mundo Azul</b>. Todos ficam fora do realizado e do SAVE/GAP até a confirmação. A Conferência mostra somente os que já passaram do prazo de tolerância; os mais recentes continuam no total, mas ainda estão no prazo. <a href="#/mundo-azul/oficial">Ver pendências vencidas</a>.</div>` : ''}
  ${d.sede && d.sede.total ? `<div class="info">Realizado inclui <b>${int(d.sede.total)} matrícula(s) Sede/Digital</b> (Mundo Azul − lançadas pelos tutores) — marcadas como <small class="sede-tag">incl. N S/D</small> (o número já está somado; confirmado pelo R.A. oficial).</div>` : ''}
  
  <nav class="abas">${abas.map(([id, n]) => `<a href="#/painel/${id}" class="${id === aba ? 'ativo' : ''}">${n}</a>`).join('')}</nav>
  ${conteudoAba()}`;

  if(aba==='equipe') c.insertAdjacentHTML('beforeend',quadroMatriculasExternas(d,umPolo));
  if (d.usaMeta) resumoGestaoPainel(c,d).catch(e=>toast(e.message,true));
  $('#resumo-dia').onclick = () => modalResumo();
  $('#f-sede').onchange = (e) => { ls.set('painel-sede', e.target.checked); rotear(); };
  $('#f-ref').onchange = (e) => { posicaoEscolhida = e.target.value && e.target.value !== B.ref_padrao ? e.target.value : ''; rotear(); };
  $$('[data-ir]', c).forEach(el => { el.onclick = () => { location.hash = el.dataset.ir; }; });
  if ($('#ritmo-prox', c)) { $('#ritmo-prox', c).onclick = () => { semanaEscolhida = addDiasISO(semana.inicio, 7); telaPainel(c, 'equipe').catch(err => toast(err.message, true)); };
    $('#ritmo-ant', c).onclick = () => { semanaEscolhida = addDiasISO(semana.inicio, -7); telaPainel(c, 'equipe').catch(err => toast(err.message, true)); }; }
  if ($('#ritmo-sug-todos', c)) $('#ritmo-sug-todos', c).onclick = () => { $$('[data-usar-sug]', c).forEach(b => b.click()); toast('Sugeridas copiadas — confira e clique em Salvar todas'); };
  if ($('#ritmo-salvar-todas', c)) $('#ritmo-salvar-todas', c).onclick = async () => {
    const mud = $$('[data-meta-tutor]', c).filter(i => i.value !== i.dataset.orig);
    if (!mud.length) return toast('Nenhuma meta alterada');
    if (mud.some(i => !i.reportValidity())) return;
    let ok = 0;
    for (const i of mud) { try { await api('/api/ritmo-semanal/meta', { method: 'POST', body: { ciclo: estado.ciclo, tutor: Number(i.dataset.metaTutor), polo: Number(i.dataset.metaPolo), semana: semana.inicio, meta: i.value === '' ? null : Number(i.value) } }); ok++; } catch (e) { toast(e.message, true); } }
    toast(`${ok} meta(s) salva(s) e divididas pelos dias`); telaPainel(c, 'equipe');
  };
  if ($('#ritmo-atual', c)) $('#ritmo-atual', c).onclick = () => { semanaEscolhida = ''; telaPainel(c, 'equipe').catch(err => toast(err.message, true)); };
  $$('[data-distribuir]', c).forEach(botao => { botao.onclick = () => {
    const [tutor, polo] = botao.dataset.distribuir.split('-').map(Number);
    const t = semana.tutores.find(x => x.tutor_id === tutor && x.polo_id === polo);
    const campoSemanal = $(`[data-meta-tutor="${tutor}"][data-meta-polo="${polo}"]`, c);
    const fer = (dt) => (semana.feriados || []).find(f => f.data === dt && (!f.polo_id || f.polo_id === polo));
    const padrao = (dt) => diasMetaCfg().includes(diaDaSemana(dt)) && !fer(dt);
    const m = abrirModal(`<header><h3>Meta por dia — ${esc(t.nome)} · ${esc(t.polo)}</h3><button class="btn icone" data-fechar>✕</button></header>
      <div class="corpo"><p style="margin-top:0">Semana de ${dataBR(semana.inicio)} a ${dataBR(semana.fim)}. Marque os dias que recebem meta (feriados já vêm desmarcados), informe o total e clique em <b>Dividir</b>. Depois ajuste qualquer dia, se quiser.</p>
      <div class="linha-acoes"><label class="campo"><span>Total da semana</span><input type="number" id="ritmo-total" min="0" max="100000" step="1" value="${campoSemanal.value === '' ? (t.meta ?? t.sugestao ?? '') : esc(campoSemanal.value)}"></label><button class="btn" id="ritmo-distribuir" type="button">Dividir pelos dias marcados</button></div>
      <table class="t mt"><thead><tr><th>Recebe meta</th><th>Dia</th><th class="num">Meta do dia</th></tr></thead><tbody>
        ${semana.datas.map((dt, i) => `<tr><td><input type="checkbox" data-dia-on="${i}" ${padrao(dt) ? 'checked' : ''}></td><td>${NOME_DIA_LONGO[diaDaSemana(dt)]} · ${dataBR(dt)}${fer(dt) ? ` <span class="tag warn mini">feriado: ${esc(fer(dt).nome)}</span>` : ''}</td>
          <td class="num"><input type="number" class="qtd" min="0" max="100000" step="1" data-dia-meta="${i}" value="${t.metas_dias ? (t.metas_dias[dt] ?? 0) : 0}"></td></tr>`).join('')}
        <tr class="total"><td></td><td>Meta da semana</td><td class="num" id="ritmo-soma">0</td></tr></tbody></table></div>
      <footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="ritmo-salvar-dias">Salvar metas por dia</button></footer>`, 620);
    const campos = $$('[data-dia-meta]', m), liga = $$('[data-dia-on]', m);
    const somar = () => { $('#ritmo-soma', m).textContent = int(campos.reduce((a, x) => a + (Number(x.value) || 0), 0)); };
    campos.forEach(x => { x.oninput = somar; }); somar();
    const dividir = () => {
      const total = Number($('#ritmo-total', m).value) || 0;
      const on = liga.map(x => x.checked); const n = on.filter(Boolean).length;
      if (!n) return toast('Marque ao menos um dia', true);
      let k = 0; campos.forEach((x, i) => { if (!on[i]) { x.value = 0; return; } x.value = Math.floor(total / n) + (k < total % n ? 1 : 0); k++; }); somar();
    };
    $('#ritmo-distribuir', m).onclick = dividir;
    if (!t.metas_dias && $('#ritmo-total', m).value !== '') dividir();
    $('#ritmo-salvar-dias', m).onclick = async () => { if (campos.some(x => !x.reportValidity() || x.value === '')) { toast('Preencha os sete dias (0 nos dias sem meta)', true); return; } const b = $('#ritmo-salvar-dias', m); b.disabled = true; try { await api('/api/ritmo-semanal/metas-diarias', { method: 'POST', body: { ciclo: estado.ciclo, polo, tutor, semana: semana.inicio, valores: campos.map(x => Number(x.value)) } }); fecharModal(); toast('Metas por dia salvas'); await telaPainel(c, 'equipe'); } catch (e) { toast(e.message, true); b.disabled = false; } };
  }; });
  $$('[data-usar-sug]', c).forEach(b => { b.onclick = () => { const [t, p] = b.dataset.usarSug.split('-'); const campo = $(`[data-meta-tutor="${t}"][data-meta-polo="${p}"]`, c); if (campo) { campo.value = b.dataset.v; campo.focus(); } }; });
  $$('[data-salvar-ritmo]', c).forEach(botao => { botao.onclick = async () => {
    const [tutor, polo] = botao.dataset.salvarRitmo.split('-');
    const campo = $(`[data-meta-tutor="${tutor}"][data-meta-polo="${polo}"]`, c);
    if (!campo.reportValidity()) return;
    const linha = semana.tutores.find(t => t.tutor_id === Number(tutor) && t.polo_id === Number(polo));
    if (linha?.metas_dias && campo.value !== '' && Number(campo.value) !== linha.meta && !await confirmar('Alterar meta semanal', 'A meta de cada dia será dividida de novo automaticamente (sem domingo e sem feriados). Para ajustar dia a dia, use "Por dia".', 'Alterar')) return;
    botao.disabled = true;
    try { await api('/api/ritmo-semanal/meta', { method: 'POST', body: { ciclo: estado.ciclo, tutor: Number(tutor), polo: Number(polo), semana: semana.inicio, meta: campo.value === '' ? null : Number(campo.value) } }); toast('Meta semanal salva'); await telaPainel(c, 'equipe'); }
    catch (e) { toast(e.message, true); botao.disabled = false; }
  }; });
  $('#f-prod').value = filtro.prod || ''; $('#f-tutor').value = filtro.tutor; $('#f-origem').value = filtro.origem; $('#f-de').value = filtro.de; $('#f-ate').value = filtro.ate;
  const mudou = () => { ls.set('painel-filtro', { prod: $('#f-prod').value, tutor: $('#f-tutor').value, origem: $('#f-origem').value, de: $('#f-de').value, ate: $('#f-ate').value }); rotear(); };
  ['#f-prod', '#f-tutor', '#f-origem', '#f-de', '#f-ate'].forEach(sel => { $(sel).onchange = mudou; });
  const limpo = { prod: '', tutor: '', origem: '', de: '', ate: '' };
  const irPolo = (id, extra = {}) => {
    estado.polo = Number(id); ls.set('polo', estado.polo);
    const sp = $('#sel-polo'); if (sp) sp.value = estado.polo;
    if (Object.keys(extra).length) ls.set('painel-filtro', { ...filtro, ...extra });
    if (location.hash === '#/painel/resumo') rotear(); else location.hash = '#/painel/resumo';
  };
  if ($('#f-limpar')) $('#f-limpar').onclick = () => {
    ls.set('painel-filtro', limpo); posicaoEscolhida = '';
    if (!poloTravado()) { estado.polo = ''; ls.set('polo', ''); $('#sel-polo').value = ''; }
    rotear();
  };
  $('#f-mais').onclick = () => { const box = $('#f-mais-box'); box.hidden = !box.hidden; ls.set('painel-mais', !box.hidden); $('#f-mais').textContent = box.hidden ? 'Mais filtros' : 'Menos filtros'; };
  $$('[data-tira]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.tira;
      if (k === 'ref') posicaoEscolhida = '';
      else if (k === 'polo') { estado.polo = ''; ls.set('polo', ''); $('#sel-polo').value = ''; }
      else if (k === 'periodo') ls.set('painel-filtro', { ...filtro, de: '', ate: '' });
      else ls.set('painel-filtro', { ...filtro, [k]: '' });
      rotear();
    };
  });
  $$('[data-abrir-polo]').forEach(el => { el.onclick = (ev) => { ev.preventDefault(); irPolo(el.dataset.abrirPolo); }; });
  $$('[data-ver-tutor]', c).forEach(el => { el.onclick = (ev) => { ev.preventDefault(); const [tid, pid] = el.dataset.verTutor.split('-').map(Number); location.hash = `#/tutor/${pid}/${tid}`; }; });
  $$('[data-abrir-produto]', c).forEach(el => { el.onclick = () => { ls.set('painel-filtro', { ...filtro, prod: `p:${el.dataset.abrirProduto}` }); if (location.hash === '#/painel/resumo') rotear(); else location.hash = '#/painel/resumo'; }; });
  $$('td.mz[data-polo]').forEach(td => { td.onclick = () => irPolo(td.dataset.polo, { prod: `p:${td.dataset.prod}` }); });
  if ($('#aba-spaces')) renderRitmo($('#aba-spaces'), R);
}

// ======================================================================= RESUMO PARA O WHATSAPP
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// início da semana de meta (Configuração › Sistema e backup; padrão terça → semana de terça a segunda)
const inicioSemanaCfg = () => { const n = Number(B.config.inicio_semana ?? 2); return n >= 0 && n <= 6 ? n : 2; };
const segundaDe = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() - inicioSemanaCfg() + 7) % 7); return isoLocal(d); };
const diasMetaCfg = () => String(B.config.dias_meta_semana ?? '1,2,3,4,5,6').split(',').map(Number);
const NOME_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const NOME_DIA_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const diaDaSemana = (iso) => new Date(iso + 'T12:00:00').getDay();
const sinalTxt = (n) => n == null ? 'aguardando Spaces' : `${n >= 0 ? '+' : '−'}${int(Math.abs(n))}`;
const bolinha = (saldo) => saldo == null ? '▫️' : saldo >= 0 ? '🟢' : '🔴';
function precisaPlano(porDia, modo) {
  if (porDia == null) return '';
  if (porDia <= 0) return 'em dia ✓';
  return porDia >= 1 ? `${dec1(porDia)}/dia` : `${dec1(porDia * (DIAS_SEMANA[modo] || 5))}/semana`;
}

function textoResumo(r, op) {
  const P = r.painel, R = P.ritmo, H = R.hoje_situacao, modo = R.modo, V = r.periodo;
  const prox = R.spaces.find(s => s.proximo);
  const semana = op.periodo === 'semana';
  const quando = semana ? 'na semana' : r.ref === B.hoje ? 'hoje' : `em ${dataBR(r.ref)}`;
  const escopo = op.polo ? `Polo ${nomePor('polos', op.polo)}` : (B.config.nome_rede || 'Rede');
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const titulo = semana ? `Semana ${dataBR(r.de)} a ${dataBR(r.ref)}` : op.parcial ? `Parcial de ${dataBR(r.ref)} às ${hora}` : `Fechamento de ${dataBR(r.ref)}`;
  const L = [`📊 *${escopo} — ${titulo}*`, `_${cicloAtual().nome}_`, ''];

  // vendas do período, quebradas por grupo
  const gruposPer = Object.entries(V.porGrupo).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  L.push(`✅ ${semana ? 'Na semana' : quando[0].toUpperCase() + quando.slice(1)}: *${int(V.total)} matrícula${V.total === 1 ? '' : 's'}*${gruposPer.length > 1 ? ` (${gruposPer.map(([g, n]) => `${g || 'Outros'} ${n}`).join(' · ')})` : ''}`);
  if (H.total.meta) {
    L.push(`📈 Acumulado: *${int(H.total.realizado)}* de ${int(H.total.meta)} (${pctTxt(pct(H.total.realizado, H.total.meta))})${P.totais.sede ? ` — inclui ${int(P.totais.sede)} Sede/Digital` : ''}`);
    if(H.total.saldo==null) L.push('⏳ Aguardando definição dos Spaces para avaliar o ritmo geral.');
    else L.push(`${bolinha(H.total.saldo)} *${H.total.saldo >= 0 ? 'SAVE' : 'GAP'} ${sinalTxt(H.total.saldo)}* — esperado até ${dataBR(r.ref)}: ${int(H.total.esperado)}`);
    if (prox) L.push(`🎯 Até o ${prox.nome} (${dataBR(prox.data)}): ${prox.total.falta ? `faltam *${int(prox.total.falta)}* · precisa ${precisaPlano(prox.total.por_dia, modo)}` : 'esperado já alcançado ✓'}`);
  } else L.push(`📈 Acumulado: *${int(P.totais.qtd)}* (sem meta cadastrada)`);

  if (op.grupos) {
    const fmt = (nome, x, sub) => x.meta || x.qtd ? `${sub ? '   ↳ ' : ''}${x.meta ? bolinha(x.saldo) : '▫️'} ${nome}: ${int(x.qtd)}${x.meta ? `/${int(x.meta)} · ${sinalTxt(x.saldo)}` : ''}` : null;
    const linhas = hierarquia(P.porProduto.filter(p => p.meta || p.qtd), ids => somaBloco(P, ids)).filter(it => it.tipo === 'prod' || it.tipo === 'subcab')
      .map(it => it.tipo === 'prod' ? fmt(nomeP(it.x.id, it.x.nome), somaBloco(P, [it.x.id]), !!it.dentro) : fmt(it.nome, it.x, false)).filter(Boolean);
    if (linhas.length > 1) L.push('', '*Por produto* (realizado/meta · SAVE/GAP)', ...linhas);
  }

  if (op.polos && !op.polo && P.porPolo.length > 1) {
    const ord = [...P.porPolo].sort((a, b) => (b.hoje?.saldo ?? -1e9) - (a.hoje?.saldo ?? -1e9));
    L.push('', '*Polos* (realizado/meta · SAVE/GAP · ' + (semana ? 'semana' : 'dia') + ')');
    for (const p of ord) {
      const n = V.porPolo[p.id] || 0, sg = p.hoje ? p.hoje.saldo : null;
      L.push(`${bolinha(sg)} ${p.nome} — ${int(p.qtd)}/${int(p.meta)} · ${sg != null ? sinalTxt(sg) : '—'} · ${n ? `*${n}* ${semana ? 'na semana' : 'hoje'}` : `0 ${semana ? 'na semana' : 'hoje'}`}${sg < 0 && p.proximo && p.proximo.por_dia ? ` · precisa ${precisaPlano(p.proximo.por_dia, modo)}` : ''}`);
    }
  }

  if (op.equipe && op.polo) {
    const ts = [...P.porTutor].sort((a, b) => (b.saldo ?? -1e9) - (a.saldo ?? -1e9) || b.qtd - a.qtd);
    if (ts.length) {
      L.push('', '*Equipe*' + (P.tem_meta_tutor ? ' (realizado/meta · SAVE/GAP)' : ''));
      for (const t of ts) {
        const n = V.porTutor[`${t.tutor_id}-${t.polo_id}`] || 0;
        L.push(t.meta != null
          ? `${bolinha(t.saldo)} ${t.nome} — ${int(t.qtd)}/${dec1(t.meta).replace(',0', '')} · ${sinalTxt(t.saldo)}${n ? ` · *${n}* ${semana ? 'na semana' : 'hoje'}` : ''}${t.saldo < 0 && t.proximo && t.proximo.por_dia ? ` · precisa ${precisaPlano(t.proximo.por_dia, modo)}` : ''}`
          : `▫️ ${t.nome} — ${int(t.qtd)}${n ? ` · *${n}* ${semana ? 'na semana' : 'hoje'}` : ''}`);
      }
    }
  }

  if (op.destaques) {
    const top = P.porTutor.map(t => ({ ...t, n: V.porTutor[`${t.tutor_id}-${t.polo_id}`] || 0 })).filter(t => t.n).sort((a, b) => b.n - a.n).slice(0, 5);
    if (top.length) L.push('', `⭐ *Destaques ${semana ? 'da semana' : 'do dia'}:* ` + top.map(t => `${t.nome}${op.polo ? '' : ` (${t.polo})`} ${t.n}`).join(' · '));
  }
  if (op.semVenda) {
    const sem = op.polo
      ? P.porTutor.filter(t => !(V.porTutor[`${t.tutor_id}-${t.polo_id}`])).map(t => t.nome)
      : P.porPolo.filter(p => p.meta && !V.porPolo[p.id]).map(p => p.nome);
    if (sem.length) L.push('', `😴 Sem matrícula ${semana ? 'na semana' : quando}: ${sem.join(', ')}`);
  }
  if (op.rodape) L.push('', op.rodape);
  return L.join('\n');
}

function modalResumo() {
  const op = { periodo: 'dia', grupos: true, polos: true, equipe: true, destaques: true, semVenda: true, parcial: false, rodape: '', ...ls.get('resumo-op', {}) };
  op.polo = poloTravado() ? B.usuario.polo_id : (estado.polo ? Number(estado.polo) : 0);
  op.data = posicaoAtual();
  const m = abrirModal(`<header><h3>Resumo para o WhatsApp</h3><button class="btn icone" data-fechar aria-label="Fechar">✕</button></header>
    <div class="corpo"><div class="form-grid resumo-op">
      <label class="campo"><span>Data</span><input type="date" id="rs-data"></label>
      <label class="campo"><span>Para</span><select id="rs-polo" ${poloTravado() ? 'disabled' : ''}><option value="0">Rede (todos os polos)</option>${B.polos.filter(p => p.ativo).map(p => `<option value="${p.id}">Polo ${esc(p.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>Vendas de</span><select id="rs-periodo"><option value="dia">Só o dia</option><option value="semana">A semana (desde o início da semana de meta)</option></select></label>
      <label class="campo"><span>Título</span><select id="rs-parcial"><option value="0">Fechamento do dia</option><option value="1">Parcial (com horário)</option></select></label>
      <div class="campo inteiro"><span>Incluir</span><div class="chips">
        <label class="check"><input type="checkbox" id="rs-grupos">Por produto</label>
        <label class="check" id="rs-l-polos"><input type="checkbox" id="rs-polos">Polos</label>
        <label class="check" id="rs-l-equipe"><input type="checkbox" id="rs-equipe">Equipe do polo</label>
        <label class="check"><input type="checkbox" id="rs-destaques">Destaques</label>
        <label class="check"><input type="checkbox" id="rs-semvenda">Quem não vendeu</label></div></div>
      <label class="campo inteiro"><span>Frase final <small class="muted">(opcional — fica salva para os próximos)</small></span><input type="text" id="rs-rodape" placeholder="Ex.: Bora virar o GAP amanhã! 💪"></label>
    </div>
    <div class="resumo-prev"><textarea id="rs-txt" rows="16" spellcheck="false"></textarea><small class="muted">Você pode editar o texto antes de copiar. *negrito* e _itálico_ viram formatação no WhatsApp.</small></div></div>
    <footer><button class="btn" data-fechar>Fechar</button><button class="btn prim" id="rs-copiar">Copiar texto</button></footer>`, 760);
  $('#rs-data', m).value = op.data; $('#rs-polo', m).value = op.polo; $('#rs-periodo', m).value = op.periodo; $('#rs-parcial', m).value = op.parcial ? '1' : '0';
  $('#rs-grupos', m).checked = op.grupos; $('#rs-polos', m).checked = op.polos; $('#rs-equipe', m).checked = op.equipe; $('#rs-destaques', m).checked = op.destaques; $('#rs-semvenda', m).checked = op.semVenda; $('#rs-rodape', m).value = op.rodape;
  let dados = null, chave = '';
  const ler = () => {
    Object.assign(op, { data: $('#rs-data', m).value || B.hoje, polo: Number($('#rs-polo', m).value) || 0, periodo: $('#rs-periodo', m).value, parcial: $('#rs-parcial', m).value === '1',
      grupos: $('#rs-grupos', m).checked, polos: $('#rs-polos', m).checked, equipe: $('#rs-equipe', m).checked, destaques: $('#rs-destaques', m).checked, semVenda: $('#rs-semvenda', m).checked, rodape: $('#rs-rodape', m).value.trim() });
    const { polo, data, ...guardar } = op; ls.set('resumo-op', guardar);
    $('#rs-l-polos', m).hidden = !!op.polo; $('#rs-l-equipe', m).hidden = !op.polo;
  };
  const atualizar = async () => {
    ler();
    const de = op.periodo === 'semana' ? segundaDe(op.data) : op.data;
    const k = `${op.polo}|${op.data}|${de}`;
    try {
      if (k !== chave) { $('#rs-txt', m).value = 'Montando…'; dados = await api('/api/resumo?' + qs({ ciclo: estado.ciclo, polo: op.polo || '', ref: op.data, de })); chave = k; }
      $('#rs-txt', m).value = textoResumo(dados, op);
    } catch (e) { $('#rs-txt', m).value = 'Erro: ' + e.message; }
  };
  $$('select, input', m).forEach(el => { el.addEventListener(el.type === 'text' ? 'input' : 'change', atualizar); });
  $('#rs-copiar', m).onclick = () => copiarTexto($('#rs-txt', m).value);
  atualizar();
}

// ======================================================================= PAINEL DO GESTOR (aba Resumo)
// Blocos de produtos para leitura: um por grupo (Configuração › Categorias › grupo). Dentro de um grupo com mais de uma
// categoria, a categoria com 2+ produtos aparece como sub-bloco (ex.: Saúde dentro de Híbrido). Nada fixo no código.
const limpoTxt = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function blocosProdutos(porProduto) {
  // Um bloco por categoria (Graduação / Continuada); produtos com o mesmo "Subgrupo" (ex.: Semi - Saúde) viram sub-bloco
  return B.categorias.map(k => {
    const ps = porProduto.filter(p => p.categoria_id === k.id);
    const subNomes = [...new Set(ps.map(p => (B.produtos.find(x => x.id === p.id) || {}).subgrupo).filter(Boolean))];
    return { nome: k.nome, produtos: ps, ids: ps.map(p => p.id), subs: subNomes.map(n => { const sp = ps.filter(p => (B.produtos.find(x => x.id === p.id) || {}).subgrupo === n); return { nome: n, produtos: sp, ids: sp.map(p => p.id) }; }) };
  }).filter(b => b.produtos.length);
}
// soma de realizado/meta/esperado de um conjunto de produtos (usa a situação do dia de posição do ritmo)
function somaBloco(d, ids) {
  const H = d.ritmo.hoje_situacao;
  const ps = d.porProduto.filter(p => ids.includes(p.id));
  const hp = H.linhas.flatMap(l => l.produtos || []).filter(x => ids.includes(x.produto_id));
  const x = { qtd: ps.reduce((a, p) => a + p.qtd, 0), sede: ps.reduce((a, p) => a + (p.sede || 0), 0), meta: ps.reduce((a, p) => a + (p.meta || 0), 0), valor: ps.reduce((a, p) => a + p.valor, 0), esperado: somarConhecido(hp,'esperado') };
  x.saldo = x.esperado == null ? null : x.qtd - x.esperado;
  return x;
}

// Cartão "Sede/Digital" ao lado da equipe: matrículas do Mundo Azul que os tutores não lançaram (por produto quando conhecido)
function cartaoSede(d) {
  const T = d.totais; if (!T || !T.sede) return '';
  const porProd = d.porProduto.filter(p => p.sede).map(p => `${esc(p.nome)} ${int(p.sede)}`);
  if (T.sede_sem_produto) porProd.push(`produto não informado ${int(T.sede_sem_produto)}`);
  return `<a class="g-polo nd g-sede" href="#/mundo-azul/oficial" title="Matrículas do Mundo Azul que os tutores não lançaram (central, site)"><div class="g-polo-top"><b>Sede/Digital</b><span class="sede-tag">Mundo Azul</span></div>
    <div class="g-polo-num"><strong>${int(T.sede)}</strong><small> matrícula${T.sede === 1 ? '' : 's'}</small></div>
    <div class="g-polo-rod"><span>${porProd.join(' · ')}</span></div></a>`;
}
function painelGestor(d, o) {
  const T = d.totais, R = d.ritmo, H = R.hoje_situacao, modo = o.modo, prox = o.prox;
  const nomeRecorte = o.umPolo ? `Polo ${nomePor('polos', estado.polo || B.usuario.polo_id)}` : (B.config.nome_rede || 'Rede');
  const filtroProd = (ls.get('painel-filtro', {}) || {}).prod;
  const cab = `<div class="g-cab"><div><h2>${esc(nomeRecorte)}</h2><p>${esc(cicloAtual().nome)} · posição em <b>${dataBR(R.hoje)}</b>${R.hoje === B.ref_padrao && B.config.lancamento === 'dia_seguinte' ? ' (último dia fechado — as matrículas entram no dia seguinte)' : R.hoje === B.hoje ? ' (dia em andamento)' : ''}${filtroProd ? ' · recorte de produto ativo' : ''}</p></div>
    ${o.temMeta && H.total.saldo != null ? `<div class="g-leitura ${H.total.saldo >= 0 ? 'ok' : 'bad'}">${H.total.saldo >= 0 ? 'No ritmo' : 'Abaixo do ritmo'} · ${saveGap(H.total.saldo)}</div>` : ''}</div>`;

  if (!d.usaMeta) {
    return `${cab}<div class="info">Recorte filtrado por tutor, origem ou período: aparecem só os realizados. Para ver metas e SAVE/GAP, limpe esses filtros.</div>
      <div class="g-kpis g3"><div class="g-kpi"><span>Matrículas no recorte</span><b>${int(T.qtd)}</b></div><div class="g-kpi"><span>RPV no recorte</span><b>${brl(T.valor)}</b></div><div class="g-kpi"><span>Ticket médio</span><b>${qtdT(T) ? brl(T.valor / qtdT(T)) : '—'}</b></div></div>
      <details class="card mt" open><summary class="g-sum">Produtos</summary><div class="corpo sem-pad">${o.tabProdutos()}</div></details>`;
  }
  if (o.processoVazio) {
    return `${cab}<div class="card g-vazio"><h3>Prepare o acompanhamento do processo</h3><p>Cadastre as metas e lance as matrículas — o painel mostra o ritmo, os polos e os alertas automaticamente.</p>
      <div class="linha-acoes">${eAdmin() ? '<a class="btn prim" href="#/cadastros/metas">Cadastrar metas</a>' : ''}${podeLancar() ? '<a class="btn" href="#/matriculas/importar">Importar do WhatsApp</a>' : ''}</div></div>${quadroSemVendas(d, R.hoje, o.umPolo)}`;
  }

  // ---- 1) cinco números
  const pctEsp = H.percentual;
  const kpis = `<div class="g-kpis">
    <div class="g-kpi destaque"><span>${R.hoje === B.hoje ? 'Hoje' : R.hoje === B.ref_padrao ? 'Último dia fechado' : 'No dia'}</span><b>${int(d.vendas.dia)}</b><em>matrícula${d.vendas.dia === 1 ? '' : 's'} em ${dataBR(R.hoje)}</em><em>semana (desde ${dataBR(d.segunda).slice(0, 5)}): <strong>${int(d.vendas.semana)}</strong></em></div>
    <div class="g-kpi"><span>Acumulado</span><b>${int(T.qtd)}${sedeTxt(T)}<small> / ${o.temMeta ? int(T.meta) : '—'}</small></b>${o.temMeta ? `${barra(T.qtd, T.meta, pctEsp)}<em>${pctTxt(pct(T.qtd, T.meta))} da meta · marca = esperado na data</em>` : '<em>sem meta neste recorte</em>'}</div>
    <div class="g-kpi"><span>SAVE / GAP em ${dataBR(R.hoje).slice(0, 5)}</span><b>${o.temMeta ? saveGap(H.total.saldo) : '—'}</b><em>${o.temMeta ? `esperado até ${dataBR(R.hoje).slice(0, 5)}: ${int(H.total.esperado)} (${pctTxt(pctEsp)})` : ''}</em></div>
    <div class="g-kpi"><span>${prox ? `Até o ${esc(prox.nome)} · ${dataBR(prox.data).slice(0, 5)}` : 'Próximo Space'}</span>${prox && o.temMeta ? `<b>${prox.total.falta ? `faltam ${int(prox.total.falta)}` : '<span class="pos">✓ alcançado</span>'}</b><em>${prox.total.falta ? `precisa <strong>${precisaTxt(prox.total.por_dia, modo)}</strong> · ${prox.dias} ${o.nomeDias}` : `esperado ${int(prox.total.esperado)}`}</em>` : '<b class="muted">—</b><em>nenhum Space futuro</em>'}</div>

  </div>`;

  // ---- 2) polos (rede) ou equipe (polo) num quadro só
  const cartaoPolo = (p) => {
    const sg = p.hoje ? p.hoje.saldo : null, cls = !p.meta || sg == null ? 'nd' : sg >= 0 ? 'ok' : 'bad';
    return `<button class="g-polo ${cls}" data-abrir-polo="${p.id}" title="Abrir ${esc(p.nome)}">
      <div class="g-polo-top"><b>${esc(p.nome)}</b>${p.meta ? saveGap(sg) : '<span class="tag cinza mini">sem meta</span>'}</div>
      <div class="g-polo-num"><strong>${int(p.qtd)}</strong>${sedeTxt(p)}<small> / ${int(p.meta || 0)}</small><span>${p.meta ? pctTxt(pct(p.qtd, p.meta)) : ''}</span></div>
      ${p.meta ? barra(p.qtd, p.meta, p.hoje && p.meta && p.hoje.esperado != null ? (p.hoje.esperado / p.meta) * 100 : null) : ''}
      <div class="g-polo-rod"><span>${rotuloDia(R.hoje)} <b>${int(p.vendas_dia)}</b></span><span>semana <b>${int(p.vendas_semana)}</b></span>${sg < 0 && p.proximo && p.proximo.por_dia ? `<span>precisa <b>${precisaTxt(p.proximo.por_dia, modo)}</b></span>` : ''}</div></button>`;
  };
  const cartaoTutor = (t) => {
    const cls = t.meta == null || t.saldo == null ? 'nd' : t.saldo >= 0 ? 'ok' : 'bad';
    return `<button class="g-polo ${cls}" data-ver-tutor="${t.tutor_id}-${t.polo_id}" title="Abrir a página de ${esc(t.nome)}"><div class="g-polo-top"><b>${esc(t.nome)}</b>${t.meta != null ? saveGap(t.saldo) : ''}</div>
      <div class="g-polo-num"><strong>${int(t.qtd)}</strong>${t.meta != null ? `<small> / ${dec1(t.meta).replace(',0', '')}</small><span>${pctTxt(pct(t.qtd, t.meta))}</span>` : '<small> matrículas</small>'}</div>
      ${t.meta != null ? barra(t.qtd, t.meta, t.esperado != null && t.meta ? (t.esperado / t.meta) * 100 : null) : ''}
      <div class="g-polo-rod">${t.ultima ? `<span>última venda ${diasSemVendaTag(t)}</span>` : diasSemVendaTag(t)}${t.saldo < 0 && t.proximo && t.proximo.por_dia ? `<span>precisa <b>${precisaTxt(t.proximo.por_dia, modo)}</b></span>` : ''}</div></button>`;
  };
  const polosOrd = [...d.porPolo].sort((a, b) => (a.meta ? 0 : 1) - (b.meta ? 0 : 1) || (a.hoje?.saldo ?? 0) - (b.hoje?.saldo ?? 0));
  const quadro = o.umPolo
    ? `<div class="g-sec"><h3>Equipe</h3><span>${d.tem_meta_tutor && !R.aguardando_spaces ? 'meta do tutor no processo · do maior GAP para o maior SAVE' : 'matrículas e atingimento no processo'} · <a href="#/painel/equipe">ritmo da semana</a></span></div>
       <div class="g-polos">${[...d.porTutor].sort((a, b) => (a.meta == null) - (b.meta == null) || (a.saldo ?? 0) - (b.saldo ?? 0) || b.qtd - a.qtd).map(cartaoTutor).join('') || '<div class="g-vazio-mini">Nenhum tutor ativo neste polo.</div>'}${cartaoSede(d)}</div>`
    : `<div class="g-sec"><h3>Polos</h3><span>${R.aguardando_spaces?'realizado e atingimento · aguardando definição dos Spaces':'do maior GAP para o maior SAVE · marca = esperado na data'} · clique para abrir</span></div>
       <div class="g-polos">${polosOrd.map(cartaoPolo).join('')}</div>`;

  // ---- 3) grupos e sub-blocos (ex.: Saúde)
  const blocos = blocosProdutos(d.porProduto);
  const linhaBloco = (nome, x, sub) => `<div class="g-bloco ${sub ? 'sub' : ''}"><div class="g-bloco-nome">${sub ? '↳ ' : ''}${esc(nome)}</div>
    <div class="g-bloco-barra">${x.meta ? barra(x.qtd, x.meta, x.meta && x.esperado != null ? (x.esperado / x.meta) * 100 : null) : '<span class="muted" style="font-size:12px">sem meta</span>'}</div>
    <div class="g-bloco-num"><b>${int(x.qtd)}</b>${sedeTxt(x)}${x.meta ? `<small>/${int(x.meta)}</small>` : ''}</div><div class="g-bloco-sg">${x.meta ? saveGap(x.saldo) : ''}</div></div>`;
  const grupoHTML = hierarquia(d.porProduto, ids => somaBloco(d, ids))
    .filter(it => it.tipo === 'prod' || it.tipo === 'subcab')
    .map(it => it.tipo === 'prod' ? linhaBloco(nomeP(it.x.id, it.x.nome), somaBloco(d, [it.x.id]), !!it.dentro) : linhaBloco(it.nome, it.x, false)).join('');

  // ---- 4) alertas objetivos
  const alertas = [];
  if (o.umPolo) for (const t of d.porTutor.filter(t => t.meta != null && t.saldo < 0).sort((a, b) => a.saldo - b.saldo)) alertas.push(['bad', `<b>${esc(t.nome)}</b> em GAP ${int(t.saldo)} (${int(t.qtd)} de ${int(t.esperado)} esperadas)${t.proximo && t.proximo.por_dia ? ` · precisa ${precisaTxt(t.proximo.por_dia, modo)}` : ''}`, 'data-ir="#/painel/equipe"']);
  const polosGap = polosOrd.filter(p => p.meta && p.hoje && p.hoje.saldo < 0);
  if (!o.umPolo && polosGap.length >= 4) alertas.push(['bad', `<b>${polosGap.length} polos em GAP:</b> ${polosGap.map(p => `${esc(p.nome)} ${int(p.hoje.saldo)}`).join(' · ')}`, 'data-ir="#/painel/polos"']);
  else if (!o.umPolo) for (const p of polosGap) alertas.push(['bad', `<b>${esc(p.nome)}</b> em GAP ${int(p.hoje.saldo)}${p.proximo && p.proximo.por_dia ? ` · precisa ${precisaTxt(p.proximo.por_dia, modo)}` : ''}`, `data-abrir-polo="${p.id}"`]);
  const prodsAtras = d.porProduto.map(p => ({ p, h: (H.linhas.find(l => l.categoria_id === p.categoria_id)?.produtos || []).find(x => x.produto_id === p.id) }))
    .filter(x => x.h && x.h.meta && x.h.saldo < 0).sort((a, b) => a.h.saldo - b.h.saldo);
  if (prodsAtras.length >= 4) alertas.push(['warn', `<b>${prodsAtras.length} produtos atrás do esperado:</b> ${prodsAtras.map(x => `${esc(x.p.nome)} ${int(x.h.saldo)}`).join(' · ')}`, '']);
  else for (const x of prodsAtras) alertas.push(['warn', `Produto <b>${esc(x.p.nome)}</b> ${int(x.h.saldo)} do esperado (${int(x.h.realizado)}/${int(x.h.esperado)})`, `data-abrir-produto="${x.p.id}"`]);
  const parados = d.porTutor.filter(t => t.ultima && diasCorridosSemVenda(t.ultima, R.hoje) >= 3);
  if (parados.length) alertas.push(['warn', `${parados.length} tutor(es) há 3+ dias sem vender: ${parados.slice(0, 6).map(t => `${esc(t.nome)}${o.umPolo ? '' : ` (${esc(t.polo)})`}`).join(', ')}${parados.length > 6 ? '…' : ''}`, 'data-ir="#/painel/equipe"']);
  if (!o.umPolo) { const semHoje = d.porPolo.filter(p => p.meta && !p.vendas_dia); if (semHoje.length && semHoje.length < d.porPolo.length) alertas.push(['cinza', `Sem matrícula ${rotuloDia(R.hoje)}: ${semHoje.map(p => esc(p.nome)).join(', ')}`, '']); }
  const alertasHTML = alertas.length ? alertas.map(([c, t, at]) => `<${at ? 'button' : 'div'} class="g-alerta ${c}" ${at}>${t}</${at ? 'button' : 'div'}>`).join('') : R.aguardando_spaces ? '<div class="g-alerta cinza">Aguardando definição dos Spaces para avaliar o ritmo geral.</div>' : '<div class="g-alerta ok">Nenhum alerta de ritmo neste recorte.</div>';

  // ---- 5) evolução acumulada (realizado × esperado)
  const serie = d.serie || [];
  const grafico = () => {
    if (serie.length < 2) return `<div class="g-vazio-mini">${serie.length ? `Primeiro dia: realizado ${int(serie[0].realizado)} · esperado ${int(serie[0].esperado)}. A linha aparece a partir do 2º dia.` : 'Sem histórico ainda.'}</div>`;
    const max = Math.max(1, ...serie.flatMap(x => [x.realizado, x.esperado || 0]));
    const temEsperado = serie.every(x=>x.esperado!=null);
    const pts = (k) => serie.map((x, i) => `${(i * 100 / (serie.length - 1)).toFixed(2)},${(92 - 84 * x[k] / max).toFixed(2)}`).join(' ');
    return `<div class="g-graf"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Realizado e esperado acumulados">${temEsperado ? `<polyline points="${pts('esperado')}" fill="none" stroke="var(--text-3)" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}<polyline points="${pts('realizado')}" fill="none" stroke="var(--accent)" stroke-width="2.4" vector-effect="non-scaling-stroke"/></svg>
      <div class="g-graf-eixo"><span>${dataBR(serie[0].data)}</span><span><i class="g-l1"></i>realizado ${temEsperado ? '<i class="g-l2"></i>esperado' : ' · aguardando Spaces'}</span><span>${dataBR(serie[serie.length - 1].data)}</span></div></div>`;
  };

  // ---- produtos (recolhido)
  const linhaP = (p) => { const h = (H.linhas.find(l => l.categoria_id === p.categoria_id)?.produtos || []).find(x => x.produto_id === p.id);
    return `<tr><td><button class="novo-link" data-abrir-produto="${p.id}">${esc(nomeP(p.id, p.nome))}</button></td><td class="num"><b>${int(p.qtd)}</b>${sedeTxt(p)}</td><td class="num muted">${p.meta ? int(p.meta) : '—'}</td><td>${p.meta ? miniBarra(p.qtd, p.meta) : ''}</td><td class="num">${p.meta && h ? int(h.esperado) : '—'}</td><td>${p.meta && h ? saveGap(h.saldo) : '<span class="muted">—</span>'}</td><td class="num">${tkTxt(p)}</td></tr>`; };
  const linhaSub = (nome, x) => `<tr class="sub-total"><td>${esc(nome)} — total</td><td class="num"><b>${int(x.qtd)}</b></td><td class="num muted">${x.meta ? int(x.meta) : '—'}</td><td>${x.meta ? miniBarra(x.qtd, x.meta) : ''}</td><td class="num">${x.meta ? int(x.esperado) : '—'}</td><td>${x.meta ? saveGap(x.saldo) : ''}</td><td class="num">${qtdT(x) ? brl(x.valor / qtdT(x)) : '—'}</td></tr>`;
  // produtos na ordem da planilha; o subgrupo (ex.: Semi - Saúde) aparece no lugar do seu primeiro produto, com subtotal
  const tabela = linhasHier(hierarquia(d.porProduto, ids => somaBloco(d, ids)), 7, (x, cls, nome, it) => it.tipo === 'prod' ? linhaP(x).replace('<tr>', `<tr class="${cls}">`) : linhaSub(it.nome.replace(/ — total$/, ''), x));

  // Destaque do próximo Space: comparação por produto, ao lado do objetivo geral do processo.
  const espacoEmDestaque = () => {
    const produtoLinhas = prox ? prox.linhas.flatMap(l => l.produtos || []).filter(x => Number(x.meta) > 0) : [];
    const totalSpace = prox?.total || null;
    const metaGeral = Number(T.meta) || 0, realizadoGeral = Number(T.qtd) || 0;
    const faltaGeral = Math.max(metaGeral - realizadoGeral, 0);
    const produtosMetaGeral = d.porProduto.filter(x => Number(x.meta) > 0 || Number(x.qtd) > 0);
    const tabelaMetaGeral = `<div class="g-space-tabela"><table class="t"><thead><tr><th>Produto</th><th class="num">Meta geral</th><th class="num">Realizado</th><th class="num">Faltam</th></tr></thead><tbody>
      ${produtosMetaGeral.map(x => { const meta = Number(x.meta) || 0, atual = Number(x.qtd) || 0; return `<tr><td>${esc(nomeP(x.id, x.nome))}</td><td class="num">${int(meta)}</td><td class="num">${int(atual)}</td><td class="num">${Math.max(meta - atual, 0) ? `<b class="g-space-falta">${int(Math.max(meta - atual, 0))}</b>` : '<span class="tag ok mini">atingida</span>'}</td></tr>`; }).join('')}
      <tr class="total"><td>Total do processo</td><td class="num">${int(metaGeral)}</td><td class="num">${int(realizadoGeral)}</td><td class="num"><b class="g-space-falta">${int(faltaGeral)}</b></td></tr>
    </tbody></table></div>`;
    const corpoSpace = prox
      ? `<div class="g-space-contexto">${esc(prox.nome)} <span>·</span> ${dataBR(prox.data)} <span>·</span> ${prox.dias} ${o.nomeDias}</div>
        <div class="g-space-tabela"><table class="t"><thead><tr><th>Produto</th><th class="num">Meta do Space</th><th class="num">Realizado</th><th class="num">Faltam</th></tr></thead><tbody>
          ${produtoLinhas.map(x => { const atual = Number(x.realizado) || 0, esperado = Number(x.esperado) || 0, falta = Math.max(esperado - atual, 0); return `<tr><td><button class="novo-link" data-abrir-produto="${x.produto_id}">${esc(nomeP(x.produto_id, x.nome))}</button></td><td class="num">${int(esperado)}</td><td class="num">${int(atual)}</td><td class="num">${falta ? `<b class="g-space-falta">${int(falta)}</b>` : '<span class="tag ok mini">atingida</span>'}</td></tr>`; }).join('')}
          <tr class="total"><td>Total do próximo Space</td><td class="num">${int(totalSpace?.esperado)}</td><td class="num">${int(totalSpace?.realizado)}</td><td class="num"><b class="g-space-falta">${int(totalSpace?.falta)}</b></td></tr>
        </tbody></table></div>`
      : '<div class="g-space-sem">Não há próximo Space cadastrado para este processo. Confira os Spaces na aba correspondente.</div>';
    return `<div class="g-space-destaque">
      <section class="card g-space-proximo"><div class="card-cab"><h2>Próximo Space</h2><span>${prox ? 'Meta acumulada por produto' : 'Aguardando configuração'}</span></div><div class="corpo">${corpoSpace}</div></section>
      <section class="card g-space-geral"><div class="card-cab"><h2>Meta geral</h2><span>${R.final?.data ? `até ${dataBR(R.final.data)}` : 'Processo completo'}</span></div><div class="corpo">${tabelaMetaGeral}</div></section>
    </div>`;
  };

  return `${cab}${kpis}<section class="card mt g-onde-agir"><div class="card-cab"><h2>Onde agir</h2><span class="muted">${alertas.length ? `${alertas.length} ponto(s) para acompanhar` : ''}</span></div><div class="corpo g-alertas">${alertasHTML}<div class="linha-acoes"><a class="btn" href="#/painel/polos">Ver polos</a><a class="btn" href="#/painel/produtos">Ver produtos</a><a class="btn" href="#/painel/equipe">Ver equipe</a></div></div></section>${quadro}${quadroMatriculasExternas(d,o.umPolo)}${quadroSemVendas(d, R.hoje, o.umPolo)}${espacoEmDestaque()}
    <div class="card mt"><div class="card-cab"><h2>Por produto</h2><span class="muted">realizado / meta · marca = esperado na data</span></div><div class="corpo">${grupoHTML}</div></div>
    <div class="card mt"><div class="card-cab"><h2>Evolução acumulada</h2><span class="muted">realizado × esperado (calculado com as metas e Spaces atuais)</span></div><div class="corpo">${grafico()}</div></div>
    <details class="card mt"><summary class="g-sum">Produtos — realizado, meta e SAVE/GAP</summary><div class="corpo sem-pad"><table class="t"><thead><tr><th>Produto</th><th class="num">Realizado</th><th class="num">Meta</th><th>Atingido</th><th class="num">Esperado</th><th>SAVE/GAP</th><th class="num">Ticket</th></tr></thead><tbody>${tabela}
      <tr class="total"><td>Total</td><td class="num">${int(T.qtd)}</td><td class="num">${int(T.meta)}</td><td>${miniBarra(T.qtd, T.meta)}</td><td class="num">${int(H.total.esperado)}</td><td>${saveGap(H.total.saldo)}</td><td class="num">${qtdT(T) ? brl(T.valor / qtdT(T)) : '—'}</td></tr></tbody></table></div></details>
    <details class="card mt"><summary class="g-sum">Detalhamento completo — Spaces e metas por produto</summary><div class="corpo sem-pad">${o.tabProdutos()}</div></details>
    <p class="nota-rodape">SAVE/GAP = realizado − esperado até hoje (o % de cada Space é distribuído por ${MODO_TXT[modo] || modo}). Polos e rede são arredondados separadamente; a soma dos polos pode diferir da rede em 1–2.</p>`;
}

// Cabeçalho compartilhado pelos relatórios, usando a marca configurada no sistema.
// Bloco comum: mantém separados o ritmo da data e a meta completa de cada Space.
function resumoRelatorio({meta, realizado=0, esperado=null, ref, spaces=[], modo='corridos', titulo='Resumo do processo', prazoProprio=false}) {
  const temMeta = Number(meta) > 0;
  const cartao = (nome,valor,detalhe='') => `<div><span>${esc(nome)}</span><b>${valor}</b><em>${detalhe}</em></div>`;
  const etapas = spaces.map(sp => ({...sp, ...sp.total}));
  const prox = etapas.find(sp => sp.proximo) || etapas.find(sp => sp.data >= ref);
  return `${temMeta && esperado == null ? avisoSpaces() : ''}<div class="rp-resumo"><h2>${esc(titulo)}</h2><div class="rel-kpis">
    ${cartao('Meta do processo',temMeta?int(meta):'—',temMeta?'matrículas':'Sem meta cadastrada')}
    ${cartao('Realizado acumulado',int(realizado),ref?`Posição em ${dataBR(ref)}`:'')}
    ${cartao('Atingimento do processo',temMeta?pctTxt(pct(realizado,meta)):'—')}
    ${cartao('Esperado até a consulta',temMeta&&esperado!=null?int(esperado):'—')}
    ${cartao('SAVE/GAP na data',temMeta&&esperado!=null?(prazoProprio&&realizado===esperado?'Em linha com o esperado':saveGap(realizado-esperado)):'—','Comparação com o esperado até a consulta')}
    ${prox?cartao('Próximo Space',esc(prox.nome),`${dataBR(prox.data)} · ${prox.percentual!=null?pctTxt(prox.percentual)+' previsto':''}`):''}
    ${prox?cartao('Faltam para o Space',temMeta?int(Math.max(0,prox.esperado-realizado)):'—','Comparação com a meta completa do Space'):''}
    ${prox?cartao('Dias de venda restantes',esc(prox.dias_texto || int(prox.dias||0)),`Contagem: ${esc(MODO_TXT[modo]||modo)}`):''}
    ${prox?cartao('Necessário por dia',temMeta&&prox.dias>0?dec1(prox.por_dia ?? Math.max(0,prox.esperado-realizado)/prox.dias):'—',prox.dias>0?'matrículas por dia de venda':'Sem dias de venda restantes'):''}
  </div>${etapas.length?`<h2>Acompanhamento dos Spaces</h2><table class="t"><thead><tr><th>Space / data</th><th class="num">% previsto</th><th class="num">Meta acumulada</th><th class="num">Realizado</th><th class="num">Atingimento</th><th>Situação do Space</th></tr></thead><tbody>${etapas.map(sp=>`<tr><td>${esc(sp.nome)}<br>${dataBR(sp.data)}</td><td class="num">${sp.percentual!=null?pctTxt(sp.percentual):'—'}</td><td class="num">${temMeta?int(sp.esperado):'—'}</td><td class="num">${int(sp.realizado||0)}</td><td class="num">${temMeta&&sp.esperado>0?pctTxt(pct(sp.realizado,sp.esperado)):'—'}</td><td>${!temMeta?'Sem meta cadastrada':sp.data<=ref?saveGap(sp.realizado-sp.esperado):`Faltam ${int(Math.max(0,sp.esperado-sp.realizado))} · parcial`}</td></tr>`).join('')}</tbody></table>`:''}<p class="rp-nota">${prazoProprio?'SAVE/GAP compara o realizado ao esperado até a consulta, respeitando o prazo próprio e o calendário de cada polo. Esperado zero pode decorrer do arredondamento; não indica início de vendas.':'SAVE/GAP na data compara o realizado ao esperado até a consulta. A situação do Space compara com a meta acumulada daquele marco; Spaces futuros são parciais. Percentual previsto é a regra cadastrada; produtos com prazo próprio seguem o motor de metas.'}</p></div>`;
}
function resumoRitmo(r,titulo) {
  const h=r.hoje_situacao.total;
  return resumoRelatorio({meta:h.meta,realizado:h.realizado,esperado:h.esperado,ref:r.hoje,spaces:r.spaces,modo:r.modo,titulo});
}

function resumoRedeRelatorios(paineis) {
  const rs=Object.values(paineis).map(p=>p.ritmo);
  if(!rs.length) return '';
  const soma=xs=>({meta:xs.reduce((a,x)=>a+(x.meta||0),0),esperado:somarConhecido(xs,'esperado'),realizado:xs.reduce((a,x)=>a+(x.realizado||0),0)});
  const h=soma(rs.map(r=>r.hoje_situacao.total));
  const spaces=rs[0].spaces.map(sp=>{
    const etapas=rs.map(r=>r.spaces.find(s=>s.id===sp.id)).filter(Boolean);
    const ds=etapas.map(s=>s.dias||0), menor=Math.min(...ds), maior=Math.max(...ds);
    return {...sp,total:soma(etapas.map(s=>s.total)),dias:maior,dias_texto:menor===maior?String(maior):`${menor} a ${maior} conforme o polo`,por_dia:etapas.reduce((a,s)=>a+(s.total.por_dia||0),0)};
  });
  return resumoRelatorio({...h,spaces,ref:rs[0].hoje,modo:rs[0].modo,titulo:'Resumo da rede — soma dos polos'});
}

function timbreRelatorio(titulo, descricao, periodo) {
  return `<style>.rel .rp-resumo{margin:18px 0 24px}.rel .rp-resumo .rel-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.rel .rp-resumo .rel-kpis>div{padding:10px;min-width:0}.rel .rp-resumo .rel-kpis b{font-size:20px}.rel .rp-resumo .rel-kpis em{display:block;font-size:11px;line-height:1.4}.rel .rp-nota{font-size:11px;line-height:1.5;color:#475569}.rel .rp-resumo table th,.rel .rp-resumo table td{padding:8px;font-size:12px}.rel .rp-resumo table tr{break-inside:avoid}@media print{.rel .rp-resumo .rel-kpis b{font-size:16px}.rel .rp-resumo .rel-kpis>div{break-inside:avoid}.rel .rp-resumo table thead{display:table-header-group}}@media(max-width:700px){.rel .rp-resumo .rel-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><header class="rel-timbre"><div class="rel-timbre-marca">${logoHTML(B.config, true)}</div><div class="rel-timbre-titulo"><span>${esc(B.config.nome_sistema || 'Acompanhamento de Matrículas')}</span><h1>${esc(titulo)}</h1><p>${esc(descricao)}</p></div><div class="rel-timbre-data">${periodo ? `<strong>${esc(periodo)}</strong>` : ''}<span>Emitido em ${esc(new Date().toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }))}</span></div></header>`;
}

// ======================================================================= RELATÓRIO POR POLO (imprimir / PDF)
// Explica de onde vem o número do realizado (lançadas no polo do aluno, tutores de outros polos, Sede/Digital)
function composicaoRealizado(d, umPolo) {
  const T = d.totais || {}, lanc = qtdT(T), sede = T.sede || 0;
  if (!T.qtd) return '';
  const semP = T.sede_sem_produto ? ` (${int(T.sede_sem_produto)} sem produto informado no Mundo Azul)` : '';
  if (!umPolo) return `<p class="rp-nota"><b>Composição do realizado:</b> ${int(lanc)} lançadas pelos tutores + ${int(sede)} Sede/Digital${semP} = <b>${int(T.qtd)}</b>.</p>`;
  const ext = (d.externasRecebidas || []).reduce((a, x) => a + x.qtd, 0), proprios = lanc - ext;
  const credito = d.total_credito_tutores ? d.total_credito_tutores.qtd : proprios, fora = Math.max(0, credito - proprios);
  return `<p class="rp-nota"><b>Composição do realizado do polo:</b> ${int(proprios)} da equipe do polo${ext ? ` + ${int(ext)} de tutores de outros polos` : ''}${sede ? ` + ${int(sede)} Sede/Digital${semP}` : ''} = <b>${int(T.qtd)}</b>.${fora ? ` A equipe também lançou ${int(fora)} matrícula(s) para alunos de outros polos: contam na meta do tutor (tabela Responsáveis, ${int(credito)} no total), mas no realizado do polo do aluno.` : ''}</p>`;
}
function relatorioHTML(d, titulo, umPolo) {
  const T = d.totais, R = d.ritmo, H = R.hoje_situacao, modo = R.modo;
  const prox = R.spaces.find(s => s.proximo), fin = R.final;
  const nomeDias = modo === 'corridos' ? 'dias corridos' : modo === 'seg-sab' ? 'dias de segunda a sábado' : 'dias de segunda a sexta';
  const cats = d.categorias.filter(k => d.porProduto.some(p => p.categoria_id === k.id));
  const sub = (lin, x) => { const l = lin && lin.find(z => z.categoria_id === x.categoria_id); return l && l.produtos ? l.produtos.find(z => z.produto_id === x.id) : null; };
  const linhaProd = (x, it, cls) => {
    const h = ritmoDe(H, it), r = ritmoDe(prox, it);
    return `<tr class="${cls}"><td>${esc(x.nome)}</td><td class="num"><b>${int(x.qtd)}</b>${sedeTxt(x)}</td><td class="num">${int(x.meta)}</td><td class="num">${x.meta ? pctTxt(pct(x.qtd, x.meta)) : '—'}</td>
      <td class="num">${x.meta && h ? int(h.esperado) : '—'}</td><td>${x.meta && h ? saveGap(h.saldo) : '—'}</td>
      ${prox ? `<td class="num">${r ? int(r.falta) : ''}</td><td class="num">${r ? precisaTxt(r.por_dia, modo) : ''}</td>` : ''}
      </tr>`;
  };
  const vazio = !T.qtd;
  return `<section class="rel-pagina">
    ${timbreRelatorio('Relatório de acompanhamento', `${titulo} · ${cicloAtual().nome}`, `Posição em ${dataBR(R.hoje)}`)}
    ${resumoRitmo(R, 'Resumo do processo')}

    <h2>Produtos</h2>
    <table class="t"><thead><tr><th>Produto</th><th class="num">Realizado</th><th class="num">Meta</th><th class="num">%</th><th class="num">Esperado</th><th>SAVE/GAP</th>
      ${prox ? `<th class="num">Falta p/ ${esc(prox.nome)}</th><th class="num">Precisa</th>` : ''}</tr></thead><tbody>
      ${linhasHier(hierarquia(d.porProduto, ids => somaProdutos(d, ids)), 8, (x, cls, nome, it) => linhaProd({ ...x, nome }, it, cls))}
      ${linhaProd({ nome: 'Total', ...T }, { tipo: 'total' }, 'total')}</tbody></table>
    ${composicaoRealizado(d, umPolo)}

    <h2>Indicadores financeiros por produto</h2>${avisoFinanceiro(d)}
    <table class="t rel-financeiro"><thead><tr><th>Produto</th><th class="num">Matrículas</th><th class="num">Ticket médio</th><th class="num">Meta ticket</th><th class="num">RPV</th><th class="num">Meta RPV</th></tr></thead><tbody>
      ${d.porProduto.map(p => `<tr><td>${esc(p.nome)}</td><td class="num">${int(qtdT(p))}</td><td class="num">${tkTxt(p)}</td><td class="num">${p.ticket_meta != null ? brl(p.ticket_meta) : '—'}</td><td class="num">${brl(p.rpv_real ?? p.valor)}</td><td class="num">${metaRpvTxt(p)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${int(qtdT(T))}</td><td class="num">${tkTxt(T)}</td><td class="num">${T.ticket_meta != null ? brl(T.ticket_meta) : '—'}</td><td class="num">${brl(T.rpv_real)}</td><td class="num">${metaRpvTxt(T)}</td></tr></tbody></table>
    <h2>Spaces</h2>
    <table class="t"><thead><tr><th>Space</th><th>Data</th><th class="num">% da meta</th><th class="num">Esperado</th><th class="num">Realizado</th><th>Situação</th></tr></thead><tbody>
      ${R.spaces.map(s => `<tr><td>${esc(s.nome)}</td><td>${dataBR(s.data)}</td><td class="num">${pctTxt(s.percentual)}</td><td class="num">${int(s.total.esperado)}</td><td class="num">${int(s.total.realizado)}</td>
        <td>${!T.meta ? 'Meta não cadastrada' : s.total.esperado === 0 ? 'Sem previsão para este marco' : s.passado ? saveGap(s.total.saldo) : s.proximo ? `próximo · faltam ${int(s.total.falta)} · ${precisaTxt(s.total.por_dia, modo)}` : `faltam ${int(s.total.falta)}`}</td></tr>`).join('')}</tbody></table>

    ${umPolo ? `<h2>Responsáveis — equipe e histórico</h2>
    ${d.porTutor.length ? `<table class="t"><thead><tr><th>Tutor</th><th class="num">Matrículas</th>${d.tem_meta_tutor ? '<th class="num">Meta</th><th class="num">Esperado</th><th>SAVE/GAP</th>' : ''}<th class="num">Participação</th><th class="num">Ticket</th><th>Última venda</th><th>Sem vender</th></tr></thead><tbody>${d.porTutor.map(t => `<tr><td>${esc(t.nome)}</td><td class="num">${int(t.qtd)}</td>${d.tem_meta_tutor ? `<td class="num">${t.meta != null ? dec1(t.meta).replace(',0', '') : '—'}</td><td class="num">${t.esperado != null ? int(t.esperado) : '—'}</td><td>${t.saldo != null ? saveGap(t.saldo) : '—'}</td>` : ''}<td class="num">${(d.total_credito_tutores?.qtd ?? qtdT(T)) ? pctTxt(pct(t.qtd,d.total_credito_tutores?.qtd ?? qtdT(T))) : '—'}</td><td class="num">${tkTxt(t)}</td><td>${t.ultima ? dataBR(t.ultima) : '—'}</td><td>${diasSemVendaTag(t)}</td></tr>`).join('')}${T.sede ? `<tr class="sub"><td>Sede/Digital <span class="sede-tag">Mundo Azul</span></td><td class="num">${int(T.sede)}</td><td colspan="${(d.tem_meta_tutor ? 3 : 0) + 4}" class="muted">Matrículas do Mundo Azul que os tutores não lançaram — somam no realizado do polo, não na meta de nenhum tutor</td></tr>` : ''}</tbody></table><h2>Equipe por produto</h2><table class="t"><thead><tr><th>Tutor</th><th>Produto</th><th class="num">Matrículas</th></tr></thead><tbody>${d.porTutor.flatMap(t => (d.produtosEquipe || d.porProduto).filter(p => t.produtos[p.id]).map(p => `<tr><td>${esc(t.nome)}</td><td>${esc(p.nome)}</td><td class="num">${int(t.produtos[p.id])}</td></tr>`)).join('') || '<tr><td colspan="3">Nenhuma matrícula por tutor neste recorte.</td></tr>'}</tbody></table>` : '<p class="muted">Nenhum tutor ativo vinculado a este polo.</p>'}`
    : `<h2>Polos</h2>
    <table class="t"><thead><tr><th>Polo</th><th class="num">Realizado</th><th class="num">Meta</th><th class="num">%</th><th class="num">Esperado</th><th>SAVE/GAP</th><th class="num">Ticket</th><th>Dif. ticket</th><th>Ating. RPV</th></tr></thead><tbody>
      ${[...d.porPolo].sort((a, b) => (a.hoje?.saldo ?? 0) - (b.hoje?.saldo ?? 0)).map(p => `<tr><td>${esc(p.nome)}</td><td class="num"><b>${int(p.qtd)}</b>${sedeTxt(p)}</td><td class="num">${int(p.meta)}</td><td class="num">${pctTxt(pct(p.qtd, p.meta))}</td><td class="num">${p.hoje ? int(p.hoje.esperado) : '—'}</td><td>${p.hoje ? saveGap(p.hoje.saldo) : '—'}</td><td class="num">${tkTxt(p)}</td><td>${difTicket(p.ticket_dif)}</td><td>${atingTag(p)}</td></tr>`).join('')}</tbody></table>`}

    ${quadroMatriculasExternas(d,umPolo)}
    <h2>Origens</h2>
    ${d.porOrigem.length ? `<table class="t"><thead><tr><th>Origem</th><th class="num">Matrículas</th><th class="num">Participação</th><th class="num">Ticket médio</th></tr></thead><tbody>${[...d.porOrigem].sort((a,b)=>b.qtd-a.qtd).map(o => `<tr><td>${esc(o.nome)}</td><td class="num">${int(o.qtd)}</td><td class="num">${qtdT(T) ? pctTxt(pct(o.qtd,qtdT(T))) : '—'}</td><td class="num">${tkTxt(o)}</td></tr>`).join('')}</tbody></table><h2>Origens por produto</h2><table class="t"><thead><tr><th>Origem</th><th>Produto</th><th class="num">Matrículas</th></tr></thead><tbody>${d.porOrigem.flatMap(o=>d.porProduto.filter(p=>o.produtos[p.id]).map(p=>`<tr><td>${esc(o.nome)}</td><td>${esc(p.nome)}</td><td class="num">${int(o.produtos[p.id])}</td></tr>`)).join('')}</tbody></table>` : '<p class="muted">Nenhuma matrícula lançada ainda.</p>'}
    <footer class="rel-rodape">SAVE/GAP = realizado − esperado até hoje (o % de cada Space é distribuído por ${MODO_TXT[modo]}). O esperado total é distribuído proporcionalmente entre produtos; a falta total considera o realizado total. A soma das faltas dos produtos pode ser maior quando há excedentes em outros produtos. Ticket = mensalidade média com desconto; RPV = receita (matrículas × ticket); meta de RPV = meta de matrículas × meta de ticket. Realizado, metas e SAVE/GAP incluem Sede/Digital (marcado “incl. N S/D”); financeiro, equipe e origens usam só as matrículas lançadas.</footer>
  </section>`;
}

async function telaRelatorio(alvo) {
  const app = $('#app');
  const travado = poloTravado();
  if (travado) alvo = String(B.usuario.polo_id);
  const todos = alvo === 'todos';
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Relatório</b>
    <select id="rel-polo" ${travado ? 'disabled' : ''}>${travado ? '' : '<option value="todos">Rede + todos os polos (um por página)</option>'}${B.polos.filter(p => p.ativo).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select>
    <button class="btn prim" onclick="window.print()">Imprimir / Salvar PDF</button><span class="muted">Usa apenas processo e polo; os demais filtros do painel não se aplicam. Na impressão, escolha Salvar como PDF e desative cabeçalhos e rodapés do navegador.</span></div>
    <div id="rel-conteudo" class="rel"><div class="carregando">Montando relatório…</div></div>`;
  $('#rel-polo').value = alvo;
  $('#rel-polo').onchange = (e) => { location.hash = '#/relatorio/' + e.target.value; };
  document.title = `Relatório — ${todos ? 'Rede' : nomePor('polos', alvo)} — ${cicloAtual().nome}`;
  const pega = (polo) => api('/api/painel?' + qs({ ciclo: estado.ciclo, polo, ref: posicaoAtual(),historico:'1' }));
  try {
    let html = '';
    if (todos) {
      html += relatorioHTML(await pega(''), B.config.nome_rede ? `Rede ${B.config.nome_rede}` : 'Rede', false);
      for (const p of B.polos.filter(x => x.ativo)) html += relatorioHTML(await pega(p.id), `Polo ${p.nome}`, true);
    } else html = relatorioHTML(await pega(alvo), `Polo ${nomePor('polos', alvo)}`, true);
    $('#rel-conteudo').innerHTML = html;
  } catch (e) { $('#rel-conteudo').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
}

// ======================================================================= RITMO SPACE
function renderRitmo(c, d) {
  if (!d.spaces.length) {
    c.innerHTML = `<div class="card"><div class="vazio">Nenhum Space cadastrado neste processo. ${eAdmin() ? '<a href="#/cadastros/metas">Cadastre em Metas e Spaces</a>.' : ''}</div></div>`;
    return;
  }
  const H = d.hoje_situacao;
  // produtos que aparecem no ritmo (com meta ou realizado), no formato da hierarquia
  const prodsDe = (lin) => lin.linhas.flatMap(l => (l.produtos || []).map(p => ({ id: p.produto_id, categoria_id: l.categoria_id, nome: p.nome })));
  const itensDe = (lin) => hierarquia(prodsDe(lin), () => ({}));
  const card = (s, final = false) => `
    <div class="card space ${s.proximo ? 'proximo' : ''} ${s.passado ? 'passado' : ''} ${final ? 'final' : ''}">
      <div class="card-cab"><h2>${esc(s.nome)} · ${dataBR(s.data)}</h2>
        ${s.passado ? (s.total.saldo >= 0 ? '<span class="tag ok">Encerrado · SAVE</span>' : '<span class="tag bad">Encerrado · GAP</span>') : s.proximo ? '<span class="tag">Próximo</span>' : final ? '' : '<span class="tag cinza">Futuro</span>'}
        <span class="tag cinza">${pctTxt(s.percentual)} da meta</span></div>
      <div class="space-resumo">
        <div>Esperado<b>${int(s.total.esperado)}</b></div><div>Realizado<b>${int(s.total.realizado)}</b></div>
        ${s.passado ? `<div>Resultado<b>${saveGap(s.total.saldo)}</b></div>` : `<div>Falta<b>${int(s.total.falta)}</b></div><div>Dias úteis<b>${s.dias}</b></div><div>Precisa<b>${precisaTxt(s.total.por_dia, d.modo)}</b></div>`}
      </div>
      <div class="corpo sem-pad"><table class="t"><thead><tr><th>Produto</th><th class="num">Esperado</th><th class="num">Realizado</th><th>Atingido</th>
        ${s.passado ? '<th>Resultado</th>' : '<th class="num">Falta</th><th class="num">Precisa</th>'}</tr></thead>
      <tbody>${linhasHier(itensDe(s), 6, (_, cls, nome, it) => { const x = ritmoDe(s, it) || {}; return `<tr class="${cls}"><td>${esc(nome)}</td><td class="num">${int(x.esperado)}</td><td class="num"><b>${int(x.realizado)}</b></td><td>${miniBarra(x.realizado, x.esperado)}</td>
        ${s.passado ? `<td>${saveGap(x.saldo)}</td>` : `<td class="num">${int(x.falta)}</td><td class="num">${precisaTxt(x.por_dia, d.modo)}</td>`}</tr>`; })}</tbody></table></div>
    </div>`;
  c.innerHTML = `
  <div class="card"><div class="card-cab"><h2>Posição · ${dataBR(d.hoje)}</h2><span class="tag cinza">${pctTxt(H.percentual)} da meta previsto até a data</span>${saveGap(H.total.saldo)}</div>
    <div class="corpo sem-pad"><table class="t"><thead><tr><th>Produto</th><th class="num">Meta</th><th class="num">Esperado até a data</th><th class="num">Realizado</th><th>Atingido</th><th>SAVE/GAP</th></tr></thead>
    <tbody>${linhasHier(itensDe(H), 6, (_, cls, nome, it) => { const x = ritmoDe(H, it) || {}; return `<tr class="${cls}"><td>${esc(nome)}</td><td class="num muted">${int(x.meta)}</td><td class="num">${int(x.esperado)}</td><td class="num"><b>${int(x.realizado)}</b></td><td>${miniBarra(x.realizado, x.esperado)}</td><td>${x.meta ? saveGap(x.saldo) : '<span class="muted">sem meta</span>'}</td></tr>`; })}
      <tr class="total"><td>Total</td><td class="num">${int(H.total.meta)}</td><td class="num">${int(H.total.esperado)}</td><td class="num">${int(H.total.realizado)}</td><td>${miniBarra(H.total.realizado, H.total.esperado)}</td><td>${saveGap(H.total.saldo)}</td></tr></tbody></table></div>
    <div class="nota">Esperado até hoje: o % de cada Space é distribuído por ${MODO_TXT[d.modo]} desde o Space anterior${H.periodo ? ` (período ${dataBR(H.periodo.inicio)} → ${dataBR(H.periodo.fim)}: ${H.periodo.dias_feitos} de ${H.periodo.dias_total} dias, de ${pctTxt(H.periodo.pct_inicio)} a ${pctTxt(d.spaces.find(x => x.proximo)?.percentual)})` : ''}. Início do processo: ${dataBR(d.inicio)}${d.inicio_estimado ? ' (estimado pela 1ª matrícula — cadastre em Metas e Spaces)' : ''}.${estado.polo ? '' : ' Todos os polos somados.'}</div></div>
  <div class="spaces mt">${d.spaces.map(s => card(s)).join('')}${d.final && !d.spaces.some(s => s.data === d.final.data && s.percentual >= 100) ? card(d.final, true) : ''}</div>`;
}

// ======================================================================= MATRÍCULAS
async function telaMatriculas(c, sub) {
  if (sub === 'importar') { if (!podeLancar()) { location.hash = '#/matriculas'; return; } return telaImportar(c); }
  const f = ls.get('mat-filtro', { busca: '', tutor: '', produto: '', origem: '', de: '', ate: '' });
  let pagina = 1;
  const tutoresFiltro = f.credito_tutor && estado.polo ? await api('/api/tutores-processo?'+qs({ciclo:estado.ciclo,polo:estado.polo,ref:posicaoAtual()})) : B.tutores;
  c.innerHTML = `
  <div class="filtros">
    <label class="campo largo"><span>Buscar (aluno, CPF, curso, obs.)</span><input type="search" id="m-busca" placeholder="Digite para buscar…"></label>
    <label class="campo"><span>Tutor</span><select id="m-tutor"><option value="">Todos</option>${tutoresFiltro.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select></label>
    <label class="campo"><span>Produto</span><select id="m-produto"><option value="">Todos</option>${B.produtos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label class="campo"><span>Origem</span><select id="m-origem"><option value="">Todas</option>${B.origens.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></label>
    <label class="campo"><span>De</span><input type="date" id="m-de"></label>
    <label class="campo"><span>Até</span><input type="date" id="m-ate"></label>
    <label class="check"><input type="checkbox" id="m-credito" ${f.credito_tutor?'checked':''}> Polo de crédito do tutor</label><button class="btn" id="m-limpar">Limpar</button>
    <a class="btn" id="m-csv" href="#">Exportar CSV</a>
    ${podeLancar() ? '<a class="btn prim" href="#/matriculas/importar">Importar do WhatsApp</a>' : ''}
  </div>
  <div class="card"><div class="card-cab"><h2 id="m-resumo">Matrículas</h2></div>
    <div class="corpo sem-pad" id="m-tabela"></div><div class="paginacao" id="m-pag"></div></div>`;
  const campos = ['busca', 'tutor', 'produto', 'origem', 'de', 'ate'];
  campos.forEach(k => { $('#m-' + k).value = f[k] || ''; });

  const filtroAtual = () => ({ ciclo: estado.ciclo, polo: estado.polo, credito_tutor:$('#m-credito').checked?1:'', ...Object.fromEntries(campos.map(k => [k, $('#m-' + k).value])) });
  async function carregar() {
    const fa = filtroAtual();
    ls.set('mat-filtro', {...Object.fromEntries(campos.map(k => [k, fa[k]])),credito_tutor:fa.credito_tutor});
    $('#m-csv').href = '/api/matriculas.csv?' + qs(fa);
    const d = await api('/api/matriculas?' + qs({ ...fa, pagina, limite: 100 }));
    $('#m-resumo').innerHTML = `${int(d.total)} matrícula(s) <span class="muted" style="font-weight:500">· ${brl(d.valor_total)} em mensalidades · ticket médio ${brl(ticket(d.valor_total, d.total))}</span>`;
    $('#m-tabela').innerHTML = d.linhas.length ? `<table class="t"><thead><tr><th>Data</th><th>Polo da matrícula</th><th>Tutor responsável</th><th>Aluno</th><th>CPF</th><th>Produto</th><th>Origem</th><th class="num">Mensalidade</th>${podeLancar() ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.linhas.map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.polo)}</td><td>${esc(l.tutor)}${l.tutor_polo && l.tutor_polo_id !== l.polo_id ? `<div class="muted">Polo do tutor: ${esc(l.tutor_polo)}</div>` : ''}</td><td>${esc(l.aluno || '')}${l.curso ? `<div class="muted" style="font-size:12px">${esc(l.curso)}</div>` : ''}</td>
        <td class="cpf">${esc(l.cpf)}${l.ra ? `<div class="id-aluno">R.A. ${esc(l.ra)}</div>` : ''}</td><td><span class="tag cinza">${esc(l.categoria)}</span> ${esc(l.produto)}</td><td>${esc(l.origem)}</td><td class="num">${brl(l.valor)}</td>
        ${podeLancar() ? `<td class="acoes"><button class="btn peq" data-ed="${l.id}">Editar</button> <button class="btn peq perigo" data-ex="${l.id}">Excluir</button></td>` : ''}</tr>`).join('')}
      </tbody></table>` : `<div class="vazio">Nenhuma matrícula encontrada.${podeLancar() ? ' Use <b>+ Nova matrícula</b> no topo para lançar a primeira.' : ''}</div>`;
    const paginas = Math.max(1, Math.ceil(d.total / d.limite));
    $('#m-pag').innerHTML = paginas > 1 ? `<span class="muted">Página ${pagina} de ${paginas}</span><button class="btn peq" id="p-ant" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button><button class="btn peq" id="p-prox" ${pagina >= paginas ? 'disabled' : ''}>Próxima</button>` : '';
    if ($('#p-ant')) { $('#p-ant').onclick = () => { pagina--; carregar(); }; $('#p-prox').onclick = () => { pagina++; carregar(); }; }
    $$('[data-ed]').forEach(b => { b.onclick = () => modalMatricula(d.linhas.find(x => x.id === Number(b.dataset.ed)), carregar); });
    $$('[data-ex]').forEach(b => {
      b.onclick = async () => {
        const l = d.linhas.find(x => x.id === Number(b.dataset.ex));
        if (!await confirmar('Excluir matrícula', `Excluir a matrícula de <b>${esc(l.aluno || l.cpf || 'sem nome')}</b> (${esc(l.produto)}, ${dataBR(l.data)})? Isso não pode ser desfeito.`, 'Excluir')) return;
        try { await api('/api/matriculas/' + l.id, { method: 'DELETE' }); toast('Matrícula excluída'); carregar(); } catch (e) { toast(e.message, true); }
      };
    });
  }
  let timer;
  $('#m-busca').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { pagina = 1; carregar(); }, 300); };
  campos.filter(k => k !== 'busca').forEach(k => { $('#m-' + k).onchange = () => { pagina = 1; carregar(); }; });
  $('#m-credito').onchange=()=>{pagina=1;carregar().catch(e=>toast(e.message,true));};
  $('#m-limpar').onclick = () => { $('#m-credito').checked=false; campos.forEach(k => { $('#m-' + k).value = ''; }); pagina = 1; carregar(); };
  await carregar();
}

// ======================================================================= IMPORTAR DO WHATSAPP
async function telaImportar(c) {
  const ciclo = cicloAtual();
  let linhas = [];
  let existentes = [];
  c.innerHTML = `
  <div class="linha-acoes" style="margin-bottom:12px"><a href="#/matriculas" class="btn">← Voltar para Matrículas</a></div>
  <div class="card"><div class="card-cab"><h2>1. Cole as mensagens do grupo</h2><span class="muted"><b>${esc(ciclo.nome)}</b></span></div><div class="corpo">
    <div class="info">No <b>WhatsApp Web</b>, selecione as mensagens de matrícula (pode ser o dia todo, junto com outras conversas), copie (Ctrl+C) e cole abaixo (Ctrl+V).
      Ou envie a conversa exportada (no celular: grupo › ⋮ › Mais › <b>Exportar conversa › Sem mídia</b>). O sistema separa só as mensagens que têm Nome + CPF ou mensalidade.</div>
    <textarea id="wa-texto" rows="10" placeholder="Cole aqui…" style="font-family:var(--mono);font-size:12.5px"></textarea>
    <div class="linha-acoes" style="margin-top:10px">
      <button class="btn prim" id="wa-ler">Ler mensagens</button>
      <label class="btn">Abrir conversa exportada (.zip ou .txt)<input type="file" id="wa-arq" accept=".txt,.zip,text/plain,application/zip" hidden></label>
      <label class="campo" style="flex-direction:row;align-items:center;gap:8px;margin-left:auto"><span style="white-space:nowrap">Data quando a mensagem não tiver data</span><input type="date" id="wa-data" style="width:auto"></label>
      <label class="check"><input type="checkbox" id="wa-so-desde"> só a partir do início do processo (${dataBR(ciclo.data_inicio) || '—'})</label>
    </div>
  </div></div>
  <div id="wa-resultado"></div>`;
  $('#wa-data').value = B.hoje;
  $('#wa-so-desde').checked = !!ciclo.data_inicio;
  $('#wa-arq').onchange = (ev) => {
    const arq = ev.target.files[0]; if (!arq) return;
    if (/\.zip$/i.test(arq.name) || arq.type.includes('zip')) {
      arq.arrayBuffer().then(LeitorWhatsApp.textoDoZip).then(t => { $('#wa-texto').value = t; ler(); }).catch(e => toast(e.message, true));
      ev.target.value = ''; return;
    }
    const rd = new FileReader(); rd.onload = () => { $('#wa-texto').value = rd.result; ler(); }; rd.readAsText(arq, 'utf-8');
    ev.target.value = '';
  };
  $('#wa-ler').onclick = () => ler();

  const opcoes = (lista, sel, vazio = 'Selecione…') => `<option value="">${vazio}</option>` + lista.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
  const chave = (cpf, prod) => `${cpf}-${prod}`;

  async function ler() {
    const txt = $('#wa-texto').value;
    let itens = LeitorWhatsApp.casar(LeitorWhatsApp.extrair(txt), B, { hoje: $('#wa-data').value || B.hoje });
    const total = itens.length;
    if ($('#wa-so-desde').checked && ciclo.data_inicio) itens = itens.filter(x => !x.data || x.data >= ciclo.data_inicio);
    if (total && !itens.length) { $('#wa-resultado').innerHTML = `<div class="card mt"><div class="vazio">Encontrei ${total} matrícula(s), mas todas são de antes do início do processo (${dataBR(ciclo.data_inicio)}) — provavelmente do processo anterior. Se forem deste processo, desmarque "só a partir do início do processo" e clique em Ler mensagens.</div></div>`; return; }
    if (total > itens.length) toast(`${total - itens.length} matrícula(s) de antes do início do processo foram ignoradas`);
    if (!itens.length) { $('#wa-resultado').innerHTML = '<div class="card mt"><div class="vazio">Nenhuma matrícula encontrada no texto. As mensagens precisam ter pelo menos "Nome:" e "CPF:" (ou o valor da mensalidade).</div></div>'; return; }
    existentes = await api('/api/cpfs?ciclo=' + ciclo.id);
    linhas = itens.map(x => ({ ...x, cpf: x.cpf || '', incluir: true, lembrar: true, lembrar_origem: true, mensalidade: x.mensalidade ?? '' }));
    // duplicados já lançados ficam desmarcados
    for (const l of linhas) if (l.cpf && l.produto_id && existentes.some(e => e.cpf === l.cpf && e.produto_id === l.produto_id)) l.incluir = false;
    render();
  }

  function pendencias(l, i) {
    const p = [];
    if (!l.polo_id) p.push('polo'); if (!l.tutor_id) p.push('tutor'); if (!l.produto_id) p.push('produto'); if (!l.origem_id) p.push('origem');
    if (l.mensalidade === '' || l.mensalidade == null || !(parseValorBR(l.mensalidade) > 0)) p.push('mensalidade');
    if (B.config.exigir_cpf === '1' && !l.cpf) p.push('CPF');
    if (l.cpf && !cpfOk(l.cpf)) p.push('CPF inválido');
    if (l.tutor_id && !l.tutor_polo_id) p.push('polo da meta do tutor');
    if (l.polo_id && l.produto_id) { const po = B.polos.find(x => x.id === l.polo_id); if (po && !po.produtos.includes(l.produto_id)) p.push('polo não vende o produto'); }
    return p;
  }
  const ehDup = (l, i) => !!(l.cpf && l.produto_id && (existentes.some(e => e.cpf === l.cpf && e.produto_id === l.produto_id) || linhas.findIndex(x => x.cpf === l.cpf && x.produto_id === l.produto_id) !== i));
  function situacao(l, i) {
    if (l.resultado) return l.resultado.ok ? '<span class="tag ok">lançada</span>' : `<span class="tag bad">${esc(l.resultado.motivo)}</span>`;
    const p = pendencias(l, i);
    const dup = l.cpf && l.produto_id && existentes.find(e => e.cpf === l.cpf && e.produto_id === l.produto_id);
    const dupLista = l.cpf && l.produto_id && linhas.findIndex(x => x.cpf === l.cpf && x.produto_id === l.produto_id) !== i;
    const avisos = [];
    if (dup) avisos.push(`<span class="tag cinza">já lançada (${esc(dup.polo)}, ${dataBR(dup.data)})</span>`);
    if (dupLista) avisos.push('<span class="tag cinza">repetida na lista</span>');
    const pr = B.produtos.find(x => x.id === l.produto_id), v = parseValorBR(l.mensalidade);
    if (pr && v && ((pr.valor_min != null && v < pr.valor_min) || (pr.valor_max != null && v > pr.valor_max))) avisos.push('<span class="tag warn">valor fora da faixa</span>');
    if (l.produto_sugerido) avisos.push('<span class="tag warn">produto sugerido</span>');
    if (l.aviso_curso && !l.produto_id) avisos.push(`<span class="tag warn">${esc(l.aviso_curso)}</span>`);
    if (p.length) return `<span class="tag bad">falta: ${esc(p.join(', '))}</span> ${avisos.join(' ')}`;
    return (avisos.length ? avisos.join(' ') : '<span class="tag ok">pronta</span>');
  }
  function render() {
    linhas.forEach((l, i) => { if (!l.resultado && ehDup(l, i)) l.incluir = false; });
    const prontas = linhas.filter((l, i) => l.incluir && !l.resultado && !pendencias(l, i).length).length;
    const comPend = linhas.filter((l, i) => !l.resultado && pendencias(l, i).length).length;
    $('#wa-resultado').innerHTML = `<div class="card mt"><div class="card-cab"><h2>2. Confira e lance</h2>
      <span class="muted">${linhas.length} encontrada(s) · <b>${prontas}</b> pronta(s) para lançar · ${comPend} com pendência</span>
      <button class="btn prim" id="wa-lancar" ${prontas ? '' : 'disabled'}>Lançar ${prontas} matrícula(s)</button></div>
      <div class="corpo sem-pad"><table class="t importar"><thead><tr><th><input type="checkbox" id="wa-todas" title="Marcar/desmarcar todas"></th><th>Situação</th><th>Data</th><th>Polo</th><th>Tutor</th><th>Aluno / CPF</th><th>Curso → Produto</th><th>Origem</th><th class="num">Mensalidade</th></tr></thead><tbody>
      ${linhas.map((l, i) => {
        const tuts = B.tutores.filter(t => t.ativo || t.id === l.tutor_id);
        const po = B.polos.find(x => x.id === l.polo_id);
        const prods = B.produtos.filter(p => p.ativo && (!po || po.produtos.includes(p.id)));
        const pend = pendencias(l, i);
        const travada = !!(l.resultado && l.resultado.ok);
        return `<tr data-i="${i}" class="${travada ? 'feita' : pend.length ? 'pend' : ''}">
        <td><input type="checkbox" data-c="incluir" ${l.incluir && !travada ? 'checked' : ''} ${travada || ehDup(l, i) ? 'disabled' : ''}></td>
        <td class="situacao">${situacao(l, i)}</td>
        <td><input type="date" data-c="data" value="${esc(l.data || '')}"></td>
        <td><select data-c="polo_id" class="${l.polo_id ? '' : 'falta'}">${opcoes(B.polos.filter(p => p.ativo), l.polo_id)}</select>${l.polo_redirecionado ? '<div class="muted mini-info">Polo de destino identificado pelo curso. Confira.</div>' : ''}</td>
        <td><select data-c="tutor_id" class="${l.tutor_id ? '' : 'falta'}">${opcoes(tuts, l.tutor_id)}</select>${l.tutor_id ? `<div class="muted">Polo da meta do tutor</div><select data-c="tutor_polo_id" class="${l.tutor_polo_id ? '' : 'falta'}">${opcoes(B.polos.filter(p => (B.tutores.find(t => t.id === l.tutor_id)?.polos || []).includes(p.id)), l.tutor_polo_id)}</select>` : ''}</td>
        <td><input type="text" data-c="aluno" value="${esc(l.aluno || '')}" title="${esc(l.texto)}"><input type="text" data-c="cpf" class="${l.cpf && !cpfOk(l.cpf) ? 'falta' : ''}" value="${esc(l.cpf ? mascararCpf(l.cpf) : '')}" placeholder="CPF"></td>
        <td><div class="muted curso-txt">${esc(l.curso || '—')}${l.curso_novo ? ' <span class="tag cinza">curso novo</span>' : ''}</div>
          <select data-c="produto_id" class="${l.produto_id ? (l.produto_sugerido ? 'sugerido' : '') : 'falta'}"><option value="">Selecione…</option>${prods.map(p => `<option value="${p.id}" ${p.id === l.produto_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
          ${l.curso_novo && l.curso ? `<label class="check mini-check"><input type="checkbox" data-c="lembrar" ${l.lembrar ? 'checked' : ''}> lembrar "${esc(l.curso)}"</label>` : ''}</td>
        <td><div class="muted curso-txt">${esc(l.origem || '—')}</div><select data-c="origem_id" class="${l.origem_id ? '' : 'falta'}">${opcoes(B.origens.filter(o => o.ativo), l.origem_id)}</select>
          ${l.origem_ambigua ? '<div class="mini-info">Mais de uma origem identificada. Selecione a correta.</div>' : ''}
          ${l.origem_nova && l.origem ? `<label class="check mini-check"><input type="checkbox" data-c="lembrar_origem" ${l.lembrar_origem ? 'checked' : ''}> lembrar "${esc(l.origem)}"</label>` : ''}</td>
        <td class="num"><input type="text" data-c="mensalidade" class="qtd ${parseValorBR(l.mensalidade) > 0 ? '' : 'falta'}" style="width:96px" value="${l.mensalidade !== '' && l.mensalidade != null ? String(Number(parseValorBR(l.mensalidade)).toFixed(2)).replace('.', ',') : ''}">
          <div class="muted mini-info">${l.valor_primeira != null ? `1ª ${brl(l.valor_primeira)}` : ''}${l.bolsa ? ` · bolsa ${esc(l.bolsa)}` : ''}${l.cupom ? ` · ${esc(l.cupom)}` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="nota">Passe o mouse sobre o nome do aluno para ver a mensagem original. Linhas já lançadas no processo vêm desmarcadas. Os ajustes feitos aqui valem só para esta importação — para o sistema reconhecer sozinho da próxima vez, use "lembrar" no curso ou cadastre apelidos em Configuração (polos, tutores, origens, cursos).</div></div>`;

    $$('#wa-resultado tr[data-i]').forEach(tr => {
      const l = linhas[Number(tr.dataset.i)];
      $$('[data-c]', tr).forEach(el => {
        el.onchange = () => {
          const k = el.dataset.c;
          if (el.type === 'checkbox') l[k] = el.checked;
          else if (['polo_id', 'tutor_id', 'tutor_polo_id', 'produto_id', 'origem_id'].includes(k)) {
            l[k] = Number(el.value) || null;
            if (k === 'polo_id') l.polo_redirecionado = false;
            if (k === 'tutor_id') { const t = B.tutores.find(x => x.id === l.tutor_id); l.tutor_polo_id = t?.polo_origem_id || (t && t.polos.length===1 ? t.polos[0] : null); }
            if (k === 'produto_id') { l.produto_sugerido = false; l.produto_manual = true; }
            if (k === 'polo_id' && !l.produto_manual && (l.curso || l.tipo_curso)) { const cl = LeitorWhatsApp.classificarCurso(l, l.polo_id, B); l.produto_id = cl.produto_id || null; l.produto_sugerido = !!cl.sugerido; l.aviso_curso = cl.aviso_curso; l.curso_novo = !!(l.curso && !cl.curso_conhecido); }
          }
          else if (k === 'cpf') l.cpf = el.value.replace(/\D/g, '').slice(0, 11);
          else l[k] = el.value;
          render();
        };
      });
    });
    $('#wa-todas').onchange = (e) => { linhas.forEach(l => { if (!l.resultado || !l.resultado.ok) l.incluir = e.target.checked; }); render(); };
    $('#wa-lancar').onclick = lancar;
  }

  async function lancar() {
    const sel = linhas.map((l, i) => ({ l, i })).filter(({ l, i }) => l.incluir && !(l.resultado && l.resultado.ok) && !pendencias(l, i).length && !ehDup(l, i));
    if (!sel.length) return;
    $('#wa-lancar').disabled = true;
    try {
      // cursos novos marcados como "lembrar"
      const novos = new Map();
      for (const { l } of sel) if (l.curso_novo && l.lembrar && l.curso && l.produto_id) novos.set(LeitorWhatsApp.limpo(l.curso), { nome: l.curso.trim(), produto_id: l.produto_id });
      for (const cr of novos.values()) { try { await api('/api/cad/cursos', { method: 'POST', body: { ...cr, ativo: 1 } }); } catch (e) { /* já existe */ } }
      // origens escritas de outro jeito ("Já é aluna") viram apelido da origem escolhida
      const apel = new Map();
      for (const { l } of sel) if (l.origem_nova && l.lembrar_origem && l.origem && l.origem_id) apel.set(LeitorWhatsApp.limpo(l.origem), { tabela: 'origens', id: l.origem_id, apelido: l.origem.trim() });
      for (const a of apel.values()) { try { await api('/api/apelido', { method: 'POST', body: a }); } catch (e) { /* ignora */ } }
      const itens = sel.map(({ l }) => ({
        ciclo_id: ciclo.id, data: l.data || B.hoje, polo_id: l.polo_id, tutor_id: l.tutor_id, tutor_polo_id: l.tutor_polo_id, produto_id: l.produto_id, origem_id: l.origem_id,
        aluno: l.aluno, cpf: l.cpf, curso: l.curso, valor: parseValorBR(l.mensalidade), valor_primeira: l.valor_primeira, bolsa: l.bolsa, cupom: l.cupom,
        confirmar_faixa: true, importado: 'whatsapp',
      }));
      const r = await api('/api/matriculas/lote', { method: 'POST', body: { itens } });
      r.resultado.forEach(res => { sel[res.i].l.resultado = res; if (res.ok) sel[res.i].l.incluir = false; });
      const ok = r.resultado.filter(x => x.ok).length;
      toast(`${ok} matrícula(s) lançada(s)${ok < itens.length ? ` · ${itens.length - ok} não entraram (veja a coluna Situação)` : ''}`, ok < itens.length);
      await recarregarBootstrap();
      existentes = await api('/api/cpfs?ciclo=' + ciclo.id);
      render();
    } catch (e) { toast(e.message, true); $('#wa-lancar').disabled = false; }
  }
}

function mascararCpf(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function cpfOk(cpf) {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((s * 10) % 11) % 10 !== +c[t]) return false; }
  return true;
}

function modalMatricula(reg, depois) {
  const ultimo = ls.get('ultimo-lancamento', {});
  const v = reg ? { ...reg } : {
    data: B.hoje, ciclo_id: estado.ciclo, polo_id: estado.polo || ultimo.polo_id || '', tutor_id: ultimo.tutor_id || '',
    produto_id: '', origem_id: '', aluno: '', cpf: '', curso: '', valor: '', obs: '',
  };
  const exigeCpf = B.config.exigir_cpf === '1', exigeAluno = B.config.exigir_aluno === '1';
  const m = abrirModal(`
    <header><h3>${reg ? 'Editar matrícula' : 'Nova matrícula'}</h3><button class="btn icone" data-fechar aria-label="Fechar">✕</button></header>
    <form id="f-mat"><div class="corpo"><div id="mat-msg"></div><div class="form-grid">
      <label class="campo"><span>Data da matrícula *</span><input type="date" name="data" required></label>
      <label class="campo"><span>Processo *</span><select name="ciclo_id" required>${B.ciclos.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>Polo de destino da matrícula *</span><select name="polo_id" required><option value="">Selecione…</option>${B.polos.filter(p => p.ativo || p.id === v.polo_id).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>Tutor *</span><select name="tutor_id" required></select></label>
      <label class="campo inteiro"><span>Polo de crédito da tutora / do tutor *</span><select name="tutor_polo_id" required></select><small class="muted">Preenchido pela origem do tutor. O produto precisa ser ofertado pelo polo de destino.</small></label>${eAdmin()?'<div class="campo inteiro"><label class="check"><input type="checkbox" name="excecao_credito" value="1" id="mat-excecao"> Alterar crédito por exceção administrativa</label><input type="text" name="motivo_credito" id="mat-motivo-credito" minlength="5" maxlength="500" placeholder="Motivo da exceção (registrado no histórico)" hidden></div>':''}
      <label class="campo"><span>Produto *</span><select name="produto_id" required><option value="">Selecione…</option>${B.produtos.filter(p => p.ativo || p.id === v.produto_id).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>Origem *</span><select name="origem_id" required><option value="">Selecione…</option>${B.origens.filter(o => o.ativo || o.id === v.origem_id).map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>CPF do aluno${exigeCpf ? ' *' : ''}</span><input type="text" name="cpf" inputmode="numeric" placeholder="000.000.000-00" ${exigeCpf ? 'required' : ''}></label>
      <label class="campo"><span>Valor da mensalidade (R$) *</span><input type="text" name="valor" inputmode="decimal" placeholder="0,00" required></label>
      <label class="campo inteiro"><span>Nome do aluno${exigeAluno ? ' *' : ''}</span><input type="text" name="aluno" ${exigeAluno ? 'required' : ''}></label>
      <label class="campo inteiro"><span>Curso</span><input type="text" name="curso" list="lista-cursos" placeholder="Ex.: Pedagogia — ao escolher um curso cadastrado, o produto é preenchido"></label>
      <datalist id="lista-cursos">${B.cursos.filter(x => x.ativo).map(x => `<option value="${esc(x.nome)}">`).join('')}</datalist>
      <label class="campo"><span>Valor da 1ª (R$)</span><input type="text" name="valor_primeira" inputmode="decimal" placeholder="0,00"></label>
      <label class="campo"><span>Bolsa</span><input type="text" name="bolsa" placeholder="Ex.: 60+10"></label>
      <label class="campo"><span>Cupom</span><input type="text" name="cupom"></label>
      <label class="campo inteiro"><span>Observação</span><textarea name="obs" rows="2"></textarea></label>
    </div></div>
    <footer><button type="button" class="btn" data-fechar>Cancelar</button>
      ${reg ? '' : '<button type="submit" class="btn" data-outra="1">Salvar e lançar outra</button>'}
      <button type="submit" class="btn prim">Salvar</button></footer></form>`);
  const f = $('#f-mat', m);
  const todosProdutosHTML = f.produto_id.innerHTML;
  const preencherProdutos = () => {
    const polo = B.polos.find(p => p.id === Number(f.polo_id.value));
    const atual = f.produto_id.value || v.produto_id;
    f.produto_id.innerHTML = todosProdutosHTML;
    if (polo) $$('option[value]', f.produto_id).forEach(o => { if (o.value && !polo.produtos.includes(Number(o.value)) && Number(o.value) !== Number(reg && reg.polo_id === polo.id ? reg.produto_id : 0)) o.remove(); });
    $$('optgroup', f.produto_id).forEach(g => { if (!g.children.length) g.remove(); });
    if ($$('option', f.produto_id).some(o => o.value === String(atual))) f.produto_id.value = atual;
  };
  const preencherTutores = () => {
    const polo = Number(f.polo_id.value);
    const lista = B.tutores.filter(t => (t.ativo || t.id === v.tutor_id));
    const atual = f.tutor_id.value || v.tutor_id;
    f.tutor_id.innerHTML = `<option value="">${polo ? (lista.length ? 'Selecione…' : 'Nenhum tutor neste polo') : 'Escolha o polo primeiro'}</option>` + lista.map(t => `<option value="${t.id}">${esc(t.nome)}${t.polo_origem_id?' · '+esc(nomePor('polos',t.polo_origem_id)):''}</option>`).join('');
    if (lista.some(t => t.id === Number(atual))) f.tutor_id.value = atual;
    else if (lista.length === 1) f.tutor_id.value = lista[0].id;
  };
  const preencherCredito=()=>{
    const t=B.tutores.find(t=>t.id===Number(f.tutor_id.value)),origem=t?.polo_origem_id||(t?.polos.length===1?t.polos[0]:null);
    const salvo=reg&&reg.tutor_id===Number(f.tutor_id.value)?Number(reg.tutor_polo_id||reg.polo_id):null;
    f.tutor_polo_id.innerHTML='<option value="">Selecione a origem…</option>'+B.polos.filter(p=>t?.polos.includes(p.id)).map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    if(salvo&&!$$('option',f.tutor_polo_id).some(o=>Number(o.value)===Number(salvo))){const o=document.createElement('option');o.value=salvo;o.textContent='Crédito histórico: '+(nomePor('polos',salvo)||salvo);f.tutor_polo_id.appendChild(o);}
    f.tutor_polo_id.value=salvo||origem||'';
    f.tutor_polo_id.dataset.padrao=f.tutor_polo_id.value;
    const ex=$('#mat-excecao',m);if(ex)ex.checked=false;
    f.tutor_polo_id.disabled=!!(salvo||origem);if($('#mat-motivo-credito',m)){$('#mat-motivo-credito',m).hidden=true;$('#mat-motivo-credito',m).required=false;}

  };
  f.tutor_id.onchange=preencherCredito;
  if($('#mat-excecao',m))$('#mat-excecao',m).onchange=e=>{const ex=e.target.checked;f.tutor_polo_id.disabled=!ex&&!!f.tutor_polo_id.dataset.padrao;const campo=$('#mat-motivo-credito',m);campo.hidden=!ex;campo.required=ex;if(!ex)f.tutor_polo_id.value=f.tutor_polo_id.dataset.padrao;};
  f.data.value = v.data || B.hoje; f.ciclo_id.value = v.ciclo_id || estado.ciclo; f.polo_id.value = v.polo_id || '';
  preencherTutores();preencherCredito();
  f.produto_id.value = v.produto_id || ''; f.origem_id.value = v.origem_id || '';
  preencherProdutos();
  f.cpf.value = v.cpf ? mascararCpf(v.cpf) : ''; f.aluno.value = v.aluno || ''; f.curso.value = v.curso || ''; f.obs.value = v.obs || '';
  f.valor_primeira.value = v.valor_primeira != null && v.valor_primeira !== '' ? Number(v.valor_primeira).toFixed(2).replace('.', ',') : '';
  f.bolsa.value = v.bolsa || ''; f.cupom.value = v.cupom || '';
  f.curso.onchange = () => {
    if (!f.curso.value.trim()) return;
    const cl = LeitorWhatsApp.classificarCurso({ curso: f.curso.value }, Number(f.polo_id.value) || null, B);
    if (cl.produto_id && $$('option', f.produto_id).some(o => o.value === String(cl.produto_id))) f.produto_id.value = cl.produto_id;
    else f.produto_id.value = '';
    if (cl.aviso_curso) toast(cl.aviso_curso, true);
  };
  f.valor.value = v.valor !== '' && v.valor != null ? Number(v.valor).toFixed(2).replace('.', ',') : '';
  f.polo_id.onchange = () => { preencherTutores(); preencherCredito(); preencherProdutos(); if (f.curso.value.trim()) f.curso.onchange(); };
  f.cpf.oninput = () => { f.cpf.value = mascararCpf(f.cpf.value); f.cpf.setCustomValidity(''); };
  f.cpf.onblur = () => { if (f.cpf.value && !cpfOk(f.cpf.value)) f.cpf.setCustomValidity('CPF inválido'), f.cpf.reportValidity(); };
  setTimeout(() => (f.polo_id.value ? (f.tutor_id.value ? f.produto_id : f.tutor_id) : f.polo_id).focus(), 30);

  let outra = false;
  $$('[type=submit]', m).forEach(b => { b.onclick = () => { outra = !!b.dataset.outra; }; });
  async function enviar(flags = {}) {
    const corpo = Object.fromEntries(new FormData(f));
    corpo.excecao_credito=!!$('#mat-excecao',m)?.checked;
    corpo.confirmar_duplicada = !!flags.dup;
    corpo.confirmar_faixa = !!flags.faixa;
    try {
      const r = await api(reg ? '/api/matriculas/' + reg.id : '/api/matriculas', { method: reg ? 'PUT' : 'POST', body: corpo });
      if (r.fora_faixa) {
        const ff = r.fora_faixa;
        $('#mat-msg', m).innerHTML = `<div class="aviso">Mensalidade de <b>${brl(ff.valor)}</b> fora da faixa esperada para ${esc(ff.produto)} (${ff.min != null ? brl(ff.min) : '—'} a ${ff.max != null ? brl(ff.max) : '—'}). Confira se não houve erro de digitação. <button type="button" class="btn peq" id="b-faixa">O valor está certo</button></div>`;
        $('#b-faixa', m).onclick = () => enviar({ ...flags, faixa: true });
        f.valor.focus();
        return;
      }
      if (r.duplicada) {
        $('#mat-msg', m).innerHTML = `<div class="aviso">Já existe matrícula com este CPF e produto neste processo (${esc(r.duplicada.polo)}, ${dataBR(r.duplicada.data)}). <button type="button" class="btn peq" id="b-dup">Salvar mesmo assim</button></div>`;
        $('#b-dup', m).onclick = () => enviar({ ...flags, dup: true });
        return;
      }
      ls.set('ultimo-lancamento', { polo_id: Number(corpo.polo_id), tutor_id: Number(corpo.tutor_id) });
      toast(reg ? 'Matrícula atualizada' : 'Matrícula lançada');
      if (outra && !reg) {
        // mantém data, ciclo, polo, tutor, produto e origem; limpa dados do aluno
        ['cpf', 'aluno', 'curso', 'obs', 'valor'].forEach(k => { f[k].value = ''; });
        $('#mat-msg', m).innerHTML = '';
        f.cpf.focus();
        depois && depois();
        return;
      }
      fecharModal(); depois && depois();
    } catch (e) { $('#mat-msg', m).innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  f.onsubmit = (ev) => { ev.preventDefault(); enviar({}); };
}

// ======================================================================= MUNDO AZUL
async function telaMundoAzul(c, sub) {
  const abas = [['oficial', 'Mundo Azul — lista de alunos'], ['boas', 'Boas-vindas'], ['bi', 'Conferência com o BI']];
  sub = abas.some(a => a[0] === sub) ? sub : 'oficial';
  c.innerHTML = `<nav class="abas">${abas.map(([id, n]) => `<a href="#/mundo-azul/${id}" class="${id === sub ? 'ativo' : ''}">${n}</a>`).join('')}</nav><div id="conf"></div>`;
  return sub === 'bi' ? telaConferenciaBI($('#conf')) : sub === 'boas' ? telaBoasVindas($('#conf')) : telaConciliacaoMA($('#conf'));
}

// ======================================================================= CAMPANHAS DE INCENTIVO
const TIPOS_CAMPANHA = { meta: 'Meta única', escalonada: 'Escalonada', a_cada: 'A cada N matrículas', por_matricula: 'Valor por matrícula' };
function regraCampanha(c) {
  if (c.tipo === 'meta') return `${c.qtd} matrícula(s) = ${brl(c.valor)}`;
  if (c.tipo === 'escalonada') return `${c.qtd} matrícula(s) = ${brl(c.valor)} · a partir da ${c.qtd + 1}ª, +${brl(c.adicional)} cada`;
  if (c.tipo === 'a_cada') return `a cada ${c.qtd} matrícula(s) = ${brl(c.valor)}`;
  return `${brl(c.valor)} por matrícula`;
}
function produtosCampanha(c) {
  if (!c.produtos || !c.produtos.length) return 'todos os produtos';
  // mostra o nome da categoria quando todos os produtos dela estão incluídos
  const partes = [];
  for (const k of B.categorias) {
    const ps = B.produtos.filter(p => p.categoria_id === k.id);
    const dentro = ps.filter(p => c.produtos.includes(p.id));
    if (!dentro.length) continue;
    partes.push(dentro.length === ps.length && ps.length > 1 ? `${k.nome} (todos)` : dentro.map(p => p.nome).join(', '));
  }
  return partes.join(' · ');
}
function faltaCampanha(c, g) {
  if (c.tipo === 'por_matricula') return '<span class="muted">—</span>';
  if (c.tipo === 'meta') return g.valor ? '<span class="tag ok mini">bateu</span>' : `faltam <b>${g.falta}</b>`;
  if (c.tipo === 'escalonada') return g.valor ? `<span class="muted">próxima vale +${brl(c.adicional)}</span>` : `faltam <b>${g.falta}</b> p/ ${brl(c.valor)}`;
  return `faltam <b>${g.falta}</b> p/ +${brl(c.valor)}`;
}
function textoWhatsCampanha(c) {
  const medalha = ['🥇', '🥈', '🥉'];
  const agora = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const comMatr = c.ranking.filter(g => g.qtd);
  const quase = c.ranking.filter(g => !g.valor && g.qtd && g.falta <= 2 && c.tipo !== 'por_matricula');
  return [
    `🏆 *${c.nome}*`, `📅 ${dataBR(c.inicio)}${c.fim !== c.inicio ? ' a ' + dataBR(c.fim) : ''}`, `🎯 ${regraCampanha(c)}`, `📚 Vale para: ${produtosCampanha(c)}`, '',
    `*Parcial de ${agora}*`,
    ...(comMatr.length ? comMatr.map((g, i) => `${medalha[i] || '▫️'} ${g.nome}${c.beneficiario === 'tutor' ? ` (${g.polo})` : ''} — ${g.qtd} matr.${g.valor ? ` — *${brl(g.valor)}*` : ''}`) : ['Ainda sem matrículas — bora abrir o placar! 🚀']),
    ...(quase.length ? ['', '🔥 *Quase lá:* ' + quase.map(g => `${g.nome}${c.beneficiario === 'tutor' ? ' – ' + g.polo : ''} (falta ${g.falta})`).join(', ')] : []),
    '', `Total: ${c.total_matriculas} matrícula(s) · ${brl(c.total_premio)} em prêmios`,
  ].join('\n');
}
async function copiarTexto(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Copiado! É só colar no grupo do WhatsApp'); return; } catch { /* sem permissão (acesso pela rede) */ }
  const m = abrirModal(`<header><h3>Copiar para o WhatsApp</h3><button class="btn icone" data-fechar>✕</button></header>
    <div class="corpo"><p class="muted" style="margin-top:0">Selecione tudo (Ctrl+A) e copie (Ctrl+C):</p><textarea id="cp-txt" rows="14" style="font-family:var(--mono);font-size:12.5px">${esc(txt)}</textarea></div>
    <footer><button class="btn" data-fechar>Fechar</button></footer>`, 560);
  const t = $('#cp-txt', m); t.focus(); t.select(); try { document.execCommand('copy'); toast('Copiado!'); } catch { /* manual */ }
}

async function telaCampanhas(c) {
  const lista = await api('/api/campanhas');
  let aberta = ls.get('campanha-aberta', null);
  if (!lista.some(x => x.id === aberta)) aberta = (lista.find(x => x.situacao === 'andamento') || lista[0] || {}).id || null;
  const sitTag = { andamento: '<span class="tag ok">em andamento</span>', futura: '<span class="tag cinza">futura</span>', encerrada: '<span class="tag cinza">encerrada</span>' };
  function render() {
    const cp = lista.find(x => x.id === aberta);
    c.innerHTML = `
    <div class="linha-acoes" style="margin-bottom:14px">${podeLancar() ? '<button class="btn prim" id="cp-nova">+ Nova campanha</button>' : ''}
      <span class="muted">Contam as matrículas lançadas no período e nos produtos da campanha. CPF repetido no mesmo produto conta uma vez.</span></div>
    ${lista.length ? `<div class="campanhas">${lista.map(x => `<button class="campanha ${x.id === aberta ? 'ativa' : ''}" data-abrir="${x.id}">
        <div class="cp-topo"><b>${esc(x.nome)}</b>${sitTag[x.situacao]}</div>
        <div class="muted">${dataBR(x.inicio)}${x.fim !== x.inicio ? ' a ' + dataBR(x.fim) : ''} · ${esc(regraCampanha(x))}</div>
        <div class="cp-num"><span>${int(x.total_matriculas)} matr.</span><span>${x.ganhadores} premiado(s)</span><span><b>${brl(x.total_premio)}</b></span></div></button>`).join('')}</div>`
      : '<div class="card"><div class="vazio">Nenhuma campanha cadastrada. Crie a primeira em "+ Nova campanha".</div></div>'}
    ${cp ? `<div class="card mt"><div class="card-cab"><h2>${esc(cp.nome)}</h2>${sitTag[cp.situacao]}
        <button class="btn" id="cp-whats">Copiar para o WhatsApp</button><a class="btn" href="#/relatorio-campanha/${cp.id}" target="_blank" rel="noopener">Relatório / PDF</a>${podeLancar() ? '<button class="btn" id="cp-editar">Editar</button>' : ''}${eAdmin() ? '<button class="btn perigo" id="cp-excluir">Excluir</button>' : ''}</div>
      <div class="space-resumo">
        <div>Período<b>${dataBR(cp.inicio)}${cp.fim !== cp.inicio ? ' a ' + dataBR(cp.fim) : ''}</b></div>
        <div>Regra<b style="font-size:14px">${esc(regraCampanha(cp))}</b></div>
        <div>Matrículas válidas<b>${int(cp.total_matriculas)}</b></div><div>Premiados<b>${cp.ganhadores}</b></div><div>Total a pagar<b>${brl(cp.total_premio)}</b></div>
      </div>
      <div class="nota" style="border-top:0;border-bottom:1px solid var(--line)">Vale para: ${esc(produtosCampanha(cp))} · ${cp.polos.length ? cp.polos.map(id => esc(nomePor('polos', id))).join(', ') : 'todos os polos'} · prêmio por ${cp.beneficiario === 'polo' ? 'polo' : 'tutor'}${cp.obs ? ' · ' + esc(cp.obs) : ''}</div>
      <div class="corpo sem-pad"><table class="t"><thead><tr><th>#</th><th>${cp.beneficiario === 'polo' ? 'Polo' : 'Tutor'}</th>${cp.beneficiario === 'polo' ? '' : '<th>Polo</th>'}<th class="num">Matrículas</th><th class="num">Prêmio</th><th>Próxima faixa</th><th>Última</th></tr></thead><tbody>
        ${cp.ranking.map((g, i) => `<tr class="${g.valor ? 'premiado' : ''}"><td class="muted">${g.qtd ? i + 1 : '—'}</td><td><b>${esc(g.nome)}</b></td>${cp.beneficiario === 'polo' ? '' : `<td class="muted">${esc(g.polo)}</td>`}
          <td class="num"><b>${int(g.qtd)}</b></td><td class="num">${g.valor ? `<b class="pos">${brl(g.valor)}</b>` : '<span class="muted">R$ 0,00</span>'}</td><td>${faltaCampanha(cp, g)}</td><td class="muted">${g.ultima ? dataBR(g.ultima) : '—'}</td></tr>`).join('')}
        <tr class="total"><td></td><td>Total</td>${cp.beneficiario === 'polo' ? '' : '<td></td>'}<td class="num">${int(cp.total_matriculas)}</td><td class="num">${brl(cp.total_premio)}</td><td></td><td></td></tr>
      </tbody></table></div></div>` : ''}`;
    $$('[data-abrir]', c).forEach(b => { b.onclick = () => { aberta = Number(b.dataset.abrir); ls.set('campanha-aberta', aberta); render(); }; });
    if ($('#cp-nova')) $('#cp-nova').onclick = () => modalCampanha(null, () => telaCampanhas(c));
    if (cp) {
      $('#cp-whats').onclick = () => copiarTexto(textoWhatsCampanha(cp));
      if ($('#cp-editar')) $('#cp-editar').onclick = () => modalCampanha(cp, () => telaCampanhas(c));
      if ($('#cp-excluir')) $('#cp-excluir').onclick = async () => { if (!await confirmar('Excluir campanha', `Excluir a campanha "${esc(cp.nome)}"? As matrículas não são afetadas.`, 'Excluir')) return; await api('/api/campanhas/' + cp.id, { method: 'DELETE' }); telaCampanhas(c); };
    }
  }
  render();
}


async function telaRelatorioTutor(tutor, partes) {
  const [polo, ciclo, data, ref] = partes;
  const app = $('#app');
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Relatório semanal do tutor</b><button class="btn prim" onclick="window.print()">Imprimir / Salvar PDF</button><span class="muted">Na impressão, escolha “Salvar como PDF” e desative cabeçalhos e rodapés do navegador.</span></div><div class="rel" id="tutor-rel"><div class="carregando">Montando relatório…</div></div>`;
  try {
    const sem = await api('/api/ritmo-semanal?' + qs({ ciclo, polo, semana: data, ref,historico:'1' }));
    const t = sem.tutores.find(x => x.tutor_id === Number(tutor) && x.polo_id === Number(polo));
    if (!t) throw new Error('Tutor não encontrado neste polo ou sem permissão de acesso.');
    const meta = t.meta == null ? null : t.meta;
    const ate = sem.fim < sem.hoje ? sem.fim : sem.hoje;
    const matriculas = [];
    let pagina = 1, totalConsulta = 0;
    if (ate >= sem.inicio) do {
      const dados = await api('/api/matriculas?' + qs({ ciclo, polo, tutor, credito_tutor: 1, de: sem.inicio, ate, limite: 500, pagina }));
      totalConsulta = dados.total;
      matriculas.push(...dados.linhas);
      if (!dados.linhas.length) break;
      pagina++;
    } while (matriculas.length < totalConsulta);
    if (matriculas.length !== totalConsulta) throw new Error('Não foi possível carregar todas as matrículas. Atualize o relatório.');
    const produtos = new Map();
    for (const m of matriculas) { const chave = m.produto_id; const anterior = produtos.get(chave) || { nome: m.produto, quantidade: 0, matriculas: [] }; anterior.quantidade++; anterior.matriculas.push(m); produtos.set(chave, anterior); }
    const porProduto = [...produtos.values()].sort((a,b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome));
    document.title = `Relatório semanal — ${t.nome}`;
    $('#tutor-rel').innerHTML = `<section class="rel-pagina rel-tutor">${timbreRelatorio('Relatório semanal do tutor', `${t.nome} · ${t.polo} · ${nomePor('ciclos', ciclo)}`, `${dataBR(sem.inicio)} a ${dataBR(sem.fim)}`)}
      <div class="rp-resumo"><h2>Resumo da semana</h2><div class="rel-kpis"><div><span>Esperado até a consulta</span><b>${t.metas_dias ? int(sem.datas.filter(dt=>dt<=sem.hoje).reduce((a,dt)=>a+(t.metas_dias[dt]||0),0)) : '—'}</b><em>Somatório das metas diárias cadastradas</em></div><div><span>SAVE/GAP da semana na data</span><b>${t.metas_dias ? saveGap(t.total-sem.datas.filter(dt=>dt<=sem.hoje).reduce((a,dt)=>a+(t.metas_dias[dt]||0),0)) : '—'}</b><em>${t.metas_dias ? 'Comparação até a data consultada' : 'Sem distribuição diária cadastrada'}</em></div><div><span>Data de posição</span><b>${dataBR(sem.hoje)}</b><em>Recorte semanal; não corresponde ao processo inteiro nem a um Space</em></div></div></div>
      <div class="rt-kpis"><div><span>Realizado</span><strong>${int(t.total)}</strong><small>matrículas</small></div><div><span>Meta semanal</span><strong>${meta == null ? '—' : int(meta)}</strong><small>${meta == null ? 'não cadastrada' : 'matrículas'}</small></div><div><span>Faltam</span><strong>${meta == null ? '—' : int(Math.max(0, meta-t.total))}</strong><small>para a meta</small></div><div><span>Atingimento</span><strong>${meta == null || meta === 0 ? '—' : pctTxt(pct(t.total,meta))}</strong><small>da meta semanal</small></div></div>
      <div class="rt-section"><div class="rt-heading"><h2>Ritmo da semana</h2><span>Realizado e meta por dia</span></div>
      <table class="t rt-table"><thead><tr><th>Dia</th><th>Data</th><th class="num">Realizado</th><th class="num">Meta</th><th class="num">Diferença</th></tr></thead><tbody>${sem.datas.map((dt,i) => `<tr><td>${NOME_DIA_LONGO[diaDaSemana(dt)]}</td><td>${dataBR(dt)}</td><td class="num">${dt > sem.hoje ? '—' : int(t.dias[dt] || 0)}</td><td class="num">${t.metas_dias ? int(t.metas_dias[dt]) : '—'}</td><td class="num">${t.metas_dias && dt <= sem.hoje ? ((t.dias[dt] || 0) - t.metas_dias[dt] >= 0 ? '+' : '') + int((t.dias[dt] || 0) - t.metas_dias[dt]) : '—'}</td></tr>`).join('')}<tr class="total"><td>Total</td><td></td><td class="num">${int(t.total)}</td><td class="num">${meta == null ? '—' : int(meta)}</td><td></td></tr></tbody></table></div>
      <div class="rt-section"><div class="rt-heading"><h2>Matrículas por produto</h2><span>${int(matriculas.length)} matrícula(s) na semana</span></div>
      ${porProduto.length ? porProduto.map(grupo => `<div class="rt-produto"><div class="rt-produto-titulo"><strong>${esc(grupo.nome)}</strong><span>${int(grupo.quantidade)} matrícula(s)</span></div><table class="t rt-table rt-detalhes"><thead><tr><th>Data</th><th>Aluno</th><th>Curso</th><th>Origem</th></tr></thead><tbody>${grupo.matriculas.map(m => `<tr><td>${dataBR(m.data)}</td><td>${esc(m.aluno || 'Não informado')}${idAluno(m)}</td><td>${esc(m.curso || '—')}</td><td>${esc(m.origem || '—')}</td></tr>`).join('')}</tbody></table></div>`).join('') : '<p class="muted">Nenhuma matrícula no período.</p>'}</div>
      ${matriculas.length !== t.total ? '<p class="aviso">Os dados mudaram durante a montagem do relatório. Atualize a página para conferir os totais.</p>' : ''}
      <footer class="rel-rodape">Datas futuras não são contabilizadas. A diferença diária é o realizado menos a meta do dia. As matrículas contam na meta do polo de referência do tutor, mesmo quando realizadas para outro polo.</footer></section>`;
  } catch (e) { $('#tutor-rel').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
}

// ======================================================================= PÁGINA DO TUTOR
async function telaTutor(c, poloId, partes) {
  let tutorId = Number((partes || [])[0]);
  if (poloTravado()) poloId = B.usuario.polo_id;
  poloId = Number(poloId) || Number(estado.polo) || (B.polos.find(p => p.ativo) || {}).id;
  const equipeIds = await api('/api/tutores-processo?'+qs({ciclo:estado.ciclo,polo:poloId,ref:posicaoAtual()}));
  if (!tutorId && equipeIds[0]) { location.replace(`#/tutor/${poloId}/${equipeIds[0].id}`); return; }
  $('#titulo').textContent = 'Tutor';
  const d = await api('/api/tutor?' + qs({ ciclo: estado.ciclo, polo: poloId, tutor: tutorId, ref: posicaoEscolhida }));
  const t = d.tutor, modo = d.modo;
  const situacao = situacaoVenda(t, d.ref);
  const prox = d.spaces.find(s => s.proximo);
  const semAtual = d.semanas.find(w => w.atual);
  const qtd = d.matriculas.length, valor = d.matriculas.reduce((a, m) => a + m.valor, 0);
  const pos = d.equipe.findIndex(x => x.tutor_id === t.tutor_id) + 1;
  const mediaEq = d.equipe.length ? d.equipe.reduce((a, x) => a + x.qtd, 0) / d.equipe.length : 0;
  const tkEq = (() => { const q = d.equipe.reduce((a, x) => a + x.qtd, 0); return q ? d.equipe.reduce((a, x) => a + x.valor, 0) / q : null; })();
  const melhor = [...d.serie].sort((a, b) => b.dia - a.dia)[0];
  const porProd = {}; const porOrig = {}; const porDow = [0, 0, 0, 0, 0, 0, 0];
  for (const m of d.matriculas) { (porProd[m.produto_id] ??= { nome: m.produto, n: 0, v: 0 }); porProd[m.produto_id].n++; porProd[m.produto_id].v += m.valor; porOrig[m.origem] = (porOrig[m.origem] || 0) + 1; porDow[diaDaSemana(m.data)]++; }
  const prodLista = d.produtos.map(p => ({ id: p.id, nome: p.nome, n: porProd[p.id]?.n || 0, v: porProd[p.id]?.v || 0 }));
  const kpi = (rot, val, ...subs) => `<div class="g-kpi"><span>${rot}</span><b>${val}</b>${subs.filter(Boolean).map(x => `<em>${x}</em>`).join('')}</div>`;
  // gráfico de evolução (realizado × esperado) + barras diárias
  const grafico = () => {
    const sr = d.serie; if (sr.length < 2) return `<div class="g-vazio-mini">${sr.length ? `Primeiro dia: realizado ${int(sr[0].realizado)}${sr[0].esperado != null ? ` · esperado ${int(sr[0].esperado)}` : ''}. A linha aparece a partir do 2º dia.` : 'Sem histórico ainda.'}</div>`;
    const max = Math.max(1, ...sr.map(x => Math.max(x.realizado, x.esperado || 0)));
    const pts = (k) => sr.map((x, i) => `${(i * 100 / (sr.length - 1)).toFixed(2)},${(92 - 84 * (x[k] || 0) / max).toFixed(2)}`).join(' ');
    return `<div class="g-graf"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Evolução do tutor">${t.esperado != null ? `<polyline points="${pts('esperado')}" fill="none" stroke="var(--text-3)" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}<polyline points="${pts('realizado')}" fill="none" stroke="var(--accent)" stroke-width="2.4" vector-effect="non-scaling-stroke"/></svg>
      <div class="g-graf-eixo"><span>${dataBR(sr[0].data)}</span><span><i class="g-l1"></i>realizado ${t.esperado != null ? '<i class="g-l2"></i>esperado' : ''}</span><span>${dataBR(sr[sr.length - 1].data)}</span></div></div>`;
  };
  const ult = d.serie.slice(-30), maxDia = Math.max(1, ...ult.map(x => x.dia));
  c.innerHTML = `
  <div class="filtros">
    <a class="btn" href="#/painel/resumo">‹ Painel</a>
    <label class="campo"><span>Polo</span><select id="tt-polo" ${poloTravado() ? 'disabled' : ''}>${B.polos.filter(p => p.ativo).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label class="campo"><span>Tutor / histórico</span><select id="tt-tutor">${equipeIds.map(x=>`<option value="${x.id}">${esc(x.nome)}${x.atual?'':' (histórico)'}</option>`).join('')}</select></label>
    <span class="espaco"></span>
    <a class="btn" href="#/relatorio-equipe/${poloId}/${tutorId}" target="_blank" rel="noopener">Relatório (PDF)</a>
    <button class="btn" id="tt-mats">Ver matrículas</button>
  </div>
  <div class="g-cab"><div><h2>${esc(t.nome)}${t.atual?'':' <span class="tag cinza mini">Histórico · '+esc(t.situacao.replace('_',' '))+'</span>'}</h2><p>${esc(d.polo)} · ${esc(cicloAtual().nome)} · posição em <b>${dataBR(d.ref)}</b></p></div>
    ${t.saldo != null ? `<div class="g-leitura ${t.saldo >= 0 ? 'ok' : 'bad'}">${t.saldo >= 0 ? 'No ritmo' : 'Abaixo do ritmo'} · ${saveGap(t.saldo)}</div>` : `<div class="g-leitura">${t.meta!=null?'Aguardando definição dos Spaces':'Sem meta do tutor'}</div>`}</div>
  <div class="info">As matrículas desta página contam para o crédito do tutor no polo selecionado, inclusive quando o curso é ofertado por outro polo. O destino da matrícula aparece no detalhamento.</div>
  <div class="g-kpis tt-kpis">
    ${kpi('No processo', `${int(t.qtd)}${t.meta != null ? `<small> / ${dec1(t.meta).replace(',0', '')}</small>` : ''}`, t.meta != null ? `${barra(t.qtd, t.meta, t.esperado != null ? t.esperado / t.meta * 100 : null)}` : '', t.meta != null ? `${pctTxt(pct(t.qtd, t.meta))} da meta${t.meta_origem === 'dividida' ? ' (meta do polo ÷ equipe)' : ''}` : 'sem meta — cadastre em Metas e Spaces › Meta por tutor')}
    ${kpi(`SAVE / GAP em ${dataBR(d.ref).slice(0, 5)}`, t.saldo != null ? saveGap(t.saldo) : '—', t.esperado != null ? `esperado até a data: ${int(t.esperado)}` : '')}
    ${kpi(prox ? `Até o ${esc(prox.nome)} · ${dataBR(prox.data).slice(0, 5)}` : 'Próximo Space', prox && prox.esperado != null ? (prox.falta ? `faltam ${int(prox.falta)}` : '<span class="pos">✓</span>') : '—', prox && prox.falta ? `precisa <strong>${precisaTxt(prox.por_dia, modo)}</strong> · ${prox.dias} dias` : prox && prox.esperado != null ? `esperado ${int(prox.esperado)}` : '')}
    ${kpi(semAtual ? `Semana ${dataBR(semAtual.inicio).slice(0, 5)}–${dataBR(semAtual.fim).slice(0, 5)}` : 'Semana', semAtual ? `${int(semAtual.realizado)}${semAtual.meta != null ? `<small> / ${int(semAtual.meta)}</small>` : ''}` : '—', semAtual && semAtual.meta != null ? `faltam ${int(Math.max(0, semAtual.meta - semAtual.realizado))} para a meta da semana` : 'sem meta semanal')}
    ${kpi('Ticket médio · RPV', qtd ? brl(valor / qtd) : '—', `RPV ${brl(valor)}`, tkEq != null && qtd ? `equipe: ${brl(tkEq)}` : '')}
    ${kpi('Dias sem vender', `<span class="tag ${situacao.classe}">${situacao.texto}</span>`, situacao.detalhe, `dias corridos · posição em ${dataBR(d.ref)}`)}
    ${kpi('Ranking no polo', pos ? `${pos}º <small>de ${d.equipe.length}</small>` : '—', `média da equipe: ${dec1(mediaEq)}`)}
  </div>
  <div class="g-duas mt">
    <div class="card"><div class="card-cab"><h2>Evolução no processo</h2><span class="muted">acumulado${t.meta != null ? ' × esperado' : ''}</span></div><div class="corpo">${grafico()}</div></div>
    <div class="card"><div class="card-cab"><h2>Matrículas por dia</h2><span class="muted">últimos ${ult.length} dias${melhor && melhor.dia ? ` · melhor dia: ${dataBR(melhor.data).slice(0, 5)} (${melhor.dia})` : ''}</span></div><div class="corpo">
      <div class="tt-barras">${ult.map(x => `<div class="tt-b ${diaDaSemana(x.data) === 0 ? 'fds' : ''}" title="${dataBR(x.data)}: ${x.dia}"><i style="height:${Math.max(x.dia ? 6 : 1, x.dia / maxDia * 100)}%"></i><small>${x.dia || ''}</small></div>`).join('')}</div>
      <div class="g-graf-eixo"><span>${ult[0] ? dataBR(ult[0].data).slice(0, 5) : ''}</span><span>por dia da semana: ${[2, 3, 4, 5, 6, 1, 0].map(i => `${NOME_DIA[i]} ${porDow[i]}`).join(' · ')}</span><span>${ult.length ? dataBR(ult[ult.length - 1].data).slice(0, 5) : ''}</span></div></div></div>
  </div>
  <div class="g-duas mt">
    <div class="card"><div class="card-cab"><h2>Spaces</h2><span class="muted">meta do tutor × % de cada Space</span></div><div class="corpo sem-pad"><table class="t"><thead><tr><th>Space</th><th>Data</th><th class="num">Esperado</th><th class="num">Realizado</th><th>Situação</th></tr></thead><tbody>
      ${d.spaces.map(sp => `<tr class="${sp.proximo ? 'tt-prox' : ''}"><td>${esc(sp.nome)}</td><td>${dataBR(sp.data)}</td><td class="num">${sp.esperado != null ? int(sp.esperado) : '—'}</td><td class="num"><b>${int(sp.realizado)}</b></td>
        <td>${sp.esperado == null ? '<span class="muted">sem meta</span>' : sp.passado ? saveGap(sp.saldo) : sp.falta ? `${sp.proximo ? '<b>próximo</b> · ' : ''}faltam ${int(sp.falta)} · ${precisaTxt(sp.por_dia, modo)}` : '<span class="pos">✓ alcançado</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Sem Spaces cadastrados.</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-cab"><h2>Semana a semana</h2><span class="muted">${NOME_DIA_LONGO[inicioSemanaCfg()].toLowerCase()} a ${NOME_DIA_LONGO[(inicioSemanaCfg() + 6) % 7].toLowerCase()} · <a href="#/painel/equipe">cadastrar meta semanal</a></span></div><div class="corpo sem-pad"><table class="t"><thead><tr><th>Semana</th><th class="num">Meta</th><th class="num">Realizado</th><th>Atingido</th><th class="num">RPV</th></tr></thead><tbody>
      ${[...d.semanas].reverse().map(w => `<tr class="${w.atual ? 'tt-prox' : ''}"><td>${dataBR(w.inicio).slice(0, 5)} a ${dataBR(w.fim).slice(0, 5)}${w.atual ? ' <span class="tag cinza mini">atual</span>' : ''}</td><td class="num">${w.meta != null ? int(w.meta) : '<span class="muted">—</span>'}</td><td class="num"><b>${int(w.realizado)}</b></td><td>${w.meta ? miniBarra(w.realizado, w.meta) : '<span class="muted">—</span>'}</td><td class="num">${brl(w.valor)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>
  <div class="g-duas mt">
    <div class="card"><div class="card-cab"><h2>Por produto</h2><span class="muted">${int(qtd)} matrícula(s)</span></div><div class="corpo sem-pad">${prodLista.length ? `<table class="t"><thead><tr><th>Produto</th><th class="num">Matrículas</th><th class="num">Part.</th><th class="num">Ticket</th><th class="num">RPV</th></tr></thead><tbody>
      ${prodLista.map(p => `<tr><td>${esc(nomeP(p.id, p.nome))}</td><td class="num"><b>${int(p.n)}</b></td><td class="num">${pctTxt(pct(p.n, qtd))}</td><td class="num">${p.n ? brl(p.v / p.n) : '—'}</td><td class="num">${brl(p.v)}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhuma matrícula ainda.</div>'}</div></div>
    <div class="card"><div class="card-cab"><h2>Origens</h2><span class="muted">de onde vieram os alunos</span></div><div class="corpo">${Object.keys(porOrig).length ? Object.entries(porOrig).sort((a, b) => b[1] - a[1]).map(([o, n]) => `<div class="hbar"><div class="nome" title="${esc(o)}">${esc(o)}</div>${barra(n, Math.max(...Object.values(porOrig))).replace('class="barra ok"', 'class="barra neutra"')}<div class="v">${int(n)} <small>${pctTxt(pct(n, qtd))}</small></div></div>`).join('') : '<div class="vazio">Nenhuma matrícula ainda.</div>'}</div></div>
  </div>
  <div class="card mt"><div class="card-cab"><h2>Comparação com a equipe — ${esc(d.polo)}</h2><span class="muted">matrículas no processo</span></div><div class="corpo">
    ${d.equipe.map(x => `<div class="hbar ${x.tutor_id === t.tutor_id ? 'tt-eu' : ''}"><div class="nome">${!B.usuario?.tutor_id || Number(B.usuario.tutor_id) === Number(x.tutor_id) ? `<a href="#/tutor/${poloId}/${x.tutor_id}">${esc(x.nome)}</a>` : esc(x.nome)}</div>${barra(x.qtd, Math.max(1, ...d.equipe.map(y => y.qtd)))}<div class="v">${int(x.qtd)}${x.meta != null ? ` <small>/ ${dec1(x.meta).replace(',0', '')}</small>` : ''} ${x.saldo != null ? saveGap(x.saldo) : ''}</div></div>`).join('')}</div></div>
  <div class="card mt"><div class="card-cab"><h2>Matrículas</h2><input type="search" id="tt-busca" placeholder="Buscar aluno, curso, produto…" style="max-width:280px"><span class="muted" id="tt-cont">${int(qtd)} no processo</span></div>
    <div class="corpo sem-pad"><table class="t"><thead><tr><th>Data</th><th>Aluno</th><th>Polo de destino</th><th>Produto</th><th>Curso</th><th>Origem</th><th class="num">Mensalidade</th><th>Bolsa</th></tr></thead><tbody id="tt-lista"></tbody></table></div></div>`;
  $('#tt-polo').value = poloId; $('#tt-tutor').value = tutorId;
  $('#tt-polo').onchange = (e) => { location.hash = `#/tutor/${e.target.value}/0`; };
  $('#tt-tutor').onchange = (e) => { location.hash = `#/tutor/${poloId}/${e.target.value}`; };
  $('#tt-mats').onclick = () => { ls.set('mat-filtro', { busca: '', tutor: String(tutorId), produto: '', origem: '', de: '', ate: '',credito_tutor:1 }); estado.polo = poloId; ls.set('polo', poloId); location.hash = '#/matriculas'; };
  const lista = [...d.matriculas].reverse();
  const desenhar = () => {
    const b = limpoTxt($('#tt-busca').value);
    const vis = b ? lista.filter(m => limpoTxt(`${m.aluno} ${m.curso} ${m.produto} ${m.origem}`).includes(b)) : lista;
    $('#tt-cont').textContent = `${int(vis.length)} de ${int(lista.length)}`;
    $('#tt-lista').innerHTML = vis.map(m => `<tr><td>${dataBR(m.data)}</td><td>${esc(m.aluno || '—')}${idAluno(m)}</td><td>${esc(m.polo)}</td><td>${esc(m.produto)}</td><td class="muted">${esc(m.curso || '—')}</td><td>${esc(m.origem)}</td><td class="num">${brl(m.valor)}</td><td class="muted">${esc(m.bolsa || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma matrícula.</td></tr>';
  };
  $('#tt-busca').oninput = desenhar; desenhar();
}

// ======================================================================= RELATÓRIO DE METAS (geral e por polo)
// Relatório acumulado por produto, Space e polo, usando o motor oficial de metas.
async function telaCentralRelatorios(c) { return centralRelatoriosV27(c); }

// Consolidação por polo preserva os arredondamentos oficiais de cada unidade.
function dadosVisaoSpace(ritmos, produtos, spaceId) {
  const soma=xs=>({meta:xs.reduce((n,x)=>n+x.meta,0),meta_space:xs.reduce((n,x)=>n+x.meta_space,0),realizado:xs.reduce((n,x)=>n+x.realizado,0),esperado:somarConhecido(xs,'esperado'),por_dia:xs.some(x=>x.meta_space>x.realizado&&x.por_dia==null)?null:xs.reduce((n,x)=>n+(x.por_dia||0),0)});
  const linhas=produtos.filter(p=>!p.meta_ate).map(p=>{
    const polos=ritmos.map(({polo,r})=>{
      const sp=r.spaces.find(x=>String(x.id)===String(spaceId));
      const x=sp?.linhas.flatMap(l=>l.produtos||[]).find(x=>x.produto_id===p.id);
      const hoje=r.hoje_situacao.linhas.flatMap(l=>l.produtos||[]).find(x=>x.produto_id===p.id);
      return {nome:polo.nome,meta:x?.meta||0,meta_space:x?.esperado||0,realizado:x?.realizado||0,esperado:hoje?.esperado??(x?.meta?null:0),por_dia:x?.por_dia??null};
    });
    return {nome:p.nome,id:p.id,polos,...soma(polos)};
  }).filter(x=>x.meta||x.realizado);
  return {linhas,total:soma(linhas)};
}

// ======================================================================= ORIGENS POR POLO
async function telaRelatorioOrigens() {
  const app = $('#app'), ciclo = cicloAtual(), travado = poloTravado(), ref = posicaoAtual();
  const salvo = ls.get('rel-origens', {});
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Origens por polo</b>
    <label>De <input type="date" id="or-de"></label><label>Até <input type="date" id="or-ate" max="${ref}" value="${ref}"></label>
    <label>Produto <select id="or-prod"><option value="">Todos os produtos</option>${B.produtos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <button class="btn prim" id="or-gerar">Gerar relatório</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="or-conteudo" class="rel"></div>`;
  $('#or-de').value = salvo.de || ciclo.data_inicio || ''; $('#or-prod').value = salvo.produto || '';
  let geracao = 0;
  async function gerar() {
    const v = ++geracao, box = $('#or-conteudo'), de = $('#or-de').value, ate = $('#or-ate').value, produto = $('#or-prod').value;
    ls.set('rel-origens', { de, produto });
    box.innerHTML = '<div class="carregando">Montando…</div>';
    try {
      const d = await api('/api/origens-polo?' + qs({ ciclo: ciclo.id, de, ate, ref, produto, sede: ls.get('painel-sede', true) ? '1' : '0' }));
      if (v !== geracao) return;
      const n = (o, p) => (d.linhas.find(l => l.origem_id === o && l.polo_id === p) || {}).n || 0;
      const val = (o, p) => (d.linhas.find(l => l.origem_id === o && l.polo_id === p) || {}).valor || 0;
      const totP = (p) => d.linhas.filter(l => l.polo_id === p).reduce((a, l) => a + l.n, 0);
      const totO = (o) => d.linhas.filter(l => l.origem_id === o).reduce((a, l) => a + l.n, 0);
      const valO = (o) => d.linhas.filter(l => l.origem_id === o).reduce((a, l) => a + l.valor, 0);
      const T = d.linhas.reduce((a, l) => a + l.n, 0), TV = d.linhas.reduce((a, l) => a + l.valor, 0);
      const os = d.origens.filter(o => totO(o.id)).sort((a, b) => totO(b.id) - totO(a.id)), semVenda = d.origens.filter(o => !totO(o.id));
      const ps = d.polos, umPolo = ps.length === 1;
      const pc = (a, b) => b ? pctTxt(a / b * 100) : '—';
      const sedeT = Object.values(d.sede).reduce((a, x) => a + x, 0);
      const card = (t, vv, sub = '') => `<div><span>${esc(t)}</span><b>${vv}</b><em>${esc(sub)}</em></div>`;
      const top = os[0];
      // quadro 1: quantidade e % do polo
      const q1 = `<div class="dd-rol"><table class="t or-t"><thead><tr><th>Origem</th>${ps.map(p => `<th class="num">${esc(p.nome)}</th>`).join('')}<th class="num">Total</th><th class="num">% da rede</th></tr></thead><tbody>
        ${os.map(o => `<tr><td>${esc(o.nome)}</td>${ps.map(p => { const x = n(o.id, p.id); return `<td class="num">${x ? `<b>${int(x)}</b><br><small class="muted">${pc(x, totP(p.id))}</small>` : '<span class="muted">—</span>'}</td>`; }).join('')}<td class="num"><b>${int(totO(o.id))}</b></td><td class="num">${pc(totO(o.id), T)}</td></tr>`).join('')}
        <tr class="total"><td>Total lançadas</td>${ps.map(p => `<td class="num">${int(totP(p.id))}</td>`).join('')}<td class="num">${int(T)}</td><td class="num">100%</td></tr>
        ${sedeT ? `<tr class="sub"><td>Sede/Digital <small class="muted">(sem origem)</small></td>${ps.map(p => `<td class="num">${d.sede[p.id] ? int(d.sede[p.id]) : '<span class="muted">—</span>'}</td>`).join('')}<td class="num">${int(sedeT)}</td><td></td></tr>` : ''}
        </tbody></table></div>`;
      // quadro 2: principal origem de cada polo + ticket
      const q2 = `<table class="t"><thead><tr><th>Polo</th><th class="num">Lançadas</th><th>1ª origem</th><th>2ª origem</th><th>3ª origem</th><th class="num">Origens usadas</th></tr></thead><tbody>
        ${ps.map(p => { const r = os.map(o => ({ o, x: n(o.id, p.id) })).filter(x => x.x).sort((a, b) => b.x - a.x); const c = (i) => r[i] ? `${esc(r[i].o.nome)} <small class="muted">${int(r[i].x)} · ${pc(r[i].x, totP(p.id))}</small>` : '<span class="muted">—</span>'; return `<tr><td>${esc(p.nome)}</td><td class="num">${int(totP(p.id))}</td><td>${c(0)}</td><td>${c(1)}</td><td>${c(2)}</td><td class="num">${int(r.length)}</td></tr>`; }).join('')}</tbody></table>`;
      const q3 = `<table class="t"><thead><tr><th>Origem</th><th class="num">Matrículas</th><th class="num">Participação</th><th class="num">Ticket médio</th><th class="num">RPV</th><th class="num">Polos com venda</th></tr></thead><tbody>
        ${os.map(o => `<tr><td>${esc(o.nome)}</td><td class="num">${int(totO(o.id))}</td><td class="num">${pc(totO(o.id), T)}</td><td class="num">${brl(valO(o.id) / totO(o.id))}</td><td class="num">${brl(valO(o.id))}</td><td class="num">${int(ps.filter(p => n(o.id, p.id)).length)} de ${ps.length}</td></tr>`).join('')}
        <tr class="total"><td>Total</td><td class="num">${int(T)}</td><td class="num">100%</td><td class="num">${T ? brl(TV / T) : '—'}</td><td class="num">${brl(TV)}</td><td></td></tr></tbody></table>`;
      box.innerHTML = `<style>.rel .or-t th,.rel .or-t td{font-size:12px;padding:6px 5px}.rel .or-t td:first-child{min-width:140px}@media print{.rel .or-t th,.rel .or-t td{font-size:7.5pt;padding:3px}}</style><section class="rel-pagina">${timbreRelatorio('Origens por polo', `${ciclo.nome} · ${umPolo ? esc(ps[0].nome) : 'Rede — todos os polos'}${produto ? ' · ' + esc(nomePor('produtos', produto)) : ''}`, `${dataBR(d.de)} a ${dataBR(d.ate)}`)}
        <div class="rel-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">${card('Matrículas lançadas', int(T), 'com origem informada')}${card('Origem que mais vende', top ? esc(top.nome) : '—', top ? `${int(totO(top.id))} · ${pc(totO(top.id), T)}` : '')}${card('Origens com venda', `${int(os.length)} de ${int(d.origens.length)}`, semVenda.length ? 'sem venda: ' + semVenda.map(o => o.nome).slice(0, 4).join(', ') + (semVenda.length > 4 ? '…' : '') : 'todas venderam')}${card('Sede/Digital', int(sedeT), 'não tem origem — à parte')}</div>
        <h2>Origem × polo</h2><p class="rp-nota" style="margin-top:0">Em cada polo: quantidade e, embaixo, quanto essa origem representa das matrículas do polo.</p>${q1}
        ${umPolo ? '' : `<h2>Principais origens de cada polo</h2>${q2}`}
        <h2>Resumo por origem</h2>${q3}
        <footer class="rel-rodape">Matrículas lançadas pelos tutores, no polo do aluno, com data de ${dataBR(d.de)} a ${dataBR(d.ate)}${produto ? ', só do produto escolhido' : ''}. Ticket médio = mensalidade média; RPV = soma das mensalidades. A Sede/Digital (lista do Mundo Azul) não tem origem e aparece à parte, sem entrar nos percentuais.</footer></section>`;
      document.title = `Origens por polo — ${ciclo.nome}`;
    } catch (e) { if (v === geracao) box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  $('#or-gerar').onclick = gerar; await gerar();
}

// ======================================================================= DIA A DIA POR POLO
async function telaRelatorioDiario() {
  const app = $('#app'), ciclo = cicloAtual(), travado = poloTravado();
  const polos = B.polos.filter(p => p.ativo && (!travado || p.id === B.usuario.polo_id));
  const salvo = ls.get('rel-diario', {}), ref = posicaoAtual();
  const menos = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Dia a dia por polo</b>
    <label>Polo <select id="dd-polo" ${travado ? 'disabled' : ''}>${travado ? '' : '<option value="">Todos os polos</option>'}${polos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <span class="dd-sem"><button class="btn peq" id="dd-ant" title="Semana anterior">‹</button><label>Semana de <input type="date" id="dd-semana"></label><button class="btn peq" id="dd-prox" title="Próxima semana">›</button><button class="btn peq" id="dd-atual">Semana atual</button></span>
    <label><input type="checkbox" id="dd-livre"> Outro período</label><span id="dd-per" hidden><label>De <input type="date" id="dd-de"></label><label>Até <input type="date" id="dd-ate" max="${ref}"></label></span>
    <label><input type="checkbox" id="dd-tutores"> Uma página por polo com os tutores</label>
    <button class="btn prim" id="dd-gerar">Gerar relatório</button><button class="btn" id="dd-whats">Copiar resumo p/ WhatsApp</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="dd-conteudo" class="rel"></div>`;
  $('#dd-polo').value = travado ? B.usuario.polo_id : (polos.some(p => String(p.id) === String(salvo.polo)) ? salvo.polo : '');
  $('#dd-ate').value = ref; $('#dd-de').value = menos(ref, 13); $('#dd-semana').value = ref;
  $('#dd-livre').onchange = () => { $('#dd-per').hidden = !$('#dd-livre').checked; $$('.dd-sem button, #dd-semana').forEach(x => { x.disabled = $('#dd-livre').checked; }); gerar(); };
  $('#dd-tutores').checked = !!salvo.tutores;
  let geracao = 0, ultimo = null;
  const SEM = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'], SEMN = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const ddmm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  // ---- placar no formato do grupo do WhatsApp (por polo): "Graduação 6️⃣5️⃣ X 9️⃣0️⃣"
  const rotulos = () => { try { return JSON.parse(B.config.rotulos_whatsapp || '{}'); } catch { return {}; } };
  const rotulo = (pr) => { const r = rotulos(); return pr.produto_id in r ? r[pr.produto_id] : pr.nome.replace(/^(Semi|PowerTech)\s*-\s*/i, ''); };
  const tecla = (n) => String(Math.max(0, Math.round(n))).padStart(2, '0').split('').map(c => c + '️⃣').join('');
  const modeloCabecalho = () => B.config.cabecalho_placar_whatsapp || 'Meta {processo} - {space} - {data} - {dias restantes}';
  const textoPlacar = (p) => {
    const pl = p.placar; if (!pl) return `${p.polo}\nSem próximo Space cadastrado.`;
    const sab = pl.modo === 'seg-sab' || pl.sabados ? ` considerando ${pl.sabados === 1 ? 'o' : 'os'} ${String(pl.sabados).padStart(2, '0')} sábado${pl.sabados === 1 ? '' : 's'}` : '';
    const produtosAtivos = new Set(B.produtos.filter(x => Number(x.ativo) === 1).map(x => Number(x.id)));
    const linhas = pl.linhas.filter(x => produtosAtivos.has(Number(x.produto_id))).map(x => ({ ...x, r: rotulo(x) })).filter(x => x.r);
    const processo = String(cicloAtual().nome || '').replace(/^processo\s*/i, '').replace(/\//g, '-');
    const dataSpace = dataBR(pl.data);
    const diasRestantes = `${pl.dias} dias ${pl.modo === 'corridos' ? 'corridos' : 'úteis'}${sab}`;
    const cabecalho = modeloCabecalho().replace(/\{processo\}/gi, processo).replace(/\{space\}/gi, String(pl.space || 'Próximo Space'))
      .replace(/\{data\}/gi, dataSpace).replace(/\{dias restantes\}/gi, diasRestantes).replace(/\{polo\}/gi, p.polo).trim();
    return [`*${cabecalho}*`,
      ...linhas.map(x => `${x.r} ${tecla(x.realizado)} X ${tecla(x.meta)}`)].join('\n');
  };
  const areaPlacar = (P) => `<div class="dd-whats-area"><h2>Placar para o grupo (WhatsApp)</h2><p class="muted" style="font-size:12px;margin-top:0">Realizado × meta do próximo Space em cada produto (Pós: meta do prazo próprio). Inclui Sede/Digital. ${eAdmin() ? '<button class="btn peq" id="dd-cabecalho">Editar cabeçalho</button> <button class="btn peq" id="dd-rotulos">Editar nomes curtos</button>' : ''} <button class="btn peq" id="dd-copiar-todos">Copiar todos</button></p>
    <div class="dd-placar">${P.map(p => `<div class="card" style="padding:10px"><pre>${esc(textoPlacar(p))}</pre><button class="btn peq" data-copiar-placar="${p.polo_id}">Copiar ${esc(p.polo)}</button></div>`).join('')}</div></div>`;
  function ligarPlacar(d) {
    $$('[data-copiar-placar]').forEach(b => { b.onclick = () => copiarTexto(textoPlacar(d.polos.find(p => String(p.polo_id) === b.dataset.copiarPlacar))); });
    if ($('#dd-copiar-todos')) $('#dd-copiar-todos').onclick = () => copiarTexto(d.polos.map(textoPlacar).join('\n\n'));
    if ($('#dd-cabecalho')) $('#dd-cabecalho').onclick = () => {
      const atual = modeloCabecalho();
      const m = abrirModal(`<header><h3>Cabeçalho da mensagem do WhatsApp</h3><button class="btn icone" data-fechar aria-label="Fechar">✕</button></header><div class="corpo">
        <label class="campo"><span>Modelo do cabeçalho</span><input id="dd-cabecalho-txt" type="text" maxlength="160" value="${esc(atual)}"></label>
        <p class="muted">Campos disponíveis: <code>{processo}</code>, <code>{space}</code>, <code>{data}</code>, <code>{dias restantes}</code> e <code>{polo}</code>. Exemplo: <code>Meta {processo} - {space} - {data} - {dias restantes}</code>.</p>
      </div><footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="dd-cabecalho-salvar">Salvar cabeçalho</button></footer>`, 620);
      $('#dd-cabecalho-salvar', m).onclick = async () => {
        const valor = $('#dd-cabecalho-txt', m).value.trim();
        if (!valor) return toast('Informe um cabeçalho.', true);
        try { await api('/api/config', { method: 'PUT', body: { cabecalho_placar_whatsapp: valor } }); B.config.cabecalho_placar_whatsapp = valor; toast('Cabeçalho salvo'); fecharModal(); gerar(); }
        catch (e) { toast(e.message, true); }
      };
    };
    if ($('#dd-rotulos')) $('#dd-rotulos').onclick = () => {
      const r = rotulos(), prods = B.produtos.filter(p => p.ativo);
      const m = abrirModal(`<header><h3>Nomes curtos no placar</h3><button class="btn icone" data-fechar>✕</button></header><div class="corpo"><p class="muted" style="margin-top:0">Como cada produto aparece no texto do WhatsApp. Deixe vazio para não mostrar o produto.</p>
        <table class="t"><tbody>${prods.map(p => `<tr><td>${esc(p.nome)}</td><td><input type="text" data-rot="${p.id}" value="${esc(p.id in r ? r[p.id] : p.nome.replace(/^(Semi|PowerTech)\s*-\s*/i, ''))}"></td></tr>`).join('')}</tbody></table></div>
        <footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="rot-ok">Salvar</button></footer>`, 560);
      $('#rot-ok', m).onclick = async () => {
        const novo = Object.fromEntries($$('[data-rot]', m).map(i => [i.dataset.rot, i.value.trim()]));
        try { await api('/api/config', { method: 'PUT', body: { rotulos_whatsapp: JSON.stringify(novo) } }); B.config.rotulos_whatsapp = JSON.stringify(novo); toast('Nomes salvos'); fecharModal(); gerar(); } catch (e) { toast(e.message, true); }
      };
    };
  }
  const cor = (x) => !x.venda ? 'dd-folga' : x.meta == null || x.meta === 0 ? (x.total ? 'dd-ok' : '') : x.total >= x.meta ? 'dd-ok' : x.total ? 'dd-meio' : 'dd-bad';
  async function gerar() {
    const v = ++geracao, box = $('#dd-conteudo'), polo = travado ? String(B.usuario.polo_id) : $('#dd-polo').value, livre = $('#dd-livre').checked, de = livre ? $('#dd-de').value : '', ate = livre ? $('#dd-ate').value : '', semana = $('#dd-semana').value || ref, tutores = $('#dd-tutores').checked;
    if (livre && (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate))) { box.innerHTML = '<div class="erro-box">Informe o período.</div>'; return; }
    box.innerHTML = '<div class="carregando">Montando o dia a dia…</div>';
    try {
      const d = await api('/api/diario?' + qs({ ciclo: ciclo.id, polo, de, ate, semana: livre ? '' : semana, ref, sede: ls.get('painel-sede', true) ? '1' : '0' }));
      if (v !== geracao) return;
      ultimo = d;
      ls.set('rel-diario', { polo, tutores, dias: d.dias.length });
      if (de && d.de !== de) $('#dd-de').value = d.de;
      if (d.por_semana) { $('#dd-semana').value = d.de; $('#dd-ant').dataset.s = d.semana_anterior; $('#dd-prox').dataset.s = d.semana_seguinte; }
      const SEMANA = d.por_semana, perTxt = SEMANA ? 'Na semana' : 'No período';
      const umPolo = d.polos.length === 1, P = d.polos;
      const soma = (f) => P.reduce((a, p) => a + (f(p) || 0), 0), somaN = (f) => P.some(p => f(p) == null) ? null : soma(f);
      const hojeTxt = `${SEMN[new Date(d.ate + 'T12:00:00').getDay()]} ${dataBR(d.ate)}`;
      const ant = P.map(p => p.anterior).find(Boolean), antData = ant ? ant.data : null;
      const proxNome = P.find(p => p.proximo)?.proximo;
      const T = { hoje: soma(p => p.hoje.total), metaHoje: somaN(p => p.hoje.venda ? p.hoje.meta : 0), ant: soma(p => p.anterior?.total), metaAnt: somaN(p => p.anterior ? p.anterior.meta : 0),
        per: soma(p => p.periodo.total), metaPer: somaN(p => p.periodo.meta), semVenda: soma(p => p.periodo.dias_sem_venda), real: soma(p => p.acumulado.realizado), meta: soma(p => p.acumulado.meta),
        saldo: somaN(p => p.acumulado.saldo), porDia: somaN(p => p.proximo ? p.proximo.por_dia : 0), sedeSemData: soma(p => p.acumulado.sede_sem_data) };
      const card = (t, val, sub = '') => `<div><span>${esc(t)}</span><b>${val}</b><em>${esc(sub)}</em></div>`;
      const nm = (x) => x == null ? '—' : int(x);
      const vs = (feito, meta) => `${int(feito)}${meta != null && meta > 0 ? ` <small class="muted">/ ${int(meta)}</small>` : ''}`;
      const estilo = `<style>.rel .dd-mapa{width:100%;border-collapse:collapse;font-size:12px}.rel .dd-mapa th,.rel .dd-mapa td{padding:5px 3px;text-align:center;border:1px solid var(--borda,#e2e8f0);min-width:26px}.rel .dd-mapa th:first-child,.rel .dd-mapa td:first-child{text-align:left;min-width:120px;padding-left:6px}.rel .dd-mapa th small{display:block;font-weight:400;color:#64748b}.rel .dd-ok{background:rgba(34,197,94,.22)}.rel .dd-meio{background:rgba(234,179,8,.25)}.rel .dd-bad{background:rgba(239,68,68,.20)}.rel .dd-folga{background:rgba(148,163,184,.14);color:#94a3b8}.rel .dd-mapa .tot{font-weight:700;background:rgba(148,163,184,.10)}.rel .dd-mapa .sd{font-size:9px;vertical-align:super;color:#7c3aed}.rel .dd-leg span{display:inline-block;padding:1px 8px;border-radius:4px;margin-right:6px;font-size:11px}.rel .dd-rol{overflow-x:auto}.rel .dd-det td.dd-nome{vertical-align:top;font-weight:600;min-width:120px;background:var(--fundo,#fff)}.rel .dd-det td.dd-rot{text-align:left;white-space:nowrap;font-size:11px;color:#475569;min-width:0;padding:3px 6px}.rel .dd-det th:nth-child(2){min-width:0}.rel .dd-det tr.dd-g1 td{border-top:2px solid #94a3b8}.rel .dd-fut{background:repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(148,163,184,.10) 4px,rgba(148,163,184,.10) 8px)}.rel .dd-futh{color:#64748b}.rel .dd-pos{color:#15803d;font-weight:600}.rel .dd-neg{color:#b91c1c;font-weight:600}.rel .dd-det tr{break-inside:avoid}.rel .dd-placar{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}.rel .dd-placar pre{font-family:inherit;font-size:13px;line-height:1.5;white-space:pre-wrap;margin:6px 0;background:rgba(148,163,184,.10);padding:8px;border-radius:6px}@media print{.rel .dd-whats-area{display:none}.rel .dd-mapa{font-size:7.5pt}.rel .dd-mapa th,.rel .dd-mapa td{padding:2px 1px;min-width:0}.rel .dd-rol{overflow:visible}.rel .dd-ok,.rel .dd-bad,.rel .dd-meio,.rel .dd-folga{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>`;
      const legenda = `<p class="dd-leg muted" style="font-size:11px"><span class="dd-ok">bateu a meta do dia</span><span class="dd-meio">vendeu, abaixo da meta</span><span class="dd-bad">dia de venda sem matrícula</span><span class="dd-folga">sem venda no calendário (folga, feriado ou antes do início do processo)</span>${d.dias.some(x => x.futuro) ? '<span class="dd-fut">dia ainda não chegou — só o esperado</span>' : ''}${d.sede ? ' · <span class="sd" style="font-size:11px">S</span> inclui Sede/Digital da lista' : ''}</p>`;
      const cab = `<thead><tr><th>${'Polo'}</th>${d.dias.map(x => `<th>${ddmm(x.data)}<small>${SEMN[x.semana]}</small></th>`).join('')}<th>Total</th><th>Meta</th></tr></thead>`;
      const celula = (x) => `<td class="${cor(x)}" title="${ddmm(x.data)}: ${x.antes ? 'antes do início do processo · ' : ''}${x.total} matrícula(s)${x.meta != null ? ' · meta do dia ' + x.meta : ''}${x.sede ? ' · ' + x.sede + ' Sede/Digital' : ''}">${x.total || (x.venda ? '0' : '')}${x.sede ? '<span class="sd">S</span>' : ''}</td>`;
      // bloco de 4 linhas por polo/tutor: matrículas do dia, esperado do dia, SAVE/GAP do dia e acumulado
      const sg = (n, dec = false) => n == null ? '<span class="muted">—</span>' : (dec && Math.abs(n) < 0.05) ? '<span class="muted">0</span>' : `<span class="${n > 0 ? 'dd-pos' : n < 0 ? 'dd-neg' : 'muted'}">${n > 0 ? '+' : ''}${dec ? dec1(n).replace(',0', '') : int(n)}</span>`;
      const nf = (n, dec) => dec ? dec1(n).replace(',0', '') : int(n);
      const bloco = (nome, dias, f, extra = '', cls = '') => {
        const tot = dias.reduce((a, x) => a + (x.futuro ? 0 : f.real(x) || 0), 0), totE = dias.some(x => x.venda && f.esp(x) == null) ? null : dias.reduce((a, x) => a + (f.esp(x) || 0), 0);
        const totEh = dias.some(x => x.venda && !x.futuro && f.esp(x) == null) ? null : dias.filter(x => !x.futuro).reduce((a, x) => a + (f.esp(x) || 0), 0);
        const ultimo = [...dias].reverse().find(x => f.acum(x) != null);
        return `<tr class="dd-g1 ${cls}"><td rowspan="4" class="dd-nome">${nome}${extra}</td><td class="dd-rot">Matrículas</td>${dias.map(x => { if (x.futuro) return `<td class="${x.venda ? 'dd-fut' : 'dd-folga'}"></td>`; const n = f.real(x) || 0, e = f.esp(x); const c = !x.venda ? 'dd-folga' : e == null || e === 0 ? (n ? 'dd-ok' : '') : n >= e ? 'dd-ok' : n ? 'dd-meio' : 'dd-bad'; return `<td class="${c}">${n || (x.venda ? '0' : '')}${f.sede && f.sede(x) ? '<span class="sd">S</span>' : ''}</td>`; }).join('')}<td class="tot">${int(tot)}</td></tr>
          <tr class="${cls}"><td class="dd-rot">Esperado</td>${dias.map(x => `<td class="${x.venda ? '' : 'dd-folga'} muted">${x.venda && f.esp(x) != null ? nf(f.esp(x), f.dec) : ''}</td>`).join('')}<td class="tot">${totE == null ? '—' : nf(totE, f.dec)}</td></tr>
          <tr class="${cls}"><td class="dd-rot">SAVE/GAP do dia</td>${dias.map(x => `<td class="${x.venda ? '' : 'dd-folga'}">${x.venda && !x.futuro && f.esp(x) != null ? sg((f.real(x) || 0) - f.esp(x), f.dec) : ''}</td>`).join('')}<td class="tot">${totEh == null ? '—' : sg(tot - totEh, f.dec)}</td></tr>
          <tr class="dd-g4 ${cls}"><td class="dd-rot">SAVE/GAP acumulado</td>${dias.map(x => `<td class="${x.venda ? '' : 'dd-folga'}">${f.acum(x) == null ? '' : sg(f.acum(x))}</td>`).join('')}<td class="tot">${ultimo ? sg(f.acum(ultimo)) : '—'}</td></tr>`;
      };
      const cabD = (titulo) => `<thead><tr><th>${titulo}</th><th></th>${d.dias.map(x => `<th class="${x.futuro ? 'dd-futh' : ''}">${ddmm(x.data)}<small>${SEMN[x.semana]}</small></th>`).join('')}<th>Total</th></tr></thead>`;
      const fPolo = { real: x => x.total, esp: x => x.venda ? x.meta : 0, acum: x => x.saldo_acum, sede: x => x.sede };
      const redeDias = d.dias.map((x, i) => ({ data: x.data, futuro: x.futuro, venda: P.some(p => p.dias[i].venda), total: P.reduce((a, p) => a + (p.dias[i].total || 0), 0), sede: P.reduce((a, p) => a + p.dias[i].sede, 0),
        meta: P.some(p => p.dias[i].venda && p.dias[i].meta == null) ? null : P.reduce((a, p) => a + (p.dias[i].venda ? p.dias[i].meta || 0 : 0), 0), saldo_acum: P.some(p => p.dias[i].saldo_acum == null) ? null : P.reduce((a, p) => a + p.dias[i].saldo_acum, 0) }));
      const mapaPolos = `<div class="dd-rol"><table class="t dd-mapa dd-det">${cabD('Polo')}<tbody>${P.map(p => bloco(esc(p.polo), p.dias, fPolo, p.acumulado.meta ? `<br><small class="muted">${int(p.acumulado.realizado)} de ${int(p.acumulado.meta)}</small>` : '')).join('')}
        ${umPolo ? '' : bloco('<b>Rede</b>', redeDias, fPolo, `<br><small class="muted">${int(T.real)} de ${int(T.meta)}</small>`, 'total')}</tbody></table></div>`;
      const resumo = `<table class="t"><thead><tr><th>Polo</th><th class="num">Hoje<br><small>${ddmm(d.ate)}</small></th><th class="num">Dia anterior<br><small>${antData ? ddmm(antData) : '—'}</small></th><th class="num">${perTxt}</th>${SEMANA ? '<th class="num">Faltam na semana</th>' : ''}<th class="num">Média / dia de venda</th><th class="num">Dias sem venda</th><th class="num">Acumulado</th><th>SAVE/GAP</th><th class="num">Precisa / dia<br><small>${proxNome ? esc(proxNome.nome) + ' · ' + ddmm(proxNome.data) : ''}</small></th></tr></thead><tbody>
        ${P.map(p => `<tr><td>${esc(p.polo)}</td><td class="num"><b>${vs(p.hoje.total, p.hoje.venda ? p.hoje.meta : null)}</b></td><td class="num">${p.anterior ? vs(p.anterior.total, p.anterior.meta) : '—'}</td><td class="num">${vs(p.periodo.total, p.periodo.meta)}</td>${SEMANA ? `<td class="num">${p.periodo.meta == null ? '—' : int(Math.max(p.periodo.meta - p.periodo.total, 0))}</td>` : ''}<td class="num">${p.periodo.media == null ? '—' : dec1(p.periodo.media)}</td><td class="num">${p.periodo.dias_sem_venda ? `<span class="tag bad mini">${int(p.periodo.dias_sem_venda)}</span>` : '0'}</td><td class="num">${int(p.acumulado.realizado)}${p.acumulado.sede ? ` <small class="sede-tag">incl. ${int(p.acumulado.sede)} S/D</small>` : ''} <small class="muted">/ ${int(p.acumulado.meta)}</small></td><td>${p.acumulado.meta ? saveGap(p.acumulado.saldo) : '—'}</td><td class="num">${p.proximo && p.proximo.por_dia != null ? dec1(p.proximo.por_dia) : '—'}</td></tr>`).join('')}
        ${umPolo ? '' : `<tr class="total"><td>Rede</td><td class="num">${vs(T.hoje, T.metaHoje)}</td><td class="num">${vs(T.ant, T.metaAnt)}</td><td class="num">${vs(T.per, T.metaPer)}</td>${SEMANA ? `<td class="num">${T.metaPer == null ? '—' : int(Math.max(T.metaPer - T.per, 0))}</td>` : ''}<td class="num">—</td><td class="num">${int(T.semVenda)}</td><td class="num">${int(T.real)} <small class="muted">/ ${int(T.meta)}</small></td><td>${saveGap(T.saldo)}</td><td class="num">${T.porDia == null ? '—' : dec1(T.porDia)}</td></tr>`}</tbody></table>`;
      const rodape = `<footer class="rel-rodape"><b>Meta do dia</b> = quanto o calendário oficial (Spaces, dias de venda e feriados do polo) prevê para aquele dia: esperado acumulado no dia − esperado no dia anterior. Os números são inteiros e arredondados, por isso alguns dias têm meta 0 e outros 1 a mais. <b>Hoje</b> = ${hojeTxt}; <b>dia anterior</b> = último dia de venda antes dele. Cada dia conta as matrículas lançadas no polo do aluno${d.sede ? ' + a Sede/Digital da lista de alunos do Mundo Azul, na data do pagamento' : ''}. ${T.sedeSemData ? `Sede/Digital sem data não aparece nos dias (${P.filter(p => p.acumulado.sede_sem_data).map(p => `${esc(p.polo)} ${int(p.acumulado.sede_sem_data)}`).join(' · ')}); ela está no acumulado. ` : ''}<b>Precisa / dia</b> = o que falta para o próximo Space ÷ dias de venda até lá, somado por polo. Tutores: vendas pelo polo de crédito.</footer>`;
      // linha única, sem meta: Sede/Digital e vendas de tutores de outros polos para alunos do polo
      const linhaSimples = (nome, sub, dias, f, extraTot = '') => { const tot = dias.reduce((a, x) => a + (f(x) || 0), 0); if (!tot && !extraTot) return '';
        return `<tr class="dd-g1 dd-g4"><td class="dd-nome">${esc(nome)}<br><small class="muted">${esc(sub)}</small></td><td class="dd-rot">Matrículas</td>${dias.map(x => `<td class="${x.futuro ? (x.venda ? 'dd-fut' : 'dd-folga') : x.venda ? '' : 'dd-folga'}">${x.futuro ? '' : f(x) || ''}</td>`).join('')}<td class="tot">${int(tot)}${extraTot}</td></tr>`; };
      const paginaTutores = (p) => {
        const ts = [...p.tutores].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
        const diasSem = (t) => t.ultima ? Math.round((new Date(d.ate + 'T12:00:00') - new Date(t.ultima + 'T12:00:00')) / 864e5) : null;
        const extra = (t) => `<br><small class="muted">${t.meta != null ? 'meta ' + dec1(t.meta).replace(',0', '') : 'sem meta'}</small><br><small>${t.ultima ? 'última ' + ddmm(t.ultima) + (diasSem(t) ? ` (${diasSem(t)}d)` : ' (hoje)') : '<span class="tag bad mini">sem venda</span>'}</small>`;
        const fT = (t) => ({ dec: true, real: x => t.dias[x.data] || 0, esp: x => t.meta == null ? null : x.venda ? (t.esperado[x.data] ?? null) : 0, acum: x => t.saldo_acum[x.data] ?? null });
        const somaT = (fn) => (x) => { const vs = ts.map(t => fn(t, x)); return vs.some(v => v == null) ? null : vs.reduce((n, v) => n + v, 0); };
        const fEq = { dec: true, real: somaT((t, x) => t.dias[x.data] || 0), esp: somaT((t, x) => t.meta == null ? null : x.venda ? (t.esperado[x.data] ?? null) : 0), acum: somaT((t, x) => t.saldo_acum[x.data] ?? null) };
        const ultAc = [...p.dias].reverse().find(x => x.saldo_acum != null), eqAc = ultAc ? fEq.acum(ultAc) : null;
        return `<h2>Tutores — dia a dia</h2>${ts.length ? `<div class="dd-rol"><table class="t dd-mapa dd-det">${cabD('Tutor')}<tbody>${ts.map(t => bloco(esc(t.nome), p.dias, fT(t), extra(t))).join('')}${ts.length > 1 ? bloco('<b>Equipe</b>', p.dias, fEq, '<br><small class="muted">soma dos tutores</small>', 'total') : ''}${linhaSimples('Sede/Digital', 'sem meta · Mundo Azul', p.dias, x => x.sede, p.acumulado.sede_sem_data ? `<br><small class="muted">+${int(p.acumulado.sede_sem_data)} sem data</small>` : '')}${linhaSimples('Tutores de outros polos', 'sem meta neste polo', p.dias, x => x.outros)}</tbody></table></div>
          <p class="rp-nota">Esperado do tutor = meta do tutor no processo × % previsto do polo em cada dia (a mesma regra do painel), com uma casa decimal: quem tem menos de 1 matrícula por dia de meta aparece como 0,6, 0,7… em vez de alternar 0 e 1. SAVE/GAP acumulado = tudo o que o tutor vendeu no processo até o dia − o esperado acumulado até o dia.${eqAc != null && ultAc && eqAc !== ultAc.saldo_acum ? ` A equipe (${eqAc > 0 ? '+' : ''}${int(eqAc)}) e o polo (${ultAc.saldo_acum > 0 ? '+' : ''}${int(ultAc.saldo_acum)}) diferem porque o polo também conta a Sede/Digital${p.acumulado.sede ? ` (${int(p.acumulado.sede)})` : ''} e as vendas de tutores de outros polos para alunos daqui, e a equipe conta as vendas dela para alunos de outros polos.` : ''}</p>` : '<p class="muted">Nenhum tutor ativo neste polo.</p>'}`;
      };
      const kpis = `<div class="rel-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${card('Hoje · ' + hojeTxt, vs(T.hoje, T.metaHoje), T.metaHoje ? 'matrículas / meta do dia' : 'matrículas')}${card('Dia anterior' + (antData ? ' · ' + dataBR(antData) : ''), vs(T.ant, T.metaAnt), 'matrículas / meta do dia')}${card(SEMANA ? `Semana · ${ddmm(d.de)} a ${ddmm(d.fim)}` : `Período · ${d.dias.length} dias`, vs(T.per, T.metaPer), SEMANA ? `matrículas / meta da semana · faltam ${T.metaPer == null ? '—' : int(Math.max(T.metaPer - T.per, 0))}` : 'matrículas / meta do período')}${card('Dias de venda sem matrícula', int(T.semVenda), umPolo ? 'no período' : 'soma dos polos no período')}${card('Precisa por dia', T.porDia == null ? '—' : dec1(T.porDia), proxNome ? `até ${proxNome.nome} (${dataBR(proxNome.data)})` : '')}${card('SAVE/GAP acumulado', saveGap(T.saldo), `${int(T.real)} de ${int(T.meta)}`)}</div>`;
      let html = estilo + `<section class="rel-pagina">${timbreRelatorio('Dia a dia por polo', `${ciclo.nome} · ${umPolo ? esc(P[0].polo) : 'Rede — todos os polos'}`, `${dataBR(d.de)} a ${dataBR(d.fim || d.ate)}`)}${kpis}
        <h2>Resumo do dia</h2>${resumo}<h2>Mapa dos dias</h2>${legenda}${mapaPolos}${umPolo ? paginaTutores(P[0]) : ''}${rodape}${areaPlacar(P)}</section>`;
      if (!umPolo && tutores) html += P.map(p => `<section class="rel-pagina">${timbreRelatorio('Dia a dia por polo', `${ciclo.nome} · ${esc(p.polo)}`, `${dataBR(d.de)} a ${dataBR(d.fim || d.ate)}`)}
        <p class="rp-nota">Hoje ${vs(p.hoje.total, p.hoje.venda ? p.hoje.meta : null)} · período ${vs(p.periodo.total, p.periodo.meta)} · acumulado ${int(p.acumulado.realizado)} de ${int(p.acumulado.meta)} · ${saveGap(p.acumulado.saldo)}${p.proximo && p.proximo.por_dia != null ? ` · precisa ${dec1(p.proximo.por_dia)}/dia até ${esc(p.proximo.nome)}` : ''}</p>
        ${legenda}<div class="dd-rol"><table class="t dd-mapa dd-det">${cabD('Polo')}<tbody>${bloco(esc(p.polo), p.dias, fPolo)}</tbody></table></div>
        ${paginaTutores(p)}</section>`).join('');
      box.innerHTML = html; ligarPlacar(d);
      document.title = `Dia a dia — ${dataBR(d.ate)} — ${ciclo.nome}`;
    } catch (e) { if (v === geracao) box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  $('#dd-whats').onclick = () => {
    const d = ultimo; if (!d) return toast('Gere o relatório primeiro', true);
    const P = d.polos, ord = [...P].sort((a, b) => b.hoje.total - a.hoje.total || a.polo.localeCompare(b.polo));
    const tot = P.reduce((a, p) => a + p.hoje.total, 0), metaT = P.reduce((a, p) => a + (p.hoje.venda ? p.hoje.meta || 0 : 0), 0);
    const linhas = [`📊 *Dia a dia — ${dataBR(d.ate)}*`, `Hoje: *${tot}* matrícula(s)${metaT ? ` · meta do dia ${metaT}` : ''}`, '',
      ...ord.map(p => `${p.hoje.total >= (p.hoje.meta || 0) && p.hoje.total ? '✅' : p.hoje.total ? '🟡' : '🔴'} ${p.polo}: *${p.hoje.total}*${p.hoje.venda && p.hoje.meta ? `/${p.hoje.meta}` : ''} · acumulado ${p.acumulado.realizado}/${p.acumulado.meta}${p.acumulado.meta ? ` · ${p.acumulado.saldo >= 0 ? 'SAVE +' : 'GAP '}${p.acumulado.saldo}` : ''}${p.proximo && p.proximo.por_dia != null ? ` · precisa ${dec1(p.proximo.por_dia)}/dia` : ''}`)];
    const prox = P.find(p => p.proximo)?.proximo; if (prox) linhas.push('', `🎯 Próximo marco: ${prox.nome} (${dataBR(prox.data)})`);
    copiarTexto(linhas.join('\n'));
  };
  $('#dd-ant').onclick = () => { $('#dd-semana').value = $('#dd-ant').dataset.s || menos($('#dd-semana').value, 7); gerar(); };
  $('#dd-prox').onclick = () => { $('#dd-semana').value = $('#dd-prox').dataset.s || menos($('#dd-semana').value, -7); gerar(); };
  $('#dd-atual').onclick = () => { $('#dd-semana').value = ref; gerar(); };
  $('#dd-semana').onchange = gerar;
  $('#dd-gerar').onclick = gerar; await gerar();
}

// ======================================================================= PREVISÃO DA PRÓXIMA SEMANA
async function telaRelatorioPrevisaoSemana() {
  const app = $('#app'), ciclo = cicloAtual(), travado = poloTravado();
  const polos = B.polos.filter(p => p.ativo && (!travado || p.id === B.usuario.polo_id));
  const salvo = ls.get('rel-previsao', {});
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Previsão da próxima semana</b>
    <label>Polo <select id="pv-polo" ${travado ? 'disabled' : ''}>${travado ? '' : '<option value="">Todos os polos</option>'}${polos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label>Posição em <input type="date" id="pv-ref" value="${posicaoAtual()}"></label>
    <label>Semana que começa em <input type="date" id="pv-semana" title="Vazio = próxima semana"></label>
    <label><input type="checkbox" id="pv-detalhe"> Uma página por polo (produtos e tutores)</label>
    <button class="btn prim" id="pv-gerar">Gerar relatório</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="pv-conteudo" class="rel"></div>`;
  $('#pv-polo').value = travado ? B.usuario.polo_id : (polos.some(p => String(p.id) === String(salvo.polo)) ? salvo.polo : '');
  $('#pv-detalhe').checked = salvo.detalhe !== false;
  let geracao = 0;
  const dia = (iso) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(iso + 'T12:00:00').getDay()];
  async function gerar() {
    const v = ++geracao, box = $('#pv-conteudo'), polo = travado ? String(B.usuario.polo_id) : $('#pv-polo').value, ref = $('#pv-ref').value, semana = $('#pv-semana').value, detalhe = $('#pv-detalhe').checked;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) { box.innerHTML = '<div class="erro-box">Informe a data de posição.</div>'; return; }
    ls.set('rel-previsao', { polo, detalhe });
    box.innerHTML = '<div class="carregando">Calculando a previsão…</div>';
    try {
      const d = await api('/api/previsao-semana?' + qs({ ciclo: ciclo.id, polo, ref, semana, sede: ls.get('painel-sede', true) ? '1' : '0' }));
      if (v !== geracao) return;
      if (!d.polos.length) { box.innerHTML = '<div class="info">Nenhum polo disponível.</div>'; return; }
      if (!semana) $('#pv-semana').value = d.semana.inicio;
      const S = d.semana, fimTxt = dataBR(S.fim), periodo = `${dia(S.inicio)} ${dataBR(S.inicio)} a ${dia(S.fim)} ${fimTxt}`;
      const soma = (xs, k) => xs.some(x => x[k] == null) ? null : xs.reduce((a, x) => a + x[k], 0);
      const n = (x) => x == null ? '—' : int(x);
      const pd = (x) => x == null ? '—' : dec1(x);
      const cab = (primeira) => `<thead><tr><th>${primeira}</th><th class="num">Realizado hoje</th><th>SAVE/GAP hoje</th><th class="num">Meta da semana<br><small>plano ${dataBR(S.inicio)}–${fimTxt}</small></th><th class="num">Necessário até ${fimTxt}</th><th class="num">Por dia de venda</th><th class="num">Semana passada<br><small>lançadas</small></th></tr></thead>`;
      const lin = (nome, x, cls = '') => `<tr class="${cls}"><td>${nome}</td><td class="num">${n(x.realizado)}</td><td>${x.meta > 0 ? saveGap(x.saldo_hoje) : '<span class="muted">sem meta</span>'}</td><td class="num">${x.meta > 0 ? n(x.meta_semana) : '—'}</td><td class="num"><b>${x.meta > 0 ? n(x.necessario) : '—'}</b></td><td class="num">${x.meta > 0 ? pd(x.por_dia) : '—'}</td><td class="num">${int(x.semana_passada || 0)}</td></tr>`;
      const totalDe = (xs) => ({ meta: soma(xs, 'meta'), realizado: soma(xs, 'realizado'), saldo_hoje: soma(xs, 'saldo_hoje'), meta_semana: soma(xs, 'meta_semana'), necessario: soma(xs, 'necessario'), por_dia: soma(xs.filter(x => x.meta > 0 && x.necessario), 'por_dia'), semana_passada: soma(xs, 'semana_passada') });
      const nomeProd = (x) => `${esc(x.nome)}${x.meta_ate ? `<br><small>meta até ${dataBR(x.meta_ate)}${x.encerrado ? ' · prazo encerrado' : ''}</small>` : ''}`;
      // produtos somados entre os polos (cada polo calcula a sua necessidade; excedente de um não cobre outro)
      const prodMap = new Map();
      for (const p of d.polos) for (const x of p.produtos) { const g = prodMap.get(x.produto_id) || { ...x, itens: [] }; g.itens.push(x); prodMap.set(x.produto_id, g); }
      const ordem = B.produtos.map(p => p.id);
      const prodTot = [...prodMap.values()].sort((a, b) => ordem.indexOf(a.produto_id) - ordem.indexOf(b.produto_id)).map(g => ({ ...g, ...totalDe(g.itens) }));
      const T = totalDe(d.polos.map(p => p.total)), umPolo = d.polos.length === 1;
      const dias = d.polos.map(p => p.total.dias), dMin = Math.min(...dias), dMax = Math.max(...dias);
      const ds = d.polos.map(p => p.total.dias_semana), sMin = Math.min(...ds), sMax = Math.max(...ds);
      const faixa = (a, b) => a === b ? int(a) : `${a} a ${b}`;
      const card = (t, val, sub = '') => `<div><span>${esc(t)}</span><b>${val}</b><em>${esc(sub)}</em></div>`;
      const foraSede = await notaSedeFora(ciclo.id, ref, polo, () => true); if (v !== geracao) return;
      const rodape = `<footer class="rel-rodape"><b>Meta da semana</b> = quanto o calendário oficial (Spaces, dias de venda e feriados de cada polo) prevê vender de ${dataBR(S.inicio)} a ${fimTxt}. <b>Necessário até ${fimTxt}</b> = esperado acumulado em ${fimTxt} − realizado hoje: inclui os dias que ainda restam desta semana e recupera o GAP atual; com SAVE, pode ser menor que a meta da semana. <b>Por dia</b> = necessário ÷ dias de venda de hoje até ${fimTxt}. Realizado inclui Sede/Digital (Mundo Azul) quando ligado no painel. Tutores: meta do tutor × % previsto do polo, com as vendas pelo polo de crédito do tutor. Totais somam o que cada polo/produto precisa: o excedente de um não cobre a falta de outro. Produtos com prazo próprio (Pós) seguem a data limite da meta. Semana passada (${dataBR(d.semana_passada.inicio)} a ${dataBR(d.semana_passada.fim)}) = matrículas lançadas no período, para comparação. Previsão calculada na posição ${dataBR(d.ref)}; vendas lançadas depois mudam os números.</footer>`;
      const kpis = (x, ds1, ds2, dd1, dd2) => `<div class="rel-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${card('Necessário até ' + fimTxt, x.meta > 0 ? n(x.necessario) : '—', 'para ficar em linha com o calendário')}${card('Meta da semana', x.meta > 0 ? n(x.meta_semana) : '—', 'plano de ' + periodo)}${card('Por dia de venda', x.meta > 0 ? pd(x.por_dia) : '—', `${faixa(dd1, dd2)} dia(s) de venda de hoje até ${fimTxt}`)}${card('Dias de venda na semana', faixa(ds1, ds2), MODO_TXT[d.modo] || d.modo)}${card('Semana passada', int(x.semana_passada || 0), 'matrículas lançadas')}${card('SAVE/GAP hoje', x.meta > 0 ? saveGap(x.saldo_hoje) : '—', 'posição ' + dataBR(d.ref))}</div>`;
      let html = `<section class="rel-pagina">${timbreRelatorio('Previsão da próxima semana', `${ciclo.nome} · ${umPolo ? esc(d.polos[0].polo) : 'Rede — todos os polos'}`, periodo)}
        ${kpis(T, sMin, sMax, dMin, dMax)}
        ${umPolo ? '' : `<h2>Por polo</h2><table class="t">${cab('Polo')}<tbody>${d.polos.map(p => lin(esc(p.polo), p.total)).join('')}${lin('Total da rede', T, 'total')}</tbody></table>`}
        <h2>Por produto${umPolo ? '' : ' — soma dos polos'}</h2><table class="t">${cab('Produto')}<tbody>${prodTot.map(x => lin(nomeProd(x), x)).join('')}</tbody></table>
        ${foraSede}
        ${umPolo ? tutoresHTML(d.polos[0]) : ''}${rodape}</section>`;
      function tutoresHTML(p) {
        if (!p.tutores.length) return '<h2>Por tutor</h2><p class="muted">Sem meta de tutor neste polo.</p>';
        const ts = [...p.tutores].sort((a, b) => (b.necessario || 0) - (a.necessario || 0));
        return `<h2>Por tutor</h2><table class="t">${cab('Tutor')}<tbody>${ts.map(t => lin(esc(t.nome), t)).join('')}${lin('Total da equipe', totalDe(ts), 'total')}</tbody></table>`;
      }
      if (!umPolo && detalhe) html += d.polos.map(p => `<section class="rel-pagina">${timbreRelatorio('Previsão da próxima semana', `${ciclo.nome} · ${esc(p.polo)}`, periodo)}
        ${kpis(p.total, p.total.dias_semana, p.total.dias_semana, p.total.dias, p.total.dias)}
        <h2>Por produto</h2><table class="t">${cab('Produto')}<tbody>${p.produtos.map(x => lin(nomeProd(x), x)).join('')}${lin('Total do polo', p.total, 'total')}</tbody></table>
        ${p.total.sede_sem_produto ? `<p class="rp-nota">O total do polo inclui ${int(p.total.sede_sem_produto)} Sede/Digital sem produto informado.</p>` : ''}
        ${tutoresHTML(p)}${rodape}</section>`).join('');
      box.innerHTML = html;
      document.title = `Previsão da semana ${dataBR(S.inicio)} — ${ciclo.nome}`;
    } catch (e) { if (v === geracao) box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  $('#pv-gerar').onclick = gerar; await gerar();
}

// Sede/Digital que não entra num relatório montado por polo × produto (sem produto informado ou sem polo identificado)
async function notaSedeFora(cicloId, ref, poloSel, incluiProduto) {
  try {
    const q = await api('/api/ma/sede?' + qs({ ciclo: cicloId, ref }));
    const linhas = (q.linhas || []).filter(l => !poloSel || String(l.polo_id) === String(poloSel));
    const semProd = linhas.filter(l => l.semProduto).map(l => `${esc(l.polo)} ${int(l.semProduto)}`);
    let semPolo = 0;
    if (!poloSel && q.rede) for (const [pid, n] of Object.entries(q.rede.porProduto || {})) {
      if (!incluiProduto(Number(pid))) continue;
      const nosPolos = linhas.reduce((a, l) => a + ((l.porProduto || {})[pid] || 0), 0);
      if (n > nosPolos) semPolo += n - nosPolos;
    }
    if (!semProd.length && !semPolo) return '';
    return `<p class="rp-nota"><b>Sede/Digital fora deste quadro:</b> ${semProd.length ? `sem produto informado — ${semProd.join(' · ')}` : ''}${semProd.length && semPolo ? '; ' : ''}${semPolo ? `${int(semPolo)} sem polo identificado (só na visão da rede por produto)` : ''}. Elas contam no total do polo/da rede no painel e no Acompanhamento. Confira a ligação de cursos e polos em Conferência › Mundo Azul.</p>`;
  } catch (e) { return ''; }
}

async function telaRelatorioVisaoSpace() {
  const app=$('#app'),ciclo=cicloAtual(),restrito=poloTravado();
  const spaces=B.spaces.filter(x=>x.ciclo_id===ciclo.id).sort((a,b)=>a.data.localeCompare(b.data)||a.id-b.id);
  const polos=B.polos.filter(x=>x.ativo&&(!restrito||x.id===B.usuario.polo_id));
  const salvo=ls.get('rel-visao-space',{}),refInicial=posicaoAtual();
  app.innerHTML=`<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Visão geral do Space</b><label>Space <select id="vs-space">${spaces.map(s=>`<option value="${s.id}">${esc(s.nome)} · ${dataBR(s.data)}</option>`).join('')}</select></label><label>Polo <select id="vs-polo" ${restrito?'disabled':''}>${restrito?'':'<option value="">Todos os polos</option>'}${polos.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label><label>Posição em <input type="date" id="vs-ref" value="${refInicial}"></label><label><input type="checkbox" id="vs-detalhes"> Detalhar polos por produto</label><button class="btn prim" id="vs-gerar">Gerar relatório</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="vs-conteudo" class="rel"></div>`;
  if(!spaces.length){$('#vs-conteudo').innerHTML=avisoSpaces();$('#vs-gerar').disabled=true;return;}
  const padrao=spaces.find(s=>s.data>=refInicial)||spaces.at(-1);
  $('#vs-space').value=spaces.some(s=>String(s.id)===String(salvo.space))?salvo.space:padrao.id;
  $('#vs-polo').value=restrito?B.usuario.polo_id:(polos.some(p=>String(p.id)===String(salvo.polo))?salvo.polo:'');
  $('#vs-detalhes').checked=!!salvo.detalhes;
  let geracao=0;
  async function gerar(){
    const v=++geracao,box=$('#vs-conteudo'),ref=$('#vs-ref').value,space=spaces.find(s=>String(s.id)===$('#vs-space').value),polo=restrito?String(B.usuario.polo_id):$('#vs-polo').value,detalhes=$('#vs-detalhes').checked;
    if(!space||!/^\d{4}-\d{2}-\d{2}$/.test(ref)){box.innerHTML='<div class="erro-box">Informe Space e data de posição válidos.</div>';return;}
    const selecionados=polos.filter(p=>!polo||String(p.id)===polo);
    if(!selecionados.length){box.innerHTML='<div class="info">Nenhum polo disponível.</div>';return;}
    ls.set('rel-visao-space',{space:space.id,polo,detalhes});box.innerHTML='<div class="carregando">Montando relatório…</div>';
    try{
      const corte=ref<space.data?ref:space.data;
      const rs=await Promise.all(selecionados.map(async polo=>({polo,r:await api('/api/ritmo?'+qs({ciclo:ciclo.id,polo:polo.id,ref:corte}))})));
      if(v!==geracao)return;
      const {linhas,total}=dadosVisaoSpace(rs,B.produtos,space.id),encerrado=ref>=space.data;
      const foraSede=await notaSedeFora(ciclo.id,corte,polo,pid=>!B.produtos.find(x=>x.id===pid)?.meta_ate);if(v!==geracao)return;
      const dias=rs.map(({r})=>r.spaces.find(x=>x.id===space.id)?.dias||0),min=Math.min(...dias),max=Math.max(...dias);
      const gap=x=>x.meta<=0?'Sem meta':x.esperado==null?'—':x.realizado===x.esperado?'Em linha':saveGap(x.realizado-x.esperado);
      const linha=(x,t=false,sub=false)=>`<tr class="${t?'total':sub?'sub':''}"><td>${sub?'↳ ':''}${esc(x.nome)}</td><td class="num">${x.meta>0?int(x.meta_space):'—'}</td><td class="num"><b>${int(x.realizado)}</b></td><td class="num">${x.meta>0?int(Math.max(0,x.meta_space-x.realizado)):'—'}</td><td class="num">${x.meta_space>0?pctTxt(pct(x.realizado,x.meta_space)):'—'}</td><td class="num">${x.meta>0?int(x.esperado):'—'}</td><td>${gap(x)}</td><td class="num">${encerrado||x.meta<=0||x.por_dia==null?'—':dec1(x.por_dia)}</td></tr>`;
      const card=(t,v,d='')=>`<div><span>${esc(t)}</span><b>${v}</b><em>${esc(d)}</em></div>`;
      box.innerHTML=`<style>.rel .vs-folha .vs-tabela{width:100%;table-layout:fixed}.rel .vs-folha .vs-tabela th,.rel .vs-folha .vs-tabela td{white-space:normal;overflow-wrap:anywhere;font-size:12px;padding:7px 5px}.rel .vs-folha .vs-tabela th:first-child{width:22%}.rel .vs-folha .sub td{color:#475569;font-size:11px}.rel .vs-folha .rel-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.rel .vs-folha .total td{font-weight:700;background:#edf3fb}@media(max-width:700px){.rel .vs-folha .rel-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{.rel .rel-pagina.vs-folha{break-inside:auto}.rel .rel-pagina.vs-folha .rel-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.rel .rel-pagina.vs-folha .vs-tabela th,.rel .rel-pagina.vs-folha .vs-tabela td{font-size:8pt;padding:4px;white-space:normal;min-width:0}.rel .vs-folha tr{break-inside:avoid}.rel .vs-folha thead{display:table-header-group}.rel .vs-folha h2{break-after:avoid}.rel .vs-folha .rel-rodape{font-size:8pt;line-height:1.4}}</style><section class="rel-pagina vs-folha">${timbreRelatorio('Visão geral — '+space.nome,`${ciclo.nome} · ${selecionados.length===1?selecionados[0].nome:'Rede consolidada — todos os polos'}`,`Posição em ${dataBR(ref)}`)}<p class="rp-nota">${esc(space.nome)} · ${dataBR(space.data)} · ${pctTxt(space.percentual)} da meta do processo · ${encerrado?'Resultado até a data do Space':'Acompanhamento parcial'}</p><div class="rel-kpis">${card('Meta do Space',total.meta>0?int(total.meta_space):'—')}${card('Realizado até o corte',int(total.realizado),dataBR(corte))}${card('Faltam para o Space',total.meta>0?int(Math.max(0,total.meta_space-total.realizado)):'—')}${card('Atingimento do Space',total.meta_space>0?pctTxt(pct(total.realizado,total.meta_space)):'—')}${card('Esperado até o corte',total.meta>0?int(total.esperado):'—',dataBR(corte))}${card('SAVE/GAP até o corte',gap(total))}${card('Dias de venda restantes',encerrado?'0':min===max?int(max):`${min} a ${max}`,encerrado?'Space encerrado':`Inclui a posição consultada · ${MODO_TXT[rs[0].r.modo]||rs[0].r.modo}`)}${card('Necessário por dia',encerrado||total.meta<=0||total.por_dia==null?'—':dec1(total.por_dia),'Soma do ritmo necessário por polo e produto')}</div><h2>Produtos — meta do Space × realizado</h2><table class="t vs-tabela"><thead><tr><th>Produto / polo</th><th class="num">Meta do Space</th><th class="num">Realizado</th><th class="num">Faltam</th><th class="num">Atingimento</th><th class="num">Esperado até o corte</th><th>SAVE/GAP até o corte</th><th class="num">Necessário / dia</th></tr></thead><tbody>${linhas.map(x=>linha(x)+(detalhes?x.polos.filter(p=>p.meta||p.realizado).map(p=>linha(p,false,true)).join(''):'')).join('')}${linha({...total,nome:'Total selecionado'},true)}</tbody></table>${!linhas.length?'<p>Nenhum produto com meta ou realizado neste recorte.</p>':''}${foraSede}<footer class="rel-rodape">Meta do Space é a meta acumulada para o marco selecionado. Esperado até o corte usa o calendário oficial até a menor data entre posição consultada e Space; SAVE/GAP compara esse esperado ao realizado. Atingimento compara o realizado com a meta do Space. Spaces futuros mostram resultado parcial; consultas posteriores preservam o resultado até o marco e não incluem vendas posteriores. Dias e ritmo seguem calendário e feriados de cada polo; sem dias disponíveis, o ritmo aparece como —. Produtos com prazo próprio, como Pós, ficam fora de todos os totais. Realizado inclui Sede/Digital (Mundo Azul − lançadas pelos tutores) quando o produto e o polo são conhecidos, sem duplicação. Os totais somam os polos e preservam seus arredondamentos oficiais.</footer></section>`;
      document.title=`Visão geral do Space — ${space.nome} — ${ciclo.nome}`;
    }catch(e){if(v===geracao)box.innerHTML=`<div class="erro-box">${esc(e.message)}</div>`;}
  }
  $('#vs-gerar').onclick=gerar;await gerar();
}

async function telaRelatorioRedeProdutos() {
  const app=$('#app'), ciclo=cicloAtual(), restrito=poloTravado();
  const salvo=ls.get('rel-rede-produtos',{});
  app.innerHTML=`<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Visão geral por produto</b><label>Produto <select id="rg-produto"><option value="">Todos os produtos</option>${B.produtos.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label><label>Posição em <input type="date" id="rg-ref" value="${posicaoAtual()}"></label><label><input type="checkbox" id="rg-polos"> Resultado por polo abaixo de cada produto</label><button class="btn prim" id="rg-gerar">Gerar relatório</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="rg-conteudo" class="rel"></div>`;
  $('#rg-produto').value=salvo.produto||''; $('#rg-polos').checked=salvo.polos!==false;
  let versao=0;
  async function gerar(){
    const v=++versao, produto=$('#rg-produto').value, ref=$('#rg-ref').value, box=$('#rg-conteudo');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(ref)){box.innerHTML='<div class="erro-box">Informe uma data de posição.</div>';return;}
    const porPoloOn=$('#rg-polos').checked; ls.set('rel-rede-produtos',{produto,polos:porPoloOn});box.innerHTML='<div class="carregando">Montando relatório…</div>';
    try{
      // Carrega o mesmo recorte completo para preservar o arredondamento oficial entre produtos.
      const d=await api('/api/painel?'+qs({ciclo:ciclo.id,polo:restrito?B.usuario.polo_id:'',ref}));
      if(v!==versao)return;
      const hs=d.ritmo.hoje_situacao.linhas.flatMap(l=>l.produtos||[]);
      const ps=d.porProduto.filter(p=>!produto||String(p.id)===produto).map(p=>{
        const h=hs.find(x=>x.produto_id===p.id);
        return {...p,meta:p.meta||0,realizado:h?.realizado??p.qtd,esperado:h ? h.esperado : (p.meta ? null : 0),meta_ate:B.produtos.find(x=>x.id===p.id)?.meta_ate};
      });
      const total={meta:ps.reduce((a,p)=>a+p.meta,0),realizado:ps.reduce((a,p)=>a+p.realizado,0),esperado:somarConhecido(ps,'esperado')};
      const temSede=ps.some(p=>p.sede);
      const linha=(p,total=false)=>`<tr class="${total?'total':''}"><td>${esc(p.nome)}${p.meta_ate?`<br><small>Meta até ${dataBR(p.meta_ate)}</small>`:''}</td><td class="num">${p.meta>0?int(p.meta):'—'}</td><td class="num"><b>${int(p.realizado)}</b></td><td class="num">${p.meta>0?pctTxt(pct(p.realizado,p.meta)):'—'}</td><td class="num">${p.meta>0?int(p.esperado):'—'}</td><td>${p.meta>0?saveGap(diferencaConhecida(p.realizado,p.esperado)):'Sem meta cadastrada'}</td>${temSede?`<td class="num">${int(total?ps.reduce((a,x)=>a+(x.sede||0),0):(p.sede||0))}</td>`:''}</tr>`;
      // linhas por polo (mesmo motor do painel: realizado inclui Sede/Digital quando o produto do polo é conhecido)
      const linhasPolo=(p)=>!porPoloOn||restrito?'':d.porPolo.map(po=>{ const h=po.hojeProduto&&po.hojeProduto[p.id]; const sd=(po.sede_por_produto||{})[p.id]||0;
          if(!h||(!h.meta&&!h.realizado))return ''; return `<tr class="sub"><td>&nbsp;&nbsp;↳ ${esc(po.nome)}</td><td class="num">${h.meta>0?int(h.meta):'—'}</td><td class="num">${int(h.realizado)}</td><td class="num">${h.meta>0?pctTxt(pct(h.realizado,h.meta)):'—'}</td><td class="num">${h.meta>0?int(h.esperado):'—'}</td><td>${h.meta>0?saveGap(diferencaConhecida(h.realizado,h.esperado)):'Sem meta'}</td>${temSede?`<td class="num">${sd?int(sd):'<span class="muted">0</span>'}</td>`:''}</tr>`; }).join('')+linhaSedeSemPolo(p);
      // Sede/Digital que o Mundo Azul só mostra na visão da rede por produto (sem o polo): fica no produto, fora dos polos
      const linhaSedeSemPolo=(p)=>{ if(!porPoloOn||restrito||!p.sede)return ''; const nosPolos=d.porPolo.reduce((a,po)=>a+((po.sede_por_produto||{})[p.id]||0),0), n=p.sede-nosPolos;
          return n>0?`<tr class="sub"><td>&nbsp;&nbsp;↳ <i>Sede/Digital sem polo identificado</i></td><td class="num">—</td><td class="num">${int(n)}</td><td class="num">—</td><td class="num">—</td><td class="muted">só no total do produto</td><td class="num">${int(n)}</td></tr>`:''; };
      const semProdPolos=porPoloOn&&!restrito?d.porPolo.filter(po=>po.sede_sem_produto).map(po=>`${esc(po.nome)} ${int(po.sede_sem_produto)}`):[];
      const escopo=restrito?'Polo '+nomePor('polos',B.usuario.polo_id):'Rede consolidada — todos os polos';
      box.innerHTML=`<section class="rel-pagina">${timbreRelatorio('Visão geral por produto',`${ciclo.nome} · ${escopo}${produto?' · '+nomePor('produtos',produto):''}`,`Posição em ${dataBR(d.ref)}`)}${resumoRelatorio({...total,ref:d.ref,titulo:'Resumo do recorte selecionado'})}<h2>Metas × realizado por produto</h2><table class="t"><thead><tr><th>Produto</th><th class="num">Meta do processo</th><th class="num">Realizado</th><th class="num">Atingimento</th><th class="num">Esperado na data</th><th>SAVE/GAP na data</th>${temSede?'<th class="num">dos quais Sede/Digital</th>':''}</tr></thead><tbody>${ps.map(p=>linha(p)+linhasPolo(p)).join('')}${linha({...total,nome:'Total selecionado'},true)}</tbody></table>${semProdPolos.length?`<p class="rp-nota">Sede/Digital sem produto informado (fora das linhas por polo): ${semProdPolos.join(' · ')}. Confira a ligação curso → produto em Conferência › Mundo Azul.</p>`:''}${porPoloOn&&!restrito&&ps.some(p=>p.sede&&p.sede>d.porPolo.reduce((a,po)=>a+((po.sede_por_produto||{})[p.id]||0),0))?'<p class="rp-nota">“Sede/Digital sem polo identificado”: a matrícula está na lista do Mundo Azul num polo que não está ligado a nenhum polo do sistema. Ligue o polo em Conferência › Mundo Azul.</p>':''}${!ps.length?'<p>Nenhum produto disponível para este filtro.</p>':''}${d.sede&&d.sede.total?`<p class="rp-nota">Realizado inclui ${int(d.sede.total)} matrícula(s) Sede/Digital (Mundo Azul − lançadas pelos tutores), conforme a lista de alunos importada (data do pagamento até a consulta). Ticket e RPV não incluem essas matrículas.</p>`:''}<footer class="rel-rodape">Visão acumulada do processo até a data escolhida. As linhas ↳ mostram cada polo (metas e arredondamentos de cada polo; a soma dos polos pode diferir da rede em 1–2). SAVE/GAP compara o realizado com o esperado até a consulta. Produtos zerados permanecem visíveis conforme a oferta cadastrada. Produtos com prazo próprio seguem a data limite da meta; realizado e esperado usam o motor oficial. Contas com acesso restrito visualizam somente seu polo.</footer></section>`;
      document.title=`Visão geral por produto — ${ciclo.nome}`;
    }catch(e){if(v===versao)box.innerHTML=`<div class="erro-box">${esc(e.message)}</div>`;}
  }
  $('#rg-gerar').onclick=gerar;await gerar();
}

async function telaRelatorioProdutoSpace() {
  const app = $('#app'), ciclo = cicloAtual(), travado = poloTravado();
  const f = { modelo: 'produto', produto: '', space: '', polo: travado ? String(B.usuario.polo_id) : '', ref: posicaoAtual(), ...ls.get('rel-produto-space', {}) };
  if (travado) f.polo = String(B.usuario.polo_id);
  const polos = B.polos.filter(p => p.ativo && (!travado || p.id === B.usuario.polo_id));
  const spaces = B.spaces.filter(s => s.ciclo_id === ciclo.id).sort((a,b) => a.data.localeCompare(b.data) || a.id-b.id);
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Metas por produto</b><a class="btn" href="#/painel/resumo">Voltar ao painel</a>
    <label>Modelo <select id="ps-modelo"><option value="produto">Produto × Space</option><option value="polo">Produto × Space × Polo</option></select></label>
    <label>Produto <select id="ps-produto"><option value="">Todos os produtos</option>${B.produtos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label>Space <select id="ps-space"><option value="">Todos os Spaces</option>${spaces.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select></label>
    <label>Polo <select id="ps-polo" ${travado ? 'disabled' : ''}>${travado ? '' : '<option value="">Todos os polos</option>'}${polos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label>Posição em <input type="date" id="ps-ref"></label><button class="btn prim" id="ps-gerar">Gerar relatório</button>
    <button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="ps-conteudo" class="rel"></div>`;
  for (const k of ['modelo','produto','space','polo','ref']) $('#ps-'+k).value = f[k];
  $('#ps-gerar').onclick = gerar;
  let geracao = 0;
  async function gerar() {
    const atual = ++geracao, box = $('#ps-conteudo');
    const filtro = Object.fromEntries(['modelo','produto','space','polo','ref'].map(k => [k,$('#ps-'+k).value]));
    if (travado) filtro.polo = String(B.usuario.polo_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filtro.ref)) { box.innerHTML = '<div class="erro-box">Informe a data de posição.</div>'; return; }
    ls.set('rel-produto-space', filtro);
    box.innerHTML = '<div class="carregando">Montando relatório…</div>';
    try {
      const selecionados = polos.filter(p => !filtro.polo || String(p.id) === filtro.polo);
      const etapas = spaces.filter(s => !filtro.space || String(s.id) === filtro.space);
      if (!selecionados.length) { box.innerHTML = '<div class="info">Aguardando definição dos Spaces, ou nenhum polo disponível para os filtros selecionados.</div>'; return; }
      const ritmos = await Promise.all(selecionados.map(p => api('/api/ritmo?' + qs({ciclo:ciclo.id,polo:p.id,ref:filtro.ref,relatorio:1}))));
      if (atual !== geracao) return;
      const produtos = B.produtos.filter(p => (!filtro.produto || String(p.id) === filtro.produto) && (selecionados.some(po => po.produtos.includes(p.id)) || ritmos.some(r => r.spaces.some(sp => sp.linhas.some(l => l.produtos?.some(x => x.produto_id === p.id))))));
      const dado = (r, sp, pr) => r.spaces.find(x => x.id === sp.id)?.linhas.flatMap(l => l.produtos || []).find(x => x.produto_id === pr.id) || {meta:0,esperado:0,realizado:0};
      const somar = (rs,sp,pr) => rs.map(r=>dado(r,sp,pr)).reduce((a,x)=>({meta:a.meta+x.meta,esperado:a.esperado+x.esperado,realizado:a.realizado+x.realizado}),{meta:0,esperado:0,realizado:0});
      const encerrado = (sp,pr) => sp.data <= filtro.ref || (pr.meta_ate && pr.meta_ate <= filtro.ref && pr.meta_ate <= sp.data);
      const celula = (x,sp,pr) => `<b>Meta: ${int(x.esperado)}</b><br>Realizado: ${int(x.realizado)}<br>${encerrado(sp,pr) ? saveGap(x.realizado-x.esperado) : `Faltam: ${int(Math.max(0,x.esperado-x.realizado))}`}`;
      const hojeProd = (r,pr) => r.hoje_situacao.linhas.flatMap(l=>l.produtos||[]).find(x=>x.produto_id===pr.id)||{meta:0,esperado:0,realizado:0};
      const resumoProduto = pr => {
        const h=ritmos.map(r=>hojeProd(r,pr)).reduce((a,x)=>({meta:a.meta+x.meta,realizado:a.realizado+x.realizado,esperado:a.esperado+x.esperado}),{meta:0,realizado:0,esperado:0});
        const etapasResumo=etapas.map(sp=>{
          const rs=ritmos.map(r=>r.spaces.find(x=>x.id===sp.id));
          const dias=rs.map(x=>x?.dias||0), menor=Math.min(...dias), maior=Math.max(...dias);
          return {...sp,...somar(ritmos,sp,pr),proximo:rs.some(x=>x?.proximo),dias:maior,dias_texto:menor===maior?String(maior):`${menor} a ${maior} conforme o polo`,por_dia:ritmos.reduce((a,r)=>a+(dado(r,sp,pr).por_dia||0),0)};
        });
        return resumoRelatorio({...h,ref:filtro.ref,spaces:etapasResumo,modo:ritmos[0]?.modo,titulo:'Resumo — '+pr.nome});
      };
      const cabecalho = (titulo,extra='') => timbreRelatorio(titulo, `${ciclo.nome} · ${selecionados.length === 1 ? selecionados[0].nome : 'Todos os polos'}${extra}`, `Posição em ${dataBR(filtro.ref)}`);
      // Produtos com prazo próprio são acompanhados pela meta integral, sem Spaces.
      const trimestrais = produtos.filter(pr => pr.meta_ate);
      const produtosSpace = produtos.filter(pr => !pr.meta_ate);
      const foraPrazo = trimestrais.length ? await notaSedeFora(ciclo.id, filtro.ref, filtro.polo, pid => trimestrais.some(t => t.id === pid)) : '';
      if (atual !== geracao) return;
      const relatorioTrimestral = trimestrais.map(pr => {
        const linhas=selecionados.map((po,i)=>({...hojeProd(ritmos[i],pr),nome:po.nome,...ritmos[i].acompanhamento?.[pr.id]}));
        const total={nome:'Total selecionado',meta:linhas.reduce((a,x)=>a+x.meta,0),realizado:linhas.reduce((a,x)=>a+x.realizado,0),esperado:somarConhecido(linhas,'esperado'),tutores:linhas.reduce((a,x)=>a+(x.tutores||0),0),sede:linhas.reduce((a,x)=>a+(x.sede||0),0),necessario_semana:linhas.some(x=>x.meta>0&&x.necessario_semana==null)?null:linhas.reduce((a,x)=>a+(x.necessario_semana||0),0)};
        const dias=linhas.map(x=>x.dias||0),min=Math.min(...dias),max=Math.max(...dias);
        const cartao=(t,v,d='')=>`<div><span>${esc(t)}</span><b>${v}</b><em>${esc(d)}</em></div>`;
        const ritmo=x=>x.meta<=0?'Sem meta':x.realizado>=x.meta?'Meta atingida':filtro.ref>pr.meta_ate?'Prazo encerrado':x.esperado==null?'Sem referência':x.realizado<x.esperado?'Abaixo do ritmo':x.realizado===0?'Sem matrículas':x.realizado===x.esperado?'Em linha com o esperado':'Acima do esperado';
        const linha=(x,t=false)=>`<tr class="${t?'total':''}"><td>${esc(x.nome)}</td><td class="num">${x.meta>0?int(x.meta):'—'}</td><td class="num ps-real">${int(x.realizado)}</td><td class="num">${x.meta>0?int(Math.max(0,x.meta-x.realizado)):'—'}</td><td class="num">${x.meta>0?pctTxt(pct(x.realizado,x.meta)):'—'}</td><td class="num">${x.meta>0?int(x.esperado):'—'}</td><td>${x.meta>0?(x.realizado===x.esperado?'Em linha com o esperado':saveGap(diferencaConhecida(x.realizado,x.esperado))):'—'}</td></tr>`;
        const atencao=linhas.filter(x=>x.meta>0&&x.esperado!=null&&x.realizado<x.esperado).sort((a,b)=>(b.esperado-b.realizado)-(a.esperado-a.realizado));
        const semanas=(linhas[0]?.semanas||[]).map((w,i)=>({...w,variacao:linhas.reduce((a,x)=>a+(x.semanas?.[i]?.variacao||0),0),acumulado:linhas.reduce((a,x)=>a+(x.semanas?.[i]?.acumulado||0),0)}));
        return `<section class="rel-pagina ps-folha ps-trimestral">${cabecalho(esc(pr.nome)+' — Meta trimestral')}<div class="ps-contexto">Meta até ${dataBR(pr.meta_ate)} · Posição em ${dataBR(filtro.ref)} · Acompanhamento pelo prazo próprio do produto.</div>
          ${resumoRelatorio({...total,ref:filtro.ref,titulo:'Resumo — '+pr.nome,prazoProprio:true})}
          <div class="rel-kpis">${cartao('Faltam para a meta',total.meta>0?int(Math.max(0,total.meta-total.realizado)):'—')}${cartao('Dias de venda restantes',min===max?int(max):`${min} a ${max}`,`Inclui a posição consultada · ${MODO_TXT[ritmos[0]?.modo]||ritmos[0]?.modo}`)}${cartao('Necessário na semana · soma dos polos',total.necessario_semana==null?'—':int(total.necessario_semana),'Soma das necessidades de cada polo, arredondadas para cima; não é uma meta semanal cadastrada')}${cartao('Composição do realizado',`${int(total.tutores)} + ${int(total.sede)}`,'Lançadas pelos tutores + Sede/Digital (Mundo Azul)')}</div>
          <h2>Meta e posição atual</h2><table class="t ps-tabela"><thead><tr><th>Polo</th><th class="num">Meta trimestral</th><th class="num">Realizado</th><th class="num">Faltam</th><th class="num">Atingimento</th><th class="num">Esperado na data</th><th>SAVE/GAP na data</th></tr></thead><tbody>${filtro.modelo==='polo'?linhas.map(x=>linha(x)).join(''):''}${linha(total,true)}</tbody></table>
          <h2>Ritmo e origem por polo</h2><table class="t ps-tabela"><thead><tr><th>Polo</th><th>Situação</th><th class="num">Dias restantes</th><th class="num">Necessário / dia</th><th class="num">Nesta semana</th><th class="num">Tutores</th><th class="num">Sede/Digital*</th></tr></thead><tbody>${linhas.map(x=>`<tr><td>${esc(x.nome)}</td><td>${ritmo(x)}</td><td class="num">${int(x.dias||0)}</td><td class="num">${x.por_dia==null?'—':dec1(x.por_dia)}</td><td class="num">${x.necessario_semana==null?'—':int(x.necessario_semana)}</td><td class="num">${int(x.tutores||0)}</td><td class="num">${int(x.sede||0)}</td></tr>`).join('')}</tbody></table>
          <p class="rp-nota"><b>Prioridade de recuperação:</b> ${atencao.length?atencao.slice(0,5).map(x=>`${esc(x.nome)}: ${int(x.esperado-x.realizado)} abaixo do esperado`).join(' · '):'Nenhum polo abaixo do esperado arredondado na data. Polos sem matrículas continuam identificados na tabela.'}</p>
          <h2>Últimas quatro semanas — evolução do consolidado</h2><table class="t ps-tabela"><thead><tr><th>Semana</th><th class="num">Variação oficial</th><th class="num">Acumulado ao corte</th></tr></thead><tbody>${semanas.map(w=>`<tr><td>${dataBR(w.inicio)} a ${dataBR(w.fim)}${w.parcial?' · parcial até '+dataBR(w.ate):''}</td><td class="num">${int(w.variacao)}</td><td class="num">${int(w.acumulado)}</td></tr>`).join('')}</tbody></table>
          ${foraPrazo}<footer class="rel-rodape">Esperado e SAVE/GAP usam o motor oficial, com calendário e feriados de cada polo. O ritmo considera o saldo para a meta integral até o prazo. Nesta semana = necessário por dia × dias de venda restantes na semana configurada, limitado ao prazo e arredondado para cima em cada polo. * Sede/Digital: Mundo Azul − lançadas pelos tutores, somente quando o produto do polo é conhecido, sem duplicar lançamentos. A variação semanal é a diferença entre posições acumuladas e pode incluir ajustes de conciliação, inclusive negativos; não representa necessariamente novas matrículas. Sem meta ou sem dias disponíveis, o ritmo aparece como —.</footer></section>`;
      }).join('');
      const foraSpace = produtosSpace.length ? await notaSedeFora(ciclo.id, filtro.ref, filtro.polo, pid => produtosSpace.some(t => t.id === pid)) : '';
      if (atual !== geracao) return;
      const nota = foraSpace + `<footer class="rel-rodape">Valores acumulados. Encerrados: matrículas até a data do Space; futuros: matrículas até a posição consultada e quantidade que falta. Respeita o prazo próprio de cada produto. Totais da rede somam os valores dos polos, inclusive o arredondamento das metas. SAVE/GAP = realizado − meta acumulada do Space.</footer>`;

      let html = '';
      if (filtro.modelo === 'produto') {
        html = `<section class="rel-pagina">${cabecalho('Produto × Space')}${produtosSpace.map(resumoProduto).join('')}<table class="t"><thead><tr><th>Produto</th><th>Space / data</th><th>% previsto</th><th>Meta do processo</th><th>Meta acumulada</th><th>Realizado</th><th>Situação</th></tr></thead><tbody>${produtosSpace.flatMap(pr => etapas.map(sp => { const x=somar(ritmos,sp,pr);return `<tr><td>${esc(pr.nome)}${pr.meta_ate ? `<br><small>Prazo: ${dataBR(pr.meta_ate)}</small>` : ''}</td><td>${esc(sp.nome)}<br>${dataBR(sp.data)}</td><td class="num">${pctTxt(sp.percentual)}</td><td class="num">${x.meta>0?int(x.meta):'—'}</td><td class="num">${int(x.esperado)}</td><td class="num">${int(x.realizado)}</td><td>${x.meta<=0?'Sem meta cadastrada':encerrado(sp,pr) ? saveGap(x.realizado-x.esperado) : `Faltam ${int(Math.max(0,x.esperado-x.realizado))} · parcial`}</td></tr>`; })).join('')}</tbody></table>${nota}</section>`;
      } else {
        // Até dois Spaces por tabela: quatro indicadores numéricos por Space.
        const numeros = (x,sp,pr) => `<td class="num">${int(x.esperado)}</td><td class="num ps-real">${int(x.realizado)}</td><td class="num">${x.meta<=0?'Sem meta':encerrado(sp,pr) ? saveGap(x.realizado-x.esperado) : int(Math.max(0,x.esperado-x.realizado))}</td><td class="num">${x.esperado ? pctTxt(pct(x.realizado,x.esperado)) : '—'}</td>`;
        for (const pr of produtosSpace) for (let ini=0;ini<etapas.length;ini+=1) {
          const lote=etapas.slice(ini,ini+1);
          const titulo = `${esc(pr.nome)} — ${lote.map(sp=>esc(sp.nome)).join(' / ')}`;
          html += `<section class="rel-pagina ps-folha">${cabecalho(titulo)}${ini===0?resumoProduto(pr):''}<div class="ps-contexto">${lote.map(sp=>`${esc(sp.nome)}: ${dataBR(sp.data)} · ${pctTxt(sp.percentual)} previsto${sp.data > filtro.ref ? ' · acompanhamento parcial' : ''}`).join(' &nbsp; | &nbsp; ')}${pr.meta_ate ? ` · Prazo do produto: ${dataBR(pr.meta_ate)}` : ''}</div><table class="t ps-tabela"><thead><tr><th rowspan="2" class="ps-polo">Polo</th><th rowspan="2" class="num">Meta processo</th><th rowspan="2" class="num">Esperado na data</th><th rowspan="2">SAVE/GAP na data</th>${lote.map(sp=>`<th colspan="4" class="ps-grupo">${esc(sp.nome)}</th>`).join('')}</tr><tr>${lote.map(sp=>`<th class="num">Meta do Space</th><th class="num">Realizado</th><th class="num">${encerrado(sp,pr) ? 'SAVE/GAP' : 'Faltam'}</th><th class="num">Atingimento</th>`).join('')}</tr></thead><tbody>${selecionados.map((po,i)=>`<tr><td class="ps-polo">${esc(po.nome)}</td>${(()=>{const h=hojeProd(ritmos[i],pr);return `<td class="num">${h.meta>0?int(h.meta):'—'}</td><td class="num">${h.meta>0?int(h.esperado):'—'}</td><td>${h.meta>0?saveGap(diferencaConhecida(h.realizado,h.esperado)):'Sem meta'}</td>`})()}${lote.map(sp=>numeros(dado(ritmos[i],sp,pr),sp,pr)).join('')}</tr>`).join('')}<tr class="total"><td class="ps-polo">Total selecionado</td>${(()=>{const h=ritmos.map(r=>hojeProd(r,pr)).reduce((a,x)=>({meta:a.meta+x.meta,esperado:a.esperado+x.esperado,realizado:a.realizado+x.realizado}),{meta:0,esperado:0,realizado:0});return `<td class="num">${h.meta>0?int(h.meta):'—'}</td><td class="num">${h.meta>0?int(h.esperado):'—'}</td><td>${h.meta>0?saveGap(diferencaConhecida(h.realizado,h.esperado)):'Sem meta'}</td>`})()}${lote.map(sp=>numeros(somar(ritmos,sp,pr),sp,pr)).join('')}</tr></tbody></table>${nota}</section>`;
        }
      }
      if (filtro.modelo === 'produto' && (!produtosSpace.length || !etapas.length)) html = '';
      if (produtosSpace.length && !etapas.length) html += '<div class="info">Os produtos que participam dos Spaces aguardam a definição das etapas.</div>';
      html = relatorioTrimestral + html;
      const estilo = `<style>
      .rel .ps-folha { max-width:1100px; margin:0 auto 24px; padding:26px; }
      .rel .ps-contexto { margin:12px 0 18px; font-size:13px; color:#475569; }
      .rel .ps-tabela { table-layout:fixed; width:100%; }
      .rel .ps-tabela .ps-polo { width:19%; min-width:0; text-align:left; font-weight:600; }
      .rel .ps-tabela th,.rel .ps-tabela td { padding:10px 6px; font-size:12px; vertical-align:middle; overflow-wrap:break-word; white-space:normal; }
      .rel .ps-tabela th { background:#edf3fb; color:#243b60; font-size:12px; }
      .rel .ps-tabela .ps-grupo { text-align:center; border-bottom:1px solid #cbd5e1; }
      .rel .ps-tabela tbody tr:nth-child(even) { background:#f8fafc; }
      .rel .ps-tabela .num { text-align:right; font-variant-numeric:tabular-nums; }
      .rel .ps-tabela .ps-real { font-weight:700; }
      .rel .ps-tabela tr.total td { background:#e8effb; color:#153c78; font-weight:700; border-top:2px solid #315eaa; }
      .rel .ps-folha .rel-rodape { font-size:11px; line-height:1.5; margin-top:18px; }
      @media print {
        .rel .ps-folha { max-width:none; padding:0; break-after:page; break-inside:auto; }
        .rel .ps-folha h2 { break-after:avoid; }
        .rel .ps-folha:last-child { break-after:auto; }
        /* A4: compacta somente o relatório trimestral; mantém quebras naturais para redes maiores. */
        .rel .rel-pagina.ps-folha.ps-trimestral { font-size:8pt; line-height:1.25; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rel-timbre { margin-bottom:8px; padding-bottom:8px; }
        .rel .rel-pagina.ps-folha.ps-trimestral .ps-contexto { margin:6px 0 8px; font-size:8pt; }
        .rel .rel-pagina.ps-folha.ps-trimestral h2 { font-size:9pt; margin:9px 0 5px; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rp-resumo { margin:6px 0; padding:0; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rel-kpis { gap:5px; margin:6px 0; }
        .rel .rel-pagina.ps-folha.ps-trimestral > .rel-kpis { grid-template-columns:repeat(4,minmax(0,1fr)); }
        .rel .rel-pagina.ps-folha.ps-trimestral .rel-kpis > div { padding:5px; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rel-kpis b { font-size:12pt; margin:3px 0; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rel-kpis span,.rel .rel-pagina.ps-folha.ps-trimestral .rel-kpis em { font-size:7pt; line-height:1.25; }
        .rel .rel-pagina.ps-folha.ps-trimestral table.ps-tabela th,.rel .rel-pagina.ps-folha.ps-trimestral table.ps-tabela td { font-size:7pt; padding:2px 4px; line-height:1.25; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rp-nota { font-size:7pt; margin:6px 0; line-height:1.3; }
        .rel .rel-pagina.ps-folha.ps-trimestral .rel-rodape { font-size:7pt; line-height:1.3; margin-top:8px; }

        .rel .ps-tabela th,.rel .ps-tabela td { font-size:11px; padding:8px 6px; }
        .rel .ps-tabela th { font-size:10px; }
        .rel .ps-tabela .ps-polo { min-width:0; width:24%; }
        .rel .ps-tabela tr { break-inside:avoid; }
        .rel .ps-tabela thead { display:table-header-group; }
      }
      </style>`;
      box.innerHTML = produtos.length ? estilo + html : '<div class="info">Nenhum produto disponível para os filtros selecionados.</div>';
      document.title = `Metas por produto — ${ciclo.nome}`;
    } catch(e) { if(atual === geracao) box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  await gerar();
}

async function telaRelatorioMetas(alvo) {
  const app = $('#app');
  const travado = poloTravado();
  if (travado) alvo = String(B.usuario.polo_id);
  alvo = alvo || 'geral';
  const comReal = ls.get('rel-metas-real', true);
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Relatório de metas</b><a class="btn" href="#/relatorio-produto-space">Produto × Space / Polo</a>
    <select id="rm-alvo" ${travado ? 'disabled' : ''}>${travado ? '' : '<option value="geral">Quadro geral — todos os polos</option><option value="todos">Quadro geral + um polo por página</option>'}${B.polos.filter(p => p.ativo).map(p => `<option value="${p.id}">Polo ${esc(p.nome)}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="rm-real" ${comReal ? 'checked' : ''}> Incluir realizado e SAVE/GAP</label>
    <button class="btn prim" onclick="window.print()">Imprimir / Salvar PDF</button><span class="muted">Na impressão, escolha "Salvar como PDF" (de preferência em paisagem).</span></div>
    <div id="rel-conteudo" class="rel"><div class="carregando">Montando relatório…</div></div>`;
  $('#rm-alvo').value = alvo;
  $('#rm-alvo').onchange = (e) => { location.hash = '#/relatorio-metas/' + e.target.value; telaRelatorioMetas(e.target.value); };
  $('#rm-real').onchange = (e) => { ls.set('rel-metas-real', e.target.checked); telaRelatorioMetas($('#rm-alvo').value); };
  const ciclo = cicloAtual();
  document.title = `Relatório de metas — ${ciclo.nome}`;
  try {
    const metas = await api('/api/metas?ciclo=' + ciclo.id);
    const meta = (po, pr) => (metas.find(m => m.polo_id === po && m.produto_id === pr) || {}).quantidade || 0;
    const polos = B.polos.filter(p => p.ativo && (!travado || p.id === B.usuario.polo_id));
    const prods = B.produtos.filter(pr => polos.some(po => po.produtos.includes(pr.id)) || metas.some(m => m.produto_id === pr.id && m.quantidade));
    const geral = alvo === 'geral' || alvo === 'todos';
    const listaPolos = alvo === 'todos' ? polos : geral ? [] : polos.filter(p => String(p.id) === String(alvo));
    // situação de cada polo (realizado, esperado na data e por Space) vem do painel
    const paineis = {};
    for (const po of (geral ? polos : listaPolos)) paineis[po.id] = await api('/api/painel?' + qs({ ciclo: ciclo.id, polo: po.id, ref: posicaoAtual() }));
    const ref = Object.values(paineis)[0]?.ritmo.hoje || B.hoje;
    const spaces = B.spaces.filter(sp => sp.ciclo_id === ciclo.id);
    const prodRitmo = (lin, pid) => lin ? lin.linhas.flatMap(l => l.produtos || []).find(x => x.produto_id === pid) : null;
    const nota = prods.some(p => p.meta_ate) ? `<p class="muted" style="font-size:12px">${prods.filter(p => p.meta_ate).map(p => `${esc(p.nome)}: meta até ${dataBR(p.meta_ate)}`).join(' · ')} (o esperado desses produtos vai até essa data).</p>` : '';
    let html = '';
    if (geral) {
      const subs = [...new Set(prods.map(p => p.subgrupo).filter(Boolean))];
      const totPolo = (po) => prods.reduce((a, pr) => a + meta(po.id, pr.id), 0);
      const realPolo = (po, pr) => (paineis[po.id].porPolo.find(x => x.id === po.id)?.produtos || {})[pr] || 0;
      const cel = (po, pr) => { const mt = meta(po.id, pr.id); const rl = realPolo(po, pr.id);
        if (!mt && !(comReal && rl)) return '<td class="num muted">—</td>';
        return comReal ? `<td class="num"><b>${int(rl)}</b><span class="muted">/${int(mt)}</span><br><small class="muted">${mt ? pctTxt(pct(rl, mt)) : ''}</small></td>` : `<td class="num">${int(mt)}</td>`; };
      html += `<section class="rel-pagina rel-metas">${timbreRelatorio('Relatório de metas', `Quadro geral · ${ciclo.nome}`, comReal ? `Posição em ${dataBR(ref)}` : `Processo ${dataBR(ciclo.data_inicio || '')} a ${dataBR(ciclo.data_fim || '')}`)}
        ${comReal ? resumoRedeRelatorios(paineis) : '<p>Modo planejamento: os realizados e SAVE/GAP estão ocultos.</p>'}
        <h2>Metas por polo e produto${comReal ? ' — realizado / meta' : ''}</h2>
        <table class="t rm-grade"><thead><tr><th>Polo</th>${prods.map(pr => `<th class="num">${esc(nomeP(pr.id, pr.nome))}</th>`).join('')}<th class="num">Total</th>${comReal ? '<th>SAVE/GAP</th>' : ''}</tr></thead><tbody>
          ${polos.map(po => { const d = paineis[po.id], H = d.ritmo.hoje_situacao, tp = totPolo(po);
            return `<tr><td><b>${esc(po.nome)}</b></td>${prods.map(pr => cel(po, pr)).join('')}
              <td class="num"><b>${comReal ? `${int(H.total.realizado)}</b><span class="muted">/${int(tp)}</span><br><small class="muted">${pctTxt(pct(H.total.realizado, tp))}</small>` : `${int(tp)}</b>`}</td>
              ${comReal ? `<td>${saveGap(H.total.saldo)}</td>` : ''}</tr>`; }).join('')}
          <tr class="total"><td>Rede</td>${prods.map(pr => { const mt = polos.reduce((a, po) => a + meta(po.id, pr.id), 0), rl = polos.reduce((a, po) => a + realPolo(po, pr.id), 0); return `<td class="num">${comReal ? `${int(rl)}/${int(mt)}` : int(mt)}</td>`; }).join('')}
            <td class="num">${comReal ? `${int(polos.reduce((a, po) => a + paineis[po.id].ritmo.hoje_situacao.total.realizado, 0))}/` : ''}${int(polos.reduce((a, po) => a + totPolo(po), 0))}</td>
            ${comReal ? `<td>${saveGap(somarConhecido(polos.map(po=>paineis[po.id].ritmo.hoje_situacao.total),'saldo'))}</td>` : ''}</tr>
        </tbody></table>${nota}
        ${spaces.length ? `<h2>Metas por Space — quanto cada polo precisa ter acumulado em cada data</h2>
        <table class="t"><thead><tr><th>Polo</th>${spaces.map(sp => `<th class="num">${esc(sp.nome)}<br><small>${dataBR(sp.data).slice(0, 5)} · ${pctTxt(sp.percentual)}</small></th>`).join('')}</tr></thead><tbody>
          ${polos.map(po => { const R = paineis[po.id].ritmo; return `<tr><td><b>${esc(po.nome)}</b></td>${R.spaces.map(sp => `<td class="num">${int(sp.total.esperado)}${comReal && sp.passado ? `<br>${saveGap(sp.total.saldo)}` : ''}</td>`).join('')}</tr>`; }).join('')}
          <tr class="total"><td>Rede</td>${spaces.map((sp, i) => `<td class="num">${int(polos.reduce((a, po) => a + (paineis[po.id].ritmo.spaces[i]?.total.esperado || 0), 0))}</td>`).join('')}</tr>
        </tbody></table>` : ''}
        <footer class="rel-rodape">Metas cadastradas em Configuração › Metas e Spaces. O valor de cada Space é a meta acumulada esperada até aquela data (meta × % do Space).${comReal ? ' Realizado e SAVE/GAP na posição ' + dataBR(ref) + '.' : ''}</footer></section>`;
    }
    for (const po of listaPolos) {
      const d = paineis[po.id], R = d.ritmo, H = R.hoje_situacao;
      const ps = prods.filter(pr => po.produtos.includes(pr.id) || meta(po.id, pr.id) || (comReal && d.porProduto.find(x => x.id === pr.id)?.qtd));
      const itens = hierarquia(ps.map(pr => ({ id: pr.id, categoria_id: pr.categoria_id, nome: pr.nome })), () => ({}));
      const linhaPolo = (nome, it, cls) => {
        const ids = it.tipo === 'prod' ? [it.x.id] : it.tipo === 'total' ? ps.map(p => p.id) : it.ids;
        const mt = ids.reduce((a, i) => a + meta(po.id, i), 0);
        const h = ritmoDe(H, it);
        return `<tr class="${cls}"><td>${esc(nome)}</td><td class="num"><b>${int(mt)}</b></td>${R.spaces.map(sp => { const x = ritmoDe(sp, it); return `<td class="num">${x ? int(x.esperado) : '—'}</td>`; }).join('')}
          ${comReal ? `<td class="num col-g"><b>${h ? int(h.realizado) : 0}</b></td><td class="num">${mt ? pctTxt(pct(h ? h.realizado : 0, mt)) : '—'}</td><td class="num">${h ? int(h.esperado) : '—'}</td><td>${h && mt ? saveGap(h.saldo) : '—'}</td>` : ''}</tr>`;
      };
      html += `<section class="rel-pagina rel-metas">${timbreRelatorio('Relatório de metas', `Polo ${po.nome} · ${ciclo.nome}`, comReal ? `Posição em ${dataBR(R.hoje)}` : '')}
        ${comReal ? resumoRitmo(R, 'Resumo do polo') : '<p>Modo planejamento: os realizados e SAVE/GAP estão ocultos.</p>'}
        <h2>Metas por produto e por Space (acumulado)</h2>
        <table class="t"><thead><tr><th>Produto</th><th class="num">Meta</th>${R.spaces.map(sp => `<th class="num">${esc(sp.nome)}<br><small>${dataBR(sp.data).slice(0, 5)}</small></th>`).join('')}${comReal ? '<th class="num col-g">Realizado</th><th class="num">%</th><th class="num">Esperado hoje</th><th>SAVE/GAP</th>' : ''}</tr></thead><tbody>
          ${linhasHier(itens, 6 + R.spaces.length, (x, cls, nome, it) => linhaPolo(nome, it, cls))}
          ${linhaPolo('Total', { tipo: 'total' }, 'total')}</tbody></table>${nota}
        <footer class="rel-rodape">Cada coluna de Space mostra a meta acumulada esperada até aquela data.${comReal ? ' Realizado e SAVE/GAP na posição ' + dataBR(R.hoje) + '.' : ''}</footer></section>`;
    }
    $('#rel-conteudo').innerHTML = html || '<div class="erro-box">Nenhuma meta cadastrada neste processo.</div>';
  } catch (e) { $('#rel-conteudo').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
}

// ======================================================================= RELATÓRIO DO TUTOR (processo inteiro ou período)
async function telaRelatorioEquipe(poloId, tutorId) {
  const app = $('#app');
  if (poloTravado()) poloId = String(B.usuario.polo_id);
  poloId = Number(poloId) || (B.polos.find(p => p.ativo) || {}).id;
  const disponiveis=await api('/api/tutores-processo?'+qs({ciclo:estado.ciclo,polo:poloId,ref:posicaoAtual()}));
  const tutoresDo = () => disponiveis;
  const f = { de:'',ate:'', ...(ls.get('rel-tutor-periodo',{})||{}),ref:posicaoAtual() };
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Relatório por tutor</b>
    <select id="rt-polo" ${poloTravado() ? 'disabled' : ''}>${B.polos.filter(p => p.ativo).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select>
    <select id="rt-tutor"><option value="todos">Equipe e histórico do polo (um por página)</option>${tutoresDo(poloId).map(t => `<option value="${t.id}">${esc(t.nome)}${t.atual?'':' (histórico)'}</option>`).join('')}</select>
    <label class="muted">Posição <input type="date" id="rt-ref" value="${f.ref}" max="${B.hoje}"></label><label class="muted">De <input type="date" id="rt-de" value="${f.de}"></label><label class="muted">Até <input type="date" id="rt-ate" value="${f.ate}"></label>
    <button class="btn prim" onclick="window.print()">Imprimir / Salvar PDF</button><span class="muted">Sem datas = processo inteiro até a posição do painel.</span></div>
    <div id="rel-conteudo" class="rel"><div class="carregando">Montando relatório…</div></div>`;
  $('#rt-polo').value = poloId; $('#rt-tutor').value = tutorId && tutorId !== 'todos' && tutoresDo(poloId).some(t => String(t.id) === String(tutorId)) ? tutorId : 'todos';
  const ir = () => { ls.set('rel-tutor-periodo', { de: $('#rt-de').value, ate: $('#rt-ate').value }); posicaoEscolhida=$('#rt-ref').value; const hash=`#/relatorio-equipe/${$('#rt-polo').value}/${$('#rt-tutor').value}`; if(location.hash===hash) telaRelatorioEquipe($('#rt-polo').value,$('#rt-tutor').value); else location.hash=hash; };
  $('#rt-polo').onchange = () => { $('#rt-tutor').value = 'todos'; ir(); };
  $('#rt-ref').onchange = ir; $('#rt-tutor').onchange = ir; $('#rt-de').onchange = ir; $('#rt-ate').onchange = ir;
  try {
    if(f.de && f.ate && f.de>f.ate) throw new Error('A data inicial deve ser anterior à final.');
    if(f.ate && f.ate>f.ref) throw new Error('O fim do período não pode superar a posição consultada.');
    const periodo = f.de || f.ate;
    const d = await api('/api/painel?' + qs({ ciclo: estado.ciclo, polo: poloId, ref: f.ref,historico:'1' }));
    const R = d.ritmo, modo = R.modo, prox = R.spaces.find(x => x.proximo);
    const lista = [];
    let pagina = 1, dd;
    do { dd = await api('/api/matriculas?' + qs({ ciclo: estado.ciclo, polo: poloId, credito_tutor:1,prazo_meta:1, de: f.de, ate: f.ate || R.hoje, limite: 5000, pagina })); lista.push(...dd.linhas); pagina++; } while (lista.length < dd.total && dd.linhas.length);
    const alvo = $('#rt-tutor').value === 'todos' ? d.porTutor : d.porTutor.filter(t => String(t.tutor_id) === $('#rt-tutor').value);
    const semAtual = await api('/api/ritmo-semanal?' + qs({ ciclo: estado.ciclo, polo:poloId,semana:R.hoje,ref:R.hoje,historico:'1' }));
    document.title = `Relatório por tutor — ${nomePor('polos', poloId)} — ${cicloAtual().nome}`;
    const detalhesTutor = {};
    await Promise.all(alvo.map(async t => { detalhesTutor[t.tutor_id] = await api('/api/tutor?' + qs({ciclo:estado.ciclo,polo:poloId,tutor:t.tutor_id,ref:R.hoje})); }));
    const pagina1 = (t) => {
      const ms = lista.filter(m => m.tutor_id === t.tutor_id && (m.tutor_polo_id || m.polo_id) === t.polo_id).sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
      const qtd = ms.length, valor = ms.reduce((a, m) => a + m.valor, 0);
      const porProd = B.produtos.filter(p=>d.porProduto.some(x=>x.id===p.id)||ms.some(x=>x.produto_id===p.id)).map(p => ({ ...p, n: ms.filter(m => m.produto_id === p.id).length, v: ms.filter(m => m.produto_id === p.id).reduce((a, m) => a + m.valor, 0) }));
      const semanas = {}; for (const m of ms) { const sg = segundaDe(m.data); semanas[sg] = (semanas[sg] || 0) + 1; }
      const origens = {}; for (const m of ms) origens[m.origem] = (origens[m.origem] || 0) + 1;
      const titulo = `${t.nome} · ${t.polo}${t.atual?'':' · histórico ('+t.situacao.replace('_',' ')+')'}`;
      return `<section class="rel-pagina">${timbreRelatorio('Relatório do tutor', `${titulo} · ${cicloAtual().nome}`, periodo ? `${f.de ? dataBR(f.de) : 'início'} a ${f.ate ? dataBR(f.ate) : dataBR(R.hoje)}` : `Posição em ${dataBR(R.hoje)}`)}
        ${resumoRelatorio({meta:t.meta,realizado:t.qtd,esperado:t.esperado,ref:R.hoje,modo,spaces:detalhesTutor[t.tutor_id].spaces.map(sp=>({...sp,percentual:detalhesTutor[t.tutor_id].spaces.find(x=>x.nome===sp.nome)?.percentual})),titulo:'Resumo do tutor no processo'})}
        <div class="rel-kpis">
          <div><span>Matrículas no processo</span><b>${int(t.qtd)}${t.meta != null ? ` <small>/ ${dec1(t.meta).replace(',0', '')}</small>` : ''}</b><em>${t.meta != null ? `${pctTxt(pct(t.qtd, t.meta))} da meta do tutor${t.meta_origem === 'dividida' ? ' (meta do polo ÷ equipe)' : ''}` : 'sem meta do tutor'}</em></div>
          <div><span>Dias sem vender</span><b>${situacaoVenda(t, R.hoje).texto}</b><em>${situacaoVenda(t, R.hoje).detalhe} · dias corridos</em></div>
          <div><span>SAVE / GAP</span><b>${t.saldo != null ? saveGap(t.saldo) : '—'}</b><em>${t.esperado != null ? `esperado até ${dataBR(R.hoje)}: ${int(t.esperado)}` : ''}</em></div>
          <div><span>${prox ? `Até o ${esc(prox.nome)} (${dataBR(prox.data)})` : 'Próximo Space'}</span><b>${t.proximo ? (t.proximo.falta ? `faltam ${int(t.proximo.falta)}` : '✓') : '—'}</b><em>${t.proximo && t.proximo.falta ? `precisa ${precisaTxt(t.proximo.por_dia, modo)}` : ''}</em></div>
          <div><span>Semana ${dataBR(semAtual.inicio).slice(0, 5)} a ${dataBR(semAtual.fim).slice(0, 5)}</span>${(() => { const w = semAtual.tutores.find(x => x.tutor_id === t.tutor_id && x.polo_id === t.polo_id); return w ? `<b>${int(w.total)}${w.meta != null ? ` <small>/ ${int(w.meta)}</small>` : ''}</b><em>${w.meta != null ? `faltam ${int(Math.max(0, w.meta - w.total))} para a meta da semana` : w.sugestao != null ? `sem meta semanal · sugerida ${int(w.sugestao)}` : 'sem meta semanal'}</em>` : '<b>—</b>'; })()}</div>
          <div><span>${periodo ? 'No período' : 'RPV no processo'}</span><b>${periodo ? int(qtd) + ' <small>matr.</small>' : brl(valor)}</b><em>${periodo ? `${brl(valor)} · ticket ${qtd ? brl(valor / qtd) : '—'}` : `ticket médio ${qtd ? brl(valor / qtd) : '—'}`}</em><em>última venda: ${t.ultima ? dataBR(t.ultima) : '—'}</em></div>
        </div>
        ${periodo ? `<p class="muted" style="margin:4px 0 0">Detalhes abaixo: ${f.de ? dataBR(f.de) : 'início do processo'} a ${f.ate ? dataBR(f.ate) : dataBR(R.hoje)}.</p>` : ''}
        <h2>${periodo ? 'Resultado do período selecionado — por produto' : 'Acumulado do processo — por produto'}</h2>
        ${porProd.length ? `<table class="t"><thead><tr><th>Produto</th><th class="num">Matrículas</th><th class="num">Part.</th><th class="num">Ticket</th><th class="num">RPV</th></tr></thead><tbody>
          ${porProd.map(p => `<tr><td>${esc(p.nome)}</td><td class="num"><b>${int(p.n)}</b></td><td class="num">${pctTxt(pct(p.n, qtd))}</td><td class="num">${p.n ? brl(p.v / p.n) : '—'}</td><td class="num">${brl(p.v)}</td></tr>`).join('')}
          <tr class="total"><td>Total</td><td class="num">${int(qtd)}</td><td class="num">100%</td><td class="num">${qtd ? brl(valor / qtd) : '—'}</td><td class="num">${brl(valor)}</td></tr></tbody></table>` : `<p class="aviso">Nenhuma matrícula lançada para ${esc(t.nome)} (${esc(t.polo)}) ${periodo ? `entre ${f.de ? dataBR(f.de) : 'o início'} e ${f.ate ? dataBR(f.ate) : dataBR(R.hoje)}` : 'neste processo'}. Se ela tem matrículas, confira em Matrículas se foram lançadas com este tutor, este polo e a data certa.</p>`}
        ${qtd ? `<div class="grid g2"><div><h2>Semana a semana</h2><table class="t"><thead><tr><th>Semana (início)</th><th class="num">Matrículas</th></tr></thead><tbody>${Object.entries(semanas).sort().map(([w, n]) => `<tr><td>${dataBR(w)}</td><td class="num">${int(n)}</td></tr>`).join('')}</tbody></table></div>
          <div><h2>Origens</h2><table class="t"><thead><tr><th>Origem</th><th class="num">Matrículas</th><th class="num">%</th></tr></thead><tbody>${Object.entries(origens).sort((a, b) => b[1] - a[1]).map(([o, n]) => `<tr><td>${esc(o)}</td><td class="num">${int(n)}</td><td class="num">${pctTxt(pct(n, qtd))}</td></tr>`).join('')}</tbody></table></div></div>
        <h2>Matrículas</h2><table class="t"><thead><tr><th>Data</th><th>Aluno</th><th>Polo de destino</th><th>Produto</th><th>Curso</th><th>Origem</th><th class="num">Mensalidade</th></tr></thead><tbody>
          ${ms.map(m => `<tr><td>${dataBR(m.data)}</td><td>${esc(m.aluno || 'não informado')}${idAluno(m)}</td><td>${esc(m.polo)}</td><td>${esc(m.produto)}</td><td class="muted">${esc(m.curso || '—')}</td><td>${esc(m.origem)}</td><td class="num">${brl(m.valor)}</td></tr>`).join('')}</tbody></table>` : ''}
        <footer class="rel-rodape">Meta do tutor: individual (Configuração › Metas e Spaces › Meta por tutor) ou a meta do polo dividida pela equipe. SAVE/GAP = realizado − esperado até a posição, com o mesmo ritmo do polo. Matrículas são atribuídas ao polo de crédito do tutor. Os indicadores do topo são do processo até a posição; os detalhes abaixo respeitam o período selecionado. Produtos com prazo próprio consideram matrículas até esse prazo. CPF não é exibido.</footer></section>`;
    };
    // Sede/Digital do polo: matrículas do Mundo Azul que os tutores não lançaram (não entram na meta de nenhum tutor)
    const T = d.totais || {};
    let alunosSede = [];
    if (T.sede) { try { const L = await api('/api/ma/lista?' + qs({ ciclo: cicloAtual().id, ref: R.hoje })); alunosSede = (L.itens || []).filter(i => i.status === 'sede' && i.polo_id === Number(poloId)); } catch { /* sem lista */ } }
    const paginaSede = () => {
      if (!T.sede) return '';
      const ps = d.porProduto.filter(p => p.sede);
      return `<section class="rel-pagina">${timbreRelatorio('Sede/Digital do polo', `${nomePor('polos', poloId)} · ${cicloAtual().nome}`, `Posição em ${dataBR(R.hoje)}`)}
        <div class="rel-kpis"><div><span>Matrículas Sede/Digital</span><b>${int(T.sede)}</b><em>Mundo Azul − lançadas pelos tutores</em></div>
          <div><span>Realizado do polo</span><b>${int(T.qtd)}</b><em>${int(qtdT(T))} dos tutores + ${int(T.sede)} Sede/Digital</em></div></div>
        <h2>Por produto</h2><table class="t"><thead><tr><th>Produto</th><th class="num">Sede/Digital</th></tr></thead><tbody>
          ${ps.map(p => `<tr><td>${esc(p.nome)}</td><td class="num"><b>${int(p.sede)}</b></td></tr>`).join('')}
          ${T.sede_sem_produto ? `<tr><td>Produto não informado</td><td class="num">${int(T.sede_sem_produto)}</td></tr>` : ''}
          <tr class="total"><td>Total</td><td class="num">${int(T.sede)}</td></tr></tbody></table>
        ${alunosSede.length ? `<h2>Alunos</h2><table class="t"><thead><tr><th>Aluno</th><th>Curso</th><th>Produto</th><th>Data</th><th>Inscrito por</th></tr></thead><tbody>${alunosSede.map(i => `<tr><td>${esc(i.nome)}${idAluno(i)}</td><td><small>${esc(i.curso)}</small></td><td>${esc(i.produto || '')}</td><td>${dataBR(i.data)}</td><td class="muted"><small>${esc(i.inscrito_por || '')}</small></td></tr>`).join('')}</tbody></table>` : ''}
        <footer class="rel-rodape">Sede/Digital = matrículas do Mundo Azul (central, site) que não foram lançadas pelos tutores, conforme a lista de alunos importada vigente na data. Contam no resultado do polo e do produto; não entram na meta, no ranking, no ticket nem no RPV de nenhum tutor. Os alunos vêm da planilha do Mundo Azul (aluno com R.A. que nenhum tutor lançou).</footer></section>`;
    };
    const avisoSede = T.sede ? `<p class="rp-nota">O polo também tem ${int(T.sede)} matrícula(s) Sede/Digital (${d.porProduto.filter(p => p.sede).map(p => `${esc(p.nome)} ${int(p.sede)}`).join(', ') || 'produto não informado'}), que não são creditadas a tutores${$('#rt-tutor').value === 'todos' ? ' — veja a última página' : ''}.</p>` : '';
    $('#rel-conteudo').innerHTML = alvo.length ? alvo.map(t => pagina1(t).replace('<footer class="rel-rodape">Meta do tutor:', avisoSede + '<footer class="rel-rodape">Meta do tutor:')).join('') + ($('#rt-tutor').value === 'todos' ? paginaSede() : '') : '<div class="erro-box">Nenhum tutor ativo neste polo.</div>';
  } catch (e) { $('#rel-conteudo').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
}

async function telaRelatorioCampanha(id) {
  const app = $('#app');
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Relatório da campanha</b><label class="check"><input type="checkbox" id="rc-det" checked> Listar as matrículas de cada participante</label>
    <button class="btn prim" onclick="window.print()">Imprimir / Salvar PDF</button><span class="muted">Na impressão, escolha “Salvar como PDF” e desative cabeçalhos e rodapés do navegador.</span></div>
    <div class="rel" id="cp-rel"><div class="carregando">Montando relatório…</div></div>`;
  let cp;
  try { cp = await api('/api/campanhas/' + Number(id)); } catch (e) { $('#cp-rel').innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; return; }
  document.title = `Campanha — ${cp.nome}`;
  const porPolo = cp.beneficiario === 'polo';
  const sit = { andamento: 'em andamento — valores parciais', futura: 'ainda não começou', encerrada: 'encerrada — valores finais' }[cp.situacao];
  const render = () => {
    const det = $('#rc-det').checked;
    const premiados = cp.ranking.filter(g => g.valor > 0);
    const comMatr = cp.ranking.filter(g => g.qtd);
    $('#cp-rel').innerHTML = `<section class="rel-pagina rel-campanha">${timbreRelatorio('Relatório de campanha', cp.nome, `${dataBR(cp.inicio)}${cp.fim !== cp.inicio ? ' a ' + dataBR(cp.fim) : ''}`)}
      <div class="rel-kpis"><div><span>Situação</span><b style="font-size:14px">${esc(sit)}</b></div><div><span>Matrículas válidas</span><b>${int(cp.total_matriculas)}</b></div><div><span>Premiados</span><b>${int(premiados.length)}</b><em>de ${int(comMatr.length)} com matrícula</em></div><div><span>Total a pagar</span><b>${brl(cp.total_premio)}</b></div></div>
      <p class="rp-nota">Este relatório apura as regras e premiações da campanha. Metas do processo, Spaces e SAVE/GAP não se aplicam a este recorte; consulte os relatórios de acompanhamento para esses indicadores.</p>
      <div class="rel-condicoes"><h2>Regras da campanha</h2><p><b>Regra:</b> ${esc(regraCampanha(cp))} (${esc(TIPOS_CAMPANHA[cp.tipo] || cp.tipo)})<br><b>Produtos:</b> ${esc(produtosCampanha(cp))}<br><b>Polos:</b> ${cp.polos.length ? cp.polos.map(i => esc(nomePor('polos', i))).join(', ') : 'todos'}<br><b>Premiação por:</b> ${porPolo ? 'polo de destino' : 'tutor — consolidação pelo polo de crédito'}${cp.obs ? `<br><b>Observação:</b> ${esc(cp.obs)}` : ''}</p></div>

      <h2>Pagamento</h2>
      <table class="t"><thead><tr><th>#</th><th>${porPolo ? 'Polo' : 'Tutor'}</th>${porPolo ? '' : '<th>Polo</th>'}<th class="num">Matrículas</th><th class="num">Prêmio</th><th>Pago</th></tr></thead><tbody>
        ${premiados.map((g, i) => `<tr><td>${i + 1}</td><td><b>${esc(g.nome)}</b></td>${porPolo ? '' : `<td>${esc(g.polo)}</td>`}<td class="num">${int(g.qtd)}</td><td class="num"><b>${brl(g.valor)}</b></td><td>☐</td></tr>`).join('') || `<tr><td colspan="6" class="muted">Ninguém atingiu a regra${cp.situacao === 'andamento' ? ' ainda' : ''}.</td></tr>`}
        <tr class="total"><td></td><td>Total</td>${porPolo ? '' : '<td></td>'}<td class="num">${int(premiados.reduce((a, g) => a + g.qtd, 0))}</td><td class="num">${brl(cp.total_premio)}</td><td></td></tr></tbody></table>

      <h2>Ranking completo</h2>
      <table class="t"><thead><tr><th>#</th><th>${porPolo ? 'Polo' : 'Tutor'}</th>${porPolo ? '' : '<th>Polo</th>'}<th class="num">Matrículas</th><th class="num">Prêmio</th><th>Próxima faixa</th><th>Última</th></tr></thead><tbody>
        ${cp.ranking.map((g, i) => `<tr><td class="muted">${g.qtd ? i + 1 : '—'}</td><td>${esc(g.nome)}</td>${porPolo ? '' : `<td class="muted">${esc(g.polo)}</td>`}<td class="num"><b>${int(g.qtd)}</b></td><td class="num">${g.valor ? brl(g.valor) : '<span class="muted">—</span>'}</td><td>${faltaCampanha(cp, g)}</td><td class="muted">${g.ultima ? dataBR(g.ultima) : '—'}</td></tr>`).join('')}</tbody></table>

      ${det ? `<h2>Matrículas de cada ${porPolo ? 'polo' : 'tutor'}</h2>
      ${comMatr.map(g => `<h3 class="rc-sub">${esc(g.nome)}${porPolo ? '' : ` <span class="muted">· ${esc(g.polo)}</span>`} — ${int(g.qtd)} válida(s) · ${brl(g.valor)}</h3>
        <table class="t"><thead><tr><th>Data</th><th>Aluno</th><th>Produto</th><th>Curso</th><th class="num">Mensalidade</th><th>Conta?</th></tr></thead><tbody>
        ${cp.matriculas.filter(x => x.grupo === g.chave).map(x => `<tr class="${x.conta ? '' : 'rc-nao'}"><td>${dataBR(x.data)}</td><td>${esc(x.aluno || 'não informado')}${idAluno(x)}</td><td>${esc(x.produto)}</td><td class="muted">${esc(x.curso || '—')}</td><td class="num">${brl(x.valor)}</td><td>${x.conta ? 'sim' : 'não — CPF repetido no mesmo produto'}</td></tr>`).join('')}</tbody></table>`).join('') || '<p class="muted">Nenhuma matrícula no período.</p>'}` : ''}

      <div class="rc-assin"><div>Responsável pela apuração</div><div>Aprovação</div></div>
      <footer class="rel-rodape">Contam as matrículas lançadas de ${dataBR(cp.inicio)} a ${dataBR(cp.fim)} nos produtos e polos da campanha, de qualquer processo. CPF repetido no mesmo produto conta uma vez (fica a primeira). Valores calculados no momento da emissão.</footer></section>`;
  };
  $('#rc-det').onchange = render;
  render();
}

function modalCampanha(cp, depois) {
  const v = cp || { nome: '', inicio: B.hoje, fim: B.hoje, tipo: 'escalonada', qtd: 2, valor: 50, adicional: 20, produtos: [], polos: [], beneficiario: 'tutor', obs: '' };
  const m = abrirModal(`<header><h3>${cp ? 'Editar campanha' : 'Nova campanha'}</h3><button class="btn icone" data-fechar>✕</button></header>
    <form id="f-cp"><div class="corpo"><div id="cp-msg"></div><div class="form-grid">
      <label class="campo inteiro"><span>Nome</span><input type="text" name="nome" required placeholder="Ex.: Campanha 26/10 — último dia do processo"></label>
      <label class="campo"><span>Início</span><input type="date" name="inicio" required></label>
      <label class="campo"><span>Fim</span><input type="date" name="fim" required></label>
      <label class="campo inteiro"><span>Tipo de regra</span><select name="tipo">${Object.entries(TIPOS_CAMPANHA).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <label class="campo" id="cp-l-qtd"><span>Matrículas</span><input type="number" name="qtd" min="1"></label>
      <label class="campo"><span id="cp-l-valor">Prêmio (R$)</span><input type="text" name="valor" inputmode="decimal"></label>
      <label class="campo" id="cp-l-adic"><span>Adicional por matrícula a mais (R$)</span><input type="text" name="adicional" inputmode="decimal"></label>
      <div class="inteiro info" id="cp-prev" style="margin:0"></div>
      <div class="campo inteiro"><span>Produtos que contam <small class="muted">(nenhum marcado = todos)</small></span>
        <div class="cp-prods">${B.categorias.map(k => { const ps = B.produtos.filter(p => p.categoria_id === k.id && p.ativo); if (!ps.length) return '';
          return `<div class="cp-cat"><label class="check"><input type="checkbox" data-cat="${k.id}"><b>${esc(k.nome)}</b></label><div class="chips">${ps.map(p => `<label class="check"><input type="checkbox" name="produtos" value="${p.id}" data-pc="${k.id}">${esc(p.nome)}</label>`).join('')}</div></div>`; }).join('')}</div></div>
      <div class="campo inteiro"><span>Polos participantes <small class="muted">(nenhum marcado = todos)</small></span><div class="chips">${B.polos.filter(p => p.ativo).map(p => `<label class="check"><input type="checkbox" name="polos" value="${p.id}">${esc(p.nome)}</label>`).join('')}</div></div>
      <label class="campo"><span>Prêmio para</span><select name="beneficiario"><option value="tutor">Cada tutor</option><option value="polo">O polo</option></select></label>
      <label class="campo"><span>Observação</span><input type="text" name="obs" placeholder="Ex.: publicar comprovante no grupo"></label>
    </div></div>
    <footer><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn prim">Salvar campanha</button></footer></form>`, 720);
  const f = $('#f-cp', m);
  f.nome.value = v.nome; f.inicio.value = v.inicio; f.fim.value = v.fim; f.tipo.value = v.tipo; f.qtd.value = v.qtd;
  f.valor.value = String(v.valor).replace('.', ','); f.adicional.value = String(v.adicional || 0).replace('.', ','); f.beneficiario.value = v.beneficiario; f.obs.value = v.obs || '';
  $$('[name=produtos]', f).forEach(i => { i.checked = v.produtos.includes(Number(i.value)); });
  $$('[name=polos]', f).forEach(i => { i.checked = v.polos.includes(Number(i.value)); });
  const syncCats = () => $$('[data-cat]', f).forEach(cb => { const ps = $$(`[data-pc="${cb.dataset.cat}"]`, f); cb.checked = ps.length && ps.every(i => i.checked); });
  $$('[data-cat]', f).forEach(cb => { cb.onchange = () => { $$(`[data-pc="${cb.dataset.cat}"]`, f).forEach(i => { i.checked = cb.checked; }); }; });
  $$('[name=produtos]', f).forEach(i => { i.addEventListener('change', syncCats); });
  syncCats();
  const atualizar = () => {
    const t = f.tipo.value;
    $('#cp-l-adic', m).style.display = t === 'escalonada' ? '' : 'none';
    $('#cp-l-qtd', m).style.display = t === 'por_matricula' ? 'none' : '';
    $('#cp-l-valor', m).textContent = t === 'por_matricula' ? 'Valor por matrícula (R$)' : t === 'escalonada' ? 'Prêmio ao atingir (R$)' : 'Prêmio (R$)';
    const c = { tipo: t, qtd: Number(f.qtd.value) || 1, valor: parseValorBR(f.valor.value), adicional: parseValorBR(f.adicional.value) };
    const ex = [1, 2, 3, 4, 5, 6].map(n => { const N = c.qtd; const val = t === 'meta' ? (n >= N ? c.valor : 0) : t === 'escalonada' ? (n >= N ? c.valor + (n - N) * c.adicional : 0) : t === 'a_cada' ? Math.floor(n / N) * c.valor : n * c.valor; return `${n} → ${brl(val)}`; });
    $('#cp-prev', m).innerHTML = `<b>${esc(regraCampanha(c))}</b><br><span style="font-size:12.5px">Simulação: ${ex.join(' · ')}</span>`;
  };
  ['tipo', 'qtd', 'valor', 'adicional'].forEach(k => { f[k].oninput = atualizar; f[k].onchange = atualizar; });
  atualizar();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const corpo = { nome: f.nome.value, inicio: f.inicio.value, fim: f.fim.value, tipo: f.tipo.value, qtd: f.qtd.value, valor: f.valor.value, adicional: f.adicional.value,
      produtos: $$('[name=produtos]:checked', f).map(i => Number(i.value)), polos: $$('[name=polos]:checked', f).map(i => Number(i.value)), beneficiario: f.beneficiario.value, obs: f.obs.value };
    try {
      const r = await api(cp ? '/api/campanhas/' + cp.id : '/api/campanhas', { method: cp ? 'PUT' : 'POST', body: corpo });
      ls.set('campanha-aberta', r.id); fecharModal(); toast('Campanha salva'); depois && depois();
    } catch (e) { $('#cp-msg', m).innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  };
}

// ======================================================================= CONFERÊNCIA COM O BI
function categoriaPorRotulo(rotulo) {
  const n = LeitorWhatsApp.limpo(rotulo);
  return B.categorias.find(k => [k.nome, ...String(k.apelidos || '').split(/[,;]/)].map(LeitorWhatsApp.limpo).filter(Boolean).includes(n)) || null;
}
function difConf(sis, bi, dinheiro = false) {
  if (sis == null || bi == null) return '<span class="muted">—</span>';
  const d = Math.round((sis - bi) * 100) / 100;
  if (Math.abs(d) < (dinheiro ? 0.01 : 0.5)) return '<span class="tag ok mini">confere</span>';
  const txt = dinheiro ? brl(Math.abs(d)) : int(Math.abs(d));
  return d < 0 ? `<span class="tag bad mini" title="o sistema tem menos que o BI">−${txt}</span>` : `<span class="tag warn mini" title="o sistema tem mais que o BI">+${txt}</span>`;
}
// Todas as categorias que respondem pelo rótulo do BI (ex.: "HIB" = HÍBRIDO + Saúde, pelo apelido em Configuração › Categorias)
function categoriasDoRotulo(rotulo) {
  const n = LeitorWhatsApp.limpo(rotulo);
  return B.categorias.filter(k => [k.nome, ...String(k.apelidos || '').split(/[,;]/)].map(LeitorWhatsApp.limpo).filter(Boolean).includes(n)).map(k => k.id);
}
function somaSistema(c, ids) {
  const o = { real_qtd: 0, real_rpv: 0, meta_qtd: 0, meta_rpv: 0, tem: false, temTk: false };
  for (const id of ids) { const x = c.sistema[id]; if (!x) continue; o.tem = true; o.real_qtd += x.real_qtd || 0; o.real_rpv += x.real_rpv || 0; o.meta_qtd += x.meta_qtd || 0; if (x.meta_rpv != null) { o.meta_rpv += x.meta_rpv; o.temTk = true; } }
  if (!o.tem) return null;
  o.real_ticket = o.real_qtd ? o.real_rpv / o.real_qtd : null;
  if (!o.temTk) o.meta_rpv = null;
  o.meta_ticket = o.meta_rpv && o.meta_qtd ? o.meta_rpv / o.meta_qtd : null;
  return o;
}
function tabelaConferencia(c) {
  const cobertas = new Set();
  const linhas = c.linhas.map(l => {
    const porRotulo = categoriasDoRotulo(l.rotulo);
    const ids = l.categoria_id && porRotulo.includes(l.categoria_id) ? porRotulo : (l.categoria_id ? [l.categoria_id] : []);
    ids.forEach(i => cobertas.add(i));
    const s = ids.length ? somaSistema(c, ids) : null;
    return { ...l, nome: l.categoria_id ? ids.map(i => nomePor('categorias', i)).join(' + ') : l.rotulo, s };
  });
  // categorias com matrículas no sistema que não vieram do BI também entram (BI = —)
  for (const [cid, s] of Object.entries(c.sistema)) {
    if ((s.real_qtd || s.meta_qtd) && !cobertas.has(Number(cid)))
      linhas.push({ rotulo: nomePor('categorias', cid), nome: nomePor('categorias', cid) + ' (não veio do BI)', categoria_id: Number(cid), s, real_qtd: null, real_rpv: null, real_ticket: null, meta_qtd: null, meta_rpv: null, meta_ticket: null });
  }
  const soma = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const T = {
    nome: 'Total', rotulo: 'Total', real_qtd: soma(linhas, x => x.real_qtd), meta_qtd: soma(linhas, x => x.meta_qtd), real_rpv: soma(linhas, x => x.real_rpv), meta_rpv: soma(linhas, x => x.meta_rpv),
    s: { real_qtd: soma(linhas, x => x.s && x.s.real_qtd), real_rpv: soma(linhas, x => x.s && x.s.real_rpv), meta_qtd: soma(linhas, x => x.s && x.s.meta_qtd), meta_rpv: soma(linhas, x => x.s && x.s.meta_rpv) },
  };
  T.real_ticket = T.real_qtd ? T.real_rpv / T.real_qtd : null; T.meta_ticket = T.meta_qtd ? T.meta_rpv / T.meta_qtd : null;
  T.s.real_ticket = T.s.real_qtd ? T.s.real_rpv / T.s.real_qtd : null; T.s.meta_ticket = T.s.meta_qtd && T.s.meta_rpv ? T.s.meta_rpv / T.s.meta_qtd : null;
  const brlN = (v) => v == null ? '—' : brl(v);
  const intN = (v) => v == null ? '—' : int(v);
  const linha = (x, total) => { const s = x.s || {}; return `<tr class="${total ? 'total' : ''}"><td>${esc(x.nome)}${!total && !x.categoria_id ? ' <span class="tag bad mini">sem categoria</span>' : ''}</td>
    <td class="num col-g">${intN(x.real_qtd)}</td><td class="num">${intN(s.real_qtd)}</td><td>${difConf(s.real_qtd, x.real_qtd)}</td>
    <td class="num col-g">${brlN(x.real_ticket)}</td><td class="num">${brlN(s.real_ticket)}</td><td>${difConf(s.real_ticket, x.real_ticket, true)}</td>
    <td class="num col-g">${brlN(x.real_rpv)}</td><td class="num">${brlN(s.real_rpv)}</td><td>${difConf(s.real_rpv, x.real_rpv, true)}</td>
    <td class="num col-g muted">${intN(x.meta_qtd)} / ${intN(s.meta_qtd)}</td><td class="num muted">${brlN(x.meta_ticket)} / ${brlN(s.meta_ticket)}</td></tr>`; };
  return `<table class="t conf"><thead>
    <tr><th rowspan="2">Produto</th><th colspan="3" class="grupo">Matrículas</th><th colspan="3" class="grupo">Ticket</th><th colspan="3" class="grupo">RPV (receita)</th><th colspan="2" class="grupo">Metas (BI / sistema)</th></tr>
    <tr><th class="num col-g">BI</th><th class="num">Sistema</th><th>Dif.</th><th class="num col-g">BI</th><th class="num">Sistema</th><th>Dif.</th><th class="num col-g">BI</th><th class="num">Sistema</th><th>Dif.</th><th class="num col-g">Matrículas</th><th class="num">Ticket</th></tr></thead>
    <tbody>${linhas.map(x => linha(x, false)).join('')}${linha(T, true)}</tbody></table>`;
}

async function telaConferenciaBI(c) {
  const ciclo = cicloAtual();
  const lista = await api('/api/conferencias?ciclo=' + ciclo.id);
  const doPolo = lista.filter(l => String(l.polo_id || '') === String(estado.polo || ''));
  let vendo = doPolo[0] ? await api('/api/conferencias/' + doPolo[0].id) : null;
  const campos = [['meta_qtd', 'Meta matr.'], ['real_qtd', 'Real matr.'], ['meta_ticket', 'Meta ticket'], ['real_ticket', 'Real ticket'], ['meta_rpv', 'Meta RPV'], ['real_rpv', 'Real RPV']];
  let grade = B.categorias.map(k => ({ rotulo: k.nome, categoria_id: k.id }));

  function render() {
    c.innerHTML = `
    <div class="info">Compare os números do <b>BI da Unicesumar</b> com o que foi lançado aqui. Cole a tabela do Power BI (ex.: "Total por produto – ACM até hoje": selecione a tabela, clique com o botão direito › <b>Copiar › Copiar tabela</b>), importe o arquivo exportado em <b>Excel (.xlsx)</b> ou <b>CSV</b>, ou digite os números. O sistema conta as matrículas lançadas <b>até a data de referência</b>.${estado.polo ? '' : ' Para conferir um polo, escolha o polo no topo.'}</div>
    ${vendo ? `<div class="card"><div class="card-cab"><h2>Conferência de ${dataBR(vendo.data_ref)} — ${vendo.polo ? esc(vendo.polo) : 'todos os polos'}</h2><span class="muted">${esc(vendo.fonte || '')} · salva por ${esc(vendo.criado_por || '')} em ${esc((vendo.criado_em || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))}</span></div>
      <div class="corpo sem-pad">${tabelaConferencia(vendo)}</div>
      <div class="nota">Dif. = sistema − BI. <span class="tag bad mini">−</span> o sistema tem menos (faltam lançamentos); <span class="tag warn mini">+</span> o sistema tem mais (lançamento a mais, data ou produto diferente). Metas: confere se as metas cadastradas aqui batem com as do BI.</div></div>`
      : `<div class="card"><div class="vazio">Nenhuma conferência salva ${estado.polo ? 'para este polo ' : ''}neste processo ainda.</div></div>`}

    ${podeLancar() ? `<div class="card mt"><div class="card-cab"><h2>Nova conferência</h2></div><div class="corpo">
      <div class="linha-acoes" style="margin-bottom:10px">
        <label class="campo" style="max-width:200px"><span>Data de referência do BI</span><input type="date" id="cb-data"></label>
        <label class="campo" style="max-width:240px"><span>Polo</span><select id="cb-polo" ${poloTravado() ? 'disabled' : ''}><option value="">Todos os polos (total)</option>${B.polos.filter(p => p.ativo).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
        <label class="campo" style="flex:1;min-width:200px"><span>Observação</span><input type="text" id="cb-obs" placeholder="Ex.: CAPTACAO_EAD › RPV, período 2026-54"></label>
      </div>
      <textarea id="cb-texto" rows="5" placeholder="Cole aqui a tabela do Power BI (com a linha de títulos)…" style="font-family:var(--mono);font-size:12.5px"></textarea>
      <div class="linha-acoes" style="margin:10px 0 14px"><button class="btn" id="cb-ler">Ler tabela colada</button>
        <label class="btn">Abrir arquivo do BI (.xlsx / .csv)<input type="file" id="cb-arq" accept=".xlsx,.csv,.txt" hidden></label></div>
      <div style="overflow-x:auto"><table class="t" id="cb-grade"><thead><tr><th>Linha do BI</th><th>Categoria no sistema</th>${campos.map(([, n]) => `<th class="num">${n}</th>`).join('')}</tr></thead><tbody>
        ${grade.map((g, i) => `<tr data-i="${i}"><td><input type="text" data-k="rotulo" value="${esc(g.rotulo)}" style="width:110px"></td>
          <td><select data-k="categoria_id"><option value="">—</option>${B.categorias.map(k => `<option value="${k.id}" ${k.id === g.categoria_id ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></td>
          ${campos.map(([k]) => `<td class="num"><input type="text" inputmode="decimal" class="qtd" style="width:100px" data-k="${k}" value="${g[k] != null ? String(g[k]).replace('.', ',') : ''}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="linha-acoes" style="margin-top:12px"><button class="btn prim" id="cb-salvar">Salvar conferência</button><span class="muted" style="font-size:12.5px">Real RPV vazio é calculado como matrículas × ticket.</span></div>
    </div></div>` : ''}

    <div class="card mt"><div class="card-cab"><h2>Histórico de conferências</h2><span class="muted">${esc(ciclo.nome)}</span></div><div class="corpo sem-pad">
      ${lista.length ? `<table class="t"><thead><tr><th>Data ref.</th><th>Polo</th><th class="num">Matr. BI</th><th class="num">Matr. sistema</th><th>Dif.</th><th class="num">RPV BI</th><th class="num">RPV sistema</th><th>Dif.</th><th>Fonte</th><th></th></tr></thead><tbody>
        ${lista.map(l => `<tr><td>${dataBR(l.data_ref)}</td><td>${esc(l.polo || 'Todos')}</td><td class="num">${int(l.bi_qtd)}</td><td class="num">${int(l.sis_qtd)}</td><td>${difConf(l.sis_qtd, l.bi_qtd)}</td>
          <td class="num">${brl(l.bi_rpv)}</td><td class="num">${brl(l.sis_rpv)}</td><td>${difConf(l.sis_rpv, l.bi_rpv, true)}</td><td class="muted">${esc(l.fonte || '')}${l.obs ? ' · ' + esc(l.obs) : ''}</td>
          <td class="acoes"><button class="btn peq" data-ver="${l.id}">Ver</button>${eAdmin() ? ` <button class="btn peq perigo" data-del="${l.id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhuma conferência ainda.</div>'}
    </div></div>`;

    $$('[data-ver]', c).forEach(b => { b.onclick = async () => { vendo = await api('/api/conferencias/' + b.dataset.ver); render(); window.scrollTo(0, 0); }; });
    $$('[data-del]', c).forEach(b => { b.onclick = async () => { if (!await confirmar('Excluir conferência', 'Excluir esta conferência do histórico?', 'Excluir')) return; await api('/api/conferencias/' + b.dataset.del, { method: 'DELETE' }); telaConferenciaBI(c); }; });
    if (!podeLancar()) return;
    $('#cb-data').value = B.hoje; $('#cb-polo').value = poloTravado() ? B.usuario.polo_id : (estado.polo || '');
    const lerGrade = () => { $$('#cb-grade tr[data-i]').forEach(tr => { const g = grade[Number(tr.dataset.i)]; $$('[data-k]', tr).forEach(el => { const k = el.dataset.k; g[k] = k === 'rotulo' ? el.value : k === 'categoria_id' ? (Number(el.value) || null) : el.value; }); }); };
    const aplicar = (linhas) => {
      if (!linhas.length) { toast('Não encontrei linhas com números', true); return; }
      grade = linhas.map(l => ({ ...l, categoria_id: (categoriaPorRotulo(l.rotulo) || {}).id || null }));
      const salvo = { data: $('#cb-data').value, polo: $('#cb-polo').value, obs: $('#cb-obs').value };
      render(); $('#cb-data').value = salvo.data; $('#cb-polo').value = salvo.polo; $('#cb-obs').value = salvo.obs;
      const sem = grade.filter(g => !g.categoria_id).map(g => g.rotulo);
      toast(`${linhas.length} linha(s) lidas${sem.length ? ` · escolha a categoria de: ${sem.join(', ')}` : ''}`, !!sem.length);
    };
    $('#cb-ler').onclick = () => { try { aplicar(LeitorPlanilha.interpretar(LeitorPlanilha.lerTexto($('#cb-texto').value))); } catch (e) { toast(e.message, true); } };
    $('#cb-arq').onchange = async (ev) => {
      const arq = ev.target.files[0]; ev.target.value = ''; if (!arq) return;
      try {
        const linhas = /\.xlsx$/i.test(arq.name) ? await LeitorPlanilha.lerXlsx(await arq.arrayBuffer()) : LeitorPlanilha.lerTexto(await arq.text());
        aplicar(LeitorPlanilha.interpretar(linhas));
        if (!$('#cb-obs').value) $('#cb-obs').value = arq.name;
      } catch (e) { toast(e.message, true); }
    };
    $('#cb-salvar').onclick = async () => {
      lerGrade();
      const linhas = grade.filter(g => g.rotulo && campos.some(([k]) => g[k] !== '' && g[k] != null)).map(g => {
        const n = (v) => v === '' || v == null ? null : LeitorPlanilha.numero(v);
        const l = { ...g }; for (const [k] of campos) l[k] = n(g[k]);
        if (l.real_rpv == null && l.real_qtd != null && l.real_ticket != null) l.real_rpv = Math.round(l.real_qtd * l.real_ticket * 100) / 100;
        if (l.meta_rpv == null && l.meta_qtd != null && l.meta_ticket != null) l.meta_rpv = Math.round(l.meta_qtd * l.meta_ticket * 100) / 100;
        if (l.real_ticket == null && l.real_rpv != null && l.real_qtd) l.real_ticket = l.real_rpv / l.real_qtd;
        if (l.meta_ticket == null && l.meta_rpv != null && l.meta_qtd) l.meta_ticket = l.meta_rpv / l.meta_qtd;
        return l;
      });
      if (!linhas.length) { toast('Preencha ou cole os números do BI', true); return; }
      try {
        const r = await api('/api/conferencias', { method: 'POST', body: { ciclo_id: ciclo.id, polo_id: $('#cb-polo').value || null, data_ref: $('#cb-data').value, fonte: $('#cb-arq').files.length ? 'arquivo' : 'colado/digitado', obs: $('#cb-obs').value, linhas } });
        toast('Conferência salva');
        vendo = await api('/api/conferencias/' + r.id);
        const novaLista = await api('/api/conferencias?ciclo=' + ciclo.id); lista.splice(0, lista.length, ...novaLista);
        grade = B.categorias.map(k => ({ rotulo: k.nome, categoria_id: k.id }));
        render(); window.scrollTo(0, 0);
      } catch (e) { toast(e.message, true); }
    };
  }
  render();
}

async function telaMundoAzulManual(c) {
  const [conf] = await Promise.all([api('/api/conferencia?' + qs({ ciclo: estado.ciclo, polo: estado.polo }))]);
  const polos = B.polos.filter(p => !estado.polo || p.id === Number(estado.polo));
  const prods = B.produtos.filter(p => p.ativo || conf.sistema.some(s => s.produto_id === p.id) || conf.mundo_azul.some(s => s.produto_id === p.id));
  const key = (po, pr) => `${po}-${pr}`;
  const sis = Object.fromEntries(conf.sistema.map(r => [key(r.polo_id, r.produto_id), r.n]));
  const ma = Object.fromEntries(conf.mundo_azul.map(r => [key(r.polo_id, r.produto_id), r.quantidade]));
  const editavel = podeLancar();

  const totaisProduto = () => prods.map(pr => {
    let s = 0, a = 0;
    for (const po of polos) { s += sis[key(po.id, pr.id)] || 0; a += Number(ma[key(po.id, pr.id)] || 0); }
    return { pr, s, a };
  });
  const dif = (a, s) => { const d = a - s; return d === 0 ? '<span class="tag ok">confere</span>' : `<span class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${int(d)}</span>`; };

  function render() {
    const tp = totaisProduto();
    c.innerHTML = `
    <div class="aviso"><b>Grade antiga, mantida só para consulta.</b> Ela supõe um número por polo × produto, não guarda data da posição nem histórico, e compara com todas as matrículas do processo. Não é usada em nenhum cálculo ou relatório. Para registrar a posição oficial, use a aba <a href="#/mundo-azul/oficial">Mundo Azul — posições oficiais</a>.</div>
    <div class="info">Compare o que foi lançado aqui com o número oficial do <b>Mundo Azul</b>. Digite a quantidade do Mundo Azul de cada polo/produto${editavel ? ' e clique em Salvar' : ''}. Diferença positiva = o Mundo Azul tem matrículas que ainda não foram lançadas aqui.</div>
    <div class="card"><div class="card-cab"><h2>Resumo por produto</h2></div><div class="corpo sem-pad"><table class="t">
      <thead><tr><th>Produto</th><th class="num">Sistema</th><th class="num">Mundo Azul</th><th class="num">Diferença</th></tr></thead>
      <tbody>${tp.map(x => `<tr><td>${esc(x.pr.nome)}</td><td class="num">${int(x.s)}</td><td class="num">${int(x.a)}</td><td class="num">${dif(x.a, x.s)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${int(tp.reduce((q, x) => q + x.s, 0))}</td><td class="num">${int(tp.reduce((q, x) => q + x.a, 0))}</td><td class="num">${dif(tp.reduce((q, x) => q + x.a, 0), tp.reduce((q, x) => q + x.s, 0))}</td></tr></tbody></table></div></div>

    <div class="card mt"><div class="card-cab"><h2>Por polo — digite o Mundo Azul</h2>${editavel ? '<button class="btn prim" id="ma-salvar">Salvar Mundo Azul</button>' : ''}</div>
      <div class="corpo sem-pad"><table class="t"><thead><tr><th>Polo</th>${prods.map(p => `<th class="num">${esc(p.nome)}</th>`).join('')}</tr></thead><tbody>
      ${polos.map(po => `<tr><td>${esc(po.nome)}</td>${prods.map(pr => {
        const k = key(po.id, pr.id), s = sis[k] || 0, a = Number(ma[k] || 0);
        if (!po.produtos.includes(pr.id) && !s && !a) return '<td class="num muted" title="Polo não vende este produto">—</td>';
        return `<td class="num">${editavel ? `<input class="qtd" type="number" min="0" data-ma="${k}" value="${ma[k] ?? ''}" placeholder="0">` : int(a)}
          <div style="font-size:11.5px;margin-top:2px" class="muted">sist. ${int(s)}${a || s ? ` · ${a - s === 0 ? '✓' : (a - s > 0 ? '+' : '') + (a - s)}` : ''}</div></td>`;
      }).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
    if (editavel) {
      $$('[data-ma]', c).forEach(i => { i.onchange = () => { ma[i.dataset.ma] = i.value === '' ? '' : Number(i.value); }; });
      $('#ma-salvar').onclick = async () => {
        const itens = [];
        for (const po of polos) for (const pr of prods) itens.push({ polo_id: po.id, produto_id: pr.id, quantidade: Number(ma[key(po.id, pr.id)] || 0) });
        try { await api('/api/mundo-azul?ciclo=' + estado.ciclo, { method: 'PUT', body: { itens } }); toast('Mundo Azul salvo'); render(); } catch (e) { toast(e.message, true); }
      };
    }
  }
  render();
}

// ======================================================================= METAS E SPACES
async function telaMetas(c) {
  const ciclo = cicloAtual();
  if (!ciclo) {
    c.innerHTML = `<div class="card"><div class="card-cab"><h2>Processos</h2></div><div class="corpo" id="ciclos-box"></div></div>`;
    return editorCiclos($('#ciclos-box'));
  }
  const [metas, metasRpv] = await Promise.all([api('/api/metas?ciclo=' + ciclo.id), api('/api/metas-rpv?ciclo=' + ciclo.id)]);
  const gradeRpv = Object.fromEntries(metasRpv.map(r => [`${r.polo_id}-${r.produto_id}`, r.valor]));
  const fmtR = (v) => v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ',');
  const grade = Object.fromEntries(metas.map(r => [`${r.polo_id}-${r.produto_id}`, r.quantidade]));
  const prods = B.produtos.filter(p => p.ativo || metas.some(m => m.produto_id === p.id));
  const polos = B.polos.filter(p => p.ativo || metas.some(m => m.polo_id === p.id));
  const spaces = B.spaces.filter(s => s.ciclo_id === ciclo.id);

  c.innerHTML = `
  <div class="card"><div class="card-cab"><h2>Processos</h2><span class="muted">O processo escolhido no topo é o que aparece abaixo</span></div><div class="corpo" id="ciclos-box"></div></div>

  <div class="card mt"><div class="card-cab"><h2>Spaces de ${esc(ciclo.nome)}</h2><span class="muted">% acumulado da meta que deve estar feito até cada data</span></div>
    <div class="corpo sem-pad"><table class="t"><thead><tr><th>Nome</th><th>Data</th><th class="num">% da meta</th><th></th></tr></thead><tbody id="sp-corpo">
    ${spaces.map(s => `<tr data-id="${s.id}"><td><input type="text" name="nome" value="${esc(s.nome)}"></td><td><input type="date" name="data" value="${s.data}"></td><td class="num"><input class="qtd" type="text" name="percentual" value="${String(s.percentual).replace('.', ',')}" style="width:90px"></td>
      <td class="acoes"><button class="btn peq" data-salvar>Salvar</button> <button class="btn peq perigo" data-excluir>Excluir</button></td></tr>`).join('')}
    <tr data-novo><td><input type="text" name="nome" placeholder="Ex.: Space 8"></td><td><input type="date" name="data"></td><td class="num"><input class="qtd" type="text" name="percentual" placeholder="%" style="width:90px"></td><td class="acoes"><button class="btn peq prim" data-salvar>Adicionar</button></td></tr>
    </tbody></table></div></div>

  <div class="card mt"><div class="card-cab"><h2>Metas de ${esc(ciclo.nome)} — por polo e produto</h2><button class="btn" id="mt-colar">Colar do Excel</button><button class="btn prim" id="mt-salvar">Salvar metas</button></div>
    <div class="corpo sem-pad"><table class="t" id="mt-tab"><thead><tr><th>Polo</th>${prods.map(p => `<th class="num">${esc(p.nome)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
    ${polos.map(po => `<tr><td>${esc(po.nome)}</td>${prods.map(pr => (po.produtos.includes(pr.id) || grade[`${po.id}-${pr.id}`]) ? `<td class="num"><input class="qtd" type="number" min="0" data-k="${po.id}-${pr.id}" value="${grade[`${po.id}-${pr.id}`] ?? ''}" placeholder="0"></td>` : '<td class="num muted" title="Polo não vende este produto (Cadastros › Polos)">—</td>').join('')}<td class="num" data-tot-polo="${po.id}"></td></tr>`).join('')}
    <tr class="total"><td>Meta geral</td>${prods.map(pr => `<td class="num" data-tot-prod="${pr.id}"></td>`).join('')}<td class="num" data-tot-geral></td></tr>
    </tbody></table></div></div>

  <!-- Painel de meta de ticket suspenso temporariamente; registros existentes preservados. -->

  <div class="card mt" id="mtt-card"></div>`;

  editorCiclos($('#ciclos-box'));
  cardMetaTutor($('#mtt-card'), ciclo, polos, grade);

  const recalcular = () => {
    let geral = 0;
    for (const po of polos) { let t = 0; for (const pr of prods) t += Number(grade[`${po.id}-${pr.id}`] || 0); $(`[data-tot-polo="${po.id}"]`).textContent = int(t); }
    for (const pr of prods) { let t = 0; for (const po of polos) t += Number(grade[`${po.id}-${pr.id}`] || 0); $(`[data-tot-prod="${pr.id}"]`).textContent = int(t); geral += t; }
    $('[data-tot-geral]').textContent = int(geral);
  };
  $$('[data-k]').forEach(i => { i.oninput = () => { grade[i.dataset.k] = i.value; recalcular(); }; });
  recalcular();
  $('#mt-colar').onclick = () => modalColarMetas(polos, prods, (k, v) => {
    grade[k] = v; const i = $(`[data-k="${k}"]`); if (i) i.value = v || '';
  }, recalcular);
  $('#mt-salvar').onclick = async () => {
    const itens = [];
    for (const po of polos) for (const pr of prods) itens.push({ polo_id: po.id, produto_id: pr.id, quantidade: Number(grade[`${po.id}-${pr.id}`] || 0) });
    try { await api('/api/metas?ciclo=' + ciclo.id, { method: 'PUT', body: { itens } }); toast('Metas salvas'); } catch (e) { toast(e.message, true); }
  };

  $$('#sp-corpo tr').forEach(tr => {
    const ler = () => ({ ciclo_id: ciclo.id, nome: $('[name=nome]', tr).value, data: $('[name=data]', tr).value, percentual: $('[name=percentual]', tr).value });
    $('[data-salvar]', tr).onclick = async () => {
      try {
        if (tr.dataset.id) await api('/api/cad/spaces/' + tr.dataset.id, { method: 'PUT', body: ler() });
        else await api('/api/cad/spaces', { method: 'POST', body: ler() });
        toast('Space salvo'); await recarregarBootstrap(); rotear();
      } catch (e) { toast(e.message, true); }
    };
    const ex = $('[data-excluir]', tr);
    if (ex) ex.onclick = async () => {
      if (!await confirmar('Excluir Space', 'Excluir este Space?', 'Excluir')) return;
      try { await api('/api/cad/spaces/' + tr.dataset.id, { method: 'DELETE' }); await recarregarBootstrap(); rotear(); } catch (e) { toast(e.message, true); }
    };
  });
}

// Meta do tutor no processo: por polo, individual ou "dividir igualmente" (padrão quando nada é cadastrado)
async function cardMetaTutor(box, ciclo, polos, grade) {
  const lista = await api('/api/metas-tutor?ciclo=' + ciclo.id);
  let poloSel = Number(ls.get('mtt-polo', 0)) || (polos.find(p => B.tutores.some(t => t.ativo && t.polos.includes(p.id))) || {}).id;
  const render = () => {
    const metaPolo = B.produtos.reduce((a, pr) => a + Number(grade[`${poloSel}-${pr.id}`] || 0), 0);
    const equipe = B.tutores.filter(t => t.ativo && t.polos.includes(poloSel) && (!t.polo_origem_id || t.polo_origem_id===poloSel));
    const atual = Object.fromEntries(lista.filter(x => x.polo_id === poloSel).map(x => [x.tutor_id, x]));
    const individual = Object.values(atual).some(x => x.origem === 'individual');
    box.innerHTML = `<div class="card-cab"><h2>Meta por tutor — ${esc(ciclo.nome)}</h2><select id="mtt-polo" style="width:auto">${polos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select>
        <button class="btn" id="mtt-dividir">Dividir igualmente</button><button class="btn prim" id="mtt-salvar">Salvar metas do polo</button></div>
      <div class="info" style="margin:12px 18px 0">É a meta de matrículas de cada tutor no processo (todos os produtos). Ela alimenta o SAVE/GAP do tutor no painel e a <b>meta semanal sugerida</b> em Painel › Equipe.
        Sem cadastro, o sistema divide a meta do polo igualmente pela equipe ativa. ${individual ? '<b>Este polo usa metas individuais.</b>' : '<b>Este polo está na divisão automática.</b>'}</div>
      <div class="corpo sem-pad"><table class="t"><thead><tr><th>Tutor</th><th class="num">Meta no processo</th><th class="muted">Origem</th></tr></thead><tbody>
        ${equipe.map(t => `<tr><td>${esc(t.nome)}</td><td class="num"><input class="qtd" type="number" min="0" data-mtt="${t.id}" value="${atual[t.id] ? atual[t.id].quantidade : ''}" placeholder="0"></td><td class="muted">${atual[t.id] ? (atual[t.id].origem === 'individual' ? 'individual' : 'dividida automaticamente') : '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Nenhum tutor ativo neste polo.</td></tr>'}
        <tr class="total"><td>Soma da equipe</td><td class="num" id="mtt-soma"></td><td class="muted">meta do polo: ${int(metaPolo)}</td></tr></tbody></table></div>`;
    $('#mtt-polo', box).value = poloSel;
    const somar = () => { const t = $$('[data-mtt]', box).reduce((a, i) => a + (Number(i.value) || 0), 0); $('#mtt-soma', box).innerHTML = `${int(t)} ${t !== metaPolo && metaPolo ? `<span class="tag warn mini">${t > metaPolo ? '+' : ''}${int(t - metaPolo)} vs polo</span>` : ''}`; };
    $$('[data-mtt]', box).forEach(i => { i.oninput = somar; }); somar();
    $('#mtt-polo', box).onchange = (e) => { poloSel = Number(e.target.value); ls.set('mtt-polo', poloSel); render(); };
    $('#mtt-dividir', box).onclick = async () => {
      if (!await confirmar('Dividir igualmente', `Apagar as metas individuais de ${esc(nomePor('polos', poloSel))} e voltar a dividir a meta do polo (${int(metaPolo)}) igualmente pela equipe?`, 'Dividir')) return;
      try { await api('/api/metas-tutor?ciclo=' + ciclo.id, { method: 'PUT', body: { polo_id: poloSel, itens: [] } }); toast('Meta dividida igualmente'); cardMetaTutor(box, ciclo, polos, grade); } catch (e) { toast(e.message, true); }
    };
    $('#mtt-salvar', box).onclick = async () => {
      const itens = $$('[data-mtt]', box).map(i => ({ tutor_id: Number(i.dataset.mtt), quantidade: Number(i.value) || 0 }));
      if (!itens.some(i => i.quantidade)) return toast('Preencha ao menos uma meta (ou use Dividir igualmente)', true);
      try { await api('/api/metas-tutor?ciclo=' + ciclo.id, { method: 'PUT', body: { polo_id: poloSel, itens } }); toast('Metas dos tutores salvas'); cardMetaTutor(box, ciclo, polos, grade); } catch (e) { toast(e.message, true); }
    };
  };
  render();
}

function normalizar(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
const APELIDOS_PROD = { grad: 'graduacao', graduacao: 'graduacao', ead: 'graduacao', pos: 'pos', posgraduacao: 'pos', prof: 'prof', profissionalizante: 'prof', tec: 'tecnico', tecnico: 'tecnico',
  licenciatura: 'semilicenciatura', licenciaturas: 'semilicenciatura', semilicenciaturas: 'semilicenciatura',
  bacharelemedfisica: 'semibacharelemeducacaofisica', bacharelemeducacaofisica: 'semibacharelemeducacaofisica', semibachareladoeducacaofisica: 'semibacharelemeducacaofisica', bef: 'semibacharelemeducacaofisica',
  engenharia: 'semiengenharia', semiengenharias: 'semiengenharia', biofarm: 'semifarmaciaebiomedicina', biomedicinaefarmacia: 'semifarmaciaebiomedicina', farmaciaebiomedicina: 'semifarmaciaebiomedicina',
  nutricao: 'seminutricao', bemestar: 'semibemestar', fono: 'semifono', powertechengenharia: 'powertechengenharias', powertechsaude: 'powertechsaude' };
// nome sem o prefixo "Semi -" e sem plural, para reconhecer cabeçalhos antigos na colagem (ex.: "Licenciatura" = "Semi - Licenciaturas")
const nomeBaseProd = (t) => normalizar(t).replace(/^semi/, '').replace(/s$/, '');
function modalColarMetas(polos, prods, setar, depois, decimal = false) {
  const m = abrirModal(`<header><h3>Colar metas do Excel</h3><button class="btn icone" data-fechar>✕</button></header>
    <div class="corpo"><div class="info">No Excel, selecione a tabela <b>com a linha de títulos</b> (nomes dos produtos) e a <b>coluna dos polos</b>, copie (Ctrl+C) e cole aqui (Ctrl+V). Ex.:<br>
      <code>Polo &nbsp; Graduação &nbsp; Pós &nbsp; Prof &nbsp; Técnico …</code><br>Os números entram na grade; confira e clique em <b>Salvar metas</b>.</div>
      <textarea id="cm-txt" rows="10" style="font-family:var(--mono);font-size:12.5px" placeholder="Cole aqui…"></textarea><div id="cm-msg" style="margin-top:10px"></div></div>
    <footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="cm-ok">Aplicar na grade</button></footer>`, 760);
  $('#cm-ok', m).onclick = () => {
    const linhas = $('#cm-txt', m).value.split(/\r?\n/).map(l => l.split('\t')).filter(l => l.some(x => x.trim()));
    if (linhas.length < 2) { $('#cm-msg', m).innerHTML = '<div class="erro-box">Cole a tabela com a linha de títulos e ao menos um polo.</div>'; return; }
    const achaProd = (t) => { const n = normalizar(t), b = nomeBaseProd(t); return prods.find(p => normalizar(p.nome) === n || normalizar(p.nome) === APELIDOS_PROD[n]) || prods.find(p => nomeBaseProd(p.nome) === b || (b.length >= 6 && nomeBaseProd(p.nome).startsWith(b))); };
    const achaPolo = (t) => { const n = normalizar(t); return polos.find(p => normalizar(p.nome) === n) || (['padrao', 'todos', 'todosospolos', 'geral', 'rede'].includes(n) ? polos.find(p => p.id === 0) : null); };
    const cab = linhas[0].map(achaProd);
    const semProd = linhas[0].slice(1).filter((t, i) => t.trim() && !cab[i + 1] && !/total/i.test(t));
    let n = 0; const semPolo = [];
    for (const l of linhas.slice(1)) {
      const polo = achaPolo(l[0]);
      if (!polo) { if (l[0].trim() && !/total|geral/i.test(l[0])) semPolo.push(l[0].trim()); continue; }
      cab.forEach((pr, i) => { if (!pr || i === 0 || !polo.produtos.includes(pr.id)) return; const v = decimal ? parseValorBR(l[i]) : (Number(String(l[i] || '').replace(/\./g, '').replace(',', '.')) || 0); setar(`${polo.id}-${pr.id}`, v); n++; });
    }
    depois();
    if (!n) { $('#cm-msg', m).innerHTML = '<div class="erro-box">Não reconheci polos/produtos. Confira se os nomes batem com os cadastros.</div>'; return; }
    fecharModal();
    toast(`${n} metas aplicadas na grade — confira e clique em Salvar metas`);
    if (semProd.length || semPolo.length) toast(`Ignorados: ${[...semProd, ...semPolo].join(', ')}`, true);
  };
  setTimeout(() => $('#cm-txt', m).focus(), 30);
}

function editorCiclos(box) {
  box.innerHTML = `<table class="t"><thead><tr><th>Nome</th><th>Início</th><th>Fim</th><th>Padrão</th><th></th></tr></thead><tbody>
    ${B.ciclos.map(c => `<tr data-id="${c.id}"><td><input type="text" name="nome" value="${esc(c.nome)}"></td><td><input type="date" name="data_inicio" value="${c.data_inicio || ''}"></td><td><input type="date" name="data_fim" value="${c.data_fim || ''}"></td>
      <td><label class="check"><input type="radio" name="padrao" ${c.padrao ? 'checked' : ''}> abre por padrão</label></td>
      <td class="acoes"><button class="btn peq" data-salvar>Salvar</button> <button class="btn peq perigo" data-excluir>Excluir</button></td></tr>`).join('')}
    <tr data-novo><td><input type="text" name="nome" placeholder="Novo processo, ex.: 52/2027"></td><td><input type="date" name="data_inicio"></td><td><input type="date" name="data_fim"></td><td><label class="check"><input type="radio" name="padrao"> abre por padrão</label></td><td class="acoes"><button class="btn peq prim" data-salvar>Criar processo</button></td></tr>
  </tbody></table>
  <p class="muted" style="margin:10px 2px 0;font-size:12.5px">Para começar um processo novo com as mesmas metas, crie o processo, selecione-o no topo e use “Copiar metas e Spaces de outro processo”.</p>
  ${B.ciclos.length > 1 ? `<div class="linha-acoes" style="margin-top:8px"><select id="cp-origem" style="width:auto">${B.ciclos.filter(c => c.id !== Number(estado.ciclo)).map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select><button class="btn peq" id="cp-btn">Copiar metas e Spaces de outro processo</button></div>` : ''}`;
  $$('tr', box).forEach(tr => {
    const btn = $('[data-salvar]', tr); if (!btn) return;
    btn.onclick = async () => {
      const corpo = { nome: $('[name=nome]', tr).value, data_inicio: $('[name=data_inicio]', tr).value, data_fim: $('[name=data_fim]', tr).value, padrao: $('[name=padrao]', tr).checked ? 1 : 0 };
      try {
        const r = tr.dataset.id ? await api('/api/cad/ciclos/' + tr.dataset.id, { method: 'PUT', body: corpo }) : await api('/api/cad/ciclos', { method: 'POST', body: corpo });
        if (!tr.dataset.id) { estado.ciclo = r.id; ls.set('ciclo', r.id); }
        toast('Processo salvo'); await recarregarBootstrap(); montarShell(); rotear();
      } catch (e) { toast(e.message, true); }
    };
    const ex = $('[data-excluir]', tr);
    if (ex) ex.onclick = async () => {
      if (!await confirmar('Excluir processo', 'Excluir este processo, suas metas e Spaces? (Só é possível se não tiver matrículas.)', 'Excluir')) return;
      try { await api('/api/cad/ciclos/' + tr.dataset.id, { method: 'DELETE' }); ls.set('ciclo', null); await recarregarBootstrap(); montarShell(); rotear(); } catch (e) { toast(e.message, true); }
    };
  });
  const cp = $('#cp-btn', box);
  if (cp) cp.onclick = async () => {
    const origem = Number($('#cp-origem', box).value);
    if (!await confirmar('Copiar', 'Substituir as metas deste processo pelas do processo escolhido e copiar os Spaces (as datas você ajusta depois)?', 'Copiar')) return;
    try {
      const metas = await api('/api/metas?ciclo=' + origem);
      const atuais = await api('/api/metas?ciclo=' + estado.ciclo);
      const itens = [...atuais.map(m => ({ ...m, quantidade: 0 })), ...metas];
      await api('/api/metas?ciclo=' + estado.ciclo, { method: 'PUT', body: { itens } });
      for (const s of B.spaces.filter(s => s.ciclo_id === origem)) await api('/api/cad/spaces', { method: 'POST', body: { ciclo_id: estado.ciclo, nome: s.nome, data: s.data, percentual: s.percentual } });
      toast('Copiado'); await recarregarBootstrap(); rotear();
    } catch (e) { toast(e.message, true); }
  };
}

// ======================================================================= CADASTROS
const ABAS_CAD = [
  ['metas', 'Metas e Spaces'], ['polos', 'Polos'], ['tutores', 'Tutores'], ['feriados', 'Feriados'], ['origens', 'Origens'], ['produtos', 'Produtos'], ['cursos', 'Cursos'], ['categorias', 'Categorias'],
  ['usuarios', 'Usuários'], ['config', 'Sistema e backup'], ['historico', 'Histórico'],
];

async function telaCadastros(c, aba) {
  aba = ABAS_CAD.some(a => a[0] === aba) ? aba : 'metas';
  c.innerHTML = `<nav class="abas">${ABAS_CAD.map(([id, n]) => `<a href="#/cadastros/${id}" class="${id === aba ? 'ativo' : ''}">${n}</a>`).join('')}</nav><div id="cad"></div>`;
  const box = $('#cad');
  const depois = async (msg) => { if (msg) toast(msg); await recarregarBootstrap(); montarShell(); rotear(); };
  if (aba === 'usuarios') return cadUsuarios(box, depois);
  if (aba === 'config') return cadConfig(box, depois);
  if (aba === 'historico') return cadHistorico(box);
  if (aba === 'metas') return telaMetas(box);

  const defs = {
    polos: { titulo: 'Polos', dica: 'Marque os produtos que cada polo vende: só eles aparecem no lançamento, nas metas e no painel do polo.', cols: [['nome', 'Nome', 'text'], ['produtos', 'Produtos que vende', 'produtos'], ['apelidos', 'Apelidos', 'text'], ['ordem', 'Ordem', 'num'], ['ativo', 'Ativo', 'bool']] },
    origens: { titulo: 'Origens da matrícula', dica: 'De onde veio o aluno. "Apelidos" = como aparece no WhatsApp (ex.: Instagram → Marketing Digital).', cols: [['nome', 'Nome', 'text'], ['apelidos', 'Apelidos', 'text'], ['ordem', 'Ordem', 'num'], ['ativo', 'Ativo', 'bool']] },
    categorias: { titulo: 'Categorias', dica: 'Graduação e Continuada. Cada produto pertence a uma categoria (em Produtos).', cols: [['nome', 'Nome', 'text'], ['ordem', 'Ordem', 'num']] },
    produtos: { titulo: 'Produtos', dica: '"Meta até": quando a meta do produto termina antes do processo (ex.: Pós = 31/12/2026), o esperado, o falta e o precisa por dia são calculados até essa data. Subgrupo junta produtos num subtotal (ex.: Semi - Saúde = Farmácia e Biomedicina + Nutrição). Mensalidade mín./máx.: o lançamento avisa quando o valor sai dessa faixa (evita erro de digitação que distorce o ticket e o RPV).', cols: [['nome', 'Nome', 'text'], ['categoria_id', 'Categoria', 'cat'], ['subgrupo', 'Subgrupo (opcional)', 'text'], ['meta_ate', 'Meta até (opcional)', 'date'], ['valor_min', 'Mensalidade mín. (R$)', 'money'], ['valor_max', 'Mensalidade máx. (R$)', 'money'], ['ordem', 'Ordem', 'num'], ['ativo', 'Ativo', 'bool']] },
    feriados: { titulo: 'Feriados', dica: 'Não contam como dia útil na projeção. Sem polo = vale para todos; com polo = feriado municipal só daquele polo.', cols: [['data', 'Data', 'date'], ['nome', 'Nome', 'text'], ['polo_id', 'Polo', 'polo']] },
    tutores: { titulo: 'Tutores', dica: 'Defina o polo de origem para o crédito automático. Vendas para outros polos não exigem vínculo com o destino. "Apelidos" = outros nomes usados no WhatsApp (ex.: Fê, Fernanda M.).', cols: [['nome', 'Nome', 'text'], ['polos', 'Polos', 'polos'], ['polo_origem_id','Polo de origem (crédito)','polo-origem'], ['apelidos', 'Apelidos', 'text'], ['ativo', 'Ativo', 'bool']] },
    cursos: { titulo: 'Cursos', dica: 'Cada curso aponta para um produto. Na importação do WhatsApp, cursos novos são classificados uma vez e ficam guardados aqui. "Apelidos" = outras grafias (ex.: ADM, Adm. de Empresas).', cols: [['nome', 'Curso', 'text'], ['produto_id', 'Produto', 'prod'], ['polos', 'Só nestes polos (nenhum = todos)', 'polos'], ['apelidos', 'Apelidos', 'text'], ['ativo', 'Ativo', 'bool']] },
  };
  const def = defs[aba];
  const lista = B[aba];
  const campo = (col, val) => {
    const [k, , tipo] = col;
    if (tipo === 'text') return `<input type="text" name="${k}" value="${esc(val ?? '')}"${k === 'nome' ? ' style="min-width:260px"' : ''}>`;
    if (tipo === 'prod') return `<select name="${k}">${B.categorias.map(kc => `<optgroup label="${esc(kc.nome)}">${B.produtos.filter(p => p.categoria_id === kc.id).map(p => `<option value="${p.id}" ${p.id === val ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    if (tipo === 'money') return `<input type="text" inputmode="decimal" class="qtd" style="width:110px" name="${k}" value="${val != null ? String(val).replace('.', ',') : ''}" placeholder="—">`;
    if (tipo === 'date') return `<input type="date" name="${k}" value="${esc(val ?? '')}">`;
    if (tipo === 'polo-origem') return `<select name="${k}"><option value="">Automático se houver um único vínculo</option>${B.polos.map(p=>`<option value="${p.id}" ${p.id===Number(val)?'selected':''}>${esc(p.nome)}</option>`).join('')}</select>`;
    if (tipo === 'polo') return `<select name="${k}"><option value="">Todos os polos</option>${B.polos.map(p => `<option value="${p.id}" ${p.id === val ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>`;
    if (tipo === 'num') return `<input class="qtd" type="number" name="${k}" value="${val ?? 0}">`;
    if (tipo === 'bool') return `<input type="checkbox" name="${k}" ${val == null || val ? 'checked' : ''}>`;
    if (tipo === 'cat') return `<select name="${k}">${B.categorias.map(x => `<option value="${x.id}" ${x.id === val ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>`;
    if (tipo === 'produtos') return `<div class="chips">${B.produtos.filter(p => p.ativo || (val || []).includes(p.id)).map(p => `<label class="check"><input type="checkbox" name="produtos" value="${p.id}" ${val === undefined || (val || []).includes(p.id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('')}</div>`;
    if (tipo === 'polos') return `<div class="chips">${B.polos.map(p => `<label class="check"><input type="checkbox" name="polos" value="${p.id}" ${(val || []).includes(p.id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('')}</div>`;
    return '';
  };
  box.innerHTML = `<div class="card"><div class="card-cab"><h2>${def.titulo}</h2><span class="muted">${def.dica}</span></div><div class="corpo sem-pad"><table class="t">
    <thead><tr>${def.cols.map(c2 => `<th>${c2[1]}</th>`).join('')}<th></th></tr></thead><tbody>
    ${lista.map(r => `<tr data-id="${r.id}">${def.cols.map(col => `<td>${campo(col, r[col[0]])}</td>`).join('')}<td class="acoes"><button class="btn peq" data-salvar>Salvar</button> <button class="btn peq perigo" data-excluir>Excluir</button></td></tr>`).join('')}
    <tr data-novo>${def.cols.map(col => `<td>${campo(col, col[0] === 'polo_id' ? null : col[0] === 'ordem' ? lista.length + 1 : col[0] === 'categoria_id' ? (B.categorias[0] || {}).id : undefined)}</td>`).join('')}<td class="acoes"><button class="btn peq prim" data-salvar>Adicionar</button></td></tr>
    </tbody></table></div></div>`;
  if (aba === 'cursos') {
    box.insertAdjacentHTML('beforeend', `<div class="card mt"><div class="card-cab"><h2>Reclassificar matrículas já lançadas</h2><span class="muted">${esc(cicloAtual() ? cicloAtual().nome : '')}</span></div><div class="corpo">
      <p style="margin-top:0">Aplica as regras de curso atuais (cursos acima, Licenciaturas, Bacharelado Educação Física, PowerTech, Engenharias…) às matrículas do processo selecionado que têm curso preenchido e mostra o que mudaria antes de gravar.</p>
      <button class="btn" id="rc-ver">Conferir cursos e classificações</button><div id="rc-res" style="margin-top:12px"></div></div></div>`);
    $('#rc-ver').onclick = async () => {
      const linhas = []; let pagina = 1, d;
      do { d = await api('/api/matriculas?' + qs({ ciclo: estado.ciclo, limite: 5000, pagina })); linhas.push(...d.linhas); pagina++; } while (linhas.length < d.total && d.linhas.length);
      const mud = [], pendentes = [];
      for (const m of linhas) {
        if (!m.curso) { pendentes.push({ m, motivo:'Curso não informado' }); continue; }
        const normal = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const inativos = B.cursos.filter(x => !x.ativo && [x.nome, ...(x.apelidos || '').split(',')].some(n => normal(n) === normal(m.curso)));
        const ativos = B.cursos.filter(x => x.ativo && [x.nome, ...(x.apelidos || '').split(',')].some(n => normal(n) === normal(m.curso)));
        if (inativos.length && !ativos.length) { pendentes.push({ m, motivo: 'Curso cadastrado como inativo — conferir situação' }); continue; }
        const cl = LeitorWhatsApp.classificarCurso({ curso: m.curso }, m.polo_id, B);
        if (!cl.produto_id || cl.sugerido) pendentes.push({ m, motivo: cl.aviso_curso || 'Classificação requer conferência' });
        else if (cl.produto_id !== m.produto_id) mud.push({ m, novo: cl.produto_id });
      }
      const avisoPendentes = pendentes.length ? `<div class="aviso">${int(pendentes.length)} matrícula(s) precisam de conferência manual; não serão alteradas.</div><table class="t"><thead><tr><th>Polo</th><th>Aluno</th><th>Curso</th><th>Produto atual</th><th>Motivo</th></tr></thead><tbody>${pendentes.map(x => `<tr><td>${esc(x.m.polo)}</td><td>${esc(x.m.aluno || '—')}${idAluno(x.m)}</td><td>${esc(x.m.curso || '—')}</td><td>${esc(x.m.produto)}</td><td>${esc(x.motivo)}</td></tr>`).join('')}</tbody></table>` : '';
      if (!mud.length) { $('#rc-res').innerHTML = `<div class="info">Nenhuma alteração identificada entre as classificações reconhecidas. ${int(linhas.length)} matrícula(s) examinada(s).</div>${avisoPendentes}`; return; }
      $('#rc-res').innerHTML = `${avisoPendentes}<table class="t"><thead><tr><th>Data</th><th>Polo</th><th>Aluno</th><th>Curso</th><th>Produto atual</th><th>Novo produto</th></tr></thead><tbody>
        ${mud.map(x => `<tr><td>${dataBR(x.m.data)}</td><td>${esc(x.m.polo)}</td><td>${esc(x.m.aluno || '')}${idAluno(x.m)}</td><td>${esc(x.m.curso)}</td><td>${esc(x.m.produto)}</td><td><b>${esc(nomePor('produtos', x.novo))}</b></td></tr>`).join('')}</tbody></table>
        <div class="linha-acoes" style="margin-top:10px"><button class="btn prim" id="rc-aplicar">Aplicar em ${mud.length} matrícula(s)</button></div>`;
      $('#rc-aplicar').onclick = async () => {
        let ok = 0; const erros = [];
        for (const x of mud) {
          try { await api('/api/matriculas/' + x.m.id, { method: 'PUT', body: { ...x.m, produto_id: x.novo, confirmar_duplicada: true, confirmar_faixa: true } }); ok++; }
          catch (e) { erros.push(`${x.m.aluno || x.m.cpf}: ${e.message}`); }
        }
        toast(`${ok} matrícula(s) reclassificada(s)${erros.length ? ` · ${erros.length} com erro` : ''}`, !!erros.length);
        $('#rc-res').innerHTML = erros.length ? `<div class="erro-box">${erros.map(esc).join('<br>')}</div>` : '<div class="info">Pronto.</div>';
      };
    };
  }
  $$('tr[data-id], tr[data-novo]', box).forEach(tr => {
    const ler = () => {
      const o = {};
      for (const [k, , tipo] of def.cols) {
        if (tipo === 'bool') o[k] = $(`[name=${k}]`, tr).checked ? 1 : 0;
        else if (tipo === 'produtos') o.produtos = $$('[name=produtos]:checked', tr).map(i => Number(i.value));
        else if (tipo === 'polos') o.polos = $$('[name=polos]:checked', tr).map(i => Number(i.value));
        else o[k] = $(`[name=${k}]`, tr).value;
      }
      return o;
    };
    $('[data-salvar]', tr).onclick = async () => {
      try {
        if (tr.dataset.id) await api(`/api/cad/${aba}/${tr.dataset.id}`, { method: 'PUT', body: ler() });
        else await api(`/api/cad/${aba}`, { method: 'POST', body: ler() });
        depois('Salvo');
      } catch (e) { toast(e.message, true); }
    };
    const ex = $('[data-excluir]', tr);
    if (ex) ex.onclick = async () => {
      if (!await confirmar('Excluir', 'Excluir este cadastro? Se ele já tiver matrículas, o sistema vai bloquear — nesse caso, desmarque “Ativo”.', 'Excluir')) return;
      try { await api(`/api/cad/${aba}/${tr.dataset.id}`, { method: 'DELETE' }); depois('Excluído'); } catch (e) { toast(e.message, true); }
    };
  });
}

function cadUsuarios(box, depois) {
  const papeis = { admin: 'Administrador', lancador: 'Lançador', visualizador: 'Visualização' };
  const linha = (u) => `<tr ${u ? `data-id="${u.id}"` : 'data-novo'}>
    <td><input type="text" name="nome" value="${esc(u?.nome || '')}" placeholder="Nome"></td>
    <td><input type="text" name="login" value="${esc(u?.login || '')}" placeholder="login"></td>
    <td><select name="papel">${Object.entries(papeis).map(([k, n]) => `<option value="${k}" ${(u?.papel || 'visualizador') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
    <td><select name="polo_id"><option value="">Todos os polos</option>${B.polos.map(p => `<option value="${p.id}" ${u?.polo_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></td>
    <td><input type="checkbox" name="ativo" ${!u || u.ativo ? 'checked' : ''}></td>
    <td><input type="password" name="senha" placeholder="${u ? 'deixe vazio p/ manter' : 'senha (mín. 6)'}" autocomplete="new-password"></td>
    <td class="acoes"><button class="btn peq ${u ? '' : 'prim'}" data-salvar>${u ? 'Salvar' : 'Adicionar'}</button>${u ? ' <button class="btn peq perigo" data-excluir>Excluir</button>' : ''}</td></tr>`;
  box.innerHTML = `
  <div class="info"><b>Administrador</b>: tudo. <b>Lançador</b>: lança/edita matrículas e o Mundo Azul. <b>Visualização</b>: só consulta (CPF aparece mascarado); se tiver um polo definido, vê apenas aquele polo.</div>
  <div class="card"><div class="corpo sem-pad"><table class="t"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Polo (só p/ visualização)</th><th>Ativo</th><th>Senha</th><th></th></tr></thead>
  <tbody>${B.usuarios.map(linha).join('')}${linha(null)}</tbody></table></div></div>`;
  $$('tr[data-id], tr[data-novo]', box).forEach(tr => {
    $('[data-salvar]', tr).onclick = async () => {
      const corpo = { nome: $('[name=nome]', tr).value, login: $('[name=login]', tr).value, papel: $('[name=papel]', tr).value, polo_id: $('[name=polo_id]', tr).value, ativo: $('[name=ativo]', tr).checked ? 1 : 0, senha: $('[name=senha]', tr).value };
      try { await api('/api/usuarios' + (tr.dataset.id ? '/' + tr.dataset.id : ''), { method: tr.dataset.id ? 'PUT' : 'POST', body: corpo }); depois('Usuário salvo'); } catch (e) { toast(e.message, true); }
    };
    const ex = $('[data-excluir]', tr);
    if (ex) ex.onclick = async () => {
      if (!await confirmar('Excluir usuário', 'Excluir este usuário?', 'Excluir')) return;
      try { await api('/api/usuarios/' + tr.dataset.id, { method: 'DELETE' }); depois('Usuário excluído'); } catch (e) { toast(e.message, true); }
    };
  });
}

function cadConfig(box, depois) {
  const c = B.config;
  box.innerHTML = `
  <div class="grid g2">
    <div class="card"><h2>Geral</h2><div class="corpo"><form id="f-cfg" class="form-grid">
      <label class="campo inteiro"><span>Nome da rede (aparece no logo padrão)</span><input type="text" name="nome_rede" value="${esc(c.nome_rede || '')}"></label>
      <label class="campo inteiro"><span>Nome do sistema</span><input type="text" name="nome_sistema" value="${esc(c.nome_sistema || '')}"></label>
      <label class="campo inteiro"><span>Subtítulo</span><input type="text" name="subtitulo" value="${esc(c.subtitulo || '')}"></label>
      <label class="campo inteiro"><span>Dias que contam para o esperado e o "precisa"</span><select name="contagem_dias">
        <option value="seg-sex">Dias úteis — segunda a sexta, sem feriados</option><option value="seg-sab">Segunda a sábado, sem feriados</option><option value="corridos">Dias corridos</option></select></label>
      <label class="campo inteiro"><span>A semana de meta começa na</span><select name="inicio_semana">${NOME_DIA_LONGO.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
      <div class="campo inteiro"><span>Dias que recebem meta na semana (feriados ficam fora sozinhos)</span><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(i => `<label class="check"><input type="checkbox" name="dias_meta" value="${i}" ${diasMetaCfg().includes(i) ? 'checked' : ''}>${NOME_DIA[i]}</label>`).join('')}</div></div>
      <label class="campo inteiro"><span>Data de referência do painel e do resumo</span><select name="lancamento">
        <option value="mesmo_dia">Data de referência = hoje (padrão)</option><option value="dia_seguinte">Data de referência = último dia fechado</option></select></label>
      <label class="campo"><span>Meta semanal do tutor — mínimo por semana (0 = sem mínimo)</span><input type="number" min="0" max="100" name="ritmo_minimo_semanal" value="${esc(c.ritmo_minimo_semanal || '0')}"></label>
      <label class="campo"><span>Mundo Azul — dias de tolerância para aparecer o R.A.</span><input type="number" min="0" max="60" name="tolerancia_ra_dias" value="${esc(c.tolerancia_ra_dias ?? '3')}"></label>
      <label class="check inteiro"><input type="checkbox" name="exigir_cpf" ${c.exigir_cpf === '1' ? 'checked' : ''}> CPF obrigatório no lançamento <small class="muted">(recomendado: é pelo CPF que a lista do Mundo Azul reconhece o aluno já lançado)</small></label>
      <label class="check inteiro"><input type="checkbox" name="exigir_aluno" ${c.exigir_aluno === '1' ? 'checked' : ''}> Nome do aluno obrigatório</label>
      <div class="inteiro"><button class="btn prim" type="submit">Salvar configurações</button></div>
    </form></div></div>
    <div class="card"><h2>Logo do menu</h2><div class="corpo">
      <div class="logo-preview">${logoHTML(c)}</div>
      <p class="muted" style="font-size:12.5px">A identidade oficial da Rede Balbino é aplicada ao menu, ao login e aos relatórios. Arquivos enviados anteriormente são preservados no cadastro.</p>
    </div></div>
    <div class="card"><h2>Backup</h2><div class="corpo">
      ${(() => { let st = null; try { st = JSON.parse(c.backup_extra_status || 'null'); } catch { /* sem status */ }
        return c.pasta_backup_extra ? (st ? `<div class="${st.ok ? 'info' : 'erro-box'}">${st.ok ? 'Última cópia externa' : 'Falha na última cópia externa'} (${esc(st.quando)}): ${esc(st.msg)}</div>` : '')
          : '<div class="aviso">Sem pasta externa: hoje os backups ficam só neste computador. Se o disco falhar, perde-se tudo.</div>'; })()}
      <p style="margin-top:0">Todo dia o sistema guarda uma cópia em <code>dados/backups</code> (últimos 30 dias) e, se configurada, <b>copia também para a pasta externa</b> abaixo.</p>
      <label class="campo"><span>Pasta externa de backup (caminho completo)</span>
        <input type="text" id="bk-pasta" value="${esc(c.pasta_backup_extra || '')}" placeholder="Ex.: G:\\Meu Drive\\Backup Matrículas   ou   \\\\SERVIDOR\\Backups"></label>
      <p class="muted" style="font-size:12.5px;margin:6px 0 10px">Pode ser uma pasta do Google Drive para computador, uma pasta de rede ou um pendrive. O caminho é do computador onde o sistema roda.</p>
      <div class="linha-acoes">
        <button class="btn" id="bk-testar">Testar pasta</button>
        <button class="btn prim" id="bk-salvar">Salvar pasta</button>
        <button class="btn" id="bk-agora">Fazer backup agora</button>
        <a class="btn" href="/api/backup">Baixar cópia</a><button class="btn" id="bk-restaurar">Restaurar backup…</button>
      </div>
      <p class="muted" style="font-size:12.5px">Para restaurar: feche o servidor, substitua <code>dados/matriculas.db</code> pelo arquivo de backup (renomeando) e abra de novo.</p>
    </div></div>
  </div>`;
  const f = $('#f-cfg');
  f.contagem_dias.value = c.contagem_dias || 'seg-sex';
  f.lancamento.value = c.lancamento || 'mesmo_dia';
  f.inicio_semana.value = String(inicioSemanaCfg());
  $('#bk-restaurar').onclick = modalRestaurarBackup;
  $('#bk-testar').onclick = async () => { try { await api('/api/backup-testar', { method: 'POST', body: { pasta: $('#bk-pasta').value } }); toast('Pasta OK — o sistema consegue gravar nela'); } catch (e) { toast(e.message, true); } };
  $('#bk-salvar').onclick = async () => { try { await api('/api/config', { method: 'PUT', body: { pasta_backup_extra: $('#bk-pasta').value.trim() } }); depois('Pasta de backup salva'); } catch (e) { toast(e.message, true); } };
  $('#bk-agora').onclick = async () => { try { const r = await api('/api/backup-agora', { method: 'POST' }); depois(r.msg); } catch (e) { toast(e.message, true); } };

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const corpo = { nome_rede: f.nome_rede.value, nome_sistema: f.nome_sistema.value, subtitulo: f.subtitulo.value, contagem_dias: f.contagem_dias.value, lancamento: f.lancamento.value, inicio_semana: f.inicio_semana.value, dias_meta_semana: $$('[name=dias_meta]:checked', f).map(i => i.value).join(',') || '1,2,3,4,5,6', exigir_cpf: f.exigir_cpf.checked ? '1' : '0', exigir_aluno: f.exigir_aluno.checked ? '1' : '0', ritmo_minimo_semanal: String(Math.max(0, Math.round(Number(f.ritmo_minimo_semanal.value) || 0))), tolerancia_ra_dias: String(Math.max(0, Math.round(Number(f.tolerancia_ra_dias.value) || 0))) };
    try { await api('/api/config', { method: 'PUT', body: corpo }); depois('Configurações salvas'); } catch (e) { toast(e.message, true); }
  };
}

async function cadHistorico(box) {
  const h = await api('/api/historico');
  box.innerHTML = `<div class="card"><div class="card-cab"><h2>Histórico de alterações</h2><span class="muted">últimas 300 ações</span></div><div class="corpo sem-pad"><table class="t">
    <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead>
    <tbody>${h.map(r => `<tr><td class="muted" style="white-space:nowrap">${esc(r.quando.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))}</td><td>${esc(r.usuario || '')}</td><td>${esc(r.acao)}</td><td class="muted">${esc(r.detalhe || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nada ainda.</td></tr>'}</tbody></table></div></div>`;
}

// ======================================================================= modais
function abrirModal(html, largura) {
  const raiz = $('#modal-raiz');
  raiz.innerHTML = `<div class="modal-fundo"><div class="modal" role="dialog" aria-modal="true" ${largura ? `style="max-width:${largura}px"` : ''}>${html}</div></div>`;
  const fundo = $('.modal-fundo', raiz);
  $$('[data-fechar]', raiz).forEach(b => { b.onclick = fecharModal; });
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fecharModal(); });
  document.addEventListener('keydown', escFecha);
  return $('.modal', raiz);
}
function escFecha(e) { if (e.key === 'Escape') fecharModal(); }
function fecharModal() { $('#modal-raiz').innerHTML = ''; document.removeEventListener('keydown', escFecha); }

function confirmar(titulo, msg, ok = 'Confirmar') {
  return new Promise(resolve => {
    const m = abrirModal(`<header><h3>${esc(titulo)}</h3></header><div class="corpo">${msg}</div><footer><button class="btn" id="cf-n">Cancelar</button><button class="btn prim" id="cf-s">${esc(ok)}</button></footer>`, 440);
    $('#cf-n', m).onclick = () => { fecharModal(); resolve(false); };
    $('#cf-s', m).onclick = () => { fecharModal(); resolve(true); };
    $('#cf-s', m).focus();
  });
}

function modalTrocarSenha() {
  const m = abrirModal(`<header><h3>Trocar minha senha</h3><button class="btn icone" data-fechar>✕</button></header>
    <form id="f-ts"><div class="corpo"><div id="ts-msg"></div>
      <label class="campo" style="margin-bottom:10px"><span>Senha atual</span><input type="password" name="atual" required></label>
      <label class="campo"><span>Nova senha (mín. 6)</span><input type="password" name="nova" minlength="6" required></label></div>
    <footer><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn prim">Salvar</button></footer></form>`, 420);
  $('#f-ts', m).onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/api/minha-senha', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); fecharModal(); toast('Senha alterada'); }
    catch (e) { $('#ts-msg', m).innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  };
}

iniciar();
