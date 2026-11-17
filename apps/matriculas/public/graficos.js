/* Gráficos derivados exclusivamente do recorte autorizado de /api/painel. */
(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const fmt = value => n(value).toLocaleString('pt-BR');
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : String(value || '');
  function barras(title, rows, useMeta) {
    const sorted = [...rows].sort((a,b)=>n(b.qtd)-n(a.qtd)||String(a.nome).localeCompare(String(b.nome),'pt-BR'));
    const maxActual = Math.max(1, ...rows.map(x => n(x.qtd)));
    const row = x => {
      const hasMeta = useMeta && x.meta != null && n(x.meta) > 0;
      const percent = hasMeta ? n(x.qtd)/n(x.meta)*100 : null;
      const width = Math.min(100, hasMeta ? percent : n(x.qtd)/maxActual*100);
      const value = percent == null ? '' : percent.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
      return `<div class="rb-chart-row"><div class="rb-chart-label"><b>${esc(x.nome)}</b><strong>${value || fmt(x.qtd)}</strong></div><div class="rb-chart-track" role="img" aria-label="${esc(x.nome)}: ${fmt(x.qtd)} realizada(s)${hasMeta ? ` de ${fmt(x.meta)} da meta; ${value}` : ''}"><span class="rb-chart-fill ${percent>=100?'rb-chart-achieved':''}" style="width:${width}%"></span></div><div class="rb-chart-caption">${fmt(x.qtd)} realizada(s)${hasMeta ? ` de ${fmt(x.meta)} da meta${percent>100?' · meta superada':''}` : useMeta ? ' · sem meta cadastrada' : ''}</div></div>`;
    };
    return `<article class="card rb-chart"><div class="card-cab"><h2>${esc(title)}</h2></div><div class="corpo"><p class="muted rb-chart-description">${useMeta ? 'A barra mostra o percentual da meta de cada item.' : 'Quantidades no recorte selecionado.'}</p>${rows.length ? sorted.slice(0,6).map(row).join('')+(rows.length>6?`<details class="rb-chart-more"><summary>Ver mais ${rows.length-6} itens</summary>${sorted.slice(6).map(row).join('')}</details>`:'') : '<p class="muted">Sem dados neste recorte.</p>'}</div></article>`;
  }
  function diario(rows) {
    const series = rows.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.data)).sort((a,b) => a.data.localeCompare(b.data));
    const max = Math.max(1, ...series.map(x => n(x.qtd)));
    const first = series.length ? Date.parse(series[0].data+'T12:00:00Z') : 0;
    const last = series.length ? Date.parse(series.at(-1).data+'T12:00:00Z') : 0;
    const x = row => 40 + (Date.parse(row.data+'T12:00:00Z') - first) / (last-first || 1) * 620;
    const y = row => 190 - n(row.qtd)/max*160;
    const points = series.map(row => `${x(row)},${y(row)}`).join(' ');
    return `<article class="card rb-chart"><div class="card-cab"><h2>Matrículas por dia</h2></div><div class="corpo"><p class="muted">Lançamentos confirmados dos tutores no recorte. Sede/Digital não possui detalhamento diário neste gráfico.</p>${series.length ? `<svg class="rb-daily-chart" viewBox="0 0 700 235" role="img" aria-label="Matrículas confirmadas por dia; valores disponíveis na tabela abaixo"><text x="5" y="30">${fmt(max)}</text><text x="15" y="194">0</text><path d="M40 25V190H670" class="rb-chart-axis"/><polyline points="${points}" class="rb-chart-line"/>${series.map(row => `<circle cx="${x(row)}" cy="${y(row)}" r="4" tabindex="0"><title>${esc(date(row.data))}: ${fmt(row.qtd)} matrícula(s)</title></circle>`).join('')}<text x="40" y="225">${esc(date(series[0].data))}</text><text x="660" y="225" text-anchor="end">${esc(date(series.at(-1).data))}</text></svg><details><summary>Consultar valores por dia</summary><table class="t"><thead><tr><th>Data</th><th class="num">Matrículas</th></tr></thead><tbody>${series.map(row => `<tr><td>${esc(date(row.data))}</td><td class="num">${fmt(row.qtd)}</td></tr>`).join('')}</tbody></table></details>` : '<p class="muted">Nenhuma matrícula confirmada neste recorte.</p>'}</div></article>`;
  }
  function render(d) {
    return `<section class="rb-charts" aria-label="Gráficos de matrículas"><p class="muted">Os gráficos seguem os filtros do painel. Metas aparecem somente nos recortes em que a comparação está disponível.</p><div class="rb-chart-grid">${barras('Meta × realizado por polo', d.porPolo || [], d.usaMeta)}${barras('Resultado por produto', d.porProduto || [], d.usaMeta)}</div>${diario(d.porDia || [])}</section>`;
  }
  if (typeof module === 'object' && module.exports) module.exports = {render};
  else root.BalbinoGraficos = {render};
})(typeof globalThis === 'undefined' ? this : globalThis);
