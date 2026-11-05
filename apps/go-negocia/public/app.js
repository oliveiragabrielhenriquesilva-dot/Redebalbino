// GO Negocia — interface (JS puro, sem build). Todo texto vindo do servidor entra via textContent (sem innerHTML).

// Marca: ponto único (arquivos em /brand, ver public/brand/LEIA-ME.md).
const MARCA = {
  nome: 'GO Negocia',
  assinatura: 'Atendimento financeiro para escolas',
  logo: '/brand/logo-go-negocia.png',
  logoNegativo: '/brand/logo-go-negocia-negativo.png',
  monogramaNegativo: '/brand/monograma-go-negativo.png',
};

const estado = { eu: null, orgId: null, ctx: null };
const raiz = document.getElementById('raiz');

// ---------- utilidades ----------
function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) el.append(f instanceof Node ? f : String(f));
  return el;
}
const reais = c => c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = iso => iso ? iso.split('-').reverse().join('/') : '—';
const quando = ms => ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const telefoneBR = t => { const d = String(t || ''); if (d.includes('•')) return d; const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (d || ''); };
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const pode = p => estado.ctx?.permissoes?.includes(p);

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    method: opcoes.method || 'GET',
    headers: opcoes.body ? { 'Content-Type': 'application/json' } : {},
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    credentials: 'same-origin',
  });
  let dados = {};
  try { dados = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 401 && caminho !== '/api/eu' && !caminho.includes('/auth/')) { estado.eu = null; estado.ctx = null; telaLogin(); throw new Error('Sessão expirada'); }
  if (!r.ok) throw Object.assign(new Error(dados.erro || `Erro ${r.status}`), { status: r.status, dados });
  return dados;
}
const apiOrg = (c, o) => api(`/api/o/${estado.orgId}${c}`, o);

// replaceChildren converte null em texto "null"; trocar() ignora nulos.
function trocar(el, ...filhos) { el.replaceChildren(...filhos.flat(Infinity).filter(f => f != null && f !== false)); }

function ir(hash) { if (location.hash === hash) render(); else location.hash = hash; }

const selo = (texto, tipo = 'neutro', icone = '') => h('span', { class: `selo ${tipo}` }, icone ? icone + ' ' : '', texto);
const aviso = (texto, tipo = 'info', icone = 'ℹ') => h('div', { class: `aviso ${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, h('span', { 'aria-hidden': 'true' }, icone), h('div', {}, texto));
const vazio = (titulo, texto) => h('div', { class: 'vazio' }, h('div', { class: 'vazio-titulo' }, titulo), texto ? h('div', {}, texto) : null);
const carregando = (t = 'Carregando…') => h('div', { class: 'carregando' }, t);
const erroBloco = (e, tentar) => h('div', {}, aviso(e.message || String(e), 'erro', '⚠'), tentar ? h('div', { class: 'acoes' }, h('button', { class: 'botao secundario pequeno', onclick: tentar }, 'Tentar novamente')) : null);

function seloTitulo(t) {
  if (t.situacao === 'PAGO') return selo('Pago', 'ok', '✓');
  if (t.situacao === 'CANCELADO') return selo('Cancelado', 'neutro', '–');
  if (t.bloqueio === 'CONTESTADO') return selo('Contestado · pausado', 'alerta', '⏸');
  if (t.bloqueio === 'COMPROVANTE_EM_ANALISE') return selo('Comprovante em análise', 'atencao', '⏸');
  if (t.ausente) return selo('Ausente na última carteira', 'atencao', '?');
  return selo('Em aberto', 'info', '●');
}

// ---------- estrutura ----------
async function carregarEu() {
  try { estado.eu = await api('/api/eu'); } catch { estado.eu = null; }
}

function telaLogin() {
  document.title = `Entrar · ${MARCA.nome}`;
  const erro = h('div');
  const form = h('form', {
    onsubmit: async ev => {
      ev.preventDefault();
      trocar(erro, );
      const b = form.querySelector('button'); b.disabled = true;
      try {
        await api('/api/auth/login', { method: 'POST', body: { login: form.login.value, senha: form.senha.value } });
        await carregarEu();
        ir('#/');
      } catch (e) { trocar(erro, aviso(e.message, 'erro', '⚠')); b.disabled = false; }
    },
  },
  h('div', { class: 'campo' }, h('label', { for: 'login' }, 'Login'), h('input', { type: 'text', id: 'login', name: 'login', autocomplete: 'username', required: true })),
  h('div', { class: 'campo' }, h('label', { for: 'senha' }, 'Senha'), h('input', { type: 'password', id: 'senha', name: 'senha', autocomplete: 'current-password', required: true })),
  erro,
  h('button', { class: 'botao', type: 'submit' }, 'Entrar'));
  trocar(raiz, h('main', { class: 'tela-login' }, h('div', { class: 'caixa-login' },
    h('h1', { class: 'logo-login' }, h('img', { class: 'logo', src: MARCA.logo, alt: MARCA.nome, width: 251, height: 48 })),
    h('p', { class: 'assinatura' }, MARCA.assinatura),
    h('div', { class: 'detalhe', 'aria-hidden': 'true' }),
    form)));
}

function moldura(paginaAtiva, conteudo) {
  const eu = estado.eu;
  const org = estado.orgId;
  const link = (rota, icone, texto, extra = {}) => h('a', { href: rota, class: (paginaAtiva === rota.split('/').slice(3, 4)[0] || paginaAtiva === rota) ? 'ativo' : '', ...extra },
    h('span', { class: 'icone', 'aria-hidden': 'true' }, icone), texto);
  const breve = (icone, texto) => h('a', { class: 'desligado', 'aria-disabled': 'true' }, h('span', { class: 'icone', 'aria-hidden': 'true' }, icone), texto, h('span', { class: 'selo-breve' }, 'próximo'));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu principal' },
    org && pode('fila.ver') ? link(`#/o/${org}/fila`, '☰', 'Fila de hoje') : null,
    org && pode('carteira.ver') ? link(`#/o/${org}/carteira`, '▤', 'Carteira') : null,
    org && pode('conversa.ver') ? link(`#/o/${org}/conversas`, '✉', 'Atendimento') : null,
    org && pode('carteira.importar') ? link(`#/o/${org}/importar`, '⇪', 'Importar carteira') : null,
    org && !pode('carteira.importar') && pode('lotes.ver') ? link(`#/o/${org}/importar`, '⇪', 'Importações') : null,
    org ? [breve('◇', 'Acordos'), breve('☷', 'Pendências'), breve('▦', 'Relatório')] : null,
    eu.usuario.admin ? [h('div', { class: 'nav-titulo' }, 'Administração'), link('#/admin/instituicoes', '⌂', 'Instituições'), link('#/admin/usuarios', '◉', 'Usuários e permissões')] : null);
  const seletor = h('select', {
    id: 'seletor-org', 'aria-label': 'Instituição',
    onchange: e => ir(e.target.value ? `#/o/${e.target.value}/fila` : '#/'),
  }, h('option', { value: '' }, eu.instituicoes.length ? 'Selecione a instituição…' : 'Nenhuma instituição autorizada'),
  eu.instituicoes.map(i => h('option', { value: i.organizacao_id, selected: i.organizacao_id === org }, i.nome)));
  const papel = estado.ctx && org ? ({ ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', ATENDENTE: 'Atendente', REPRESENTANTE: 'Representante' }[estado.ctx.papel]) : (eu.usuario.admin ? 'Administrador' : '');
  trocar(raiz, h('div', { class: 'app' },
    h('aside', { class: 'lateral' },
      h('a', { class: 'marca-lateral', href: '#/', 'aria-label': `${MARCA.nome} — início` },
        h('img', { class: 'marca-horizontal', src: MARCA.logoNegativo, alt: '', width: 167, height: 32 }),
        h('img', { class: 'marca-compacta', src: MARCA.monogramaNegativo, alt: '', width: 42, height: 20 })),
      nav,
      h('div', { class: 'rodape-lateral' }, `${MARCA.nome} ${eu.versao}`)),
    h('div', { class: 'principal' },
      h('header', { class: 'topo' },
        h('div', { class: 'seletor-org' }, h('label', { for: 'seletor-org' }, 'Instituição'), seletor),
        estado.ctx && org && !estado.ctx.todas_unidades ? selo(`Unidades: ${estado.ctx.unidades.map(u => u.nome).join(', ') || 'nenhuma'}`, 'neutro') : null,
        h('div', { class: 'usuario' }, h('span', {}, eu.usuario.nome), papel ? selo(papel, 'info') : null,
          h('button', { class: 'botao secundario pequeno', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); estado.eu = null; ir('#/login'); } }, 'Sair'))),
      eu.envio_real ? null : h('div', { class: 'faixa-teste', role: 'note' }, h('strong', {}, 'Ambiente de teste: '), 'nenhuma mensagem real é enviada. Envios ficam registrados como simulados ou bloqueados.'),
      h('main', { class: 'conteudo', id: 'conteudo' }, conteudo))));
}

function cabecalho(titulo, subtitulo, ...acoes) {
  document.title = `${titulo} · ${estado.ctx?.organizacao?.nome ? estado.ctx.organizacao.nome + ' · ' : ''}${MARCA.nome}`;
  return h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, titulo), subtitulo ? h('p', { class: 'mudo' }, subtitulo) : null), acoes.length ? h('div', { class: 'acoes' }, acoes) : null);
}

// ---------- Início ----------
function paginaInicio() {
  const eu = estado.eu;
  if (eu.instituicoes.length === 1 && !eu.usuario.admin) return ir(`#/o/${eu.instituicoes[0].organizacao_id}/fila`);
  moldura('', h('div', {},
    cabecalho(`Olá, ${eu.usuario.nome.split(' ')[0]}`, 'Escolha a instituição para trabalhar. Cada instituição tem carteira, conversas e permissões separadas.'),
    eu.instituicoes.length
      ? h('div', { class: 'grade grade-4' }, eu.instituicoes.map(i => h('a', { class: 'cartao', href: `#/o/${i.organizacao_id}/${i.papel === 'REPRESENTANTE' ? 'carteira' : 'fila'}` }, h('h3', {}, i.nome), h('div', { class: 'mudo pequeno' }, ({ ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', ATENDENTE: 'Atendente', REPRESENTANTE: 'Representante' })[i.papel]))))
      : h('div', { class: 'cartao' }, vazio('Nenhuma instituição autorizada', eu.usuario.admin ? 'Cadastre a primeira instituição em Administração › Instituições.' : 'Peça ao administrador da GO Negocia para liberar seu acesso.'))));
}

// ---------- Fila de hoje ----------
async function paginaFila() {
  const filtros = { unidade: '', atendente: estado.ctx.papel === 'ATENDENTE' ? 'meus' : '', atraso: '' };
  const area = h('div', {}, carregando());
  const carregar = async () => {
    trocar(area, carregando());
    try {
      const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
      const f = await apiOrg(`/fila?${q}`);
      if (!f.itens.length) return trocar(area, h('div', { class: 'cartao' }, vazio('Nada na fila de hoje', 'Todos os casos têm próxima ação futura, retorno combinado ou títulos pausados. Ajuste os filtros para ver mais.')));
      trocar(area, h('div', { class: 'cartao tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Responsável', 'Saldo negociável', 'Atraso', 'Próxima ação', 'Atendente', 'Situação'].map(t => h('th', { class: /Saldo|Atraso/.test(t) ? 'num' : '' }, t)))),
        h('tbody', {}, f.itens.map(i => h('tr', { class: 'clicavel', tabindex: 0, onclick: () => ir(`#/o/${estado.orgId}/caso/${i.caso_id}`), onkeydown: e => { if (e.key === 'Enter') ir(`#/o/${estado.orgId}/caso/${i.caso_id}`); } },
          h('td', {}, h('strong', {}, i.responsavel), h('div', { class: 'mudo pequeno' }, `${i.titulos} título(s) · ${i.telefone_mascarado || 'sem telefone'}`)),
          h('td', { class: 'num' }, reais(i.saldo_negociavel_centavos)),
          h('td', { class: 'num' }, `${i.dias_atraso} dias`),
          h('td', {}, i.proxima_acao.em ? h('div', {}, dataBR(i.proxima_acao.em), h('div', { class: 'mudo pequeno' }, rotuloAcao(i.proxima_acao.tipo))) : selo('Primeiro contato', 'info', '★')),
          h('td', {}, i.atendente?.nome || h('span', { class: 'mudo' }, 'Sem atendente')),
          h('td', {}, i.em_uso_por ? selo(`Em uso por ${i.em_uso_por}`, 'atencao', '⏳') : null, ' ',
            !i.contato_autorizado ? selo('Contato não autorizado', 'alerta', '⛔') : null, ' ',
            i.saldo_desatualizado ? selo('Saldo desatualizado', 'atencao', '⚠') : null)))))));
    } catch (e) { trocar(area, erroBloco(e, carregar)); }
  };
  const ctx = estado.ctx;
  moldura('fila', h('div', {},
    cabecalho('Fila de hoje', `${ctx.organizacao.nome} · casos com próxima ação até hoje, sem retorno combinado pendente e com título negociável.`),
    h('div', { class: 'filtros' },
      ctx.unidades.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'f-un' }, 'Unidade'), h('select', { id: 'f-un', onchange: e => { filtros.unidade = e.target.value; carregar(); } }, h('option', { value: '' }, 'Todas'), ctx.unidades.map(u => h('option', { value: u.id }, u.nome)))) : null,
      h('div', { class: 'campo' }, h('label', { for: 'f-at' }, 'Atendente'), h('select', { id: 'f-at', onchange: e => { filtros.atendente = e.target.value; carregar(); } },
        h('option', { value: '', selected: !filtros.atendente }, 'Todos'), h('option', { value: 'meus', selected: filtros.atendente === 'meus' }, 'Meus e sem atendente'), h('option', { value: 'sem' }, 'Sem atendente'),
        ctx.equipe.map(u => h('option', { value: u.id }, u.nome)))),
      h('div', { class: 'campo' }, h('label', { for: 'f-atr' }, 'Atraso mínimo'), h('select', { id: 'f-atr', onchange: e => { filtros.atraso = e.target.value; carregar(); } },
        h('option', { value: '' }, 'Qualquer'), [15, 30, 60, 90].map(d => h('option', { value: d }, `${d}+ dias`))))),
    area));
  carregar();
}

const rotuloAcao = t => ({ NOVO_CONTATO: 'Novo contato', RETORNO_COMBINADO: 'Retorno combinado', CONFERIR_PROMESSA: 'Conferir promessa', AGUARDAR_RESPOSTA: 'Aguardando resposta', RESPONDER_MENSAGEM: 'Responder mensagem' }[t] || t || '—');

// ---------- Carteira ----------
async function paginaCarteira() {
  const ctx = estado.ctx;
  const filtros = { busca: '', unidade: '', pagina: 1 };
  const area = h('div', {}, carregando());
  const r = ctx.resumo;
  const desatualizada = r.referencia_mais_antiga && (Date.parse(hojeISO()) - Date.parse(r.referencia_mais_antiga)) / 86400000 > ctx.organizacao.dias_saldo_valido;
  const carregar = async () => {
    trocar(area, carregando());
    try {
      const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
      const c = await apiOrg(`/carteira?${q}`);
      if (!c.itens.length) return trocar(area, h('div', { class: 'cartao' }, filtros.busca ? vazio('Nenhum responsável encontrado', 'Busque por nome, código, matrícula ou telefone.') : vazio('Carteira vazia', pode('carteira.importar') ? 'Importe o arquivo de carteira da escola para começar.' : 'A carteira desta instituição ainda não foi importada.')));
      const abre = pode('caso.trabalhar');
      trocar(area, h('div', { class: 'cartao tabela-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, ['Responsável', 'Código', 'Títulos em aberto', 'Saldo em aberto', 'Atraso', 'Situação'].map(t => h('th', { class: /Saldo|Atraso|Títulos/.test(t) ? 'num' : '' }, t)))),
          h('tbody', {}, c.itens.map(i => h('tr', abre ? { class: 'clicavel', tabindex: 0, onclick: () => abrirCasoResp(i.id), onkeydown: e => { if (e.key === 'Enter') abrirCasoResp(i.id); } } : {},
            h('td', {}, h('strong', {}, i.nome), h('div', { class: 'mudo pequeno' }, telefoneBR(i.telefone) || 'sem telefone', i.documento_final ? ` · doc ${i.documento_final}` : '')),
            h('td', {}, i.chave_origem),
            h('td', { class: 'num' }, i.titulos_abertos),
            h('td', { class: 'num' }, reais(i.saldo_aberto_centavos)),
            h('td', { class: 'num' }, `${i.dias_atraso} dias`),
            h('td', {}, i.titulos_com_alerta ? selo(`${i.titulos_com_alerta} com alerta`, 'atencao', '⚠') : selo('Regular', 'info', '●'), ' ', i.saldo_desatualizado ? selo('Saldo desatualizado', 'atencao', '⏱') : null, ' ', !i.contato_autorizado ? selo('Sem autorização de contato', 'neutro', '⛔') : null))))),
        h('div', { class: 'acoes pequeno mudo' }, `${c.total} responsável(is)`, c.total > c.por_pagina ? [
          h('button', { class: 'botao secundario pequeno', disabled: filtros.pagina <= 1, onclick: () => { filtros.pagina--; carregar(); } }, '‹ Anterior'),
          h('button', { class: 'botao secundario pequeno', disabled: filtros.pagina * c.por_pagina >= c.total, onclick: () => { filtros.pagina++; carregar(); } }, 'Próxima ›')] : null)));
    } catch (e) { trocar(area, erroBloco(e, carregar)); }
  };
  let t;
  moldura('carteira', h('div', {},
    cabecalho('Carteira', ctx.organizacao.nome, pode('carteira.importar') ? h('a', { class: 'botao', href: `#/o/${estado.orgId}/importar` }, '⇪ Importar carteira') : null),
    h('div', { class: 'grade grade-4' },
      ind('Saldo em aberto', reais(r.saldo_aberto_centavos), `${r.titulos_abertos} títulos`),
      ind('Responsáveis', r.responsaveis, 'com título em aberto'),
      ind('Saldo atualizado em', dataBR(r.referencia_mais_recente), r.referencia_mais_antiga && r.referencia_mais_antiga !== r.referencia_mais_recente ? `mais antigo: ${dataBR(r.referencia_mais_antiga)}` : 'data de referência do arquivo'),
      ind('Títulos com alerta', r.titulos_com_alerta, 'pausados ou ausentes da última carteira')),
    desatualizada ? h('div', {}, h('br'), aviso(`Há saldos com mais de ${ctx.organizacao.dias_saldo_valido} dias. Contatos ativos ficam bloqueados nesses casos até a carteira ser atualizada.`, 'atencao', '⏱')) : null,
    h('br'),
    h('div', { class: 'filtros' },
      h('div', { class: 'campo' }, h('label', { for: 'busca' }, 'Buscar'), h('input', { type: 'search', id: 'busca', placeholder: 'Nome, código, matrícula ou telefone', oninput: e => { clearTimeout(t); t = setTimeout(() => { filtros.busca = e.target.value; filtros.pagina = 1; carregar(); }, 300); } })),
      ctx.unidades.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'c-un' }, 'Unidade'), h('select', { id: 'c-un', onchange: e => { filtros.unidade = e.target.value; filtros.pagina = 1; carregar(); } }, h('option', { value: '' }, 'Todas'), ctx.unidades.map(u => h('option', { value: u.id }, u.nome)))) : null),
    area));
  carregar();
}
const ind = (rotulo, valor, nota) => h('div', { class: 'cartao indicador' }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), nota ? h('div', { class: 'nota' }, nota) : null);

async function abrirCasoResp(respId) {
  try { const r = await apiOrg(`/responsaveis/${respId}/caso`); ir(`#/o/${estado.orgId}/caso/${r.caso_id}`); }
  catch (e) { alertaFlutuante(e.message); }
}

function alertaFlutuante(msg, tipo = 'erro') {
  const d = h('dialog', {}, aviso(msg, tipo, tipo === 'erro' ? '⚠' : 'ℹ'), h('div', { class: 'acoes' }, h('button', { class: 'botao', onclick: () => d.close() }, 'OK')));
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
}

// ---------- Caso (atendimento) ----------
async function paginaCaso(casoId) {
  moldura('fila', carregando());
  const conteudo = document.getElementById('conteudo');
  let c;
  try { c = await apiOrg(`/casos/${casoId}`); }
  catch (e) { return trocar(conteudo, e.status === 404 ? h('div', { class: 'cartao' }, vazio('Caso não encontrado', 'Ele não existe ou não pertence às instituições e unidades que você pode acessar.')) : erroBloco(e, () => paginaCaso(casoId))); }
  const eu = estado.eu.usuario;
  const minhaTrava = c.trava?.usuario_id === eu.id;
  const recarregar = () => paginaCaso(casoId);
  const msg = h('div');
  const acao = async (fn, ok) => { trocar(msg); try { const navegou = await fn(); if (navegou === 'navegou') return; if (ok) trocar(msg, aviso(ok, 'ok', '✓')); setTimeout(recarregar, ok ? 700 : 0); } catch (e) { trocar(msg, aviso(e.message, 'erro', '⚠'), e.dados?.bloqueios ? h('ul', {}, e.dados.bloqueios.map(b => h('li', {}, b.texto))) : null); } };

  const blocoTrava = c.trava && !minhaTrava
    ? aviso(`${c.trava.nome} está trabalhando este caso até ${quando(c.trava.ate)}. Para evitar contato duplicado, aguarde${pode('fila.distribuir') ? ' ou assuma como supervisor' : ''}.`, 'atencao', '⏳')
    : minhaTrava ? aviso(`Você está com este caso até ${quando(c.trava.ate)}.`, 'info', '✋') : null;
  const botoesTrava = h('div', { class: 'acoes' },
    !minhaTrava && !c.trava ? h('button', { class: 'botao', onclick: () => acao(() => apiOrg(`/casos/${casoId}/assumir`, { method: 'POST', body: {} })) }, 'Assumir caso') : null,
    c.trava && !minhaTrava && pode('fila.distribuir') ? h('button', { class: 'botao perigo', onclick: () => acao(() => apiOrg(`/casos/${casoId}/assumir`, { method: 'POST', body: { forcar: true } })) }, 'Assumir mesmo assim') : null,
    minhaTrava ? h('button', { class: 'botao secundario', onclick: () => acao(() => apiOrg(`/casos/${casoId}/liberar`, { method: 'POST', body: {} })) }, 'Liberar caso') : null);

  const unidadesAlunos = [...new Set(c.alunos.map(a => a.unidade_nome).filter(Boolean))];
  const titulos = h('div', { class: 'tabela-wrap' }, c.titulos.length ? h('table', {},
    h('thead', {}, h('tr', {}, ['Título', 'Aluno', 'Competência', 'Vencimento', 'Saldo', 'Situação'].map(t => h('th', { class: t === 'Saldo' ? 'num' : '' }, t)))),
    h('tbody', {}, c.titulos.map(t => h('tr', {},
      h('td', { class: 'sem-quebra' }, t.id_origem, h('div', { class: 'mudo pequeno' }, t.unidade_nome || 'Sem unidade')),
      h('td', {}, t.aluno_nome || '—', h('div', { class: 'mudo pequeno' }, `Mat. ${t.aluno_matricula}`)),
      h('td', {}, t.competencia ? t.competencia.split('-').reverse().join('/') : '—'),
      h('td', {}, dataBR(t.vencimento), t.dias_atraso ? h('div', { class: 'mudo pequeno' }, `${t.dias_atraso} dias de atraso`) : null),
      h('td', { class: 'num' }, reais(t.saldo_centavos), h('div', { class: 'mudo pequeno' }, `ref. ${dataBR(t.saldo_referencia)}`)),
      h('td', {}, seloTitulo(t), t.alertas.filter(a => a.codigo === 'DESATUALIZADO').map(a => h('div', {}, selo(a.texto, 'atencao', '⏱')))))))) : vazio('Sem títulos visíveis'));

  // Registrar contato
  const form = h('form', {
    class: 'grade', onsubmit: ev => {
      ev.preventDefault();
      const f = ev.target;
      const corpo = { canal: f.canal.value, direcao: f.direcao.value, resultado: f.resultado.value, nota: f.nota.value, proxima_acao_em: f.proxima.value || null };
      if (corpo.resultado === 'RETORNO_COMBINADO') corpo.retorno_em = f.retorno.value;
      if (corpo.resultado === 'PROMESSA') { corpo.promessa_data = f.promessa.value; const v = Math.round(Number(String(f.valor.value).replace(/\./g, '').replace(',', '.')) * 100); if (v > 0) corpo.promessa_centavos = v; }
      acao(() => apiOrg(`/casos/${casoId}/contatos`, { method: 'POST', body: corpo }), 'Contato registrado.');
    },
  },
  h('div', { class: 'form-linha' },
    h('div', { class: 'campo' }, h('label', { for: 'canal' }, 'Canal'), h('select', { id: 'canal', name: 'canal' }, [['WHATSAPP', 'WhatsApp'], ['TELEFONE', 'Telefone'], ['EMAIL', 'E-mail'], ['PRESENCIAL', 'Presencial']].map(([v, t]) => h('option', { value: v }, t)))),
    h('div', { class: 'campo' }, h('label', { for: 'direcao' }, 'Tipo'), h('select', { id: 'direcao', name: 'direcao' }, h('option', { value: 'ATIVO' }, 'Ativo (nós contatamos)'), h('option', { value: 'RECEPTIVO' }, 'Receptivo (família procurou)'))),
    h('div', { class: 'campo' }, h('label', { for: 'resultado' }, 'Resultado'), h('select', {
      id: 'resultado', name: 'resultado', onchange: e => {
        form.querySelector('#bloco-retorno').classList.toggle('oculto', e.target.value !== 'RETORNO_COMBINADO');
        form.querySelector('#bloco-promessa').classList.toggle('oculto', e.target.value !== 'PROMESSA');
      },
    }, [['SEM_RESPOSTA', 'Tentativa sem resposta'], ['RESPONDEU', 'Respondeu'], ['RETORNO_COMBINADO', 'Retorno combinado'], ['PROMESSA', 'Promessa de pagamento'], ['RECUSA', 'Recusou negociar'], ['NUMERO_INVALIDO', 'Número inválido'], ['OUTRO', 'Outro']].map(([v, t]) => h('option', { value: v }, t))))),
  h('div', { class: 'form-linha oculto', id: 'bloco-retorno' }, h('div', { class: 'campo' }, h('label', { for: 'retorno' }, 'Retorno combinado para'), h('input', { type: 'datetime-local', id: 'retorno', name: 'retorno' }), h('span', { class: 'ajuda' }, 'Até essa hora o caso sai da fila e o contato ativo fica bloqueado.'))),
  h('div', { class: 'form-linha oculto', id: 'bloco-promessa' },
    h('div', { class: 'campo' }, h('label', { for: 'promessa' }, 'Data prometida'), h('input', { type: 'date', id: 'promessa', name: 'promessa', min: hojeISO() })),
    h('div', { class: 'campo' }, h('label', { for: 'valor' }, 'Valor prometido (R$)'), h('input', { type: 'text', id: 'valor', name: 'valor', inputmode: 'decimal', placeholder: '0,00' }), h('span', { class: 'ajuda' }, 'Promessa não é acordo nem pagamento.'))),
  h('div', { class: 'campo' }, h('label', { for: 'nota' }, 'Anotação'), h('textarea', { id: 'nota', name: 'nota', maxlength: 2000 })),
  h('div', { class: 'form-linha' },
    h('div', { class: 'campo' }, h('label', { for: 'proxima' }, 'Próxima ação em'), h('input', { type: 'date', id: 'proxima', name: 'proxima', min: hojeISO() }), h('span', { class: 'ajuda' }, 'Obrigatória, exceto recusa e número inválido. Retorno e promessa preenchem sozinhos.')),
    h('div', {}, h('button', { class: 'botao', type: 'submit', disabled: !minhaTrava }, 'Registrar contato'))),
  !minhaTrava ? h('div', { class: 'mudo pequeno' }, 'Assuma o caso para registrar.') : null);

  // WhatsApp
  const zap = h('div', {}, carregando('Verificando bloqueios…'));
  (async () => {
    if (!pode('conversa.enviar')) return trocar(zap, h('div', { class: 'mudo' }, 'Seu perfil não envia mensagens.'));
    const conexoes = estado.ctx.conexoes;
    try {
      const b = await apiOrg(`/casos/${casoId}/bloqueios`);
      const sel = h('select', { id: 'cx', 'aria-label': 'Conexão de envio' }, conexoes.map(x => h('option', { value: x.id }, `${x.nome} · ${x.modo === 'OFICIAL' ? 'API oficial' : 'teste'}`)));
      trocar(zap, 
        c.conversas.length ? h('div', {}, h('div', { class: 'pequeno mudo' }, 'Conversas deste caso'), c.conversas.map(cv => h('div', {}, h('a', { href: `#/o/${estado.orgId}/conversas/${cv.id}` }, `${cv.conexao_nome} · ${cv.verificada_em ? 'identidade confirmada' : 'aguardando confirmação'}`))), h('br')) : null,
        !conexoes.length ? aviso('Esta instituição não tem conexão de WhatsApp ativa.', 'atencao', '⚠')
          : b.bloqueios.length ? h('div', {}, b.bloqueios.map(x => aviso(x.texto, 'atencao', '⏸')))
            : h('div', { class: 'grade' },
              h('div', { class: 'aviso info' }, h('span', {}, 'ℹ'), h('div', {}, 'O primeiro contato apresenta você, a GO Negocia e a instituição, sem mencionar valores. O débito só é tratado depois da confirmação do responsável.')),
              conexoes.length > 1 ? sel : null,
              h('div', {}, h('button', { class: 'botao', disabled: !minhaTrava, onclick: () => acao(async () => { const r = await apiOrg(`/casos/${casoId}/contato-ativo`, { method: 'POST', body: { conexao_id: conexoes.length > 1 ? sel.value : conexoes[0].id } }); ir(`#/o/${estado.orgId}/conversas/${r.conversa_id}`); return 'navegou'; }) }, 'Iniciar contato pelo WhatsApp'))));
    } catch (e) { trocar(zap, erroBloco(e)); }
  })();

  trocar(conteudo, 
    cabecalho(c.responsavel.nome, `${c.organizacao.nome}${unidadesAlunos.length ? ' · ' + unidadesAlunos.join(', ') : ''} · código ${c.responsavel.chave_origem}`,
      h('a', { class: 'botao secundario', href: `#/o/${estado.orgId}/fila` }, '‹ Fila')),
    blocoTrava, botoesTrava, msg, h('br'),
    h('div', { class: 'grade grade-4' },
      ind('Saldo negociável', reais(c.totais.saldo_negociavel_centavos), `${c.totais.titulos_negociaveis} título(s)`),
      ind('Títulos pausados', c.totais.titulos_pausados, 'contestados, em análise ou ausentes'),
      ind('Próxima ação', c.proxima_acao.em ? dataBR(c.proxima_acao.em) : 'Hoje', c.proxima_acao.tipo ? rotuloAcao(c.proxima_acao.tipo) : 'primeiro contato'),
      ind('Contato', c.responsavel.contato_autorizado ? 'Autorizado' : 'Não autorizado', telefoneBR(c.responsavel.telefone) || 'sem telefone')),
    h('br'),
    h('div', { class: 'grade grade-2' },
      h('div', {},
        h('section', { class: 'cartao' },
          h('div', { class: 'abas', role: 'tablist' }, h('button', { class: 'ativa', role: 'tab', 'aria-selected': 'true' }, 'Títulos'), h('button', { role: 'tab', disabled: true, title: 'Chega no incremento 2 (acordos)' }, 'Negociação · próximo incremento')),
          h('div', { class: 'pequeno mudo' }, 'Alunos: ', c.alunos.map(a => `${a.nome || 'Aluno'} (mat. ${a.matricula}${a.unidade_nome ? ' · ' + a.unidade_nome : ''})`).join(' · ') || '—'),
          h('br'), titulos),
        h('section', { class: 'cartao' }, h('h2', {}, 'Registrar contato'), h('br'), form)),
      h('div', {},
        h('section', { class: 'cartao' }, h('h2', {}, 'WhatsApp'), h('br'), zap),
        h('section', { class: 'cartao' }, h('h2', {}, 'Histórico'),
          c.contatos.length ? h('ul', { class: 'linha-tempo' }, c.contatos.map(ct => h('li', {},
            h('div', {}, h('strong', {}, rotuloResultado(ct.resultado)), ' · ', ct.canal.toLowerCase(), ' · ', ct.direcao === 'ATIVO' ? 'ativo' : 'receptivo'),
            h('div', { class: 'mudo pequeno' }, `${quando(ct.em)} · ${ct.usuario_nome}`),
            ct.promessa_data ? h('div', { class: 'pequeno' }, `Promessa para ${dataBR(ct.promessa_data)}${ct.promessa_centavos ? ' · ' + reais(ct.promessa_centavos) : ''}`) : null,
            ct.retorno_em ? h('div', { class: 'pequeno' }, `Retorno combinado: ${quando(ct.retorno_em)}`) : null,
            ct.nota ? h('div', { class: 'pequeno' }, ct.nota) : null))) : vazio('Nenhum contato registrado'))),
      ));
}
const rotuloResultado = r => ({ SEM_RESPOSTA: 'Sem resposta', RESPONDEU: 'Respondeu', RETORNO_COMBINADO: 'Retorno combinado', PROMESSA: 'Promessa de pagamento', RECUSA: 'Recusou', NUMERO_INVALIDO: 'Número inválido', OUTRO: 'Outro' }[r] || r);

// ---------- Conversas ----------
async function paginaConversas(conversaId) {
  const lista = h('div', { class: 'lista-conversas' }, carregando());
  const detalhe = h('div', {}, conversaId ? carregando() : h('div', { class: 'cartao' }, vazio('Selecione uma conversa', 'As mensagens recebidas entram aqui, já separadas pela conexão da instituição.')));
  const simular = pode('teste.simular') && estado.ctx.conexoes.some(c => c.modo === 'TESTE') ? (() => {
    const f = h('form', {
      class: 'grade', onsubmit: async ev => {
        ev.preventDefault();
        try { const r = await apiOrg('/teste/receber', { method: 'POST', body: { conexao_id: f.cxs.value, telefone: f.tel.value, texto: f.txt.value } }); ir(`#/o/${estado.orgId}/conversas/${r.conversaId}`); }
        catch (e) { alertaFlutuante(e.message); }
      },
    },
    h('div', { class: 'campo' }, h('label', { for: 'cxs' }, 'Conexão de teste'), h('select', { id: 'cxs', name: 'cxs' }, estado.ctx.conexoes.filter(c => c.modo === 'TESTE').map(c => h('option', { value: c.id }, c.nome)))),
    h('div', { class: 'campo' }, h('label', { for: 'tel' }, 'Telefone de quem escreve'), h('input', { type: 'text', id: 'tel', name: 'tel', required: true, placeholder: '16 99000-0001' })),
    h('div', { class: 'campo' }, h('label', { for: 'txt' }, 'Mensagem'), h('input', { type: 'text', id: 'txt', name: 'txt', required: true, value: 'Oi, recebi uma mensagem de vocês.' })),
    h('button', { class: 'botao secundario', type: 'submit' }, 'Simular mensagem recebida'));
    return h('details', { class: 'cartao' }, h('summary', {}, 'Ambiente de teste: simular mensagem recebida'), h('br'), f);
  })() : null;
  moldura('conversas', h('div', {}, cabecalho('Atendimento', `${estado.ctx.organizacao.nome} · conversas de WhatsApp desta instituição`),
    h('div', { class: 'grade grade-2' }, detalhe, h('div', {}, h('section', { class: 'cartao' }, h('h2', {}, 'Conversas'), lista), simular))));
  try {
    const cs = await apiOrg('/conversas');
    trocar(lista, ...(cs.length ? cs.map(cv => h('button', { class: cv.id === conversaId ? 'ativa' : '', onclick: () => ir(`#/o/${estado.orgId}/conversas/${cv.id}`) },
      h('div', {}, h('strong', {}, cv.responsavel || telefoneBR(cv.telefone)), ' ', cv.verificada ? selo('Confirmada', 'ok', '✓') : selo('Não confirmada', 'atencao', '?')),
      h('div', { class: 'mudo pequeno' }, `${cv.conexao.nome} · ${quando(cv.atualizada_em)}`),
      cv.ultima ? h('div', { class: 'pequeno' }, (cv.ultima_direcao === 'SAIDA' ? 'Você: ' : '') + cv.ultima.slice(0, 70)) : null)) : [vazio('Nenhuma conversa ainda')]));
  } catch (e) { trocar(lista, erroBloco(e)); }
  if (conversaId) carregarConversa(conversaId, detalhe);
}

async function carregarConversa(id, alvo) {
  let cv;
  try { cv = await apiOrg(`/conversas/${id}`); }
  catch (e) { return trocar(alvo, e.status === 404 ? h('div', { class: 'cartao' }, vazio('Conversa não encontrada', 'Ela não existe ou não pertence ao seu escopo.')) : erroBloco(e)); }
  const recarregar = () => carregarConversa(id, alvo);
  const msg = h('div');
  const chat = h('div', { class: 'chat', 'aria-live': 'polite' }, cv.mensagens.length ? cv.mensagens.map(m => h('div', { class: `bolha ${m.direcao === 'ENTRADA' ? 'entrada' : 'saida'}` }, m.texto,
    h('div', { class: 'meta' }, quando(m.em), m.direcao === 'SAIDA' ? ` · ${m.usuario_nome || ''} · ${({ SIMULADA: 'simulada (teste)', NAO_ENVIADA_ENVIO_DESLIGADO: 'não enviada (envio real desligado)', ENVIADA: 'enviada', FALHOU: 'falhou' })[m.status] || m.status}` : '', m.erro ? ` · ${m.erro}` : ''))) : vazio('Sem mensagens'));
  setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 0);

  let verificacao = null;
  if (!cv.verificada) {
    const resultados = h('div');
    const selResp = h('select', { id: 'v-resp', name: 'resp', required: true }, h('option', { value: '' }, cv.candidatos.length ? 'Escolha o responsável' : 'Busque o responsável abaixo'), cv.candidatos.map(r => h('option', { value: r.id, selected: cv.candidatos.length === 1 }, `${r.nome} (sugerido)`)));
    const busca = h('input', {
      type: 'search', placeholder: 'Buscar por nome ou código', 'aria-label': 'Buscar responsável', oninput: async e => {
        const q = e.target.value.trim(); if (q.length < 3) return;
        try { const r = await apiOrg(`/carteira?busca=${encodeURIComponent(q)}`); trocar(selResp, h('option', { value: '' }, 'Escolha o responsável'), cv.candidatos.map(x => h('option', { value: x.id }, `${x.nome} (sugerido)`)), r.itens.map(x => h('option', { value: x.id }, `${x.nome} · ${x.chave_origem}`))); } catch { /* ignora */ }
      },
    });
    const f = h('form', {
      class: 'grade', onsubmit: async ev => {
        ev.preventDefault();
        try { const r = await apiOrg(`/conversas/${id}/verificar`, { method: 'POST', body: { responsavel_id: selResp.value, matricula: f.mat.value } }); if (!r.telefone_confere) alertaFlutuante('Identidade confirmada. Atenção: o telefone desta conversa é diferente do cadastrado pela escola.', 'info'); recarregar(); }
        catch (e) { trocar(resultados, aviso(e.message, 'erro', '⚠')); }
      },
    },
    aviso(`Antes de falar do débito, confirme a identidade. Regra desta instituição: a pessoa informa a matrícula de um aluno vinculado. Busca limitada a ${cv.organizacao}.`, 'info', '🔒'),
    h('div', { class: 'form-linha' }, h('div', { class: 'campo' }, h('label', {}, 'Responsável'), busca, selResp),
      h('div', { class: 'campo' }, h('label', { for: 'mat' }, 'Matrícula informada'), h('input', { type: 'text', id: 'mat', name: 'mat', required: true }))),
    resultados, h('div', {}, h('button', { class: 'botao', type: 'submit' }, 'Confirmar identidade')));
    verificacao = h('section', { class: 'cartao' }, h('h2', {}, 'Confirmação do responsável'), h('br'), f);
  }

  const envio = h('form', {
    class: 'acoes', onsubmit: async ev => {
      ev.preventDefault();
      trocar(msg, );
      try { await apiOrg(`/conversas/${id}/mensagens`, { method: 'POST', body: { texto: envio.texto.value } }); recarregar(); }
      catch (e) { trocar(msg, aviso(e.message, 'erro', '⚠')); }
    },
  }, h('input', { type: 'text', name: 'texto', 'aria-label': 'Mensagem', placeholder: 'Escreva uma mensagem', required: true, class: 'campo-msg' }), h('button', { class: 'botao', type: 'submit' }, 'Enviar'));

  const janela = cv.conexao.modo === 'OFICIAL' ? (cv.janela_aberta_ate && cv.janela_aberta_ate > Date.now() ? selo(`Janela de 24h aberta até ${quando(cv.janela_aberta_ate)}`, 'info', '⏱') : selo('Fora da janela de 24h: só modelo aprovado', 'atencao', '⏱')) : selo('Conexão de teste', 'neutro', '⚙');
  trocar(alvo, 
    h('section', { class: 'cartao' },
      h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h2', {}, cv.caso?.responsavel?.nome || telefoneBR(cv.telefone)), h('p', { class: 'mudo pequeno' }, `${cv.organizacao} · ${cv.conexao.nome}`)),
        h('div', { class: 'acoes' }, cv.verificada ? selo('Identidade confirmada', 'ok', '✓') : selo('Identidade não confirmada', 'atencao', '?'), janela,
          cv.caso_id ? h('a', { class: 'botao secundario pequeno', href: `#/o/${estado.orgId}/caso/${cv.caso_id}` }, 'Abrir caso') : null)),
      chat, h('br'), msg, envio,
      !cv.verificada ? h('div', { class: 'mudo pequeno' }, 'Mensagens com valores ou débitos são bloqueadas até a confirmação.') : null),
    verificacao,
    cv.caso ? h('section', { class: 'cartao' }, h('h2', {}, 'Títulos do responsável'), h('br'),
      h('table', {}, h('tbody', {}, cv.caso.titulos.map(t => h('tr', {}, h('td', {}, t.aluno_nome, h('div', { class: 'mudo pequeno' }, `${t.id_origem} · venc. ${dataBR(t.vencimento)}`)), h('td', { class: 'num' }, reais(t.saldo_centavos)), h('td', {}, seloTitulo(t))))))) : null);
}

// ---------- Importação ----------
async function paginaImportar(loteId) {
  const area = h('div');
  const historico = h('div', {}, carregando());
  const ctx = estado.ctx;
  const form = pode('carteira.importar') ? h('form', {
    class: 'grade', onsubmit: async ev => {
      ev.preventDefault();
      const arq = form.arquivo.files[0];
      if (!arq) return;
      trocar(area, carregando('Lendo arquivo e montando a prévia…'));
      try {
        const buf = new Uint8Array(await arq.arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const r = await apiOrg('/lotes', { method: 'POST', body: { arquivo_nome: arq.name, conteudo_base64: btoa(bin), data_referencia: form.ref.value, escopo: form.escopo.value, tipo: 'CARTEIRA' } });
        ir(`#/o/${estado.orgId}/importar/${r.id}`);
      } catch (e) { trocar(area, aviso(e.message, 'erro', '⚠')); }
    },
  },
  h('div', { class: 'form-linha' },
    h('div', { class: 'campo' }, h('label', { for: 'arquivo' }, 'Arquivo da escola (CSV ou XLSX)'), h('input', { type: 'file', id: 'arquivo', name: 'arquivo', accept: '.csv,.xlsx,text/csv', required: true })),
    h('div', { class: 'campo' }, h('label', { for: 'ref' }, 'Data de referência dos saldos'), h('input', { type: 'date', id: 'ref', name: 'ref', value: hojeISO(), max: hojeISO(), required: true })),
    h('div', { class: 'campo' }, h('label', { for: 'escopo' }, 'O arquivo traz'), h('select', { id: 'escopo', name: 'escopo' }, h('option', { value: 'COMPLETA' }, 'Toda a carteira em aberto das unidades do arquivo'), h('option', { value: 'PARCIAL' }, 'Só parte dos títulos (não sinaliza ausentes)')))),
  h('div', { class: 'mudo pequeno' }, 'Colunas: id_titulo, unidade, responsavel_id, responsavel_nome, telefone, contato_autorizado, aluno_matricula, aluno_nome, competencia, vencimento, valor, saldo, situacao. CPF completo não é necessário (só os 4 últimos dígitos são guardados).'),
  h('div', {}, h('button', { class: 'botao', type: 'submit' }, 'Gerar prévia'))) : null;

  moldura('importar', h('div', {},
    cabecalho(pode('carteira.importar') ? 'Importar carteira' : 'Importações', `${ctx.organizacao.nome} · nada muda na carteira até você aplicar a prévia.`),
    form ? h('section', { class: 'cartao' }, form) : null,
    h('br'), area, h('br'),
    h('section', { class: 'cartao' }, h('h2', {}, 'Lotes'), h('br'), historico)));

  if (loteId) mostrarLote(loteId, area);
  try {
    const lotes = await apiOrg('/lotes');
    trocar(historico, lotes.length ? h('div', { class: 'tabela-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Arquivo', 'Referência', 'Situação', 'Novos', 'Alterados', 'Rejeitados', 'Ausentes', 'Por'].map(t => h('th', {}, t)))),
      h('tbody', {}, lotes.map(l => h('tr', { class: 'clicavel', onclick: () => ir(`#/o/${estado.orgId}/importar/${l.id}`) },
        h('td', {}, l.arquivo_nome, h('div', { class: 'mudo pequeno' }, quando(l.criado_em))), h('td', {}, dataBR(l.data_referencia)),
        h('td', {}, l.status === 'APLICADO' ? selo('Aplicado', 'ok', '✓') : l.status === 'PREVIA' ? selo('Prévia', 'info', '…') : selo('Descartado', 'neutro', '–')),
        h('td', { class: 'num' }, l.resumo.novos), h('td', { class: 'num' }, l.resumo.alterados), h('td', { class: 'num' }, l.resumo.rejeitados), h('td', { class: 'num' }, l.resumo.ausentes), h('td', {}, l.usuario_nome)))))) : vazio('Nenhum lote importado'));
  } catch (e) { trocar(historico, erroBloco(e)); }
}

async function mostrarLote(id, alvo) {
  trocar(alvo, carregando());
  let l;
  try { l = await apiOrg(`/lotes/${id}`); } catch (e) { return trocar(alvo, erroBloco(e)); }
  const r = l.resumo;
  const msg = h('div');
  const agir = async acao => { try { await apiOrg(`/lotes/${id}/${acao}`, { method: 'POST', body: {} }); await carregarCtx(); paginaImportar(id); } catch (e) { trocar(msg, aviso(e.message, 'erro', '⚠')); } };
  const linhasProblema = l.linhas.filter(x => ['REJEITADO', 'REPETIDO'].includes(x.status) || x.motivo);
  trocar(alvo, h('section', { class: 'cartao' },
    h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h2', {}, `${l.status === 'PREVIA' ? 'Prévia' : l.status === 'APLICADO' ? 'Lote aplicado' : 'Lote descartado'} · ${l.arquivo_nome}`),
      h('p', { class: 'mudo pequeno' }, `Referência ${dataBR(l.data_referencia)} · ${l.escopo === 'COMPLETA' ? 'carteira completa' : 'parcial'} · por ${l.usuario_nome} em ${quando(l.criado_em)}`)),
    l.status === 'PREVIA' && pode('carteira.importar') ? h('div', { class: 'acoes' }, h('button', { class: 'botao', onclick: () => agir('aplicar') }, r.novos + r.alterados ? `Aplicar ${r.novos + r.alterados} mudança(s)` : 'Aplicar (sem mudanças na carteira)'), h('button', { class: 'botao secundario', onclick: () => agir('descartar') }, 'Descartar')) : null),
    msg,
    r.arquivo_ja_aplicado_em ? aviso(`Este mesmo arquivo já foi aplicado em ${quando(r.arquivo_ja_aplicado_em)}. Reaplicar não duplica registros.`, 'info', 'ℹ') : null,
    h('div', { class: 'grade grade-4' }, ind('Válidos', r.validos, `${r.novos} novos · ${r.alterados} alterados · ${r.sem_mudanca} sem mudança`), ind('Repetidos', r.repetidos, 'linhas idênticas ignoradas'), ind('Rejeitados', r.rejeitados, 'ver motivos abaixo'), ind('Ausentes', r.ausentes, 'em aberto antes, fora deste arquivo')),
    r.ausentes ? h('div', {}, h('br'), aviso(`${r.ausentes} título(s) em aberto não vieram neste arquivo (${r.ausentes_ids.slice(0, 8).join(', ')}${r.ausentes > 8 ? '…' : ''}). Ausência não comprova pagamento: os títulos ficam pausados e sinalizados para conferência com a escola.`, 'atencao', '?')) : null,
    h('br'),
    linhasProblema.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Linha', 'Título', 'Responsável', 'Situação', 'Motivo'].map(t => h('th', {}, t)))),
      h('tbody', {}, linhasProblema.map(x => h('tr', {}, h('td', {}, x.linha), h('td', {}, x.id_titulo || '—'), h('td', {}, x.responsavel || '—'),
        h('td', {}, x.status === 'REJEITADO' ? selo('Rejeitado', 'alerta', '✕') : x.status === 'REPETIDO' ? selo('Repetido', 'neutro', '=') : selo(x.status === 'NOVO' ? 'Novo com aviso' : 'Com aviso', 'atencao', '!')),
        h('td', {}, x.motivo || '')))))) : aviso('Nenhuma linha rejeitada.', 'ok', '✓')));
}

// ---------- Administração ----------
async function paginaAdminInstituicoes() {
  const area = h('div', {}, carregando());
  moldura('#/admin/instituicoes', h('div', {}, cabecalho('Instituições', 'Cada instituição tem carteira, conexões e acessos separados. Unidades são opcionais.'), area));
  const carregar = async () => {
    try {
      const orgs = await api('/api/admin/organizacoes');
      const nova = h('form', {
        class: 'form-linha', onsubmit: async ev => { ev.preventDefault(); try { await api('/api/admin/organizacoes', { method: 'POST', body: { nome: nova.nome.value } }); await carregarEu(); carregar(); } catch (e) { alertaFlutuante(e.message); } },
      }, h('div', { class: 'campo' }, h('label', { for: 'nome-org' }, 'Nova instituição'), h('input', { type: 'text', id: 'nome-org', name: 'nome', required: true, placeholder: 'Nome da escola' })), h('div', {}, h('button', { class: 'botao' }, 'Cadastrar')));
      trocar(area, h('section', { class: 'cartao' }, nova), ...await Promise.all(orgs.map(async o => {
        const [unidades, conexoes] = await Promise.all([api(`/api/admin/organizacoes/${o.id}/unidades`), api(`/api/admin/organizacoes/${o.id}/conexoes`)]);
        const fu = h('form', { class: 'form-linha', onsubmit: async ev => { ev.preventDefault(); try { await api(`/api/admin/organizacoes/${o.id}/unidades`, { method: 'POST', body: { nome: fu.nome.value, codigo: fu.codigo.value } }); carregar(); } catch (e) { alertaFlutuante(e.message); } } },
          h('div', { class: 'campo' }, h('label', {}, 'Unidade'), h('input', { type: 'text', name: 'nome', required: true, placeholder: 'Nome' })), h('div', { class: 'campo' }, h('label', {}, 'Código no arquivo'), h('input', { type: 'text', name: 'codigo', required: true, placeholder: 'Ex.: CEN' })), h('div', {}, h('button', { class: 'botao secundario' }, 'Adicionar unidade')));
        const fc = h('form', {
          class: 'grade', onsubmit: async ev => {
            ev.preventDefault();
            try { await api(`/api/admin/organizacoes/${o.id}/conexoes`, { method: 'POST', body: { nome: fc.nome.value, modo: fc.modo.value, phone_number_id: fc.pnid.value, waba_id: fc.waba.value, token_env: fc.tok.value, modelo_primeiro_contato: fc.modelo.value, numero_exibicao: fc.num.value } }); carregar(); }
            catch (e) { alertaFlutuante(e.message); }
          },
        },
        h('div', { class: 'form-linha' },
          h('div', { class: 'campo' }, h('label', {}, 'Nome da conexão'), h('input', { type: 'text', name: 'nome', required: true })),
          h('div', { class: 'campo' }, h('label', {}, 'Modo'), h('select', { name: 'modo', onchange: e => fc.querySelector('.so-oficial').classList.toggle('oculto', e.target.value !== 'OFICIAL') }, h('option', { value: 'TESTE' }, 'Teste (não envia)'), h('option', { value: 'OFICIAL' }, 'API oficial (Meta)'))),
          h('div', { class: 'campo' }, h('label', {}, 'Número exibido'), h('input', { type: 'text', name: 'num' }))),
        h('div', { class: 'form-linha so-oficial oculto' },
          h('div', { class: 'campo' }, h('label', {}, 'Phone Number ID'), h('input', { type: 'text', name: 'pnid', inputmode: 'numeric' })),
          h('div', { class: 'campo' }, h('label', {}, 'WABA ID'), h('input', { type: 'text', name: 'waba' })),
          h('div', { class: 'campo' }, h('label', {}, 'Variável do token'), h('input', { type: 'text', name: 'tok', placeholder: 'META_TOKEN_ESCOLA' }), h('span', { class: 'ajuda' }, 'O token fica no ambiente do servidor, não no banco.')),
          h('div', { class: 'campo' }, h('label', {}, 'Modelo de primeiro contato'), h('input', { type: 'text', name: 'modelo', placeholder: 'nome_do_modelo_aprovado' }))),
        h('div', {}, h('button', { class: 'botao secundario' }, 'Adicionar conexão')));
        return h('section', { class: 'cartao' },
          h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h2', {}, o.nome), h('p', { class: 'mudo pequeno' }, `${o.usuarios} usuário(s) · saldo válido por ${o.dias_saldo_valido} dias · verificação: matrícula do aluno`)), o.ativa ? selo('Ativa', 'ok', '✓') : selo('Inativa', 'neutro', '–')),
          h('h3', {}, 'Unidades'), unidades.length ? h('p', {}, unidades.map(u => selo(`${u.nome} · ${u.codigo}`, 'info')).flatMap(x => [x, ' '])) : h('p', { class: 'mudo pequeno' }, 'Sem unidades (opcional).'), fu, h('br'),
          h('h3', {}, 'Conexões de WhatsApp'),
          conexoes.length ? h('ul', {}, conexoes.map(c => h('li', {}, `${c.nome} · ${c.modo === 'OFICIAL' ? 'API oficial' : 'teste'}${c.numero_exibicao ? ' · ' + c.numero_exibicao : ''} `, c.ativa ? selo('Ativa', 'ok', '✓') : selo('Inativa', 'neutro', '–'),
            c.modo === 'OFICIAL' ? [' ', c.token_configurado ? selo('Token configurado', 'ok', '🔑') : selo(`Token ausente (${c.token_env})`, 'alerta', '⚠'), ' ', c.modelo_primeiro_contato ? selo(`Modelo: ${c.modelo_primeiro_contato}`, 'info') : selo('Sem modelo aprovado', 'atencao', '!')] : null))) : h('p', { class: 'mudo pequeno' }, 'Nenhuma conexão.'),
          fc);
      })));
    } catch (e) { trocar(area, erroBloco(e, carregar)); }
  };
  carregar();
}

async function paginaAdminUsuarios() {
  const area = h('div', {}, carregando());
  moldura('#/admin/usuarios', h('div', {}, cabecalho('Usuários e permissões', 'O acesso é dado por instituição. Sem acesso explícito, o usuário não vê a instituição.'), area));
  const carregar = async () => {
    try {
      const [us, orgs] = await Promise.all([api('/api/admin/usuarios'), api('/api/admin/organizacoes')]);
      const unidadesPorOrg = Object.fromEntries(await Promise.all(orgs.map(async o => [o.id, await api(`/api/admin/organizacoes/${o.id}/unidades`)])));
      const novo = h('form', {
        class: 'form-linha', onsubmit: async ev => { ev.preventDefault(); try { await api('/api/admin/usuarios', { method: 'POST', body: { nome: novo.nome.value, login: novo.login.value, senha: novo.senha.value, admin: novo.adm.checked } }); carregar(); } catch (e) { alertaFlutuante(e.message); } },
      },
      h('div', { class: 'campo' }, h('label', {}, 'Nome'), h('input', { type: 'text', name: 'nome', required: true })),
      h('div', { class: 'campo' }, h('label', {}, 'Login'), h('input', { type: 'text', name: 'login', required: true })),
      h('div', { class: 'campo' }, h('label', {}, 'Senha inicial'), h('input', { type: 'password', name: 'senha', required: true, minlength: 10, autocomplete: 'new-password' })),
      h('label', { class: 'pequeno' }, h('input', { type: 'checkbox', name: 'adm' }), ' Administrador da GO Negocia'),
      h('div', {}, h('button', { class: 'botao' }, 'Criar usuário')));
      const acessoForm = u => {
        const f = h('form', {
          class: 'form-linha', onsubmit: async ev => {
            ev.preventDefault();
            const unidades = [...f.querySelectorAll('input[name=un]:checked')].map(x => x.value);
            try { await api(`/api/admin/usuarios/${u.id}/acessos/${f.org.value}`, { method: 'PUT', body: { papel: f.papel.value || null, unidades } }); carregar(); } catch (e) { alertaFlutuante(e.message); }
          },
        },
        h('div', { class: 'campo' }, h('label', {}, 'Instituição'), h('select', { name: 'org', onchange: e => { trocar(uns, ...(unidadesPorOrg[e.target.value] || []).map(x => h('label', { class: 'pequeno' }, h('input', { type: 'checkbox', name: 'un', value: x.id }), ` ${x.nome} `))); } }, orgs.map(o => h('option', { value: o.id }, o.nome)))),
        h('div', { class: 'campo' }, h('label', {}, 'Perfil'), h('select', { name: 'papel' }, h('option', { value: 'ATENDENTE' }, 'Atendente'), h('option', { value: 'SUPERVISOR' }, 'Supervisor'), h('option', { value: 'REPRESENTANTE' }, 'Representante da instituição'), h('option', { value: '' }, 'Remover acesso'))),
        h('div', {}, h('button', { class: 'botao secundario pequeno' }, 'Salvar acesso')));
        const uns = h('div', { class: 'campo' }, (unidadesPorOrg[orgs[0]?.id] || []).map(x => h('label', { class: 'pequeno' }, h('input', { type: 'checkbox', name: 'un', value: x.id }), ` ${x.nome} `)));
        f.insertBefore(h('div', { class: 'campo' }, h('label', {}, 'Unidades (vazio = todas)'), uns), f.lastChild);
        return f;
      };
      trocar(area, h('section', { class: 'cartao' }, h('h2', {}, 'Novo usuário'), h('br'), novo),
        ...us.map(u => h('section', { class: 'cartao' },
          h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h3', {}, u.nome), h('p', { class: 'mudo pequeno' }, u.login)), h('div', { class: 'acoes' }, u.admin ? selo('Administrador', 'info') : null, u.ativo ? selo('Ativo', 'ok', '✓') : selo('Inativo', 'neutro', '–'))),
          u.admin ? h('p', { class: 'mudo pequeno' }, 'Acesso a todas as instituições.') : u.acessos.length ? h('ul', {}, u.acessos.map(a => h('li', {}, `${a.organizacao}: ${({ SUPERVISOR: 'Supervisor', ATENDENTE: 'Atendente', REPRESENTANTE: 'Representante' })[a.papel]} · ${a.todas_unidades ? 'todas as unidades' : (unidadesPorOrg[a.organizacao_id] || []).filter(x => a.unidades.includes(x.id)).map(x => x.nome).join(', ')}`))) : h('p', { class: 'mudo pequeno' }, 'Sem acesso a nenhuma instituição.'),
          u.admin ? null : acessoForm(u))));
    } catch (e) { trocar(area, erroBloco(e, carregar)); }
  };
  carregar();
}

// ---------- roteamento ----------
async function carregarCtx() { estado.ctx = await apiOrg('/contexto'); }

async function render() {
  if (!estado.eu) await carregarEu();
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  if (!estado.eu) return telaLogin();
  if (partes[0] === 'login') return ir('#/');
  if (partes[0] === 'admin') {
    estado.orgId = null; estado.ctx = null;
    if (!estado.eu.usuario.admin) return ir('#/');
    return partes[1] === 'usuarios' ? paginaAdminUsuarios() : paginaAdminInstituicoes();
  }
  if (partes[0] === 'o' && partes[1]) {
    if (estado.orgId !== partes[1] || !estado.ctx) {
      estado.orgId = partes[1];
      try { await carregarCtx(); } catch (e) {
        estado.ctx = null;
        moldura('', h('div', { class: 'cartao' }, e.status === 404 ? vazio('Instituição não encontrada', 'Ela não existe ou você não tem acesso a ela.') : erroBloco(e)));
        estado.orgId = null;
        return;
      }
    }
    const p = partes[2] || 'fila';
    if (p === 'carteira' && pode('carteira.ver')) return paginaCarteira();
    if (p === 'fila' && pode('fila.ver')) return paginaFila();
    if (p === 'caso' && pode('caso.trabalhar')) return paginaCaso(partes[3]);
    if (p === 'conversas' && pode('conversa.ver')) return paginaConversas(partes[3]);
    if (p === 'importar' && (pode('carteira.importar') || pode('lotes.ver'))) return paginaImportar(partes[3]);
    return ir(`#/o/${estado.orgId}/${pode('fila.ver') ? 'fila' : 'carteira'}`);
  }
  estado.orgId = null; estado.ctx = null;
  return paginaInicio();
}

window.addEventListener('hashchange', render);
render();
