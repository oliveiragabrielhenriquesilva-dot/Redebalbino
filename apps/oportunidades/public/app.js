(() => {
  'use strict';
  const API = '/oportunidades/api/ma/oportunidades';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = n => n == null ? '—' : Number(n).toLocaleString('pt-BR');
  const fmtP = n => n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const fmtD = v => { if (!v) return '—'; const [y, m, d] = String(v).slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : '—'; };
  const digits = v => String(v || '').replace(/\D/g, '');

  const state = { opts: null, ciclo: '', f: {}, tab: 'painel', painel: null, list: { page: 1, order: 'retorno' }, drill: { extra: {}, page: 1, title: '' }, detail: null, filtersOpen: true };
  const drillRegistry = [];

  // ------------------------------------------------------------ requisições
  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.assign('/?next=' + encodeURIComponent(location.pathname)); throw new Error('Sessão expirada.'); }
    if (!res.ok) throw new Error(data.erro || data.error || `Falha na consulta (${res.status}).`);
    return data;
  }
  function params(extra = {}, base = state.f) {
    const p = new URLSearchParams();
    if (state.ciclo) p.set('ciclo', state.ciclo);
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== '' && v != null) p.set(k, v);
    return p;
  }
  const showError = (msg = '') => { $('error').textContent = msg; $('error').classList.toggle('hidden', !msg); if (msg) $('error').scrollIntoView({ block: 'nearest' }); };
  const showNotice = (msg = '') => { $('notice').textContent = msg; $('notice').classList.toggle('hidden', !msg); };

  // ------------------------------------------------------------ opções e filtros
  async function loadOpcoes() {
    const o = await api(`${API}/opcoes?ciclo=${encodeURIComponent(state.ciclo || '')}`);
    state.opts = o; state.ciclo = String(o.ciclo);
    $('cycle').innerHTML = o.ciclos.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.padrao ? ' (atual)' : ''}</option>`).join('');
    $('cycle').value = state.ciclo;
    $('cmp-ciclo').innerHTML = '<option value="">Não comparar</option>' + o.ciclos.filter(c => String(c.id) !== state.ciclo).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
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
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  }
  function loadUrl() {
    const p = new URLSearchParams(location.search);
    state.ciclo = p.get('ciclo') || '';
    for (const [k, v] of p) if (!['ciclo', 'aba'].includes(k)) state.f[k] = v;
    if (['candidatos', 'importacoes', 'definicoes'].includes(p.get('aba'))) state.tab = p.get('aba');
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
  function groupCols(dimLabel, dimKey) {
    const ex = r => ({ [dimKey]: r.key });
    const t = (r, s) => `${dimLabel}: ${r.label}${s ? ' · ' + s : ''}`;
    return [
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
  }
  function totalOf(rows) {
    const t = { label: 'Total' };
    for (const k of ['total', 'confirmado', 'aguardando', 'sem_ra', 'abertas', 'sem_contato', 'vencidos', 'atendimentos']) t[k] = rows.reduce((a, r) => a + (r[k] || 0), 0);
    t.taxa = t.total ? Math.round(t.confirmado / t.total * 10000) / 100 : null;
    return t;
  }

  // ------------------------------------------------------------ painel
  async function loadPainel() {
    const d = await api(`${API}/painel?${params()}`);
    state.painel = d; drillRegistry.length = 0;
    const k = d.kpis;
    $('avisos').innerHTML = d.avisos.map(a => `<div class="aviso">${esc(a)}</div>`).join('');
    const tile = (label, value, drill, opts = {}) => `<article class="kpi ${opts.cls || ''}"><span>${esc(label)}</span><strong>${drill ? num(value, drill.title, drill.extra) : esc(value)}</strong>${opts.sub ? `<small>${opts.sub}</small>` : ''}</article>`;
    $('kpis').innerHTML = [
      tile('Oportunidades', k.total, { title: 'Todas as oportunidades do filtro', extra: {} }, { sub: `${fmtN(d.total_base)} no processo${d.permissoes.polo_restrito ? ' (seu polo)' : ''}` }),
      tile('RA confirmado', k.ra.confirmado, { title: 'RA confirmado', extra: { ra: 'confirmado' } }, { cls: 'good' }),
      tile('Taxa de conversão', fmtP(k.taxa_conversao), null, { cls: 'hero', sub: esc(k.formula) }),
      tile('Aguardando conciliação', k.ra.aguardando, { title: 'Aguardando conciliação de RA', extra: { ra: 'aguardando' } }),
      tile('Sem RA', k.ra.sem_ra, { title: 'Sem RA', extra: { ra: 'sem_ra' } }),
      tile('Em aberto', k.abertas, null, { sub: 'sem RA e etapa não encerrada' }),
      tile('Sem contato registrado', k.sem_contato, { title: 'Sem contato registrado', extra: { contato: 'sem' } }),
      tile('Retornos vencidos', k.retornos.vencido, { title: 'Retornos vencidos', extra: { retorno: 'vencido' } }, { cls: k.retornos.vencido ? 'alert' : '' }),
      tile('Retorno hoje / 7 dias', `${fmtN(k.retornos.hoje)} / ${fmtN(k.retornos.proximos7)}`, null, { sub: `${fmtN(k.retornos.sem)} em aberto sem data de retorno` }),
      tile('Atendimentos registrados', k.atendimentos_registrados, null, { sub: `${fmtN(k.oportunidades_atendidas)} oportunidade(s) atendida(s)${state.f.atend_de || state.f.atend_ate ? ' no período' : ''}` })
    ].join('');
    renderComparacao(d);
    bars($('chart-status'), d.por_status.map(s => ({ label: s.label, value: s.total, sub: s.confirmado, note: ` · ${fmtP(s.percentual)} · RA ${fmtN(s.confirmado)}`, tip: `${s.label}: ${s.total} oportunidades, ${s.confirmado} com RA confirmado (${fmtP(s.taxa)})`, drill: { title: `Status: ${s.label}`, extra: { status: s.key } } })),
      { legend: '<span class="sw"></span>Oportunidades <span class="sw sub"></span>com RA confirmado' });
    const funil = Object.fromEntries(d.funil.map(x => [x.key, x]));
    bars($('chart-etapa'), d.por_etapa.map(e => ({ label: e.label, value: e.total, sub: e.confirmado, note: ` · ${fmtP(e.percentual)}${funil[e.key] ? ` · na etapa ou adiante ${fmtN(funil[e.key].na_etapa_ou_adiante)}${funil[e.key].taxa_da_anterior != null ? ' (' + fmtP(funil[e.key].taxa_da_anterior) + ' da anterior)' : ''}` : ''}`, tip: `${e.label}: ${e.total}; RA confirmado ${e.confirmado}`, drill: { title: `Etapa: ${e.label}`, extra: { etapa: e.key } } })),
      { legend: '<span class="sw"></span>Na etapa <span class="sw sub"></span>com RA confirmado' });
    table($('table-polo'), groupCols('Polo', 'polo'), d.por_polo, { search: true, initialSort: 'total', total: totalOf(d.por_polo) });
    table($('table-tutor'), groupCols('Tutor do relatório', 'tutor'), d.por_tutor, { search: true, initialSort: 'total', total: totalOf(d.por_tutor) });
    table($('table-resp'), groupCols('Responsável atual', 'resp'), d.por_responsavel, { search: true, initialSort: 'total', total: totalOf(d.por_responsavel) });
    table($('table-curso'), groupCols('Curso', 'curso').slice(0, 6), d.por_curso, { search: true, initialSort: 'total' });
    table($('table-produto'), groupCols('Produto', 'produto').slice(0, 6), d.por_produto, { initialSort: 'total' });
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
    const lado = `${esc(c.ciclo_nome)}${c.insc_de || c.insc_ate ? ` · inscrição ${fmtD(c.insc_de)} a ${fmtD(c.insc_ate)}` : ''}`;
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
      { key: 'polo', label: 'Polo / curso', html: r => `${esc(r.polo)}<span class="sub">${esc(r.curso || 'Curso não informado')}</span>` },
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
  async function loadLista() {
    const data = await api(`${API}/lista?${params({ ordem: state.list.order, pagina: state.list.page, por_pagina: 100 })}`);
    $('list-count').textContent = `${fmtN(data.total)} candidato(s) · ${fmtN(data.ra.confirmado)} com RA confirmado · ${fmtN(data.ra.aguardando)} aguardando conciliação`;
    renderList($('list-table'), $('list-pager'), data, p => { state.list.page = p; loadLista().catch(e => showError(e.message)); });
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
    } catch (e) { $('drill-sub').textContent = e.message; }
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
    catch (e) { body.innerHTML = `<div class="dialog-head"><h2>Não foi possível abrir</h2><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div><div class="error">${esc(e.message)}</div>`; }
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
  async function readSheet(file) {
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
      return rows;
    }
    let end = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('O arquivo não parece ser um Excel .xlsx válido.');
    const count = dv.getUint16(end + 10, true); let offset = dv.getUint32(end + 16, true); const files = {};
    for (let i = 0; i < count; i++) { const method = dv.getUint16(offset + 10, true), size = dv.getUint32(offset + 20, true), nl = dv.getUint16(offset + 28, true), el = dv.getUint16(offset + 30, true), cl = dv.getUint16(offset + 32, true), local = dv.getUint32(offset + 42, true); files[new TextDecoder().decode(buf.slice(offset + 46, offset + 46 + nl))] = { method, size, local }; offset += 46 + nl + el + cl; }
    const read = async name => { const f = files[name]; if (!f) return null; const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true), data = buf.slice(start, start + f.size); if (f.method === 0) return new TextDecoder().decode(data); if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx. Atualize o navegador ou salve como CSV.'); return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); };
    const xml = t => new DOMParser().parseFromString(t, 'application/xml'), shared = [];
    const ss = await read('xl/sharedStrings.xml'); if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(x => x.textContent).join(''));
    let sheetPath = 'xl/worksheets/sheet1.xml';
    try { const wb = xml(await read('xl/workbook.xml')), rels = xml(await read('xl/_rels/workbook.xml.rels')), sheet = wb.getElementsByTagName('sheet')[0], rid = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'), rel = [...rels.getElementsByTagName('Relationship')].find(x => x.getAttribute('Id') === rid); if (rel) sheetPath = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, ''); } catch {}
    const source = await read(sheetPath); if (!source) throw new Error('Não encontrei a primeira planilha no arquivo.');
    const col = ref => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; for (const ch of (m ? m[1] : 'A')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const out = [];
    for (const row of xml(source).getElementsByTagName('row')) {
      const cells = []; for (const cell of row.getElementsByTagName('c')) { const type = cell.getAttribute('t'), v = cell.getElementsByTagName('v')[0]; let value = type === 'inlineStr' ? [...cell.getElementsByTagName('t')].map(x => x.textContent).join('') : v ? v.textContent : ''; if (type === 's') value = shared[Number(value)] || ''; cells[col(cell.getAttribute('r'))] = value; }
      out[(Number(row.getAttribute('r')) || out.length + 1) - 1] = Array.from(cells, x => x ?? '');
    }
    return Array.from(out, x => x || []);
  }
  const normHeader = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
  // A coluna de identificação da planilha se chama exatamente "Identificador" (também aceita o nome antigo).
  const ALIASES = {
    identificador: ['identificador', 'identificador aluno', 'id aluno'], nome: ['nome completo', 'nome', 'nome do aluno', 'nome do candidato', 'candidato', 'aluno'], cpf: ['cpf', 'cpf aluno', 'cpf do aluno'],
    telefone: ['telefone', 'celular', 'whatsapp', 'telefone celular', 'fone'], curso_cod: ['curso codigo', 'codigo curso', 'cod curso', 'codigo do curso'], curso_nome: ['curso nome', 'nome curso', 'curso', 'nome do curso'],
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
  async function loadImportacoes() {
    const d = await api(`${API}/importacoes?ciclo=${encodeURIComponent(state.ciclo)}`);
    $('imports').innerHTML = d.importacoes.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Quando / quem</th><th>Arquivo</th><th class="n">Linhas</th><th class="n">Novas</th><th class="n">Atualizadas</th><th class="n">Sem mudança</th><th class="n">Ignoradas</th><th class="n">Com alerta</th><th></th></tr></thead><tbody>${d.importacoes.map(i => `
      <tr><td>${i.id}</td><td>${esc(i.criado_em)}<span class="sub">${esc(i.criado_por_nome || i.criado_por)}</span></td><td>${esc(i.arquivo || '—')}</td><td class="n">${fmtN(i.linhas)}</td><td class="n">${fmtN(i.novos)}</td><td class="n">${fmtN(i.atualizados)}</td><td class="n">${fmtN(i.inalterados)}</td><td class="n">${fmtN(i.ignorados)}</td><td class="n">${fmtN(i.com_alerta)}</td>
      <td>${i.problemas.length ? `<details><summary>Ver ${fmtN(i.problemas.length)} linha(s)</summary><ul class="problems">${i.problemas.map(p => `<li>Linha ${p.linha} · ${esc(p.identificador || 'sem identificador')}: ${[...p.motivos, ...p.alertas].map(esc).join(' ')}</li>`).join('')}</ul></details>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nenhuma importação registrada neste processo.</p>';
  }

  // ------------------------------------------------------------ navegação
  async function refresh() {
    showError('');
    filterSummary(); saveUrl();
    try {
      if (state.tab === 'painel') await loadPainel();
      else if (state.tab === 'candidatos') await loadLista();
      else if (state.tab === 'importacoes') await loadImportacoes();
    } catch (e) { showError(e.message); }
  }
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + tab));
    $('filters').classList.toggle('hidden', tab === 'importacoes' || tab === 'definicoes');
    $('compare-row').classList.toggle('hidden', tab !== 'painel');
    refresh();
  }
  let timer;
  const onFilter = () => { clearTimeout(timer); timer = setTimeout(() => { readFilters(); state.list.page = 1; refresh(); }, 300); };
  document.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', onFilter));
  ['cmp-ciclo', 'cmp-de', 'cmp-ate'].forEach(id => $(id).addEventListener('change', onFilter));
  $('clear-filters').addEventListener('click', () => { state.f = {}; writeFilters(); state.list.page = 1; refresh(); });
  $('toggle-filters').addEventListener('click', () => { state.filtersOpen = !state.filtersOpen; $('filter-grid').classList.toggle('hidden', !state.filtersOpen); $('toggle-filters').textContent = state.filtersOpen ? 'Ocultar' : 'Mostrar'; $('toggle-filters').setAttribute('aria-expanded', state.filtersOpen); });
  $('cycle').addEventListener('change', async () => { state.ciclo = $('cycle').value; try { await loadOpcoes(); } catch (e) { showError(e.message); } refresh(); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('list-order').addEventListener('change', () => { state.list.order = $('list-order').value; state.list.page = 1; refresh(); });
  $('export-csv').addEventListener('click', () => download('csv'));
  $('export-xlsx').addEventListener('click', () => download('xlsx'));
  $('drill-csv').addEventListener('click', () => download('csv', state.drill.extra));
  $('drill-xlsx').addEventListener('click', () => download('xlsx', state.drill.extra));
  $('drill-apply').addEventListener('click', () => { state.f = { ...state.f, ...state.drill.extra }; writeFilters(); $('drill-dialog').close(); refresh(); });
  $('upload').addEventListener('change', async ev => { const file = ev.target.files?.[0]; if (!file) return; try { await startImport(file); } catch (e) { if ($('import-dialog').open) $('import-dialog').close(); showError(e.message); } finally { ev.target.value = ''; } });
  document.addEventListener('click', ev => {
    const d = ev.target.closest('[data-drill]'); if (d) { const item = drillRegistry[Number(d.dataset.drill)]; if (item) openDrill(item.title, item.extra); return; }
    const o = ev.target.closest('[data-open]'); if (o) { openDetail(Number(o.dataset.open)); return; }
    const c = ev.target.closest('[data-close]'); if (c) c.closest('dialog')?.close();
  });
  $('logout').addEventListener('click', async () => { try { await api('/api/portal/logout', { method: 'POST', body: '{}' }); } catch {} location.assign('/'); });

  (async () => {
    loadUrl();
    try { await loadOpcoes(); } catch (e) { showError(e.message); return; }
    writeFilters();
    if (state.tab === 'importacoes' && !state.opts.permissoes.importar) state.tab = 'painel';
    setTab(state.tab);
  })();
})();
