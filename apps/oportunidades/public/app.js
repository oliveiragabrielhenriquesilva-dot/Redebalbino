(() => {
  'use strict';
  const API = '/oportunidades/api/ma/oportunidades';
  const $ = id => document.getElementById(id);
  const THEME_KEY = 'balbino-theme';
  function carregarTema() { try { const t = localStorage.getItem(THEME_KEY) || localStorage.getItem('balbino:tema'); if (t === 'claro' || t === 'light') return 'claro'; if (t === 'escuro' || t === 'dark') return 'escuro'; } catch {} return 'escuro'; }
  function aplicarTema(tema, salvar = false) {
    if (window.BalbinoTheme) return window.BalbinoTheme.set(tema);
    const claro = tema === 'claro'; document.documentElement.dataset.tema = claro ? 'claro' : 'escuro';
    const botao = $('theme-toggle');
    if (botao) { botao.textContent = claro ? '🌙 Tema escuro' : '☀️ Tema claro'; botao.setAttribute('aria-label', claro ? 'Mudar para tema escuro' : 'Mudar para tema claro'); botao.setAttribute('aria-pressed', String(claro)); }
    if (salvar) { try { localStorage.setItem(THEME_KEY, claro ? 'light' : 'dark'); } catch {} }
  }
  document.documentElement.dataset.tema = carregarTema();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = n => n == null ? '—' : Number(n).toLocaleString('pt-BR');
  const fmtP = n => n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const fmtD = v => { if (!v) return '—'; const [y, m, d] = String(v).slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : '—'; };
  const digits = v => String(v || '').replace(/\D/g, '');

  const state = { opts: null, ciclo: '', f: {}, tab: 'painel', painel: null, list: { page: 1, order: 'retorno' }, drill: { extra: {}, page: 1, title: '' }, detail: null, filtersOpen: false, compareOpen: false };
  const drillRegistry = [];

  // ------------------------------------------------------------ requisições
  const requests = window.BalbinoRequests.create({onUnauthorized:()=>location.assign('/?next='+encodeURIComponent(location.pathname))});
  const api = (url,options={})=>requests.json(url,options);
  const cancelled = error => error?.name === 'AbortError';
  let readVersion=0;
  function params(extra = {}, base = state.f) {
    const p = new URLSearchParams();
    if (state.ciclo) p.set('ciclo', state.ciclo);
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== '' && v != null) p.set(k, v);
    return p;
  }
  const nomeProcesso = nome => String(nome || '').replace(/^Ciclo\s+/i, 'Processo ');
  const showError = (msg = '') => { $('error').textContent = msg; $('error').classList.toggle('hidden', !msg); if (msg) $('error').scrollIntoView({ block: 'nearest' }); };
  const showNotice = (msg = '') => { $('notice').textContent = msg; $('notice').classList.toggle('hidden', !msg); };

  // ------------------------------------------------------------ opções e filtros
  async function loadOpcoes() {
    const o = await api(`${API}/opcoes?ciclo=${encodeURIComponent(state.ciclo || '')}`);
    state.opts = o; state.ciclo = String(o.ciclo);
    $('cycle').innerHTML = o.ciclos.map(c => `<option value="${esc(c.id)}">${esc(nomeProcesso(c.nome))}${c.padrao ? ' (atual)' : ''}</option>`).join('');
    $('cycle').value = state.ciclo;
    $('cmp-ciclo').innerHTML = '<option value="">Não comparar</option>' + o.ciclos.filter(c => String(c.id) !== state.ciclo).map(c => `<option value="${esc(c.id)}">${esc(nomeProcesso(c.nome))}</option>`).join('');
    document.querySelectorAll('[data-opt]').forEach(sel => {
      const list = o[sel.dataset.opt] || [];
      const cur = state.f[sel.dataset.f] || '';
      sel.innerHTML = '<option value="">Todos</option>' + list.map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
      sel.value = list.some(x => String(x.value) === cur) ? cur : '';
      if (!sel.value && cur) delete state.f[sel.dataset.f];
    });
    $('upload-label').classList.toggle('hidden', !o.permissoes.importar);
    $('tab-importacoes').classList.toggle('hidden', !o.permissoes.importar);
    $('who').textContent = o.usuario.nome + (o.permissoes.polo_restrito ? ' · ' + (o.polos_cadastro[0]?.nome || 'polo') : '');
  }
  function readFilters() {
    const f = {};
    document.querySelectorAll('[data-f]').forEach(el => { const v = el.value.trim(); if (v) f[el.dataset.f] = v; });
    const cc = $('cmp-ciclo').value, cd = $('cmp-de').value, ca = $('cmp-ate').value;
    if (cc) f.cmp_ciclo = cc; if (cd) f.cmp_de = cd; if (ca) f.cmp_ate = ca;
    state.f = f;
  }
  function writeFilters() {
    document.querySelectorAll('[data-f]').forEach(el => { el.value = state.f[el.dataset.f] || ''; });
    $('cmp-ciclo').value = state.f.cmp_ciclo || ''; $('cmp-de').value = state.f.cmp_de || ''; $('cmp-ate').value = state.f.cmp_ate || '';
  }
  function filterSummary() {
    const parts = [];
    document.querySelectorAll('[data-f]').forEach(el => {
      const v = state.f[el.dataset.f]; if (!v) return;
      const label = el.closest('label').querySelector('span').textContent;
      const shown = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : el.type === 'date' ? fmtD(v) : v;
      parts.push(`${label}: ${shown}`);
    });
    if (state.f.mes) parts.push(`Mês de inscrição: ${state.f.mes === 'sem' ? 'sem data' : state.f.mes.split('-').reverse().join('/')}`);
    $('filter-summary').textContent = parts.length ? parts.join(' · ') : 'Todos os registros do processo';
  }
  function saveUrl() {
    const p = params();
    if (state.tab !== 'painel') p.set('aba', state.tab);
    if(state.tab==='acoes'&&selectedAction)p.set('acao',selectedAction);
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  }
  function loadUrl() {
    const p = new URLSearchParams(location.search);
    state.ciclo = p.get('ciclo') || '';
    selectedAction=p.get('acao')||'';
    for (const [k, v] of p) if (!['ciclo', 'aba', 'acao'].includes(k)) state.f[k] = v;
    if (['candidatos', 'acoes', 'importacoes', 'definicoes'].includes(p.get('aba'))) state.tab = p.get('aba');
  }
  const labelOf = (opt, value) => (state.opts?.[opt] || []).find(x => String(x.value) === String(value))?.label || value;

  // ------------------------------------------------------------ componentes
  function drillAttr(title, extra) { drillRegistry.push({ title, extra }); return ` data-drill="${drillRegistry.length - 1}"`; }
  function num(n, title, extra, cls = '') {
    if (!n) return `<span class="num zero ${cls}">${fmtN(n || 0)}</span>`;
    return `<button type="button" class="num ${cls}"${drillAttr(title, extra)} title="Ver os candidatos">${fmtN(n)}</button>`;
  }
  function bars(container, rows, opts) {
    const max = Math.max(1, ...rows.map(r => r.value));
    container.innerHTML = rows.length ? `<div class="bars">${rows.map(r => `
      <div class="bar-row">
        <div class="bar-label" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="bar-track" title="${esc(r.tip || '')}"><span class="bar-fill" data-w="${(r.value / max) * 100}"></span>${r.sub != null ? `<span class="bar-fill sub" data-w="${(r.sub / max) * 100}"></span>` : ''}</div>
        <div class="bar-val">${r.drill ? num(r.value, r.drill.title, r.drill.extra) : fmtN(r.value)}<small>${esc(r.note || '')}</small></div>
      </div>`).join('')}</div>${opts?.legend ? `<div class="legend">${opts.legend}</div>` : ''}` : '<p class="empty">Sem dados no filtro.</p>';
    container.querySelectorAll('[data-w]').forEach(el => { el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w))) + '%'; });
  }
  // tabela ordenável com busca; células numéricas podem abrir o detalhamento
  function table(container, cols, rows, { search = false, empty = 'Sem dados no filtro.', initialSort = null, total = null } = {}) {
    const st = { sort: initialSort, dir: -1, q: '' };
    const render = () => {
      let data = rows.slice();
      if (st.q) { const t = st.q.toLocaleLowerCase('pt-BR'); data = data.filter(r => cols.some(c => !c.num && String(c.text ? c.text(r) : r[c.key] ?? '').toLocaleLowerCase('pt-BR').includes(t))); }
      if (st.sort) { const c = cols.find(x => x.key === st.sort); const val = r => c.sortVal ? c.sortVal(r) : r[c.key]; data.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' || typeof y === 'number' ? (Number(x ?? -1) - Number(y ?? -1)) : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR')) * st.dir; }); }
      const head = cols.map(c => `<th class="${c.num ? 'n' : ''}"><button type="button" class="th" data-sort="${esc(c.key)}">${esc(c.label)}${st.sort === c.key ? (st.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('');
      const body = data.length ? data.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'n' : ''}${c.cls ? ' ' + c.cls : ''}">${c.html ? c.html(r) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">${esc(empty)}</td></tr>`;
      const foot = total ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.num ? 'n' : ''}">${i === 0 ? 'Total' : (total[c.key] != null ? (c.footHtml ? c.footHtml(total) : fmtN(total[c.key])) : '')}</td>`).join('')}</tr></tfoot>` : '';
      container.querySelector('.table-wrap').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
      container.querySelectorAll('[data-w]').forEach(el => { el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w))) + '%'; });
      container.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { if (st.sort === b.dataset.sort) st.dir *= -1; else { st.sort = b.dataset.sort; st.dir = cols.find(c => c.key === st.sort)?.num ? -1 : 1; } render(); }));
    };
    container.innerHTML = (search ? `<div class="table-tools"><input type="search" class="table-search" placeholder="Buscar nesta tabela" aria-label="Buscar nesta tabela"><span class="muted small">${fmtN(rows.length)} linha(s)</span></div>` : '') + '<div class="table-wrap"></div>';
    if (search) container.querySelector('.table-search').addEventListener('input', e => { st.q = e.target.value.trim(); render(); });
    render();
  }
  function groupCols(dimLabel, dimKey, rows = []) {
    const ex = r => ({ [dimKey]: r.key });
    const t = (r, s) => `${dimLabel}: ${r.label}${s ? ' · ' + s : ''}`;
    const columns = [
      { key: 'label', label: dimLabel },
      { key: 'total', label: 'Oportunidades', num: true, html: r => num(r.total, t(r), ex(r)) },
      { key: 'confirmado', label: 'RA confirmado', num: true, html: r => num(r.confirmado, t(r, 'RA confirmado'), { ...ex(r), ra: 'confirmado' }, 'ok') },
      { key: 'aguardando', label: 'Aguard. conciliação', num: true, html: r => num(r.aguardando, t(r, 'aguardando conciliação'), { ...ex(r), ra: 'aguardando' }) },
      { key: 'sem_ra', label: 'Sem RA', num: true, html: r => num(r.sem_ra, t(r, 'sem RA'), { ...ex(r), ra: 'sem_ra' }) },
      { key: 'taxa', label: 'Conversão', num: true, html: r => `<span title="${fmtN(r.confirmado)} ÷ ${fmtN(r.total)}">${fmtP(r.taxa)}</span>`, footHtml: tt => fmtP(tt.taxa) },
      { key: 'abertas', label: 'Em aberto', num: true, html: r => num(r.abertas, t(r, 'em aberto'), ex(r)) },
      { key: 'sem_contato', label: 'Sem contato', num: true, html: r => num(r.sem_contato, t(r, 'sem contato registrado'), { ...ex(r), contato: 'sem' }) },
      { key: 'vencidos', label: 'Retorno vencido', num: true, html: r => num(r.vencidos, t(r, 'retorno vencido'), { ...ex(r), retorno: 'vencido' }, r.vencidos ? 'warn' : '') },
      { key: 'atendimentos', label: 'Atendimentos', num: true, html: r => fmtN(r.atendimentos) }
    ];
    const optional = new Set(['aguardando', 'sem_contato', 'atendimentos']);
    return columns.filter(col => !optional.has(col.key) || rows.some(row => Number(row[col.key]) > 0));
  }
  function totalOf(rows) {
    const t = { label: 'Total' };
    for (const k of ['total', 'confirmado', 'aguardando', 'sem_ra', 'abertas', 'sem_contato', 'vencidos', 'atendimentos']) t[k] = rows.reduce((a, r) => a + (r[k] || 0), 0);
    t.taxa = t.total ? Math.round(t.confirmado / t.total * 10000) / 100 : null;
    return t;
  }

  function renderPoloCards(rows) {
    $('pole-cards').innerHTML = rows.length ? rows.map(p => {
      const recorte = { polo: p.key };
      const metric = (label, value, extra, cls='') => `<div><span>${esc(label)}</span><b>${num(value, `${p.label} · ${label}`, { ...recorte, ...extra }, cls)}</b></div>`;
      const percent = Math.max(0, Math.min(100, Number(p.taxa) || 0));
      return `<article class="op-polo-card ${p.vencidos ? 'has-late' : ''}"><header><button type="button" class="op-polo-name" data-select-polo="${esc(p.key)}" aria-label="Abrir polo ${esc(p.label)}">${esc(p.label)} <span aria-hidden="true">→</span></button>${p.vencidos ? '<span class="op-polo-badge">Retornos vencidos</span>' : '<span class="op-polo-badge neutral">'+(p.total?'Sem retorno vencido':'Sem oportunidades no recorte')+'</span>'}</header><div class="op-polo-total"><div><span>Oportunidades</span><strong>${num(p.total, `${p.label} · oportunidades`, recorte)}</strong></div><div class="op-polo-rate"><b>${fmtP(p.taxa)}</b><span>de conversão</span></div></div><progress max="100" value="${percent}" aria-label="Conversão de ${esc(p.label)}: ${fmtP(p.taxa)}"></progress><p class="op-polo-formula">${fmtN(p.confirmado)} RA confirmado(s) em ${fmtN(p.total)} oportunidade(s)</p><div class="op-polo-metrics">${metric('RA confirmado',p.confirmado,{ra:'confirmado'},'ok')}${metric('Retornos vencidos',p.vencidos,{retorno:'vencido'},p.vencidos?'warn':'')}${metric('Retornos hoje',p.hoje||0,{retorno:'hoje'})}${metric('Próximos 7 dias',p.proximos7||0,{retorno:'proximos7'})}${metric('Sem contato',p.sem_contato,{contato:'sem'})}${metric('Aguardando RA',p.aguardando,{ra:'aguardando'})}</div><button type="button" class="op-polo-open" data-select-polo="${esc(p.key)}">Abrir este polo <span aria-hidden="true">→</span></button></article>`;
    }).join('') : '<p class="empty">Nenhum polo disponível para este recorte.</p>';
  }

  // ------------------------------------------------------------ painel
  async function loadPainel(version=++readVersion) {
    const d = await api(`${API}/painel?${params()}`);
    if(version!==readVersion||state.tab!=='painel')return;
    state.painel = d; drillRegistry.length = 0;
    const k = d.kpis;
    $('avisos').innerHTML = d.avisos.map(a => `<div class="aviso">${esc(a)}</div>`).join('');
    const tile = (label, value, drill, opts = {}) => `<article class="kpi ${opts.cls || ''}"><span>${esc(label)}</span><strong>${drill ? num(value, drill.title, drill.extra) : esc(value)}</strong>${opts.sub ? `<small>${opts.sub}</small>` : ''}</article>`;
    $('kpis').innerHTML = [
      tile('Oportunidades', k.total, { title: 'Oportunidades do filtro', extra: {} }, { sub: `${fmtN(d.total_base)} no processo${d.permissoes.polo_restrito ? ' · seu polo' : ''}` }),
      tile('RA confirmado', k.ra.confirmado, { title: 'RA confirmado', extra: { ra: 'confirmado' } }, { cls: 'good', sub: 'Matrículas confirmadas na lista oficial' }),
      tile('Conversão', fmtP(k.taxa_conversao), null, { sub: esc(k.formula) }),
      tile('Retornos vencidos', k.retornos.vencido, { title: 'Retornos vencidos', extra: { retorno: 'vencido' } }, { cls: 'alert', sub: `${fmtN(k.retornos.hoje)} retorno(s) para hoje` })
    ].join('');
    $('kpis-extra').innerHTML = [
      tile('Retornos para hoje', k.retornos.hoje, { title: 'Retornos previstos para hoje', extra: { retorno: 'hoje' } }),
      tile('Próximos 7 dias', k.retornos.proximos7, { title: 'Retornos nos próximos 7 dias', extra: { retorno: 'proximos7' } }, { sub: `${fmtN(k.retornos.sem)} sem data de retorno` }),
      tile('Aguardando conciliação', k.ra.aguardando, { title: 'Aguardando conciliação de RA', extra: { ra: 'aguardando' } }),
      tile('Sem RA', k.ra.sem_ra, { title: 'Sem RA', extra: { ra: 'sem_ra' } }),
      tile('Em aberto', k.abertas, null, { sub: 'sem RA e etapa não encerrada' }),
      tile('Sem contato registrado', k.sem_contato, { title: 'Sem contato registrado', extra: { contato: 'sem' } }),
      tile('Atendimentos registrados', k.atendimentos_registrados, null, { sub: `${fmtN(k.oportunidades_atendidas)} oportunidade(s) atendida(s)` })
    ].join('');
    renderPoloCards(d.por_polo);
    renderComparacao(d);
    bars($('chart-status'), d.por_status.map(s => ({ label: s.label, value: s.total, sub: s.confirmado, note: ` · ${fmtP(s.percentual)} · RA ${fmtN(s.confirmado)}`, tip: `${s.label}: ${s.total} oportunidades, ${s.confirmado} com RA confirmado (${fmtP(s.taxa)})`, drill: { title: `Status: ${s.label}`, extra: { status: s.key } } })),
      { legend: '<span class="sw"></span>Oportunidades <span class="sw sub"></span>com RA confirmado' });
    const funil = Object.fromEntries(d.funil.map(x => [x.key, x]));
    if (k.atendimentos_registrados === 0) {
      $('chart-etapa').innerHTML = `<p class="empty">Ainda não há atendimentos registrados. Comece pelos ${fmtN(k.retornos.vencido)} retornos vencidos.</p>`;
    } else {
      bars($('chart-etapa'), d.por_etapa.map(e => ({ label: e.label, value: e.total, sub: e.confirmado, note: ` · ${fmtP(e.percentual)}${funil[e.key] ? ` · na etapa ou adiante ${fmtN(funil[e.key].na_etapa_ou_adiante)}${funil[e.key].taxa_da_anterior != null ? ' (' + fmtP(funil[e.key].taxa_da_anterior) + ' da anterior)' : ''}` : ''}`, tip: `${e.label}: ${e.total}; RA confirmado ${e.confirmado}`, drill: { title: `Etapa: ${e.label}`, extra: { etapa: e.key } } })),
        { legend: '<span class="sw"></span>Na etapa <span class="sw sub"></span>com RA confirmado' });
    }
    table($('table-polo'), groupCols('Polo', 'polo', d.por_polo), d.por_polo, { search: true, initialSort: 'total', total: totalOf(d.por_polo) });
    table($('table-tutor'), groupCols('Tutor do relatório', 'tutor', d.por_tutor), d.por_tutor, { search: true, initialSort: 'total', total: totalOf(d.por_tutor) });
    table($('table-resp'), groupCols('Responsável atual', 'resp', d.por_responsavel), d.por_responsavel, { search: true, initialSort: 'total', total: totalOf(d.por_responsavel) });
    table($('table-curso'), groupCols('Curso', 'curso', d.por_curso).slice(0, 6), d.por_curso, { search: true, initialSort: 'total' });
    table($('table-produto'), groupCols('Produto', 'produto', d.por_produto).slice(0, 6), d.por_produto, { initialSort: 'total' });
    const stCols = d.status_colunas;
    table($('table-cruz'), [
      { key: 'polo', label: 'Polo' }, { key: 'tutor', label: 'Tutor do relatório' },
      ...stCols.map(s => ({ key: 's:' + s.key, label: s.label, num: true, sortVal: r => r.status[s.key] || 0, html: r => num(r.status[s.key] || 0, `${r.polo} · ${r.tutor} · ${s.label}`, { polo: r.polo_key, tutor: r.tutor_key, status: s.key }) })),
      { key: 'total', label: 'Total', num: true, html: r => num(r.total, `${r.polo} · ${r.tutor}`, { polo: r.polo_key, tutor: r.tutor_key }) },
      { key: 'confirmado', label: 'RA confirmado', num: true, html: r => num(r.confirmado, `${r.polo} · ${r.tutor} · RA confirmado`, { polo: r.polo_key, tutor: r.tutor_key, ra: 'confirmado' }, 'ok') },
      { key: 'taxa', label: 'Conversão', num: true, html: r => fmtP(r.taxa) }
    ], d.cruzamento, { search: true });
    table($('chart-conv'), [
      { key: 'label', label: 'Mês de inscrição', sortVal: r => r.key },
      { key: 'total', label: 'Oportunidades', num: true, html: r => num(r.total, `Inscrição em ${r.label}`, { mes: r.key }) },
      { key: 'confirmado', label: 'RA confirmado', num: true, html: r => num(r.confirmado, `Inscrição em ${r.label} · RA confirmado`, { mes: r.key, ra: 'confirmado' }, 'ok') },
      { key: 'taxa', label: 'Conversão', num: true, html: r => `<span class="rate"><span class="rate-fill" data-w="${r.taxa || 0}"></span></span>${fmtP(r.taxa)}` }
    ], d.conversao_periodo, { empty: 'Sem oportunidades no filtro.' });
    bars($('chart-vol'), d.volume_atendimento.map(v => ({ label: v.label.replace('Semana de ', 'Sem. '), value: v.atendimentos, note: ` · ${fmtN(v.oportunidades)} oport.`, tip: `${v.label}: ${v.atendimentos} atendimentos em ${v.oportunidades} oportunidades` })));
    if (!d.volume_atendimento.length) $('chart-vol').innerHTML = '<p class="empty">Nenhum atendimento registrado no sistema para este filtro.</p>';
    table($('table-autor'), [{ key: 'label', label: 'Autor do atendimento' }, { key: 'atendimentos', label: 'Atendimentos', num: true, html: r => fmtN(r.atendimentos) }, { key: 'oportunidades', label: 'Oportunidades', num: true, html: r => fmtN(r.oportunidades) }], d.por_autor, { initialSort: 'atendimentos', empty: 'Sem atendimentos registrados.' });
    const ui = d.ultima_importacao, br = d.base_ra;
    $('painel-meta').textContent = `Última importação da planilha: ${ui ? `${ui.criado_em} por ${ui.criado_por_nome || ui.criado_por} (${ui.arquivo || 'sem nome'}; ${fmtN(ui.linhas)} linhas)` : 'nenhuma neste processo'}. Lista do Mundo Azul: ${fmtN(br.alunos_com_ra)} aluno(s) com RA${br.ultima_importacao ? `, importada em ${br.ultima_importacao.criado_em}` : ''}. Calculado em ${new Date(d.atualizado_em).toLocaleString('pt-BR')}.`;
  }
  function renderComparacao(d) {
    const c = d.comparacao;
    if (!c) { $('comparacao').innerHTML = ''; return; }
    const a = d.kpis, b = c.kpis;
    const lado = `${esc(nomeProcesso(c.ciclo_nome))}${c.insc_de || c.insc_ate ? ` · inscrição ${fmtD(c.insc_de)} a ${fmtD(c.insc_ate)}` : ''}`;
    const linha = (rot, x, y, pct) => { const dif = x != null && y != null ? x - y : null; return `<tr><td>${rot}</td><td class="n">${pct ? fmtP(x) : fmtN(x)}</td><td class="n">${pct ? fmtP(y) : fmtN(y)}</td><td class="n ${dif > 0 ? 'up' : dif < 0 ? 'down' : ''}">${dif == null ? '—' : (dif > 0 ? '+' : '') + (pct ? fmtN(Math.round(dif * 10) / 10) + ' p.p.' : fmtN(dif))}</td></tr>`; };
    const statusKeys = [...new Set([...d.por_status.map(s => s.key), ...c.por_status.map(s => s.key)])];
    const lab = key => d.por_status.find(s => s.key === key)?.label || c.por_status.find(s => s.key === key)?.label || key;
    $('comparacao').innerHTML = `<article class="card compare"><header><h2>Comparação</h2><p>Filtro atual × ${lado}</p></header><div class="table-wrap"><table><thead><tr><th>Indicador</th><th class="n">Atual</th><th class="n">Comparado</th><th class="n">Diferença</th></tr></thead><tbody>
      ${linha('Oportunidades', a.total, b.total)}${linha('RA confirmado', a.ra.confirmado, b.ra.confirmado)}${linha('Taxa de conversão', a.taxa_conversao, b.taxa_conversao, true)}
      ${linha('Aguardando conciliação', a.ra.aguardando, b.ra.aguardando)}${linha('Sem contato registrado', a.sem_contato, b.sem_contato)}${linha('Retornos vencidos', a.retornos.vencido, b.retornos.vencido)}
      ${statusKeys.map(k => linha('Status: ' + esc(lab(k)), d.por_status.find(s => s.key === k)?.total || 0, c.por_status.find(s => s.key === k)?.total || 0)).join('')}
      </tbody></table></div></article>`;
  }

  // ------------------------------------------------------------ lista de candidatos
  function listCols(withActions = true) {
    const raPill = r => `<span class="pill ra-${esc(r.ra_situacao)}" title="${esc(r.ra_motivo)}">${esc(r.ra_label)}${r.ra ? ' · ' + esc(r.ra) : ''}</span>`;
    return [
      { key: 'nome', label: 'Candidato', html: r => `<button type="button" class="link" data-open="${r.id}">${esc(r.nome || 'Nome não informado')}</button><span class="sub">ID ${esc(r.identificador)}${r.cpf ? ' · CPF ' + esc(r.cpf) : ''}</span>` },
      { key: 'polo', label: 'Polo / curso / produto', html: r => `${esc(r.polo)}<span class="sub">${esc(r.curso || 'Curso não informado')}</span><span class="sub">Produto: ${esc(r.produto || 'Não identificado')}</span>` },
      { key: 'status_origem', label: 'Status (origem)', html: r => esc(r.status_origem || '—') },
      { key: 'etapa_label', label: 'Etapa', html: r => `<span class="pill etapa-${esc(r.etapa)}">${esc(r.etapa_label)}</span>` },
      { key: 'ra_situacao', label: 'RA', html: raPill },
      { key: 'tutor_origem', label: 'Tutor relatório / responsável', html: r => `${esc(r.tutor_origem || '—')}<span class="sub">Resp.: ${esc(r.responsavel || 'sem responsável')}</span>` },
      { key: 'data_registro', label: 'Inscrição', html: r => fmtD(r.data_registro) },
      { key: 'ultimo_contato_sistema', label: 'Último contato', html: r => `${fmtD(r.ultimo_contato_sistema || r.ultimo_atendimento)}<span class="sub">${r.atendimentos ? fmtN(r.atendimentos) + ' no sistema' : r.ultimo_atendimento ? 'da planilha' : 'sem contato'}</span>` },
      { key: 'proximo_contato', label: 'Retorno', html: r => `<span class="${r.retorno === 'vencido' ? 'late' : ''}">${fmtD(r.proximo_contato)}</span><span class="sub">${esc(r.retorno_label)}</span>` },
      ...(withActions ? [{ key: 'acoes', label: '', html: r => `<div class="table-actions">${r.telefone && digits(r.telefone).length >= 10 ? `<a class="mini" target="_blank" rel="noopener" href="https://wa.me/${esc(digits(r.telefone).length <= 11 ? '55' + digits(r.telefone) : digits(r.telefone))}">WhatsApp</a>` : ''}<button type="button" class="mini" data-open="${r.id}">Abrir</button></div>` }] : [])
    ];
  }
  function renderList(container, pager, data, onPage) {
    container.innerHTML = '<div class="table-wrap"></div>';
    const cols = listCols();
    container.querySelector('.table-wrap').innerHTML = `<table class="list"><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${data.linhas.length ? data.linhas.map(r => `<tr>${cols.map(c => `<td>${c.html(r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">Nenhum candidato neste filtro.</td></tr>`}</tbody></table>`;
    pager.innerHTML = data.paginas > 1 ? `<button class="mini" data-page="${data.pagina - 1}" ${data.pagina <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${data.pagina} de ${data.paginas}</span><button class="mini" data-page="${data.pagina + 1}" ${data.pagina >= data.paginas ? 'disabled' : ''}>Próxima</button>` : '';
    pager.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => onPage(Number(b.dataset.page))));
  }
  async function loadLista(version=++readVersion) {
    const data = await api(`${API}/lista?${params({ ordem: state.list.order, pagina: state.list.page, por_pagina: 50 })}`);
    if(version!==readVersion||state.tab!=='candidatos')return;
    $('list-count').textContent = `${fmtN(data.total)} candidato(s) · ${fmtN(data.ra.confirmado)} com RA confirmado · ${fmtN(data.ra.aguardando)} aguardando conciliação`;
    renderList($('list-table'), $('list-pager'), data, p => { state.list.page = p; loadLista().catch(e => {if(!cancelled(e))showError(e.message);}); });
  }

  // ------------------------------------------------------------ detalhamento (drill-down)
  async function openDrill(title, extra, page = 1) {
    state.drill = { title, extra, page };
    $('drill-title').textContent = title;
    $('drill-sub').textContent = 'Carregando…';
    if (!$('drill-dialog').open) $('drill-dialog').showModal();
    try {
      const data = await api(`${API}/lista?${params({ ...extra, ordem: 'nome', pagina: page, por_pagina: 50 })}`);
      $('drill-sub').textContent = `${fmtN(data.total)} candidato(s) — filtros atuais${Object.keys(extra).length ? ' + este recorte' : ''}`;
      renderList($('drill-table'), $('drill-pager'), data, p => openDrill(title, extra, p));
    } catch (e) { if(!cancelled(e))$('drill-sub').textContent = e.message; }
  }
  function download(formato, extra = {}) {
    const p = params({ ...extra, formato }); for (const k of ['cmp_ciclo', 'cmp_de', 'cmp_ate']) p.delete(k);
    location.assign(`${API}/exportar?${p}`);
  }

  // ------------------------------------------------------------ ficha do candidato
  async function openDetail(id) {
    const body = $('detail-body');
    body.innerHTML = '<p class="empty">Carregando…</p>';
    if (!$('detail-dialog').open) $('detail-dialog').showModal();
    try { state.detail = await api(`${API}/${id}`); renderDetail(); }
    catch (e) { if(cancelled(e))return; body.innerHTML = `<div class="dialog-head"><h2>Não foi possível abrir</h2><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div><div class="error">${esc(e.message)}</div>`; }
  }
  function renderDetail() {
    const { oportunidade: o, atendimentos, eventos, ra_candidatos: cand, permissoes: p, importacao, primeira_importacao } = state.detail;
    const opts = state.opts;
    const phone = digits(o.telefone);
    const resp = (opts.responsaveis || []).filter(r => r.tipo === 'usuario' || !o.polo_id || !r.polos.length || r.polos.includes(o.polo_id));
    const today = opts.hoje;
    const field = (l, v) => `<div><dt>${esc(l)}</dt><dd>${v || '—'}</dd></div>`;
    const historico = [
      ...atendimentos.map(a => ({ em: a.data + ' ' + (a.criado_em || '').slice(11, 16), html: `<b>${esc(a.canal_label)}</b> · ${fmtD(a.data)} · por ${esc(a.autor_nome || a.autor_login || '—')}<p>${esc(a.resultado)}</p>${a.etapa_depois && a.etapa_depois !== a.etapa_antes ? `<span class="sub">Etapa: ${esc(a.etapa_antes_label)} → ${esc(a.etapa_depois_label)}</span>` : ''}${a.proximo_contato ? `<span class="sub">Próximo contato: ${fmtD(a.proximo_contato)}</span>` : ''}`, cls: 'atend' })),
      ...eventos.map(e => ({ em: e.em, html: `${esc({ etapa: 'Etapa alterada', responsavel: 'Responsável alterado', proximo_contato: 'Próximo contato alterado', anotacao: 'Anotação alterada', importacao: 'Importação', conciliacao: 'Conciliação de RA' }[e.tipo] || e.tipo)}${e.de || e.para ? `: ${esc(e.tipo === 'proximo_contato' ? fmtD(e.de) : e.de || '—')} → ${esc(e.tipo === 'proximo_contato' ? fmtD(e.para) : e.para || '—')}` : ''}<span class="sub">${esc(e.em)} · ${esc(e.por_nome || e.por_login || 'sistema')}${e.detalhe ? ' · ' + esc(e.detalhe) : ''}</span>`, cls: 'evt' }))
    ].sort((a, b) => String(b.em).localeCompare(String(a.em)));
    $('detail-body').innerHTML = `
      <div class="dialog-head"><div><p class="eyebrow">Oportunidade · ID ${esc(o.identificador)}</p><h2>${esc(o.nome || 'Nome não informado')}</h2>
        <p class="muted">${esc(o.polo)} · ${esc(o.curso || 'curso não informado')}${o.cpf ? ' · CPF ' + esc(o.cpf) : ''}${o.telefone ? ' · ' + esc(o.telefone) : ''}</p></div>
        <div class="head-actions">${phone.length >= 10 ? `<a class="button" target="_blank" rel="noopener" href="https://wa.me/${esc(phone.length <= 11 ? '55' + phone : phone)}">Abrir WhatsApp</a>` : ''}<button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div></div>
      <div class="detail-grid">
        <section class="box"><h3>Dados da planilha (origem)</h3><dl class="facts">
          ${field('Status', esc(o.status_origem))}${field('Tutor do relatório', esc(o.tutor_origem))}${field('Inscrição', fmtD(o.data_registro))}${field('Último atendimento', fmtD(o.ultimo_atendimento))}
          ${field('Retorno na planilha', fmtD(o.data_retorno_origem))}${field('Prioridade', esc(o.prioridade))}${field('Interações', o.interacoes ?? '—')}${field('Origem', esc(o.origem))}
          ${field('Polo na planilha', esc(o.polo_fonte))}${field('Atualizado pela planilha', esc(o.fonte_atualizada_em || '—'))}</dl>
          <p class="sub">${importacao ? `Última importação que trouxe este registro: #${importacao.id} em ${esc(importacao.criado_em)} por ${esc(importacao.criado_por_nome || importacao.criado_por)}.` : 'Registro anterior ao controle de importações.'}${primeira_importacao && primeira_importacao.id !== importacao?.id ? ` Primeira: #${primeira_importacao.id} (${esc(primeira_importacao.criado_em)}).` : ''}${o.fora_ultima_importacao ? ' <b>Não constava na importação mais recente</b> (mantido; nada é apagado).' : ''}</p>
        </section>
        <section class="box ra-box ra-${esc(o.ra_situacao)}"><h3>Matrícula / RA</h3>
          <p class="ra-status"><span class="pill ra-${esc(o.ra_situacao)}">${esc(o.ra_label)}${o.ra ? ' · RA ' + esc(o.ra) : ''}</span></p>
          <p class="sub">${esc(o.ra_motivo)}${o.ra_manual_status ? ` · ${o.ra_manual_status === 'confirmado' ? 'confirmado' : 'sugestões descartadas'} por ${esc(o.ra_manual_por)} em ${esc(o.ra_manual_em)}` : ''}</p>
          ${cand.length ? `<table class="mini-table"><thead><tr><th>RA</th><th>Nome na lista</th><th>Polo / curso</th>${p.conciliar ? '<th></th>' : ''}</tr></thead><tbody>${cand.map(c => `<tr><td>${esc(c.ra)}</td><td>${esc(c.nome)}<span class="sub">${esc(c.cpf || '')}</span></td><td>${esc(c.polo)}<span class="sub">${esc(c.curso)}</span></td>${p.conciliar ? `<td><button class="mini" data-conciliar="confirmar" data-lista="${c.lista_id}">É esta pessoa</button></td>` : ''}</tr>`).join('')}</tbody></table>` : ''}
          ${p.conciliar ? `<div class="row-actions">${cand.length && o.ra_fonte === 'nome' ? '<button class="mini" data-conciliar="rejeitar">Nenhuma corresponde</button>' : ''}${o.ra_manual_status ? '<button class="mini" data-conciliar="desfazer">Desfazer conciliação manual</button>' : ''}</div>` : ''}
        </section>
      </div>
      <div class="detail-grid">
        <form class="box" id="follow-form"><h3>Acompanhamento interno</h3>
          <div class="form-grid">
            <label class="field"><span>Etapa</span><select name="etapa" ${p.atender ? '' : 'disabled'}>${opts.etapas.map(e => `<option value="${e.value}" ${e.value === o.etapa ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}</select></label>
            <label class="field"><span>Responsável atual</span><select name="responsavel" ${p.definir_responsavel ? '' : 'disabled'}><option value="">Sem responsável</option>${resp.map(r => `<option value="${esc(r.key)}" ${r.key === o.responsavel_key ? 'selected' : ''}>${esc(r.nome)}${r.tipo === 'tutor' ? ' (tutor)' : ''}</option>`).join('')}${o.responsavel_key && !resp.some(r => r.key === o.responsavel_key) ? `<option value="${esc(o.responsavel_key)}" selected>${esc(o.responsavel)}</option>` : ''}</select></label>
            <label class="field"><span>Próximo contato</span><input type="date" name="proximo_contato" value="${esc(o.proximo_manual || '')}" ${p.atender ? '' : 'disabled'}></label>
            <label class="field full"><span>Anotação geral</span><textarea name="observacao" rows="3" maxlength="2000" ${p.atender ? '' : 'disabled'}>${esc(o.observacao)}</textarea></label>
          </div>
          ${p.atender ? '<div class="dialog-actions"><span class="save-error" data-err></span><button class="button primary" type="submit">Salvar acompanhamento</button></div>' : '<p class="sub">Seu acesso é somente de consulta.</p>'}
        </form>
        ${p.atender ? `<form class="box" id="atend-form"><h3>Registrar atendimento</h3>
          <div class="form-grid">
            <label class="field"><span>Data</span><input type="date" name="data" value="${esc(today)}" max="${esc(today)}" required></label>
            <label class="field"><span>Canal</span><select name="canal">${opts.canais.map(c => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></label>
            <label class="field"><span>Etapa depois do contato</span><select name="etapa">${opts.etapas.map(e => `<option value="${e.value}" ${e.value === o.etapa ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}</select></label>
            <label class="field"><span>Próximo contato</span><input type="date" name="proximo_contato" value="${esc(o.proximo_manual || '')}"></label>
            <label class="field full"><span>O que aconteceu</span><textarea name="resultado" rows="3" maxlength="2000" required placeholder="Ex.: falei pelo WhatsApp, vai pagar o boleto na sexta."></textarea></label>
          </div>
          <div class="dialog-actions"><span class="save-error" data-err></span><button class="button primary" type="submit">Registrar</button></div>
        </form>` : ''}
      </div>
      <section class="box"><h3>Histórico</h3>${historico.length ? `<ol class="timeline">${historico.map(h => `<li class="${h.cls}">${h.html}</li>`).join('')}</ol>` : '<p class="empty">Nenhum atendimento ou alteração registrada.</p>'}</section>`;
    const submit = (form, fn) => form?.addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = form.querySelector('[type=submit]'), err = form.querySelector('[data-err]');
      btn.disabled = true; err.textContent = '';
      try { await fn(Object.fromEntries(new FormData(form))); await openDetail(o.id); refresh(); }
      catch (e) { err.textContent = e.message; }
      finally { btn.disabled = false; }
    });
    submit($('follow-form'), v => { const body = { etapa: v.etapa, proximo_contato: v.proximo_contato, observacao: v.observacao }; if (p.definir_responsavel) body.responsavel = v.responsavel; return api(`${API}/${o.id}`, { method: 'PUT', body: JSON.stringify(body) }); });
    submit($('atend-form'), v => api(`${API}/${o.id}/atendimentos`, { method: 'POST', body: JSON.stringify(v) }));
    $('detail-body').querySelectorAll('[data-conciliar]').forEach(b => b.addEventListener('click', async () => {
      const acao = b.dataset.conciliar;
      if (!confirm(acao === 'confirmar' ? 'Confirmar que este aluno com RA é o mesmo candidato? A oportunidade passará a contar como convertida.' : acao === 'rejeitar' ? 'Descartar as sugestões por nome? A oportunidade ficará como Sem RA.' : 'Voltar para a conciliação automática por CPF?')) return;
      try { await api(`${API}/${o.id}/conciliacao`, { method: 'POST', body: JSON.stringify({ acao, lista_id: b.dataset.lista }) }); await openDetail(o.id); refresh(); }
      catch (e) { alert(e.message); }
    }));
  }

  // ------------------------------------------------------------ importação: leitura da planilha no navegador
  async function readSheet(file, allSheets = false) {
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
    if (/\.csv$/i.test(file.name) || buf[0] !== 0x50) {
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
      text = text.replace(/^﻿/, '');
      const first = text.split(/\r?\n/)[0] || '';
      const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
      const rows = []; let row = [], value = '', quoted = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) { if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (ch === '"') quoted = false; else value += ch; }
        else if (ch === '"') quoted = true;
        else if (ch === sep) { row.push(value.trim()); value = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(value.trim()); rows.push(row); row = []; value = ''; }
        else value += ch;
      }
      if (value || row.length) { row.push(value.trim()); rows.push(row); }
      return allSheets ? [{nome:file.name,rows}] : rows;
    }
    let end = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('O arquivo não parece ser um Excel .xlsx válido.');
    const count = dv.getUint16(end + 10, true); let offset = dv.getUint32(end + 16, true); const files = {};
    for (let i = 0; i < count; i++) { const method = dv.getUint16(offset + 10, true), size = dv.getUint32(offset + 20, true), nl = dv.getUint16(offset + 28, true), el = dv.getUint16(offset + 30, true), cl = dv.getUint16(offset + 32, true), local = dv.getUint32(offset + 42, true); files[new TextDecoder().decode(buf.slice(offset + 46, offset + 46 + nl))] = { method, size, local }; offset += 46 + nl + el + cl; }
    const read = async name => { const f = files[name]; if (!f) return null; const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true), data = buf.slice(start, start + f.size); if (f.method === 0) return new TextDecoder().decode(data); if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx. Atualize o navegador ou salve como CSV.'); return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); };
    const xml = t => new DOMParser().parseFromString(t, 'application/xml'), shared = [];
    const ss = await read('xl/sharedStrings.xml'); if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(x => x.textContent).join(''));
    const wb=xml(await read('xl/workbook.xml')), rels=xml(await read('xl/_rels/workbook.xml.rels'));
    const sheets=[...wb.getElementsByTagName('sheet')].map(sheet=>{
      const rid=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      const rel=[...rels.getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===rid);
      return {nome:sheet.getAttribute('name'),path:'xl/'+String(rel?.getAttribute('Target')||'worksheets/sheet1.xml').replace(/^\/?xl\//,'').replace(/^\//,'')};
    });
    const result=[];
    for(const sheet of (allSheets?sheets:sheets.slice(0,1))){
    const source=await read(sheet.path);if(!source)throw new Error('Não encontrei a aba '+sheet.nome+'.');
    const col = ref => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; for (const ch of (m ? m[1] : 'A')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const out = [];
    for (const row of xml(source).getElementsByTagName('row')) {
      const cells = []; for (const cell of row.getElementsByTagName('c')) { const type = cell.getAttribute('t'), v = cell.getElementsByTagName('v')[0]; let value = type === 'inlineStr' ? [...cell.getElementsByTagName('t')].map(x => x.textContent).join('') : v ? v.textContent : ''; if (type === 's') value = shared[Number(value)] || ''; if ((!type || type === 'n') && value && Number.isSafeInteger(Number(value))) value = String(Number(value)); cells[col(cell.getAttribute('r'))] = value; }
      out[(Number(row.getAttribute('r')) || out.length + 1) - 1] = Array.from(cells, x => x ?? '');
    }
    result.push({nome:sheet.nome,rows:Array.from(out, x => x || [])});
    }
    return allSheets?result:result[0].rows;
  }
  const normHeader = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
  // A coluna de identificação da planilha se chama exatamente "Identificador" (também aceita o nome antigo).
  const ALIASES = {
    identificador: ['identificador', 'identificador aluno', 'id aluno'], nome: ['nome completo', 'nome', 'nome do aluno', 'nome do candidato', 'candidato', 'aluno'], cpf: ['cpf', 'cpf aluno', 'cpf do aluno'],
    telefone: ['telefone', 'celular', 'whatsapp', 'telefone celular', 'fone'], curso_cod: ['curso codigo', 'codigo curso', 'cod curso', 'codigo do curso', 'cd curso'], curso_nome: ['curso nome', 'nome curso', 'nm curso', 'curso', 'nome do curso'],
    polo_fonte: ['polo', 'polo de apoio', 'unidade polo', 'nome polo'], prioridade: ['prioridade'], ultimo_atendimento: ['dt ult atendimento', 'dt ultimo atendimento', 'data ultimo atendimento', 'ultimo atendimento', 'data ult atendimento'],
    data_retorno: ['dt retorno', 'data retorno', 'data de retorno', 'retorno'], data_registro: ['dt registro', 'data registro', 'data de registro', 'data inscricao', 'dt inscricao', 'data de inscricao'],
    interacoes: ['interacoes', 'qtd interacoes'], status_origem: ['status', 'situacao', 'status inscricao', 'situacao inscricao', 'status da inscricao'], origem: ['origem'], localizacao: ['localizacao'], contato: ['contato'],
    responsavel_origem: ['resp ult atendimento', 'resp ultimo atendimento', 'responsavel ultimo atendimento', 'responsavel', 'tutor', 'tutor responsavel', 'consultor', 'atendente']
  };
  function mapSheet(table) {
    const headIndex = table.findIndex(row => (row || []).some(v => ALIASES.identificador.includes(normHeader(v))));
    if (headIndex < 0) throw new Error('Não encontrei a coluna “Identificador” na planilha. Confira se é o relatório de acompanhamento de atendimento.');
    const headers = table[headIndex].map(normHeader), raw = table[headIndex];
    const idx = {}, usados = new Set(), colunas = [];
    for (const [key, names] of Object.entries(ALIASES)) {
      let pos = -1;
      for (const n of names) { pos = headers.findIndex((h, i) => h === n && (!usados.has(i) || key === 'curso_nome')); if (pos >= 0) break; }
      idx[key] = pos; if (pos >= 0) { usados.add(pos); colunas.push(`${raw[pos]} → ${key}`); }
    }
    const linhas = [];
    table.slice(headIndex + 1).forEach((row, i) => {
      if (!row || !row.some(v => String(v || '').trim())) return;
      const item = { linha: headIndex + i + 2 };
      for (const key of Object.keys(ALIASES)) item[key] = idx[key] < 0 ? '' : String(row[idx[key]] ?? '').trim();
      if (idx.curso_cod >= 0 && idx.curso_cod === idx.curso_nome) item.curso_cod = '';
      // O relatório de acompanhamento traz códigos na coluna Curso (não o nome).
      if (!item.curso_cod && /^(?:EGRAD|ESPRE|EPOS|HPOS|POS|ETEC)_[A-Z0-9_]+$/i.test(item.curso_nome)) item.curso_cod = item.curso_nome.toUpperCase();
      linhas.push(item);
    });
    if (!linhas.length) throw new Error('A planilha não tem candidatos abaixo do cabeçalho.');
    const faltando = ['nome', 'cpf', 'curso_nome', 'polo_fonte', 'status_origem', 'responsavel_origem', 'data_registro'].filter(k => idx[k] < 0);
    return { linhas, colunas, faltando };
  }
  const CAMPO = { nome: 'Nome', cpf: 'CPF', curso_nome: 'Curso', polo_fonte: 'Polo', status_origem: 'Status', responsavel_origem: 'Tutor/responsável', data_registro: 'Data de registro/inscrição' };
  let pendingImport = null;
  async function startImport(file) {
    showError(''); showNotice('');
    const ciclo = state.opts.ciclos.find(c => String(c.id) === state.ciclo);
    if (!ciclo) throw new Error('Selecione um processo antes de importar.');
    const mapped = mapSheet(await readSheet(file));
    pendingImport = { file: file.name, ciclo, ...mapped };
    await previewImport();
  }
  async function previewImport() {
    const imp = pendingImport, body = $('import-body');
    body.innerHTML = '<p class="empty">Analisando a planilha…</p>';
    if (!$('import-dialog').open) $('import-dialog').showModal();
    const pv = await api(`${API}/importar/previa`, { method: 'POST', body: JSON.stringify({ ciclo: imp.ciclo.id, arquivo: imp.file, linhas: imp.linhas, colunas: imp.colunas }) });
    const t = pv.totais;
    const groups = [['todas', 'Todas', () => true], ['novo', 'Novas', l => l.acao === 'novo'], ['atualizado', 'Atualizadas', l => l.acao === 'atualizado'], ['inalterado', 'Sem mudança', l => l.acao === 'inalterado'], ['ignorado', 'Ignoradas', l => l.acao === 'ignorado'], ['alerta', 'Precisam de atenção', l => l.acao !== 'ignorado' && l.alertas.length]];
    const acaoLabel = { novo: 'Incluir', atualizado: 'Atualizar', inalterado: 'Sem mudança', ignorado: 'Ignorar' };
    const polos = state.opts.polos_cadastro || [];
    body.innerHTML = `
      <div class="dialog-head"><div><p class="eyebrow">Prévia da importação</p><h2>${esc(imp.file)}</h2><p class="muted">Processo ${esc(imp.ciclo.nome)} · nada foi gravado ainda</p></div><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div>
      ${pv.ja_importado ? `<div class="aviso">Este mesmo conteúdo já foi importado em ${esc(pv.ja_importado.criado_em)} por ${esc(pv.ja_importado.criado_por_nome || pv.ja_importado.criado_por)}. Importar de novo não duplica registros.</div>` : ''}
      ${imp.faltando.length ? `<div class="aviso">Colunas não encontradas: ${imp.faltando.map(k => esc(CAMPO[k])).join(', ')}. Esses campos ficarão vazios nas novas oportunidades.</div>` : ''}
      <div class="kpis small">
        <article class="kpi"><span>Linhas lidas</span><strong>${fmtN(t.linhas)}</strong></article>
        <article class="kpi good"><span>Novas</span><strong>${fmtN(t.novos)}</strong></article>
        <article class="kpi"><span>Atualizadas</span><strong>${fmtN(t.atualizados)}</strong></article>
        <article class="kpi"><span>Sem mudança</span><strong>${fmtN(t.inalterados)}</strong></article>
        <article class="kpi ${t.ignorados ? 'alert' : ''}"><span>Ignoradas</span><strong>${fmtN(t.ignorados)}</strong></article>
        <article class="kpi"><span>Com alerta</span><strong>${fmtN(t.com_alerta)}</strong></article>
      </div>
      <p class="sub">A importação atualiza só os dados da planilha. Etapa, responsável, próximo contato, anotações e atendimentos registrados no sistema são preservados. ${pv.nao_vieram ? `${fmtN(pv.nao_vieram)} oportunidade(s) já cadastradas não estão neste arquivo e continuarão no sistema.` : ''}</p>
      ${pv.polos_nao_reconhecidos.length ? `<section class="box"><h3>Vincular polos não reconhecidos</h3><p class="sub">Sem vínculo, essas oportunidades ficam visíveis só para a administração. O vínculo é o mesmo usado na Conciliação do Mundo Azul.</p>
        <div class="map-list">${pv.polos_nao_reconhecidos.map((p, i) => `<label class="field"><span>${esc(p.nome)} (${fmtN(p.qtd)})</span><select data-map-polo="${i}"><option value="">Não vincular agora</option>${polos.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>`).join('')}</div>
        <button type="button" class="mini" id="save-polos">Salvar vínculos e refazer a prévia</button></section>` : ''}
      ${pv.status_encontrados.length ? `<p class="sub">Status encontrados: ${pv.status_encontrados.map(s => `${esc(s.nome)} (${fmtN(s.qtd)})`).join(' · ')}</p>` : ''}
      <details class="sub"><summary>Colunas reconhecidas</summary>${imp.colunas.map(esc).join(' · ')}</details>
      <div class="segmented" id="import-tabs">${groups.map(([k, l, fn], i) => `<button type="button" data-g="${k}" class="${i === 0 ? 'active' : ''}">${l} (${fmtN(pv.linhas.filter(fn).length)})</button>`).join('')}</div>
      <div id="import-rows"></div>
      <div class="dialog-actions"><span class="save-error" id="import-err"></span><button type="button" class="button" data-close>Cancelar</button><button type="button" class="button primary" id="confirm-import" ${t.novos + t.atualizados + t.inalterados ? '' : 'disabled'}>Confirmar importação (${fmtN(t.novos)} novas, ${fmtN(t.atualizados)} atualizadas)</button></div>`;
    const showGroup = g => {
      const fn = groups.find(x => x[0] === g)[2];
      const rows = pv.linhas.filter(fn);
      $('import-rows').innerHTML = `<div class="table-wrap import-table"><table><thead><tr><th>Linha</th><th>Identificador</th><th>Nome</th><th>Polo</th><th>Status</th><th>Ação</th><th>Por quê / alertas</th></tr></thead><tbody>${rows.slice(0, 1000).map(l => `<tr class="acao-${esc(l.acao)}"><td>${l.linha}</td><td>${esc(l.identificador || '—')}</td><td>${esc(l.nome || '—')}</td><td>${esc(l.polo || '—')}</td><td>${esc(l.status || '—')}</td><td><span class="pill">${esc(acaoLabel[l.acao])}</span></td><td>${[...l.motivos.map(m => `<b>${esc(m)}</b>`), ...l.alertas.map(esc), l.mudancas.length ? 'Muda: ' + esc(l.mudancas.join(', ')) : ''].filter(Boolean).join('<br>') || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma linha neste grupo.</td></tr>'}</tbody></table></div>${rows.length > 1000 ? `<p class="sub">Mostrando 1.000 de ${fmtN(rows.length)} linhas.</p>` : ''}`;
      body.querySelectorAll('#import-tabs button').forEach(b => b.classList.toggle('active', b.dataset.g === g));
    };
    body.querySelectorAll('#import-tabs button').forEach(b => b.addEventListener('click', () => showGroup(b.dataset.g)));
    showGroup(t.ignorados || t.com_alerta ? (t.ignorados ? 'ignorado' : 'alerta') : 'todas');
    $('save-polos')?.addEventListener('click', async () => {
      try {
        for (const sel of body.querySelectorAll('[data-map-polo]')) if (sel.value) await api('/oportunidades/api/ma/mapeamentos', { method: 'PUT', body: JSON.stringify({ tipo: 'polo', nome_fonte: pv.polos_nao_reconhecidos[Number(sel.dataset.mapPolo)].nome, local_ids: [Number(sel.value)] }) });
        await previewImport();
      } catch (e) { $('import-err').textContent = e.message; }
    });
    $('confirm-import').addEventListener('click', async ev => {
      ev.target.disabled = true; $('import-err').textContent = 'Importando…';
      try {
        const r = await api(`${API}/importar`, { method: 'POST', body: JSON.stringify({ ciclo: imp.ciclo.id, arquivo: imp.file, linhas: imp.linhas, colunas: imp.colunas, confirmado: true }) });
        $('import-dialog').close(); pendingImport = null;
        showNotice(`Importação #${r.importacao_id} concluída: ${fmtN(r.novos)} novas, ${fmtN(r.atualizados)} atualizadas, ${fmtN(r.inalterados)} sem mudança, ${fmtN(r.ignorados)} ignoradas.`);
        await loadOpcoes(); refresh();
      } catch (e) { $('import-err').textContent = e.message; ev.target.disabled = false; }
    });
  }
  async function loadImportacoes(version=++readVersion) {
    const d = await api(`${API}/importacoes?ciclo=${encodeURIComponent(state.ciclo)}`);
    if(version!==readVersion||state.tab!=='importacoes')return;
    $('imports').innerHTML = d.importacoes.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Quando / quem</th><th>Arquivo</th><th class="n">Linhas</th><th class="n">Novas</th><th class="n">Atualizadas</th><th class="n">Sem mudança</th><th class="n">Ignoradas</th><th class="n">Com alerta</th><th></th></tr></thead><tbody>${d.importacoes.map(i => `
      <tr><td>${i.id}</td><td>${esc(i.criado_em)}<span class="sub">${esc(i.criado_por_nome || i.criado_por)}</span></td><td>${esc(i.arquivo || '—')}</td><td class="n">${fmtN(i.linhas)}</td><td class="n">${fmtN(i.novos)}</td><td class="n">${fmtN(i.atualizados)}</td><td class="n">${fmtN(i.inalterados)}</td><td class="n">${fmtN(i.ignorados)}</td><td class="n">${fmtN(i.com_alerta)}</td>
      <td>${i.problemas.length ? `<details><summary>Ver ${fmtN(i.problemas.length)} linha(s)</summary><ul class="problems">${i.problemas.map(p => `<li>Linha ${p.linha} · ${esc(p.identificador || 'sem identificador')}: ${[...p.motivos, ...p.alertas].map(esc).join(' ')}</li>`).join('')}</ul></details>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nenhuma importação registrada neste processo.</p>';
  }

  // ------------------------------------------------------------ ações da supervisão
  let selectedAction = '', actionDraft = null, showDeletedActions = false, selectedTutor = '';
  async function loadAcoes(version = readVersion) {
    const d = await api(`${API}/acoes?ciclo=${encodeURIComponent(state.ciclo)}${showDeletedActions?'&excluidas=1':''}`);
    if(version!==readVersion)return;
    const manage=state.opts.permissoes.definir_responsavel;
    $('action-upload-label').classList.toggle('hidden',!manage||showDeletedActions);
    $('action-trash-toggle').classList.toggle('hidden',!manage);
    $('action-trash-toggle').textContent=showDeletedActions?'Voltar às ações':'Ações excluídas';
    $('action-list-title').textContent=showDeletedActions?'Ações excluídas':'Acompanhe suas ações';
    if(!d.acoes.some(a=>String(a.id)===selectedAction))selectedAction=showDeletedActions?'':String(d.acoes[0]?.id||'');
    $('action-cards').innerHTML=d.acoes.length?d.acoes.map((a,i)=>`<article class="op-action-card ${String(a.id)===selectedAction?'selected':''}"><div class="op-action-card-top"><span class="op-action-state">${a.excluida_em?'Excluída':a.fim&&a.fim<state.opts.hoje?'Finalizada':'Em acompanhamento'}</span>${manage&&!a.excluida_em?`<button class="op-action-delete" data-delete-action="${a.id}" aria-label="Excluir ação ${esc(a.nome)}" title="Excluir ação"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button>`:''}</div><h3>${esc(a.nome)}</h3><p>${fmtD(a.inicio)}${a.fim?' até '+fmtD(a.fim):' · Sem prazo definido'}${a.supervisora?' · '+esc(a.supervisora):''}</p><div class="op-action-card-numbers"><div><strong>${fmtN(a.total)}</strong><span>leads</span></div><div><strong>${fmtN(a.tutoras)}</strong><span>tutoras</span></div><div><strong>${fmtP(a.taxa_atendimento)}</strong><span>atendidos</span></div></div><progress class="op-action-progress" aria-label="Atendimento de ${esc(a.nome)}" max="100" value="${Math.min(100,a.taxa_atendimento||0)}"></progress><div class="op-action-card-bottom"><span class="${a.pendentes?'op-action-pending':'muted'}">${a.pendentes?fmtN(a.pendentes)+' pendências':fmtN(a.novas_conversoes)+' novas confirmações'}</span>${a.excluida_em?`<button class="button" data-restore-action="${a.id}">Restaurar ação</button>`:`<button class="op-action-open" data-action-open="${a.id}" ${String(a.id)===selectedAction?'aria-current="true"':''}>${String(a.id)===selectedAction?'Painel aberto':'Abrir ação'} <span aria-hidden="true">→</span></button>`}</div></article>`).join(''):`<div class="op-action-empty"><h3>${showDeletedActions?'Nenhuma ação excluída':'Comece sua primeira ação'}</h3><p>${showDeletedActions?'As ações excluídas poderão ser restauradas aqui.':'Envie uma planilha com uma aba por tutora para distribuir os leads e acompanhar os resultados.'}</p></div>`;
    $('action-cards').querySelectorAll('[data-action-open]').forEach(b=>b.addEventListener('click',()=>{selectedAction=b.dataset.actionOpen;selectedTutor='';refresh();}));
    $('action-cards').querySelectorAll('[data-delete-action]').forEach(b=>b.addEventListener('click',()=>confirmActionDelete(d.acoes.find(a=>String(a.id)===b.dataset.deleteAction))));
    $('action-cards').querySelectorAll('[data-restore-action]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await api(`${API}/acoes/${b.dataset.restoreAction}/restaurar`,{method:'POST',body:'{}'});showDeletedActions=false;selectedAction=b.dataset.restoreAction;await refresh();}catch(e){showError(e.message);b.disabled=false;}}));
    saveUrl();
    if(selectedAction&&!showDeletedActions)await loadAcaoReport(version);
    else $('action-report').innerHTML='';
  }
  function confirmActionDelete(a){
    $('import-body').innerHTML=`<div class="dialog-head"><div><h2>Excluir esta ação?</h2><p>${esc(a.nome)}</p></div><button class="icon-button" data-close aria-label="Fechar">×</button></div><div class="box"><p>A ação sairá do painel. Leads, responsáveis e atendimentos serão mantidos.</p><p>Você poderá restaurá-la em <b>Ações excluídas</b>.</p><div class="dialog-actions"><span id="action-delete-error" class="save-error"></span><button class="button" data-close>Cancelar</button><button class="button op-danger" id="action-delete-confirm">Excluir ação</button></div></div>`;
    $('import-dialog').showModal();$('action-delete-confirm').addEventListener('click',async ev=>{ev.target.disabled=true;try{await api(`${API}/acoes/${a.id}`,{method:'DELETE'});$('import-dialog').close();if(selectedAction===String(a.id))selectedAction='';await refresh();showNotice('Ação excluída. Você pode restaurá-la em Ações excluídas.');}catch(e){$('action-delete-error').textContent=e.message;ev.target.disabled=false;}});
  }
  function renderPendingActions(d){
    if(!d.pendencias.length)return '';
    const tutores=state.opts.responsaveis.filter(t=>t.tipo==='tutor');
    return `<details class="card op-pending-section"><summary><span><strong>${d.pendencias.length} pendências na distribuição</strong><small>Confira inscrições repetidas e escolha a tutora responsável.</small></span><span class="op-action-pending">Resolver pendências</span></summary><div class="op-pending-grid">${(d.grupos_pendentes||[]).map((g,i)=>{
      const unique=[...new Set(g.origens.map(o=>o.tutor_id).filter(Boolean))];
      return `<form class="op-pending-card" data-pending-index="${i}"><h3>${esc(g.nome)}</h3><p class="sub">${esc(g.cpf||'CPF não informado')} · ${esc(g.curso)}</p><p class="op-pending-origins">${g.origens.map(o=>esc(o.aba)+' · linha '+o.linha).join(' / ')}</p><p class="op-pending-reason">${esc(g.motivo)}</p><label class="field"><span>Inscrição</span><select name="oportunidade_id" aria-label="Inscrição de ${esc(g.nome)}" required ${!g.candidatos.length?'disabled':''}><option value="">${g.candidatos.length?'Escolha a inscrição correta':'Nenhuma inscrição identificada'}</option>${g.candidatos.map(c=>`<option value="${c.id}" ${g.candidatos.length===1?'selected':''}>ID ${esc(c.identificador)} · ${fmtD(c.data)} · ${esc(c.status||'Sem status')} · ${esc(c.polo)}</option>`).join('')}</select></label><label class="field"><span>Tutora responsável</span><select name="tutor_id" aria-label="Tutora para ${esc(g.nome)}" required><option value="">Escolha a tutora</option>${tutores.map(t=>`<option value="${esc(t.key.slice(2))}" ${unique.length===1&&String(unique[0])===t.key.slice(2)?'selected':''}>${esc(t.nome)}</option>`).join('')}</select></label><div class="op-pending-commands"><span data-err class="save-error"></span><button class="button primary" type="submit" ${!g.candidatos.length?'disabled':''}>Vincular lead</button></div></form>`;
    }).join('')}</div></details>`;
  }
  async function loadAcaoReport(version=readVersion){
    if(!selectedAction)return;
    const d=await api(`${API}/acoes/${encodeURIComponent(selectedAction)}`);if(version!==readVersion)return;
    if(!d.por_tutora.some(t=>String(t.id)===selectedTutor))selectedTutor='';
    const tutora=d.por_tutora.find(t=>String(t.id)===selectedTutor),k=tutora||d.kpis,a=d.acao;
    const linhasVisiveis=tutora?d.linhas.filter(r=>r.tutor_id===tutora.id):d.linhas;
    const metric=(title,value,note)=>`<article class="kpi"><span>${title}</span><strong>${value}</strong><small>${note}</small></article>`;
    $('action-report').innerHTML=`<div class="op-section-head"><div><h2>${esc(a.nome)}${tutora?" · "+esc(tutora.nome):""}</h2><p>${a.supervisora?'Supervisora: '+esc(a.supervisora)+' · ':''}Início: ${fmtD(a.inicio)}${a.fim?' · Até '+fmtD(a.fim):''}</p></div></div>
      <div class="op-action-kpis">${metric('Leads distribuídos',fmtN(k.total),'Inscrições existentes vinculadas à ação')}${metric('Atendimento',fmtP(k.taxa_atendimento),fmtN(k.atendidos)+' de '+fmtN(k.total)+' leads com atendimento no período')}${metric('Novas confirmações de RA',fmtN(k.novas_conversoes),fmtN(k.ja_convertidos)+' já tinham RA ao distribuir')}${metric('Conversão da base elegível',fmtP(k.taxa_conversao),fmtN(k.novas_conversoes)+' ÷ '+fmtN(k.elegiveis)+' sem RA na distribuição')}</div>
      <p class="op-action-note">Atendimento considera registros feitos no sistema entre ${fmtD(a.inicio)} e ${fmtD(d.ate)}, por qualquer pessoa da equipe. A conversão compara o RA atual com a situação salva na distribuição e acompanha a atualização da lista oficial; não comprova que a ação causou a matrícula.</p>
      <section class="op-tutor-section"><div class="op-section-head"><div><h2>Visão por tutora</h2><p>Abra uma tutora para acompanhar seus leads e resultados.</p></div>${tutora?'<button class="button" data-tutor-all>Ver toda a ação</button>':''}</div><div class="op-tutor-grid">${d.por_tutora.map(t=>`<button class="op-tutor-card ${selectedTutor===String(t.id)?'selected':''}" data-action-tutor="${t.id}" aria-pressed="${selectedTutor===String(t.id)}"><span class="op-tutor-top"><span class="op-tutor-avatar" aria-hidden="true">${esc(t.nome.slice(0,1))}</span><strong>${esc(t.nome)}</strong><span class="op-tutor-arrow" aria-hidden="true">→</span></span><span class="op-tutor-numbers"><span><b>${fmtN(t.total)}</b>leads</span><span><b>${fmtN(t.atendidos)}</b>atendidos</span><span><b>${fmtN(t.novas_conversoes)}</b>novos RA</span></span><span class="op-tutor-progress-label">Atendimento <b>${fmtP(t.taxa_atendimento)}</b></span><progress class="op-action-progress" max="100" value="${t.taxa_atendimento||0}" aria-label="Taxa de atendimento de ${esc(t.nome)}"></progress><span class="op-tutor-bottom">${fmtN(t.nao_atendidos)} sem atendimento <span>Conversão: ${fmtP(t.taxa_conversao)}</span></span><span class="op-tutor-cta">${selectedTutor===String(t.id)?'Visualizando esta tutora':'Ver leads e resultados'}</span></button>`).join('')}</div></section>
      ${d.conferencia?`<details class="card op-source-check"><summary>Conferência com a planilha: ${d.conferencia.recebidas} linhas recebidas · ${d.conferencia.vinculados} vinculadas · ${d.conferencia.pendentes} pendentes · ${d.conferencia.repetidas_resolvidas} repetições resolvidas</summary><div class="table-wrap"><table><thead><tr><th>Aba original</th><th>Linhas recebidas</th><th>Vinculadas</th><th>Pendentes</th><th>Repetições resolvidas</th></tr></thead><tbody>${d.conferencia.por_aba.map(x=>`<tr><td>${esc(x.aba)}</td><td>${x.recebidas}</td><td>${x.vinculados}</td><td>${x.pendentes}</td><td>${x.repetidas_resolvidas}</td></tr>`).join('')}</tbody></table></div><p class="op-action-note">Uma mesma inscrição repetida entre abas entra uma única vez na ação. As contagens acima acompanham a aba de origem; os cards por tutora mostram quem recebeu os leads.</p></details>`:''}
      ${renderPendingActions(d)}
      <article class="card"><header><h2>${tutora?"Leads de "+esc(tutora.nome):"Leads da ação"} (${linhasVisiveis.length})</h2><p>Abra o candidato para registrar o atendimento.</p></header><div class="table-wrap"><table><thead><tr><th>Candidato</th><th>Tutora</th><th>Curso / polo</th><th>Atendimento no período</th><th>RA</th></tr></thead><tbody>${linhasVisiveis.map(r=>`<tr><td><button class="link" data-open="${r.id}">${esc(r.nome)}</button><span class="sub">${esc(r.cpf)}</span></td><td>${esc(r.tutora)}</td><td>${esc(r.curso)}<span class="sub">${esc(r.polo)}</span></td><td>${r.atendido?'Atendido ('+r.atendimentos+')':'Não atendido'}${r.atendido_pela_tutora?'<span class="sub">Com registro pela tutora atribuída</span>':''}</td><td>${r.ra_atual==='confirmado'?(r.ra_inicial==='confirmado'?'Já confirmado na distribuição':'Nova confirmação'):'Sem RA confirmado'}</td></tr>`).join('')}</tbody></table></div></article>`;
    $('action-report').querySelectorAll('[data-action-tutor]').forEach(b=>b.addEventListener('click',()=>{selectedTutor=b.dataset.actionTutor;refresh();}));
    $('action-report').querySelector('[data-tutor-all]')?.addEventListener('click',()=>{selectedTutor='';refresh();});
    $('action-report').querySelectorAll('[data-pending-index]').forEach(form=>form.addEventListener('submit',async ev=>{
      ev.preventDefault();const button=form.querySelector('[type=submit]'),err=form.querySelector('[data-err]');button.disabled=true;err.textContent='';
      try{const g=d.grupos_pendentes[Number(form.dataset.pendingIndex)],values=Object.fromEntries(new FormData(form));await api(`${API}/acoes/${selectedAction}/resolver`,{method:'POST',body:JSON.stringify({...values,grupo:g.key,versao:d.pendencias_versao})});await refresh();showNotice('Lead vinculado à ação e responsável atualizado. As linhas repetidas foram resolvidas juntas.');}catch(e){err.textContent=e.message;button.disabled=false;}
    }));
  }
  function mapActionSheets(sheets){
    const linhas=[];
    for(const sheet of sheets){
      const hi=sheet.rows.findIndex(row=>row.some(v=>normHeader(v)==='cpf'));
      if(hi<0)throw new Error(`A aba ${sheet.nome} não tem a coluna CPF.`);
      const h=sheet.rows[hi].map(normHeader),cpf=h.indexOf('cpf'),nome=h.findIndex(x=>['nome completo','nome'].includes(x)),curso=h.findIndex(x=>['curso','curso codigo','cd curso','codigo do curso'].includes(x));
      if(curso<0)throw new Error(`A aba ${sheet.nome} não tem a coluna Curso.`);
      sheet.rows.slice(hi+1).forEach((row,i)=>{if(!row.some(v=>String(v??'').trim()))return;linhas.push({aba:sheet.nome,linha:hi+i+2,nome:String(row[nome]||''),cpf:String(row[cpf]??'').trim(),telefone:String(row[h.findIndex(x=>['telefone','celular','whatsapp'].includes(x))]??'').trim(),curso_cod:String(row[curso]||'').trim()});});
    }
    return linhas;
  }
  async function startAction(file){
    actionDraft={ciclo:state.ciclo,nome:'Ação da supervisão — '+fmtD(state.opts.hoje),inicio:state.opts.hoje,fim:'',supervisora:'',arquivo:file.name,linhas:mapActionSheets(await readSheet(file,true)),tutores:{}};
    const abas=[...new Set(actionDraft.linhas.map(r=>r.aba))],tutores=state.opts.responsaveis.filter(r=>r.tipo==='tutor');
    const box=$('import-body');
    box.innerHTML=`<div class="dialog-head"><div><h2>Nova ação da supervisão</h2><p class="muted">${esc(file.name)} · ${actionDraft.linhas.length} linhas. Apenas leads existentes serão vinculados.</p></div><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div><form id="action-form" class="op-action-form"><div class="form-grid"><label class="field"><span>Nome da ação</span><input name="nome" value="${esc(actionDraft.nome)}" required maxlength="160"></label><label class="field"><span>Supervisora</span><input name="supervisora" maxlength="120" placeholder="Nome da supervisora"></label><label class="field"><span>Início</span><input name="inicio" type="date" value="${esc(actionDraft.inicio)}" max="${esc(state.opts.hoje)}" required></label><label class="field"><span>Fim previsto (opcional)</span><input name="fim" type="date"></label>${abas.map(aba=>`<label class="field"><span>Aba ${esc(aba)} → Tutora</span><select data-action-aba="${esc(aba)}"><option value="">Reconhecer pelo nome ou apelido cadastrado</option>${tutores.map(t=>`<option value="${esc(t.key.slice(2))}">${esc(t.nome)}</option>`).join('')}</select></label>`).join('')}</div><p class="op-action-note">A distribuição altera o responsável atual dos leads encontrados. Etapas, anotações e histórico serão preservados. CPFs com o mesmo curso em abas de tutoras diferentes ficam pendentes.</p><div class="dialog-actions"><span data-err class="save-error"></span><button class="button primary" type="submit">Conferir distribuição</button></div></form><div id="action-preview"></div>`;
    $('import-dialog').showModal();
    $('action-form').addEventListener('input',()=>{$('action-preview').innerHTML='';});
    $('action-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const form=ev.target,err=form.querySelector('[data-err]'),button=form.querySelector('[type=submit]');button.disabled=true;err.textContent='';
      try{
        Object.assign(actionDraft,Object.fromEntries(new FormData(form)));actionDraft.tutores={};form.querySelectorAll('[data-action-aba]').forEach(s=>{if(s.value)actionDraft.tutores[s.dataset.actionAba]=s.value;});
        const d=await api(`${API}/acoes/previa`,{method:'POST',body:JSON.stringify(actionDraft)});
        $('action-preview').innerHTML=`<div class="box"><h3>Prévia da distribuição</h3><p>${d.totais.vinculaveis} leads prontos para vincular · ${d.totais.pendentes} linhas pendentes.</p>${d.existente?'<p>Esta planilha já foi usada para criar uma ação. Nenhuma distribuição será repetida.</p>':''}<div class="table-wrap"><table><thead><tr><th>Aba / tutora</th><th>Lead</th><th>Curso</th><th>Resultado</th></tr></thead><tbody>${d.linhas.map(r=>`<tr><td>${esc(r.aba)}<span class="sub">${esc(r.tutora||'Tutora não vinculada')}</span></td><td>${esc(r.nome)}<span class="sub">${esc(r.cpf)}</span></td><td>${esc(r.curso)}</td><td>${esc(r.motivo||'Vincular à ação e definir responsável')}${r.atual?'<span class="sub">Responsável atual: '+esc(r.atual)+'</span>':''}</td></tr>`).join('')}</tbody></table></div><p class="op-action-note">Linhas pendentes ficam registradas para revisão e não serão atribuídas.</p><div class="dialog-actions"><span id="action-save-error" class="save-error"></span><button id="action-confirm" class="button primary" ${!d.totais.vinculaveis&&!d.existente?'disabled':''}>${d.existente?'Abrir ação existente':'Criar ação e vincular '+d.totais.vinculaveis+' leads'}</button></div></div>`;
        $('action-confirm').addEventListener('click',async e=>{e.target.disabled=true;try{const saved=await api(`${API}/acoes`,{method:'POST',body:JSON.stringify({...actionDraft,confirmado:true})});selectedAction=String(saved.id);$('import-dialog').close();await loadOpcoes();setTab('acoes');showNotice(saved.existente?'Esta ação já estava cadastrada.':'Ação criada. Os leads encontrados foram vinculados e os responsáveis atualizados.');}catch(error){$('action-save-error').textContent=error.message;e.target.disabled=false;}});
      }catch(error){err.textContent=error.message;}finally{button.disabled=false;}
    });
  }
  $('action-trash-toggle').addEventListener('click',()=>{showDeletedActions=!showDeletedActions;selectedAction='';refresh();});
  $('action-upload').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await startAction(file);}catch(error){showError(error.message);}finally{e.target.value='';}});


  // ------------------------------------------------------------ navegação
  async function refresh() {
    const version=++readVersion;
    showError('');
    filterSummary(); saveUrl();
    try {
      if (state.tab === 'painel') await loadPainel(version);
      else if (state.tab === 'candidatos') await loadLista(version);
      else if (state.tab === 'importacoes') await loadImportacoes(version);
      else if (state.tab === 'acoes') await loadAcoes(version);
    } catch (e) { if(version===readVersion&&!cancelled(e))showError(e.message); }
  }
  function setTab(tab) {
    if(state.tab!==tab)requests.cancelReads();
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + tab));
    $('op-page-title').textContent=({painel:'Painel gerencial',candidatos:'Candidatos',acoes:'Ações da supervisão',importacoes:'Importações',definicoes:'Definições'})[tab]||'Oportunidades';
    $('op-sidebar').classList.remove('open');$('op-menu-backdrop').classList.add('hidden');$('op-menu-toggle').setAttribute('aria-expanded','false');
    $('filters').classList.toggle('hidden', ['importacoes','definicoes','acoes'].includes(tab));
    document.querySelector('.op-toolbar').classList.toggle('hidden',['importacoes','definicoes','acoes'].includes(tab));
    $('compare-row').classList.toggle('hidden', tab !== 'painel' || !state.compareOpen);
    refresh();
  }
  let timer;
  const onFilter = () => { clearTimeout(timer); timer = setTimeout(() => { readFilters(); state.list.page = 1; refresh(); }, 300); };
  document.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', onFilter));
  ['cmp-ciclo', 'cmp-de', 'cmp-ate'].forEach(id => $(id).addEventListener('change', onFilter));
  $('clear-filters').addEventListener('click', () => { state.f = {}; writeFilters(); state.list.page = 1; refresh(); });
  $('toggle-filters').addEventListener('click', () => { state.filtersOpen = !state.filtersOpen; $('filter-advanced').classList.toggle('hidden', !state.filtersOpen); $('toggle-filters').textContent = state.filtersOpen ? 'Menos filtros (12)' : 'Mais filtros (12)'; $('toggle-filters').setAttribute('aria-expanded', state.filtersOpen); });
  $('toggle-compare').addEventListener('click', () => { state.compareOpen = !state.compareOpen; $('compare-row').classList.toggle('hidden', !state.compareOpen); $('toggle-compare').setAttribute('aria-expanded', state.compareOpen); });
  $('cycle').addEventListener('change', async () => { requests.cancelReads();++readVersion;state.ciclo = $('cycle').value; try { await loadOpcoes(); } catch (e) { if(!cancelled(e))showError(e.message);return; } state.list.page=1; refresh(); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('list-order').addEventListener('change', () => { state.list.order = $('list-order').value; state.list.page = 1; refresh(); });
  $('export-csv').addEventListener('click', () => download('csv'));
  $('export-xlsx').addEventListener('click', () => download('xlsx'));
  $('drill-csv').addEventListener('click', () => download('csv', state.drill.extra));
  $('drill-xlsx').addEventListener('click', () => download('xlsx', state.drill.extra));
  $('drill-apply').addEventListener('click', () => { state.f = { ...state.f, ...state.drill.extra }; writeFilters(); $('drill-dialog').close(); refresh(); });
  $('upload').addEventListener('change', async ev => { const file = ev.target.files?.[0]; if (!file) return; try { await startImport(file); } catch (e) { if ($('import-dialog').open) $('import-dialog').close(); showError(e.message); } finally { ev.target.value = ''; } });
  document.addEventListener('click', ev => {
    const pole = ev.target.closest('[data-select-polo]');
    if (pole) {
      state.f.polo = pole.dataset.selectPolo; state.list.page = 1;
      const select = document.querySelector('[data-f="polo"]');
      if (![...select.options].some(option => option.value === state.f.polo)) select.add(new Option(state.painel.por_polo.find(p=>p.key===state.f.polo)?.label || 'Polo',state.f.polo));
      writeFilters(); refresh(); $('filters').scrollIntoView({block:'start',behavior:'smooth'}); return;
    }
    const d = ev.target.closest('[data-drill]'); if (d) { const item = drillRegistry[Number(d.dataset.drill)]; if (item) openDrill(item.title, item.extra); return; }
    const o = ev.target.closest('[data-open]'); if (o) { openDetail(Number(o.dataset.open)); return; }
    const c = ev.target.closest('[data-close]'); if (c) c.closest('dialog')?.close();
  });
  const closeMenu=()=>{$('op-sidebar').classList.remove('open');$('op-menu-backdrop').classList.add('hidden');$('op-menu-toggle').setAttribute('aria-expanded','false');};
  $('op-menu-toggle').addEventListener('click',()=>{const open=$('op-sidebar').classList.toggle('open');$('op-menu-backdrop').classList.toggle('hidden',!open);$('op-menu-toggle').setAttribute('aria-expanded',String(open));});
  $('op-menu-backdrop').addEventListener('click',closeMenu);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
  $('theme-toggle').addEventListener('click', () => aplicarTema(document.documentElement.dataset.tema === 'claro' ? 'escuro' : 'claro', true));
  aplicarTema(document.documentElement.dataset.tema);
  $('logout').addEventListener('click', async () => { try { await api('/api/portal/logout', { method: 'POST', body: '{}' }); } catch {} location.assign('/'); });

  (async () => {
    loadUrl();
    try { await loadOpcoes(); } catch (e) { showError(e.message); return; }
    writeFilters();
    if (state.tab === 'importacoes' && !state.opts.permissoes.importar) state.tab = 'painel';
    setTab(state.tab);
  })();
})();

