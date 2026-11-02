'use strict';
/* Conciliação com o Mundo Azul — posições oficiais por polo OU por produto (interface).
   Depende das funções e do estado de app.js (B, estado, api, esc, int, dataBR, abrirModal…). */

const MA_LEITURAS = [
  ['ok', 'Valor do recorte'], ['selecao', 'Valor “Realçado” (barra azul)'], ['contexto', 'Barra cinza / total geral'],
  ['cortada', 'Valor cortado'], ['ilegivel', 'Ilegível'], ['ambigua', 'Ambíguo'],
];
const MA_ORIGENS = { imagem: 'Print / imagem', excel: 'Arquivo Excel/CSV', colado: 'Texto colado', digitado: 'Digitado', navegador: 'Consulta no navegador' };
const maLocais = (dim) => (dim === 'polo' ? B.polos : B.produtos);
const maNomeLocal = (dim, id) => nomePor(dim === 'polo' ? 'polos' : 'produtos', id) || `#${id}`;
const maDataHora = (p) => `${dataBR(p.data_posicao)}${p.hora_posicao ? ' ' + p.hora_posicao : ''}`;
const maNum = (v) => v == null ? '<span class="muted">—</span>' : int(v);

// ----------------------------------------------------------------------- tabela de conciliação de uma visão
function maTabelaVisao(v, { titulo, curta = false } = {}) {
  if (!v) return '';
  const p = v.posicao;
  const linhas = v.unidades.map(u => {
    const fonte = u.fonte.map(f => `${esc(f.nome)}${f.leitura === 'selecao' ? ' <span class="tag cinza mini">seleção</span>' : ''}`).join('<br>');
    const sit = !u.comparavel ? `<span class="tag warn mini">${esc(u.motivo)}</span>`
      : u.divergencia ? `<span class="tag bad mini" title="Há mais matrículas identificadas do que o oficial">divergência +${int(u.divergencia)}</span>`
      : u.complemento ? `<span class="tag warn mini">${int(u.complemento)} Sede/Digital</span>` : '<span class="tag ok mini">confere</span>';
    return `<tr><td>${fonte}</td><td>${esc(u.nomes_locais.join(' + '))}${u.agrupado ? ' <span class="tag cinza mini">agrupado</span>' : ''}</td>
      <td class="num"><b>${int(u.oficial)}</b></td><td class="num">${int(u.identificadas)}${u.mesmo_dia ? `<br><small class="muted" title="Lançadas no próprio dia da posição">${int(u.mesmo_dia)} no dia</small>` : ''}</td>
      <td class="num">${u.comparavel ? `<b>${int(u.complemento)}</b>` : '<span class="muted">—</span>'}</td>
      ${curta ? '' : `<td class="num">${int(u.identificadas_apos)}</td><td class="num">${u.comparavel ? int(u.consolidado) : '<span class="muted">—</span>'}</td>`}<td>${sit}</td></tr>`;
  }).join('');
  const t = v.totais;
  const semLinha = v.sem_linha && v.sem_linha.length ? `<div class="nota">Identificadas em itens que <b>não aparecem nesta fonte</b> (não tratado como zero oficial): ${v.sem_linha.map(s => `${esc(s.nome)} ${int(s.identificadas)}`).join(' · ')}</div>` : '';
  const fora = v.fora && v.fora.length ? `<div class="nota">Fora do cálculo: ${v.fora.map(f => `${esc(f.nome_fonte)}${f.quantidade != null ? ' (' + int(f.quantidade) + ')' : ''} — ${esc(f.motivo)}`).join(' · ')}</div>` : '';
  return `<div class="card mt"><div class="card-cab"><h2>${esc(titulo || (p.dimensao === 'polo' ? 'Visão por polo' : 'Visão por produto'))}</h2>
      <span class="muted">Posição de ${maDataHora(p)} · ${esc(p.escopo_rotulo)} · ${esc(MA_ORIGENS[p.origem] || p.origem)}${p.total_fonte != null ? ' · total na fonte ' + int(p.total_fonte) : ''} · #${p.id}</span></div>
    <div class="corpo sem-pad" style="overflow-x:auto"><table class="t"><thead><tr><th>Na fonte (nome original)</th><th>No sistema</th><th class="num">Oficial</th><th class="num">Lançadas pelos tutores até a posição</th><th class="num">Sede/Digital</th>${curta ? '' : `<th class="num">Lançadas após a posição</th><th class="num">Consolidado em ${dataBR(v.ref)}</th>`}<th>Situação</th></tr></thead>
    <tbody>${linhas || `<tr><td colspan="${curta ? 6 : 8}" class="vazio">Nenhuma linha utilizável nesta posição.</td></tr>`}
    ${v.unidades.some(u => u.comparavel) ? `<tr class="total"><td colspan="2">Total das linhas comparáveis</td><td class="num">${int(t.oficial)}</td><td class="num">${int(t.identificadas)}</td><td class="num">${int(t.complemento)}</td>${curta ? '' : `<td class="num">${int(t.identificadas_apos)}</td><td class="num">${int(t.consolidado)}</td>`}<td>${t.divergencia ? `<span class="tag bad mini">divergência +${int(t.divergencia)}</span>` : ''}</td></tr>` : ''}</tbody></table></div>
    ${fora}${semLinha}${v.avisos && v.avisos.length ? `<div class="nota">${v.avisos.map(a => '⚠ ' + esc(a)).join('<br>')}</div>` : ''}</div>`;
}
const MA_REGRAS = `<b>Como ler:</b> Oficial = número do Mundo Azul na posição. Lançadas = matrículas lançadas aqui pelos tutores no mesmo recorte, com data até a da posição (polo = polo do aluno).
  <b>Sede/Digital</b> = oficial − lançadas, nunca negativo: matrículas do Mundo Azul (central, site…) que os tutores não lançaram. Elas entram no realizado do polo e do produto (painel e metas), mas não viram aluno, tutor ou origem, nem entram em ticket e RPV.
  Matrículas com data posterior à posição não consomem complemento. A visão por polo e a visão por produto são o mesmo universo: <b>não se somam</b>.
  O total soma o complemento de cada linha (o excedente de uma linha não cobre a falta de outra).`;

// ----------------------------------------------------------------------- tela principal (Conferência › Mundo Azul)
async function telaConciliacaoMA(c) {
  const ciclo = cicloAtual();
  let ref = posicaoAtual();
  c.innerHTML = '<div class="carregando">Carregando…</div>';
  async function render() {
    c.innerHTML = `
    <div class="info"><b>Sede/Digital vem da planilha do Mundo Azul.</b> No Mundo Azul: Captação › Consultar candidatos › escolha a Unidade de Ensino (Graduação, Técnico, Pós…) e o Período › Aplicar Filtros › <b>Gerar Excel</b>. Importe aqui os arquivos (pode ser todos de uma vez, todo dia).
      Conta como matrícula quem tem <b>R.A.</b>, na data do pagamento. Quem tem R.A. e não está lançado no sistema (CPF ou nome + polo) vira <b>Sede/Digital</b> no polo e no produto. Importar de novo não soma; se o tutor lançar depois, sai da Sede/Digital sozinho.</div>
    <div class="card"><div class="card-cab"><h2>Mundo Azul</h2>
      <div class="linha-acoes"><label class="campo" style="margin:0"><span>Consultar em</span><input type="date" id="ma-ref" value="${ref}"></label>
      ${podeLancar() ? '<button class="btn prim" id="ma-lista-imp">Importar lista de alunos (Excel)</button><button class="btn" id="ma-contatos">Contatos para o Google</button>' : ''}<a class="btn" href="#/relatorio-sede-digital" target="_blank" rel="noopener">Relatório Sede/Digital</a>${eAdmin() ? '<button class="btn perigo" id="ma-zerar">Zerar dados do Mundo Azul…</button>' : ''}</div></div></div>
    <div id="ma-lista"></div>
    <div id="ma-sede"></div>
    ${podeLancar() ? '<div class="card mt"><div class="card-cab"><h2>Correspondência de nomes da fonte</h2><span class="muted">polos do Mundo Azul → polos do sistema</span></div><div class="corpo sem-pad" id="ma-mapas"><div class="carregando">Carregando…</div></div></div>' : ''}`;
    $('#ma-ref').onchange = (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { ref = e.target.value; render(); } };
    if ($('#ma-lista-imp')) $('#ma-lista-imp').onclick = () => modalListaMA(ciclo, render);
    if ($('#ma-zerar')) $('#ma-zerar').onclick = () => modalZerarMA(ciclo, render);
    if ($('#ma-contatos')) $('#ma-contatos').onclick = () => modalContatosGoogle();
    renderListaMA($('#ma-lista'), ciclo, ref, render);
    if ($('#ma-mapas')) renderMapeamentosMA($('#ma-mapas'), render);
    renderQuadroSede($('#ma-sede'), ciclo.id, ref, false);
  }
  await render();
}

async function renderMapeamentosMA(box, depois) {
  const lista = await api('/api/ma/mapeamentos');
  if (!lista.length) { box.innerHTML = '<div class="vazio">Nenhuma correspondência salva. Elas são criadas ao gravar uma posição.</div>'; return; }
  // agrupamento = mais de um nome da fonte para o mesmo item, ou um nome para mais de um item
  const chaveLoc = (m) => `${m.tipo}|${m.local_ids.join(',')}`;
  const cont = {}; for (const m of lista) cont[chaveLoc(m)] = (cont[chaveLoc(m)] || 0) + 1;
  box.innerHTML = `<table class="t"><thead><tr><th>Gráfico</th><th>Nome na fonte</th><th>No sistema</th><th>Agrupamento</th><th>Atualizado</th><th></th></tr></thead><tbody>${lista.map((m, i) => {
    const agrup = m.local_ids.length > 1 || cont[chaveLoc(m)] > 1;
    return `<tr><td>${m.tipo === 'polo' ? 'Polo' : 'Produto'}</td><td>${esc(m.nome_fonte)}</td><td>${esc(m.local_ids.map(id => maNomeLocal(m.tipo, id)).join(' + '))}</td>
      <td>${!agrup ? '<span class="muted">não</span>' : m.verificado ? `<span class="tag ok mini">verificado</span><br><small class="muted">${esc(m.obs || '')}</small>` : '<span class="tag warn mini">pendente</span>'}</td>
      <td class="muted"><small>${esc(m.atualizado_por || '')} ${esc(String(m.atualizado_em || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))}</small></td>
      <td class="acoes">${eAdmin() && agrup && !m.verificado ? `<button class="btn peq" data-verif="${i}">Verificar agrupamento</button> ` : ''}${eAdmin() ? `<button class="btn peq perigo" data-rem="${i}">Remover</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table><div class="nota">Agrupar nomes diferentes da fonte num mesmo item do sistema (ex.: “Pós Saúde e Bem-Estar” e “Pós-Graduação” em “Pós”) só gera complemento depois que um administrador verificar a regra comercial.</div>`;
  $$('[data-verif]', box).forEach(b => { b.onclick = () => {
    const m = lista[Number(b.dataset.verif)];
    const md = abrirModal(`<header><h3>Verificar agrupamento</h3></header><div class="corpo"><p>“${esc(m.nome_fonte)}” → <b>${esc(m.local_ids.map(id => maNomeLocal(m.tipo, id)).join(' + '))}</b></p>
      <p class="muted">Confirme só se a regra comercial e o cadastro de cursos sustentam essa correspondência. Outras linhas da fonte ligadas ao mesmo item também precisam ser verificadas.</p>
      <label class="campo"><span>Regra / evidência (obrigatório)</span><textarea id="vf-obs" rows="3" placeholder="Ex.: comunicado de 27/10 confirma que Pós Saúde e Bem-Estar é linha de Pós"></textarea></label></div>
      <footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="vf-ok">Verificar</button></footer>`, 520);
    $('#vf-ok', md).onclick = async () => { try { await api('/api/ma/mapeamentos', { method: 'PUT', body: { tipo: m.tipo, nome_fonte: m.nome_fonte, local_ids: m.local_ids, verificado: true, obs: $('#vf-obs', md).value } }); fecharModal(); toast('Agrupamento verificado'); depois(); } catch (e) { toast(e.message, true); } };
  }; });
  $$('[data-rem]', box).forEach(b => { b.onclick = async () => {
    const m = lista[Number(b.dataset.rem)];
    if (!await confirmar('Remover correspondência', `Remover “${esc(m.nome_fonte)}” do dicionário? Posições já gravadas mantêm a correspondência registrada nelas.`, 'Remover')) return;
    try { await api('/api/ma/mapeamentos', { method: 'PUT', body: { tipo: m.tipo, nome_fonte: m.nome_fonte, local_ids: [] } }); depois(); } catch (e) { toast(e.message, true); }
  }; });
}

async function modalDescartarMA(id, depois) {
  const md = abrirModal(`<header><h3>Descartar posição #${id}</h3></header><div class="corpo"><p>A posição continua no histórico, mas deixa de ser usada nos cálculos. Se a posição anterior precisar voltar, registre-a de novo.</p>
    <label class="campo"><span>Motivo (obrigatório)</span><input type="text" id="ds-mot"></label></div><footer><button class="btn" data-fechar>Cancelar</button><button class="btn perigo" id="ds-ok">Descartar</button></footer>`, 460);
  $('#ds-ok', md).onclick = async () => { try { await api(`/api/ma/posicoes/${id}/descartar`, { method: 'POST', body: { motivo: $('#ds-mot', md).value } }); fecharModal(); toast('Posição descartada'); depois(); } catch (e) { toast(e.message, true); } };
}

async function modalVerPosicaoMA(id, ref, ciclo, depois) {
  const d = await api(`/api/ma/posicoes/${id}?ref=${ref}`);
  const p = d.posicao, leit = Object.fromEntries(MA_LEITURAS);
  const md = abrirModal(`<header><h3>Posição #${p.id} — ${p.dimensao === 'polo' ? 'por polo' : 'por produto'} · ${maDataHora(p)}</h3></header><div class="corpo">
    <p class="muted">${esc(p.escopo_rotulo)}${p.escopo_tipo !== 'rede' ? (p.cruzamento_verificado ? ` · filtro verificado: ${esc(p.cruzamento_evidencia || '')}` : ' · <b>filtro não verificado</b>') : ''}<br>
    ${esc(MA_ORIGENS[p.origem] || p.origem)}${p.arquivo ? ' · ' + esc(p.arquivo) : ''} · registrada por ${esc(p.criado_por || '')} em ${esc(String(p.criado_em || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))} · situação: ${esc(p.status)}${p.status_por ? ` (${esc(p.status_por)})` : ''}
    ${p.motivo ? `<br>Motivo: ${esc(p.motivo)}` : ''}${p.obs ? `<br>Obs.: ${esc(p.obs)}` : ''}</p>
    ${p.evidencia_id ? `<a href="/api/ma/evidencias/${p.evidencia_id}" target="_blank" rel="noopener"><img src="/api/ma/evidencias/${p.evidencia_id}" alt="Evidência" style="max-width:100%;max-height:320px;border:1px solid var(--line);border-radius:8px"></a>` : ''}
    ${p.linhas.length ? `<h4>Linhas como vieram da fonte</h4><table class="t"><thead><tr><th>Nome na fonte</th><th class="num">Quantidade</th><th>Leitura</th><th>No sistema</th><th>Obs.</th></tr></thead><tbody>${p.linhas.map(l => `<tr><td>${esc(l.nome_fonte)}</td><td class="num">${maNum(l.quantidade)}</td><td>${esc(leit[l.leitura] || l.leitura)}</td><td>${esc(l.local_ids.map(i => maNomeLocal(p.dimensao, i)).join(' + ') || '—')}</td><td class="muted">${esc(l.obs || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${maTabelaVisao({ posicao: p, ...d.calculo }, { titulo: `Conciliação calculada agora (consulta em ${dataBR(d.calculo.ref)})` })}
    ${d.anteriores.length ? `<h4>Versões anteriores</h4><ul>${d.anteriores.map(a => `<li>#${a.id} · ${dataBR(a.data_posicao)} ${esc(a.hora_posicao || '')} · ${esc(a.status)} · ${esc(a.criado_por || '')}${a.motivo ? ' · ' + esc(a.motivo) : ''}</li>`).join('')}</ul>` : ''}
  </div><footer>${podeLancar() && p.status === 'ativa' && p.linhas.length ? '<button class="btn" id="vp-sub">Corrigir (substituir)</button>' : ''}<button class="btn prim" data-fechar>Fechar</button></footer>`, 980);
  if ($('#vp-sub', md)) $('#vp-sub', md).onclick = () => modalPosicaoMA(ciclo, { ...p, substituir_id: p.id }, depois);
}

// ----------------------------------------------------------------------- registrar posição: entrada → revisão → confirmação
function maComprimirImagem(arq) {
  return new Promise((ok, erro) => {
    const img = new Image(), url = URL.createObjectURL(arq);
    img.onload = () => {
      const max = 1800, s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let q = 0.88, dados = cv.toDataURL('image/jpeg', q);
      while (dados.length > 1_400_000 && q > 0.4) { q -= 0.12; dados = cv.toDataURL('image/jpeg', q); }
      ok({ nome: arq.name || 'print-colado.jpg', dados, largura: img.width, altura: img.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('Não consegui abrir a imagem')); };
    img.src = url;
  });
}
async function maHashArquivo(arq) {
  try { const h = await crypto.subtle.digest('SHA-256', await arq.arrayBuffer()); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { return ''; }
}
// Lê um gráfico exportado (uma coluna de nomes + uma de quantidades). Linha "Total" vira o total da fonte.
function maInterpretarTabela(linhas) {
  const ehNum = (v) => typeof v === 'number' || (v != null && /^\s*-?[\d.]+(,\d+)?\s*$/.test(String(v)));
  const ncol = Math.max(0, ...linhas.map(l => l.length));
  let colNum = -1, colTxt = -1, melhorN = 0, melhorT = 0;
  for (let j = 0; j < ncol; j++) {
    const n = linhas.filter(l => ehNum(l[j])).length, t = linhas.filter(l => l[j] != null && String(l[j]).trim() && !ehNum(l[j])).length;
    if (n > melhorN) { melhorN = n; colNum = j; }
    if (t > melhorT) { melhorT = t; colTxt = j; }
  }
  if (colNum < 0 || colTxt < 0 || colNum === colTxt) throw new Error('Não encontrei uma coluna de nomes e uma de quantidades. Confira o arquivo ou digite as linhas.');
  const out = []; let total = null; const avisos = [];
  for (const l of linhas) {
    const nome = String(l[colTxt] ?? '').trim(), v = l[colNum];
    if (!nome) continue;
    if (!ehNum(v)) { if (out.length || /total/i.test(nome)) avisos.push(`Linha sem número ignorada: "${nome}"`); continue; }
    const q = LeitorPlanilha.numero(v);
    if (/^total/i.test(nome)) { total = q; continue; }
    out.push({ nome_fonte: nome, quantidade: Number.isInteger(q) ? q : null, leitura: Number.isInteger(q) ? 'ok' : 'ambigua', obs: Number.isInteger(q) ? '' : 'valor não inteiro na fonte: ' + v });
  }
  return { linhas: out, total, avisos };
}

function modalPosicaoMA(ciclo, base, depois) {
  const f = {
    dimensao: base?.dimensao || 'polo', escopo_tipo: base?.escopo_tipo || 'rede', escopo_ids: base?.escopo_ids || [], escopo_fonte: base?.escopo_fonte || '',
    cruzamento_verificado: !!base?.cruzamento_verificado, cruzamento_evidencia: base?.cruzamento_evidencia || '',
    data_posicao: base?.data_posicao || B.hoje, hora_posicao: base?.hora_posicao || '', origem: base?.origem || 'digitado', arquivo: base?.arquivo || '', arquivo_hash: '',
    total_fonte: base?.total_fonte ?? '', obs: '', substituir_id: base?.substituir_id || null, motivo: '',
    linhas: (base?.linhas || []).map(l => ({ nome_fonte: l.nome_fonte, quantidade: l.quantidade ?? '', leitura: l.leitura, local_ids: [...(l.local_ids || [])], obs: l.obs || '' })),
  };
  let evidencia = null, etapa = 'entrada', previa = null, avisosLeitura = [];
  if (!f.linhas.length) f.linhas.push({ nome_fonte: '', quantidade: '', leitura: 'ok', local_ids: [], obs: '' });
  const md = abrirModal('<div id="pm"></div>', 1100);
  const box = $('#pm', md);

  const opcoesLocais = (dim, sel) => maLocais(dim).filter(x => x.ativo || sel.includes(x.id)).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  function lerForm() {
    for (const k of ['dimensao', 'escopo_tipo', 'escopo_fonte', 'cruzamento_evidencia', 'data_posicao', 'hora_posicao', 'origem', 'total_fonte', 'obs', 'motivo']) { const el = $('#pm-' + k, box); if (el) f[k] = el.value; }
    if ($('#pm-cruzamento_verificado', box)) f.cruzamento_verificado = $('#pm-cruzamento_verificado', box).checked;
    if ($('#pm-escopo_ids', box)) f.escopo_ids = $('#pm-escopo_ids', box).value ? [Number($('#pm-escopo_ids', box).value)] : [];
    $$('tr[data-l]', box).forEach(tr => { const l = f.linhas[Number(tr.dataset.l)]; for (const el of $$('[data-k]', tr)) l[el.dataset.k] = el.value; });
  }
  async function sugerirMapas() {
    const nomes = f.linhas.filter(l => l.nome_fonte && !l.local_ids.length).map(l => l.nome_fonte);
    if (!nomes.length) return;
    try {
      const sug = await api('/api/ma/sugestoes', { method: 'POST', body: { tipo: f.dimensao, nomes } });
      for (const s of sug) { const l = f.linhas.find(x => x.nome_fonte === s.nome_fonte && !x.local_ids.length); if (l && s.local_ids.length) { l.local_ids = s.local_ids; l.sugerido = s.origem; } }
    } catch { /* segue sem sugestão */ }
  }

  function renderEntrada() {
    const outra = f.dimensao === 'polo' ? 'produto' : 'polo';
    box.innerHTML = `<header><h3>${f.substituir_id ? `Corrigir posição #${f.substituir_id} (substituição)` : 'Registrar posição oficial do Mundo Azul'}</h3></header><div class="corpo">
      <div class="info">Registre <b>um gráfico por vez</b>, exatamente como aparece na fonte. Linha que não aparece não é zero: simplesmente não informe. Nada é gravado antes da revisão.</div>
      <div class="linha-acoes" style="flex-wrap:wrap;gap:10px">
        <label class="campo" style="max-width:220px"><span>Gráfico</span><select id="pm-dimensao"><option value="polo">Matrícula realizada por POLO</option><option value="produto">Matrícula realizada por PRODUTO</option></select></label>
        <label class="campo" style="max-width:250px"><span>Seleção ativa no Mundo Azul</span><select id="pm-escopo_tipo"><option value="rede">Nenhuma (rede inteira)</option><option value="${outra}">Um ${outra} selecionado</option></select></label>
        <label class="campo" style="max-width:160px"><span>Data da posição</span><input type="date" id="pm-data_posicao" max="${B.hoje}"></label>
        <label class="campo" style="max-width:120px"><span>Hora (se souber)</span><input type="time" id="pm-hora_posicao"></label>
        <label class="campo" style="max-width:150px"><span>Total mostrado na fonte</span><input type="number" min="0" id="pm-total_fonte" placeholder="vazio = não aparece"></label>
        <label class="campo" style="max-width:200px"><span>Origem</span><select id="pm-origem">${Object.entries(MA_ORIGENS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      </div>
      ${f.escopo_tipo !== 'rede' ? `<div class="aviso"><div class="linha-acoes" style="flex-wrap:wrap;gap:10px">
        <label class="campo" style="max-width:220px"><span>${outra === 'polo' ? 'Polo' : 'Produto'} no sistema</span><select id="pm-escopo_ids"><option value="">—</option>${opcoesLocais(outra, f.escopo_ids)}</select></label>
        <label class="campo" style="max-width:240px"><span>Nome da seleção na fonte</span><input type="text" id="pm-escopo_fonte" placeholder="como aparece no Mundo Azul"></label></div>
        <div style="font-size:12.5px;margin-top:8px"><b>Verificado no Mundo Azul em 28/10/2026</b> (Indicadores › Captação EAD › Matrículas, Power BI): clicar numa barra de polo faz <b>realce</b> no gráfico de produtos, não filtro.
          A barra cinza é o <b>total geral</b> (tooltip só com “Mat. Realizado”); a parte azul é do polo (tooltip “Realçado”). Formas confiáveis de obter o recorte:
          (1) filtro <b>Polo</b>/<b>Produto</b> no painel lateral FILTROS; (2) selecionar a barra e usar “…” › <b>Mostrar como uma tabela</b>: a tabela lista só o recorte; (3) o valor “Realçado” do tooltip.
          Espere o painel atualizar (os cartões Meta Ritmo mudam) antes do print: logo após o clique, o gráfico pode ainda mostrar a seleção anterior.</div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:8px"><input type="checkbox" id="pm-cruzamento_verificado"> <span>Confirmei que a seleção <b>filtra</b> este gráfico (os números mudaram para o recorte, ou o tooltip/exportação mostra o valor do recorte). <b>Barra cinza não é valor do recorte.</b> Sem esta confirmação nada é calculado.</span></label>
        <label class="campo" style="margin-top:6px"><span>Como foi confirmado</span><input type="text" id="pm-cruzamento_evidencia" placeholder="Ex.: filtro Polo = BATATAIS SP no painel FILTROS; ou “Mostrar como uma tabela” com Batatais selecionado"></label></div>` : ''}
      <div class="grid ma-entrada" style="align-items:start;margin-top:8px">
        <div><h4 style="margin:4px 0">Fonte</h4>
          <div class="linha-acoes" style="flex-wrap:wrap"><label class="btn">Abrir print / imagem<input type="file" id="pm-img" accept="image/png,image/jpeg,image/webp" hidden></label>
            <label class="btn">Abrir Excel / CSV<input type="file" id="pm-arq" accept=".xlsx,.csv,.txt" hidden></label></div>
          <p class="muted" style="font-size:12px">Também dá para colar um print (Ctrl+V) nesta janela. A imagem <b>não é lida automaticamente</b>: digite os valores ao lado conferindo com ela.</p>
          <textarea id="pm-texto" rows="3" placeholder="…ou cole aqui a tabela copiada (nome e quantidade por linha)" style="font-family:var(--mono);font-size:12px"></textarea>
          <button class="btn peq" id="pm-ler">Ler texto colado</button>
          <div id="pm-prev" style="margin-top:8px">${evidencia ? `<img src="${evidencia.dados}" alt="Prévia da imagem" style="max-width:100%;border:1px solid var(--line);border-radius:8px;cursor:zoom-in" id="pm-img-prev"><div class="muted" style="font-size:12px">${esc(evidencia.nome)} · ${evidencia.largura}×${evidencia.altura}px · será guardada como evidência</div>` : ''}</div>
          ${avisosLeitura.length ? `<div class="aviso">${avisosLeitura.map(esc).join('<br>')}</div>` : ''}
        </div>
        <div><h4 style="margin:4px 0">Linhas do gráfico ${f.dimensao === 'polo' ? '(polos)' : '(produtos)'}</h4>
          <div style="overflow-x:auto"><table class="t"><thead><tr><th>Nome na fonte</th><th class="num">Qtd.</th><th>O número é…</th><th>No sistema</th><th></th></tr></thead><tbody>
          ${f.linhas.map((l, i) => `<tr data-l="${i}"><td><input type="text" data-k="nome_fonte" value="${esc(l.nome_fonte)}" style="width:150px"></td>
            <td class="num"><input type="number" min="0" step="1" class="qtd" data-k="quantidade" value="${esc(l.quantidade)}" style="width:70px"></td>
            <td><select data-k="leitura" style="width:165px">${MA_LEITURAS.map(([k, n]) => `<option value="${k}" ${k === l.leitura ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
            <td>${l.local_ids.map(id => `<span class="tag cinza mini">${esc(maNomeLocal(f.dimensao, id))} <a href="#" data-tira="${i}:${id}" title="remover">×</a></span>`).join(' ')}
              ${l.sugerido === 'nome_identico' ? '<small class="muted">(nome idêntico)</small>' : l.sugerido === 'dicionario' ? '<small class="muted">(dicionário)</small>' : ''}
              <select data-add="${i}" style="width:130px"><option value="">${l.local_ids.length ? '+ agrupar…' : 'escolher…'}</option>${maLocais(f.dimensao).filter(x => x.ativo && !l.local_ids.includes(x.id)).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></td>
            <td><button class="btn peq perigo" data-rm="${i}" title="Remover linha">×</button></td></tr>`).join('')}
          </tbody></table></div>
          <button class="btn peq" id="pm-mais">+ linha</button>
          <label class="campo" style="margin-top:10px"><span>Observação</span><input type="text" id="pm-obs" placeholder="Ex.: Captação EAD › Matrículas · Período 2027-51 · Gestor/Grupo Polo/Produto/Polo = Todos"></label>
        </div>
      </div></div>
      <footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="pm-revisar">Revisar antes de gravar</button></footer>`;
    for (const k of ['dimensao', 'escopo_tipo', 'escopo_fonte', 'cruzamento_evidencia', 'data_posicao', 'hora_posicao', 'origem', 'total_fonte', 'obs']) { const el = $('#pm-' + k, box); if (el) el.value = f[k] ?? ''; }
    if ($('#pm-escopo_ids', box)) $('#pm-escopo_ids', box).value = f.escopo_ids[0] || '';
    if ($('#pm-cruzamento_verificado', box)) $('#pm-cruzamento_verificado', box).checked = f.cruzamento_verificado;
    $$('[data-fechar]', box).forEach(b => { b.onclick = fecharModal; });
    $('#pm-dimensao', box).onchange = () => { lerForm(); f.escopo_tipo = 'rede'; f.escopo_ids = []; for (const l of f.linhas) { l.local_ids = []; l.sugerido = null; } sugerirMapas().then(renderEntrada); };
    $('#pm-escopo_tipo', box).onchange = () => { lerForm(); renderEntrada(); };
    $('#pm-mais', box).onclick = () => { lerForm(); f.linhas.push({ nome_fonte: '', quantidade: '', leitura: 'ok', local_ids: [], obs: '' }); renderEntrada(); };
    $$('[data-rm]', box).forEach(b => { b.onclick = () => { lerForm(); f.linhas.splice(Number(b.dataset.rm), 1); if (!f.linhas.length) f.linhas.push({ nome_fonte: '', quantidade: '', leitura: 'ok', local_ids: [], obs: '' }); renderEntrada(); }; });
    $$('[data-add]', box).forEach(s => { s.onchange = () => { lerForm(); const l = f.linhas[Number(s.dataset.add)]; const id = Number(s.value); if (id && !l.local_ids.includes(id)) l.local_ids.push(id); l.sugerido = null; renderEntrada(); }; });
    $$('[data-tira]', box).forEach(a => { a.onclick = (e) => { e.preventDefault(); lerForm(); const [i, id] = a.dataset.tira.split(':').map(Number); f.linhas[i].local_ids = f.linhas[i].local_ids.filter(x => x !== id); renderEntrada(); }; });
    $$('[data-k="nome_fonte"]', box).forEach(el => { el.onchange = () => { lerForm(); sugerirMapas().then(renderEntrada); }; });
    if ($('#pm-img-prev', box)) $('#pm-img-prev', box).onclick = () => { const w = window.open(); if (w) w.document.write(`<title>Evidência</title><img src="${evidencia.dados}" style="max-width:none">`); };
    const usarImagem = async (arq) => {
      try { lerForm(); evidencia = await maComprimirImagem(arq); f.origem = 'imagem'; f.arquivo = evidencia.nome; f.arquivo_hash = await maHashArquivo(arq); renderEntrada(); }
      catch (e) { toast(e.message, true); }
    };
    $('#pm-img', box).onchange = (ev) => { const a = ev.target.files[0]; ev.target.value = ''; if (a) usarImagem(a); };
    md.onpaste = (ev) => { const it = [...(ev.clipboardData?.items || [])].find(x => x.type.startsWith('image/')); if (it) { ev.preventDefault(); usarImagem(it.getAsFile()); } };
    const aplicarTabela = async (matriz, origem, nome) => {
      lerForm();
      const r = maInterpretarTabela(matriz);
      if (!r.linhas.length) { toast('Nenhuma linha com quantidade encontrada', true); return; }
      f.linhas = r.linhas.map(l => ({ ...l, local_ids: [] })); f.origem = origem; if (nome) f.arquivo = nome;
      if (r.total != null) f.total_fonte = r.total;
      avisosLeitura = r.avisos;
      await sugerirMapas(); renderEntrada();
      toast(`${r.linhas.length} linha(s) lidas — confira cada uma antes de revisar`);
    };
    $('#pm-ler', box).onclick = () => { try { aplicarTabela(LeitorPlanilha.lerTexto($('#pm-texto', box).value), 'colado'); } catch (e) { toast(e.message, true); } };
    $('#pm-arq', box).onchange = async (ev) => {
      const arq = ev.target.files[0]; ev.target.value = ''; if (!arq) return;
      try { f.arquivo_hash = await maHashArquivo(arq); await aplicarTabela(/\.xlsx$/i.test(arq.name) ? await LeitorPlanilha.lerXlsx(await arq.arrayBuffer()) : LeitorPlanilha.lerTexto(await arq.text()), 'excel', arq.name); }
      catch (e) { toast(e.message, true); }
    };
    $('#pm-revisar', box).onclick = async () => {
      lerForm();
      const linhas = f.linhas.filter(l => String(l.nome_fonte).trim());
      if (!linhas.length) { toast('Informe ao menos uma linha', true); return; }
      try { previa = await api('/api/ma/previa', { method: 'POST', body: corpo(linhas) }); etapa = 'revisao'; renderRevisao(); }
      catch (e) { toast(e.message, true); }
    };
  }
  const corpo = (linhas = f.linhas) => ({ ciclo_id: ciclo.id, ...f, linhas: linhas.map(l => ({ nome_fonte: l.nome_fonte, quantidade: l.quantidade === '' ? null : Number(l.quantidade), leitura: l.leitura, local_ids: l.local_ids, obs: l.obs })) });

  function renderRevisao() {
    const d = previa.dados, calc = previa.calculo;
    const leit = Object.fromEntries(MA_LEITURAS);
    const problemas = d.linhas.filter(l => !['ok', 'selecao'].includes(l.leitura) || !l.local_ids.length);
    const bloqueio = previa.ja_registrada ? null : previa.conflito && Number(f.substituir_id) !== previa.conflito.id ? 'conflito' : null;
    box.innerHTML = `<header><h3>Revisão — nada foi gravado ainda</h3></header><div class="corpo">
      <div class="grid g2" style="align-items:start"><div>
        <p><b>${d.dimensao === 'polo' ? 'Gráfico por polo' : 'Gráfico por produto'}</b> · ${d.escopo_tipo === 'rede' ? 'sem seleção (rede)' : `seleção: ${esc(d.escopo_ids.map(i => maNomeLocal(d.escopo_tipo, i)).join(', '))}${d.escopo_fonte ? ` (“${esc(d.escopo_fonte)}”)` : ''} · ${d.cruzamento_verificado ? 'filtro verificado' : '<b>filtro NÃO verificado</b>'}`}<br>
        Posição de ${dataBR(d.data_posicao)}${d.hora_posicao ? ' ' + esc(d.hora_posicao) : ' (hora não informada)'} · ${esc(MA_ORIGENS[d.origem])}${d.arquivo ? ' · ' + esc(d.arquivo) : ''} · ${esc(ciclo.nome)}<br>
        Soma das linhas lidas: <b>${int(calc.soma_linhas)}</b> · total na fonte: <b>${d.total_fonte == null ? 'não informado' : int(d.total_fonte)}</b></p>
        <table class="t"><thead><tr><th>Nome na fonte</th><th class="num">Qtd.</th><th>Leitura</th><th>No sistema</th></tr></thead><tbody>${d.linhas.map(l => `<tr class="${!['ok', 'selecao'].includes(l.leitura) || !l.local_ids.length ? 'linha-alerta' : ''}"><td>${esc(l.nome_fonte)}</td><td class="num">${maNum(l.quantidade)}</td><td>${['ok', 'selecao'].includes(l.leitura) ? esc(leit[l.leitura]) : `<span class="tag warn mini">${esc(leit[l.leitura])}</span>`}</td><td>${l.local_ids.length ? esc(l.local_ids.map(i => maNomeLocal(d.dimensao, i)).join(' + ')) : '<span class="tag bad mini">sem correspondência</span>'}</td></tr>`).join('')}</tbody></table>
      </div><div>${evidencia ? `<img src="${evidencia.dados}" alt="Evidência" style="max-width:100%;border:1px solid var(--line);border-radius:8px">` : '<div class="muted">Sem imagem de evidência.</div>'}</div></div>
      ${previa.ja_registrada ? `<div class="aviso">Esta posição já está registrada (#${previa.ja_registrada.id}, ${esc(previa.ja_registrada.criado_por || '')}). Reimportar não soma de novo; nada será gravado.</div>` : ''}
      ${previa.conflito ? `<div class="aviso">Já existe uma posição ativa do mesmo gráfico, escopo, data e hora com números diferentes (#${previa.conflito.id}).
        ${Number(f.substituir_id) === previa.conflito.id ? 'Ela será marcada como <b>substituída</b> (fica no histórico).' : `Para trocar, marque substituir e informe o motivo: <label style="display:inline-flex;gap:6px"><input type="checkbox" id="pm-subst"> substituir #${previa.conflito.id}</label>`}</div>` : ''}
      ${f.substituir_id ? `<label class="campo"><span>Motivo da substituição (obrigatório)</span><input type="text" id="pm-motivo" value="${esc(f.motivo || '')}"></label>` : ''}
      ${previa.posterior ? `<div class="aviso">Já existe posição posterior deste gráfico (${dataBR(previa.posterior.data_posicao)} ${esc(previa.posterior.hora_posicao || '')}). Esta só valerá para consultas entre as duas datas.</div>` : ''}
      ${problemas.length ? `<div class="aviso">${problemas.length} linha(s) não entram no cálculo (leitura não confiável ou sem correspondência). Elas são guardadas como vieram, para auditoria.</div>` : ''}
      ${maTabelaVisao({ posicao: { ...d, id: 'nova', escopo_rotulo: d.escopo_tipo === 'rede' ? 'Rede (sem seleção)' : 'Seleção: ' + d.escopo_ids.map(i => maNomeLocal(d.escopo_tipo, i)).join(', ') }, ...calc }, { titulo: 'Como a conciliação vai ficar', curta: true })}
      <label style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="pm-conferi"> <span>Conferi linha a linha com a fonte (nomes, quantidades, barras cinza e linhas ausentes).</span></label>
      </div><footer><button class="btn" id="pm-voltar">‹ Voltar e editar</button><button class="btn prim" id="pm-gravar" ${previa.ja_registrada ? 'disabled' : ''}>Confirmar e gravar</button></footer>`;
    $('#pm-voltar', box).onclick = () => { etapa = 'entrada'; renderEntrada(); };
    if ($('#pm-subst', box)) $('#pm-subst', box).onchange = (e) => { f.substituir_id = e.target.checked ? previa.conflito.id : null; renderRevisao(); };
    if ($('#pm-motivo', box)) $('#pm-motivo', box).oninput = (e) => { f.motivo = e.target.value; };
    $('#pm-gravar', box).onclick = async () => {
      if (!$('#pm-conferi', box).checked) { toast('Marque que conferiu a prévia com a fonte', true); return; }
      if (bloqueio === 'conflito' && !f.substituir_id) { toast('Já existe posição com números diferentes: marque substituir ou volte e corrija a data/hora', true); return; }
      try {
        const r = await api('/api/ma/posicoes', { method: 'POST', body: { ...corpo(), confirmado: true, evidencia: evidencia ? { nome: evidencia.nome, dados: evidencia.dados } : null } });
        fecharModal(); toast(r.ja_registrada ? 'Posição já registrada — nada foi somado' : `Posição #${r.id} gravada`); depois();
      } catch (e) { toast(e.message, true); }
    };
  }
  sugerirMapas().then(renderEntrada);
}

// ----------------------------------------------------------------------- relatório (nova guia)
async function telaRelatorioMundoAzul() {
  const app = $('#app'), ciclo = cicloAtual();
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Conciliação com o Mundo Azul</b><label>Posição em <input type="date" id="rm-ref" value="${posicaoAtual()}"></label><button class="btn prim" id="rm-gerar">Gerar relatório</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="rm-conteudo" class="rel"></div>`;
  let versao = 0;
  async function gerar() {
    const v = ++versao, ref = $('#rm-ref').value, box = $('#rm-conteudo');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) { box.innerHTML = '<div class="erro-box">Informe uma data.</div>'; return; }
    box.innerHTML = '<div class="carregando">Montando relatório…</div>';
    try {
      const d = await api('/api/ma/conciliacao?' + qs({ ciclo: ciclo.id, ref }));
      if (v !== versao) return;
      const tabela = (vis, titulo) => {
        if (!vis) return `<h2>${titulo}</h2><p>Sem posição oficial deste gráfico com data até ${dataBR(d.ref)}.</p>`;
        const p = vis.posicao, t = vis.totais;
        return `<h2>${titulo}</h2><p class="rp-nota">Posição oficial de ${maDataHora(p)} · ${esc(p.escopo_rotulo)} · ${esc(MA_ORIGENS[p.origem] || p.origem)}${p.total_fonte != null ? ` · total na fonte ${int(p.total_fonte)}` : ''} · registro #${p.id}</p>
          <table class="t"><thead><tr><th>Na fonte</th><th>No sistema</th><th class="num">Oficial</th><th class="num">Lançadas até a posição</th><th class="num">Sede/Digital</th><th class="num">Lançadas após</th><th class="num">Consolidado</th><th>Situação</th></tr></thead><tbody>
          ${vis.unidades.map(u => `<tr><td>${esc(u.fonte.map(f => f.nome).join(' + '))}</td><td>${esc(u.nomes_locais.join(' + '))}</td><td class="num"><b>${int(u.oficial)}</b></td><td class="num">${int(u.identificadas)}</td><td class="num">${u.comparavel ? int(u.complemento) : '—'}</td><td class="num">${int(u.identificadas_apos)}</td><td class="num">${u.comparavel ? int(u.consolidado) : '—'}</td><td>${!u.comparavel ? esc(u.motivo) : u.divergencia ? `Divergência: +${int(u.divergencia)} identificada(s) além do oficial` : u.complemento ? `${int(u.complemento)} Sede/Digital` : 'Confere'}</td></tr>`).join('')}
          <tr class="total"><td colspan="2">Total comparável</td><td class="num">${int(t.oficial)}</td><td class="num">${int(t.identificadas)}</td><td class="num">${int(t.complemento)}</td><td class="num">${int(t.identificadas_apos)}</td><td class="num">${int(t.consolidado)}</td><td>${t.divergencia ? `Divergência total +${int(t.divergencia)}` : ''}</td></tr></tbody></table>
          ${vis.sem_linha.length ? `<p class="rp-nota">Identificadas em itens ausentes da fonte (não considerados zero oficial): ${vis.sem_linha.map(s => `${esc(s.nome)} ${int(s.identificadas)}`).join(' · ')}.</p>` : ''}
          ${vis.fora.length ? `<p class="rp-nota">Fora do cálculo: ${vis.fora.map(f => `${esc(f.nome_fonte)} (${esc(f.motivo)})`).join(' · ')}.</p>` : ''}
          ${vis.avisos.length ? `<p class="rp-nota">${vis.avisos.map(a => '⚠ ' + esc(a)).join('<br>')}</p>` : ''}`;
      };
      const spaces = d.spaces.length ? `<h2>Spaces encerrados</h2><table class="t"><thead><tr><th>Space</th><th>Posição oficial vigente (polo)</th><th class="num">Oficial</th><th class="num">Sede/Digital</th><th>Posição oficial vigente (produto)</th><th class="num">Oficial</th><th class="num">Sede/Digital</th></tr></thead><tbody>
        ${d.spaces.map(sp => { const c = (x) => x ? `<td>${dataBR(x.data_posicao)}${x.hora_posicao ? ' ' + esc(x.hora_posicao) : ''}</td><td class="num">${int(x.oficial)}</td><td class="num">${int(x.complemento)}</td>` : '<td colspan="3">Sem posição oficial até a data do Space</td>'; return `<tr><td>${esc(sp.nome)} · ${dataBR(sp.data)}</td>${c(sp.por_polo)}${c(sp.por_produto)}</tr>`; }).join('')}</tbody></table>
        <p class="rp-nota">Cada Space usa a última posição com data até o próprio Space. Não há interpolação; uma posição posterior não é usada para um Space encerrado. O complemento é recalculado com as matrículas identificadas hoje até a data da posição.</p>` : '';
      box.innerHTML = `<section class="rel-pagina">${timbreRelatorio('Conciliação com o Mundo Azul', `${ciclo.nome} · ${poloTravado() ? 'Polo ' + nomePor('polos', B.usuario.polo_id) : 'Rede'}`, `Posição em ${dataBR(d.ref)}`)}
        ${d.avisos.map(a => `<p class="rp-nota">⚠ ${esc(a)}</p>`).join('')}
        ${tabela(d.por_polo, 'Por polo (todos os produtos)')}
        ${poloTravado() ? '' : tabela(d.por_produto, 'Por produto (rede)')}
        ${d.cruzamentos.length ? d.cruzamentos.map(x => tabela(x, 'Cruzamento verificado — ' + x.posicao.escopo_rotulo)).join('') : '<h2>Polo × produto</h2><p>Sem cruzamento polo × produto verificado. Os relatórios por polo e produto mantêm apenas as matrículas identificadas; o complemento não é distribuído entre produtos de um polo.</p>'}
        ${spaces}
        <footer class="rel-rodape">Oficial = posição registrada do Mundo Azul (snapshot, não soma). Lançadas até a posição = matrículas lançadas pelos tutores no mesmo recorte, com data até a posição (polo do aluno). Sede/Digital = máx(oficial − lançadas, 0), por linha. Consolidado = lançadas até a data do relatório + Sede/Digital da posição vigente — é o número que entra no realizado dos polos e produtos. As visões por polo e por produto representam o mesmo universo e não devem ser somadas. Rankings de tutores, metas por tutor, campanhas, ticket e RPV continuam calculados apenas com as matrículas lançadas.</footer></section>`;
      document.title = `Conciliação Mundo Azul — ${ciclo.nome}`;
    } catch (e) { if (v === versao) box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  $('#rm-gerar').onclick = gerar; await gerar();
}

// Para a Visão geral por produto: complemento apenas onde a granularidade é de UM produto local.
async function complementoPorProdutoMA(cicloId, ref) {
  const d = await api('/api/ma/conciliacao?' + qs({ ciclo: cicloId, ref }));
  const v = d.por_produto; if (!v) return null;
  const porProduto = {}, agrupados = [];
  for (const u of v.unidades) {
    if (u.comparavel && u.locais.length === 1) porProduto[u.locais[0]] = u;
    else if (u.comparavel) agrupados.push(u);
  }
  return { posicao: v.posicao, porProduto, agrupados, totais: v.totais, sem_linha: v.sem_linha };
}

// ----------------------------------------------------------------------- Sede/Digital por polo × produto
async function quadroSedeHTML(cicloId, ref, relatorio) {
  const d = await api('/api/ma/sede?' + qs({ ciclo: cicloId, ref }));
  const comDados = d.linhas.filter(l => l.fonte);
  if (!comDados.length && !(d.rede && d.rede.fonte)) return relatorio ? `<p>Nenhuma lista de alunos do Mundo Azul importada (ou nenhum aluno com R.A. até ${dataBR(d.ref)}).</p>` : '';
  const prods = B.produtos.filter(p => d.linhas.some(l => l.porProduto[p.id]) || (d.rede && d.rede.porProduto[p.id]));
  const fonteTxt = { cruzamento: 'por produto (polo selecionado no Mundo Azul)', visao_polo: 'só o total do polo', visao_produto: 'visão por produto da rede', deduzido: 'produto deduzido (único produto com Sede/Digital na rede)', cruzamentos: 'soma dos polos lidos', lista: 'lista de alunos do Mundo Azul' };
  const pos = (x) => x.posicoes && x.posicoes.length ? [...new Set(x.posicoes.map(p => `${dataBR(p.data_posicao)}${p.hora_posicao ? ' ' + p.hora_posicao : ''}`))].join(', ') : '';
  const temSP = d.linhas.some(l => l.semProduto) || (d.rede && d.rede.semProduto);
  const tot = (x) => Object.values(x.porProduto).reduce((a, n) => a + n, 0) + (x.semProduto || 0);
  const linhas = comDados.map(l => `<tr><td>${esc(l.polo)}</td>${prods.map(p => `<td class="num">${l.porProduto[p.id] ? int(l.porProduto[p.id]) : '<span class="muted">—</span>'}</td>`).join('')}${temSP ? `<td class="num">${l.semProduto ? int(l.semProduto) : '<span class="muted">—</span>'}</td>` : ''}<td class="num"><b>${int(tot(l))}</b></td><td class="muted"><small>${esc(fonteTxt[l.fonte] || '')}${l.diferenca_visoes ? ` · ${int(l.diferenca_visoes)} a mais na visão por polo, sem produto no print do polo` : ''} · ${pos(l)}</small></td></tr>`).join('');
  const soma = (pid) => comDados.reduce((a, l) => a + (l.porProduto[pid] || 0), 0);
  const tabela = `<table class="t"><thead><tr><th>Polo</th>${prods.map(p => `<th class="num">${esc(p.nome)}</th>`).join('')}${temSP ? '<th class="num">Produto não informado</th>' : ''}<th class="num">Total Sede/Digital</th><th>Fonte</th></tr></thead><tbody>${linhas}
    <tr class="total"><td>Soma dos polos</td>${prods.map(p => `<td class="num">${int(soma(p.id))}</td>`).join('')}${temSP ? `<td class="num">${int(comDados.reduce((a, l) => a + (l.semProduto || 0), 0))}</td>` : ''}<td class="num">${int(comDados.reduce((a, l) => a + tot(l), 0))}</td><td></td></tr>
    ${d.rede && d.rede.fonte === 'visao_produto' ? `<tr><td>Rede (visão por produto)</td>${prods.map(p => `<td class="num">${d.rede.porProduto[p.id] ? int(d.rede.porProduto[p.id]) : '—'}</td>`).join('')}<td class="num">${d.rede.semProduto ? int(d.rede.semProduto) : '—'}</td><td class="num">${int(tot(d.rede))}</td><td class="muted"><small>${pos(d.rede)}</small></td></tr>` : ''}</tbody></table>`;
  const nota = `Sede/Digital = alunos com R.A. na lista do Mundo Azul (data do pagamento até a consulta) que não estão lançados no sistema pelos tutores. Vem só da planilha importada em Conferência › Mundo Azul.`;
  return relatorio ? `${tabela}<p class="rp-nota">${nota}</p>` : `<div class="card mt"><div class="card-cab"><h2>Sede/Digital por polo e produto</h2><span class="muted">em ${dataBR(d.ref)} · <a href="#/relatorio-sede-digital" target="_blank" rel="noopener">relatório</a></span></div><div class="corpo sem-pad" style="overflow-x:auto">${tabela}</div><div class="nota">${nota}</div></div>`;
}
async function renderQuadroSede(box, cicloId, ref) { if (!box) return; try { box.innerHTML = await quadroSedeHTML(cicloId, ref, false); } catch (e) { box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; } }
async function telaRelatorioSedeDigital() {
  const app = $('#app'), ciclo = cicloAtual();
  app.innerHTML = `<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>Sede/Digital por polo e produto</b><label>Posição em <input type="date" id="sd-ref" value="${posicaoAtual()}"></label><button class="btn prim" id="sd-gerar">Gerar relatório</button><button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button></div><div id="sd-conteudo" class="rel"></div>`;
  async function gerar() {
    const ref = $('#sd-ref').value, box = $('#sd-conteudo');
    box.innerHTML = '<div class="carregando">Montando relatório…</div>';
    try { box.innerHTML = `<section class="rel-pagina">${timbreRelatorio('Matrículas Sede/Digital', `${ciclo.nome} · ${poloTravado() ? 'Polo ' + nomePor('polos', B.usuario.polo_id) : 'Rede'}`, `Posição em ${dataBR(ref)}`)}${await quadroSedeHTML(ciclo.id, ref, true)}</section>`; document.title = `Sede/Digital — ${ciclo.nome}`; }
    catch (e) { box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
  }
  $('#sd-gerar').onclick = gerar; await gerar();
}

// ----------------------------------------------------------------------- grade polo × produto (igual à grade de metas)
// Cada linha = leitura do Mundo Azul com aquele polo selecionado. Gera uma posição "por produto com o polo selecionado" por polo.
// Célula vazia = não informado (não é zero). Colunas coladas guardam o nome original da fonte.
function modalGradeMA(ciclo, depois) {
  const polos = B.polos.filter(p => p.ativo), prods = B.produtos.filter(p => p.ativo);
  const cel = {}; // `${polo}-${prod}` → [{ nome_fonte, quantidade }]
  const k = (po, pr) => `${po}-${pr}`;
  const f = { data_posicao: B.hoje, hora_posicao: '', origem: 'imagem', obs: '', confirmou: false, evidencia: '' };
  let previas = null;
  const md = abrirModal('<div id="gm"></div>', 1240), box = $('#gm', md);
  const somaCel = (po, pr) => { const c = cel[k(po, pr)]; return c && c.length ? c.reduce((a, x) => a + x.quantidade, 0) : null; };
  const lerTopo = () => { for (const n of ['data_posicao', 'hora_posicao', 'origem', 'obs', 'evidencia']) { const el = $('#gm-' + n, box); if (el) f[n] = el.value; } const c = $('#gm-confirmou', box); if (c) f.confirmou = c.checked; };
  const lerGrade = () => $$('[data-cel]', box).forEach(i => {
    const [po, pr] = i.dataset.cel.split('-').map(Number), atual = somaCel(po, pr), v = i.value.trim();
    if (v === '') { delete cel[k(po, pr)]; return; }
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n !== atual) cel[k(po, pr)] = [{ nome_fonte: nomePor('produtos', pr), quantidade: n }];
  });
  function renderGrade() {
    box.innerHTML = `<header><h3>Mundo Azul — grade polo × produto</h3></header><div class="corpo">
      <div class="info">Uma linha por polo, lida no Mundo Azul <b>com o polo selecionado</b> (filtro Polo ou “…” › Mostrar como uma tabela). Cole o texto que o Claude gerar (ou digite). <b>Célula vazia = não informado</b> (não vira zero). Nada é gravado antes da revisão.</div>
      <div class="linha-acoes" style="flex-wrap:wrap;gap:10px">
        <label class="campo" style="max-width:160px"><span>Data da posição</span><input type="date" id="gm-data_posicao" max="${B.hoje}" value="${f.data_posicao}"></label>
        <label class="campo" style="max-width:120px"><span>Hora (“Dados atualizados”)</span><input type="time" id="gm-hora_posicao" value="${f.hora_posicao}"></label>
        <label class="campo" style="max-width:190px"><span>Origem</span><select id="gm-origem">${Object.entries(MA_ORIGENS).map(([v, n]) => `<option value="${v}" ${v === f.origem ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="campo" style="flex:1;min-width:220px"><span>Observação</span><input type="text" id="gm-obs" value="${esc(f.obs)}" placeholder="Ex.: Captação EAD › Matrículas · Período 2027-51 · prints enviados ao Claude"></label>
        <button class="btn" id="gm-colar">Colar texto / Excel</button></div>
      <div style="overflow-x:auto;margin-top:8px"><table class="t"><thead><tr><th>Polo</th>${prods.map(p => `<th class="num">${esc(p.nome)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
      ${polos.map(po => { let tot = 0, tem = false; const tds = prods.map(pr => { const v = somaCel(po.id, pr.id); if (v != null) { tot += v; tem = true; }
          const c = cel[k(po.id, pr.id)] || [], tit = c.map(x => `${x.nome_fonte}: ${x.quantidade}`).join(' · ');
          if (!po.produtos.includes(pr.id) && v == null) return '<td class="num muted" title="Polo não vende este produto">—</td>';
          return `<td class="num"><input class="qtd" type="number" min="0" step="1" style="width:62px" data-cel="${po.id}-${pr.id}" value="${v ?? ''}" title="${esc(tit)}">${c.length > 1 ? '<br><small class="muted">agrupa ' + c.length + '</small>' : ''}</td>`; }).join('');
        return `<tr><td>${esc(po.nome)}</td>${tds}<td class="num"><b>${tem ? int(tot) : '—'}</b></td></tr>`; }).join('')}</tbody></table></div>
      <label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input type="checkbox" id="gm-confirmou" ${f.confirmou ? 'checked' : ''}> <span>Cada linha preenchida foi lida no Mundo Azul <b>com aquele polo selecionado</b> (números do recorte, não a barra cinza).</span></label>
      <label class="campo" style="margin-top:6px"><span>Como foi lido</span><input type="text" id="gm-evidencia" value="${esc(f.evidencia)}" placeholder="Ex.: prints de cada polo filtrado (painel FILTROS › Polo), lidos pelo Claude"></label>
      </div><footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="gm-revisar">Revisar antes de gravar</button></footer>`;
    $$('[data-fechar]', box).forEach(b => { b.onclick = fecharModal; });
    $$('[data-cel]', box).forEach(i => { i.onchange = () => { lerTopo(); lerGrade(); renderGrade(); }; });
    $('#gm-colar', box).onclick = () => { lerTopo(); lerGrade(); colar(); };
    $('#gm-revisar', box).onclick = () => { lerTopo(); lerGrade(); revisar(); };
  }
  function colar() {
    const m2 = document.createElement('div');
    m2.className = 'modal-fundo'; m2.style.zIndex = 1001;
    m2.innerHTML = `<div class="modal" style="max-width:760px"><header><h3>Colar grade do Mundo Azul</h3></header><div class="corpo">
      <div class="info">Primeira linha = títulos (Polo e os produtos como aparecem no Mundo Azul); uma linha por polo. Separador: tabulação ou ponto e vírgula. Ex.:<br><code>Polo;PÓS-GRADUAÇÃO;PÓS SAÚDE E BEM-ESTAR<br>BATATAIS SP;1;<br>FRANCA SP;;1</code><br>Uma linha <code>Data;28/10/2026 10:12</code> preenche data e hora.</div>
      <textarea id="gc-txt" rows="10" style="font-family:var(--mono);font-size:12.5px"></textarea><div id="gc-msg"></div></div>
      <footer><button class="btn" id="gc-cancel">Cancelar</button><button class="btn prim" id="gc-ok">Aplicar na grade</button></footer></div>`;
    document.body.appendChild(m2);
    const fechar = () => m2.remove();
    $('#gc-cancel', m2).onclick = fechar;
    setTimeout(() => $('#gc-txt', m2).focus(), 30);
    $('#gc-ok', m2).onclick = async () => {
      const brutas = $('#gc-txt', m2).value.split(/\r?\n/).filter(l => l.trim());
      const sep = brutas.some(l => l.includes('\t')) ? '\t' : ';';
      let linhas = brutas.map(l => l.split(sep).map(x => x.trim()));
      const dl = linhas.find(l => /^data$/i.test(l[0]));
      if (dl) { const mt = String(dl[1] || '').match(/(\d{2})\/(\d{2})\/(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/); if (mt) { f.data_posicao = `${mt[3].length === 2 ? '20' + mt[3] : mt[3]}-${mt[2]}-${mt[1]}`; if (mt[4]) f.hora_posicao = `${mt[4].padStart(2, '0')}:${mt[5]}`; } }
      linhas = linhas.filter(l => !/^data$/i.test(l[0]));
      if (linhas.length < 2) { $('#gc-msg', m2).innerHTML = '<div class="erro-box">Cole a linha de títulos e ao menos um polo.</div>'; return; }
      const cab = linhas[0];
      let sug = [];
      try { sug = await api('/api/ma/sugestoes', { method: 'POST', body: { tipo: 'produto', nomes: cab.slice(1).filter(Boolean) } }); } catch { /* sem sugestão */ }
      const achaProd = (t) => { const s1 = sug.find(x => x.nome_fonte === t && x.local_ids.length === 1); if (s1) return prods.find(p => p.id === s1.local_ids[0]);
        const n = normalizar(t), b = nomeBaseProd(t); return prods.find(p => normalizar(p.nome) === n || normalizar(p.nome) === APELIDOS_PROD[n]) || prods.find(p => nomeBaseProd(p.nome) === b); };
      const semUF = (t) => normalizar(String(t).replace(/\s+(sp|mg|pr|rj|go|ms|mt|ba|sc|rs)$/i, ''));
      const achaPolo = (t) => polos.find(p => normalizar(p.nome) === normalizar(t) || normalizar(p.nome) === semUF(t) || String(p.apelidos || '').split(/[,;]/).some(a => a.trim() && normalizar(a) === semUF(t)));
      const colProd = cab.map((t, i) => i === 0 ? null : achaProd(t));
      const ignorados = cab.slice(1).filter((t, i) => t && !colProd[i + 1] && !/total/i.test(t));
      const semPolo = []; let n = 0;
      for (const l of linhas.slice(1)) {
        const po = achaPolo(l[0]);
        if (!po) { if (l[0] && !/total|geral|rede/i.test(l[0])) semPolo.push(l[0]); continue; }
        for (const pr of prods) delete cel[k(po.id, pr.id)];
        colProd.forEach((pr, i) => {
          if (!pr) return; const v = String(l[i] ?? '').trim(); if (v === '') return;
          const q = Number(v.replace(/\./g, '').replace(',', '.'));
          if (!Number.isInteger(q) || q < 0) return;
          (cel[k(po.id, pr.id)] ??= []).push({ nome_fonte: cab[i], quantidade: q }); n++;
        });
      }
      if (!n) { $('#gc-msg', m2).innerHTML = '<div class="erro-box">Não reconheci polos/produtos. Confira os títulos.</div>'; return; }
      fechar(); renderGrade();
      toast(`${n} valor(es) aplicados — confira a grade`);
      if (ignorados.length || semPolo.length) toast(`Não reconhecidos: ${[...ignorados, ...semPolo].join(', ')}`, true);
    };
  }
  const corpoPolo = (po) => {
    const linhas = [];
    for (const pr of prods) for (const x of (cel[k(po.id, pr.id)] || [])) linhas.push({ nome_fonte: x.nome_fonte, quantidade: x.quantidade, leitura: 'ok', local_ids: [pr.id], obs: '' });
    if (!linhas.length) return null;
    return { ciclo_id: ciclo.id, dimensao: 'produto', escopo_tipo: 'polo', escopo_ids: [po.id], escopo_fonte: po.nome, cruzamento_verificado: true,
      cruzamento_evidencia: f.evidencia || 'Grade polo × produto: linha lida com o polo selecionado', data_posicao: f.data_posicao, hora_posicao: f.hora_posicao,
      origem: f.origem, total_fonte: linhas.reduce((a, l) => a + l.quantidade, 0), obs: f.obs, linhas };
  };
  async function revisar() {
    if (!f.confirmou) { toast('Marque que cada linha foi lida com o polo selecionado', true); return; }
    const itens = polos.map(po => ({ po, corpo: corpoPolo(po) })).filter(x => x.corpo);
    if (!itens.length) { toast('Preencha ao menos um polo', true); return; }
    try { previas = await Promise.all(itens.map(async x => ({ ...x, pv: await api('/api/ma/previa', { method: 'POST', body: x.corpo }) }))); }
    catch (e) { toast(e.message, true); return; }
    const conflitos = previas.filter(x => x.pv.conflito);
    box.innerHTML = `<header><h3>Revisão — nada foi gravado ainda</h3></header><div class="corpo">
      <p>Posição de <b>${dataBR(f.data_posicao)}${f.hora_posicao ? ' ' + esc(f.hora_posicao) : ''}</b> · ${esc(MA_ORIGENS[f.origem])} · ${esc(ciclo.nome)} · ${previas.length} polo(s)</p>
      <table class="t"><thead><tr><th>Polo</th><th>No Mundo Azul</th><th class="num">Oficial</th><th class="num">Lançadas pelos tutores</th><th class="num">Sede/Digital</th><th>Situação</th></tr></thead><tbody>
      ${previas.map(x => { const c = x.pv.calculo; return `<tr><td>${esc(x.po.nome)}</td><td>${c.unidades.map(u => `${esc(u.fonte.map(z => z.nome + ' ' + z.quantidade).join(' + '))} → ${esc(u.nomes_locais.join(' + '))}`).join('<br>')}</td>
        <td class="num">${int(c.totais.oficial_lido)}</td><td class="num">${int(c.unidades.reduce((a, u) => a + u.identificadas, 0))}</td><td class="num"><b>${c.unidades.every(u => u.comparavel) ? int(c.totais.complemento) : '—'}</b></td>
        <td>${x.pv.ja_registrada ? '<span class="tag cinza mini">já registrada — não soma</span>' : x.pv.conflito ? '<span class="tag warn mini">substitui posição anterior</span>' : c.unidades.some(u => !u.comparavel) ? `<span class="tag warn mini">${esc(c.unidades.find(u => !u.comparavel).motivo)}</span>` : c.totais.divergencia ? `<span class="tag bad mini">divergência +${int(c.totais.divergencia)}</span>` : '<span class="tag ok mini">ok</span>'}</td></tr>`; }).join('')}</tbody></table>
      ${conflitos.length ? `<div class="aviso">${conflitos.length} polo(s) já têm posição desta mesma data e hora com outros números. Elas serão marcadas como <b>substituídas</b> (ficam no histórico).<label class="campo" style="margin-top:6px"><span>Motivo da substituição</span><input type="text" id="gm-motivo" value="Correção pela grade polo × produto"></label></div>` : ''}
      ${previas.some(x => x.pv.calculo.unidades.some(u => u.agrupado && !u.agrupamento_verificado)) ? '<div class="aviso">Há nomes diferentes da fonte juntos no mesmo produto sem agrupamento verificado: essas linhas ficam sem Sede/Digital até um administrador verificar (Correspondência de nomes da fonte).</div>' : ''}
      <label style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="gm-conferi"> <span>Conferi a grade com os prints do Mundo Azul.</span></label>
      </div><footer><button class="btn" id="gm-voltar">‹ Voltar e editar</button><button class="btn prim" id="gm-gravar">Confirmar e gravar ${previas.filter(x => !x.pv.ja_registrada).length} polo(s)</button></footer>`;
    $('#gm-voltar', box).onclick = renderGrade;
    $('#gm-gravar', box).onclick = async () => {
      if (!$('#gm-conferi', box).checked) { toast('Marque que conferiu a grade', true); return; }
      const motivo = $('#gm-motivo', box) ? $('#gm-motivo', box).value : '';
      let ok = 0, iguais = 0; const erros = [];
      for (const x of previas) {
        if (x.pv.ja_registrada) { iguais++; continue; }
        try { await api('/api/ma/posicoes', { method: 'POST', body: { ...x.corpo, confirmado: true, ...(x.pv.conflito ? { substituir_id: x.pv.conflito.id, motivo } : {}) } }); ok++; }
        catch (e) { erros.push(`${x.po.nome}: ${e.message}`); }
      }
      fecharModal();
      toast(`${ok} polo(s) gravado(s)${iguais ? ` · ${iguais} já estavam registrados` : ''}`);
      if (erros.length) toast(erros.join(' · '), true);
      depois();
    };
  }
  renderGrade();
}

// ----------------------------------------------------------------------- colar a leitura da tela do Mundo Azul (os dois gráficos de uma vez)
// Texto gerado pelo Claude a partir de UM print da tela:
//   Data;28/10/2026 10:12
//   POLO;QTD        (linhas do gráfico por polo)
//   PRODUTO;QTD     (linhas do gráfico por produto)
// Grava duas posições da rede: por polo e por produto. Linha ausente não vira zero.
function modalLeituraMA(ciclo, depois) {
  const md = abrirModal('<div id="lm"></div>', 900), box = $('#lm', md);
  let dados = null, previas = null;
  function entrada() {
    box.innerHTML = `<header><h3>Colar leitura do Mundo Azul</h3></header><div class="corpo">
      <div class="info">Mande o print da tela do Mundo Azul (gráficos <b>por polo</b> e <b>por produto</b>, sem polo selecionado) ao Claude e cole aqui o texto que ele devolver. Ex.:<br>
      <code>Data;28/10/2026 10:12<br>POLO;QTD<br>BATATAIS SP;1<br>FRANCA SP;1<br>PRODUTO;QTD<br>PÓS-GRADUAÇÃO;1<br>PÓS SAÚDE E BEM-ESTAR;1</code></div>
      <textarea id="lm-txt" rows="12" style="font-family:var(--mono);font-size:12.5px" placeholder="Cole aqui…"></textarea>
      <label class="campo" style="margin-top:8px"><span>Observação</span><input type="text" id="lm-obs" placeholder="Ex.: print da tela Indicadores › Matrículas, período 2027-51"></label>
      </div><footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="lm-ler">Ler e revisar</button></footer>`;
    $$('[data-fechar]', box).forEach(b => { b.onclick = fecharModal; });
    setTimeout(() => $('#lm-txt', box).focus(), 30);
    $('#lm-ler', box).onclick = ler;
  }
  async function ler() {
    const obs = $('#lm-obs', box).value.trim();
    const linhas = $('#lm-txt', box).value.split(/\r?\n/).map(l => l.split(/\t|;/).map(x => x.trim())).filter(l => l.some(Boolean));
    let data = B.hoje, hora = '', secao = null; const sec = { polo: [], produto: [] }, total = { polo: null, produto: null };
    for (const l of linhas) {
      const c0 = normalizar(l[0]);
      if (c0 === 'data' || /dadosatualizados/.test(c0)) { const mt = l.slice(1).join(' ').match(/(\d{2})\/(\d{2})\/(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/); if (mt) { data = `${mt[3].length === 2 ? '20' + mt[3] : mt[3]}-${mt[2]}-${mt[1]}`; if (mt[4]) hora = `${mt[4].padStart(2, '0')}:${mt[5]}`; } continue; }
      if (['polo', 'polos', 'nmunidade', 'unidade'].includes(c0)) { secao = 'polo'; continue; }
      if (['produto', 'produtos', 'dsnivel', 'nivel'].includes(c0)) { secao = 'produto'; continue; }
      if (!secao) continue;
      const q = Number(String(l[1] ?? '').replace(/\./g, '').replace(',', '.'));
      if (/^total/.test(c0)) { if (Number.isInteger(q)) total[secao] = q; continue; }
      if (!l[0] || !Number.isInteger(q) || q < 0) continue;
      sec[secao].push({ nome_fonte: l[0], quantidade: q });
    }
    if (!sec.polo.length && !sec.produto.length) { toast('Não encontrei as linhas POLO;QTD / PRODUTO;QTD no texto', true); return; }
    const sugere = async (tipo) => { if (!sec[tipo].length) return []; try { return await api('/api/ma/sugestoes', { method: 'POST', body: { tipo, nomes: sec[tipo].map(x => x.nome_fonte) } }); } catch { return []; } };
    const [sp, sr] = await Promise.all([sugere('polo'), sugere('produto')]);
    for (const [tipo, sug] of [['polo', sp], ['produto', sr]]) for (const l of sec[tipo]) { const s1 = sug.find(x => x.nome_fonte === l.nome_fonte); l.local_ids = s1 ? s1.local_ids : []; }
    dados = { data, hora, obs, sec, total };
    await revisar();
  }
  const corpoDe = (tipo) => ({ ciclo_id: ciclo.id, dimensao: tipo, escopo_tipo: 'rede', data_posicao: dados.data, hora_posicao: dados.hora, origem: 'imagem',
    total_fonte: dados.total[tipo] ?? dados.sec[tipo].reduce((a, x) => a + x.quantidade, 0), obs: dados.obs || 'Leitura do print do Mundo Azul (texto gerado pelo Claude)',
    linhas: dados.sec[tipo].map(x => ({ nome_fonte: x.nome_fonte, quantidade: x.quantidade, leitura: 'ok', local_ids: x.local_ids, obs: '' })) });
  async function revisar() {
    const tipos = ['polo', 'produto'].filter(t => dados.sec[t].length);
    try { previas = await Promise.all(tipos.map(async t => ({ tipo: t, corpo: corpoDe(t), pv: await api('/api/ma/previa', { method: 'POST', body: corpoDe(t) }) }))); }
    catch (e) { toast(e.message, true); return; }
    const sel = (tipo, i, l) => l.local_ids.length ? esc(l.local_ids.map(id => maNomeLocal(tipo, id)).join(' + '))
      : `<select data-map="${tipo}:${i}"><option value="">escolher…</option>${maLocais(tipo).filter(x => x.ativo).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select>`;
    box.innerHTML = `<header><h3>Revisão — nada foi gravado ainda</h3></header><div class="corpo">
      <p>Posição de <b>${dataBR(dados.data)}${dados.hora ? ' ' + esc(dados.hora) : ' (sem hora)'}</b> · ${esc(ciclo.nome)}</p>
      <div class="grid g2" style="align-items:start">${previas.map(x => { const c = x.pv.calculo; return `<div><h4 style="margin:4px 0">${x.tipo === 'polo' ? 'Por polo' : 'Por produto'} ${x.pv.ja_registrada ? '<span class="tag cinza mini">já registrada — não soma</span>' : x.pv.conflito ? '<span class="tag warn mini">substitui a anterior</span>' : ''}</h4>
        <table class="t"><thead><tr><th>Mundo Azul</th><th>No sistema</th><th class="num">Oficial</th><th class="num">Lançadas</th><th class="num">Sede/Digital</th></tr></thead><tbody>
        ${dados.sec[x.tipo].map((l, i) => { const u = c.unidades.find(z => z.fonte.some(f => f.nome === l.nome_fonte)); return `<tr><td>${esc(l.nome_fonte)}</td><td>${sel(x.tipo, i, l)}</td><td class="num">${int(l.quantidade)}</td><td class="num">${u ? int(u.identificadas) : '—'}</td><td class="num">${u && u.comparavel ? (u.agrupado && u.fonte[0].nome !== l.nome_fonte ? '↑' : `<b>${int(u.complemento)}</b>`) : u ? `<small class="muted">${esc(u.motivo)}</small>` : '—'}</td></tr>`; }).join('')}
        <tr class="total"><td>Total</td><td></td><td class="num">${int(c.soma_linhas)}</td><td></td><td class="num">${int(c.totais.complemento)}</td></tr></tbody></table>
        ${c.avisos.filter(a => !/Total da fonte não informado/.test(a)).map(a => `<div class="nota">⚠ ${esc(a)}</div>`).join('')}</div>`; }).join('')}</div>
      <label style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="lm-conferi"> <span>Conferi com o print do Mundo Azul.</span></label>
      </div><footer><button class="btn" id="lm-voltar">‹ Voltar</button><button class="btn prim" id="lm-gravar">Confirmar e gravar</button></footer>`;
    $('#lm-voltar', box).onclick = entrada;
    $$('[data-map]', box).forEach(s => { s.onchange = async () => { const [t, i] = s.dataset.map.split(':'); dados.sec[t][Number(i)].local_ids = s.value ? [Number(s.value)] : []; await revisar(); }; });
    $('#lm-gravar', box).onclick = async () => {
      if (!$('#lm-conferi', box).checked) { toast('Marque que conferiu com o print', true); return; }
      let ok = 0, iguais = 0; const erros = [];
      for (const x of previas) {
        if (x.pv.ja_registrada) { iguais++; continue; }
        try { await api('/api/ma/posicoes', { method: 'POST', body: { ...corpoDe(x.tipo), confirmado: true, ...(x.pv.conflito ? { substituir_id: x.pv.conflito.id, motivo: 'Nova leitura do mesmo horário' } : {}) } }); ok++; }
        catch (e) { erros.push(e.message); }
      }
      fecharModal(); toast(`${ok} gráfico(s) gravado(s)${iguais ? ` · ${iguais} já estava(m) registrado(s)` : ''}`);
      if (erros.length) toast(erros.join(' · '), true);
      depois();
    };
  }
  entrada();
}


// ----------------------------------------------------------------------- lista de alunos do Mundo Azul (Excel)
// O Excel é lido NO NAVEGADOR: só as colunas usadas na contagem vão para o sistema.
// Telefone, e-mail e endereço ficam de fora.
async function lerXlsxMA(arquivo) {
  const buf = new Uint8Array(await arquivo.arrayBuffer()), dv = new DataView(buf.buffer);
  if (/\.csv$/i.test(arquivo.name) || buf[0] !== 0x50) {
    const txt = new TextDecoder(/�/.test(new TextDecoder().decode(buf.slice(0, 4000))) ? 'iso-8859-1' : 'utf-8').decode(buf);
    const sep = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return txt.split(/\r?\n/).filter(l => l.trim()).map(l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); });
  }
  // zip: diretório central
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo não parece um Excel (.xlsx) válido');
  const n = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true); const arqs = {};
  for (let i = 0; i < n; i++) {
    const metodo = dv.getUint16(off + 10, true), tam = dv.getUint32(off + 20, true), ln = dv.getUint16(off + 28, true), le = dv.getUint16(off + 30, true), lc = dv.getUint16(off + 32, true), loc = dv.getUint32(off + 42, true);
    const nome = new TextDecoder().decode(buf.slice(off + 46, off + 46 + ln)); arqs[nome] = { metodo, tam, loc }; off += 46 + ln + le + lc;
  }
  const ler = async (nome) => {
    const a = arqs[nome]; if (!a) return null;
    const ini = a.loc + 30 + dv.getUint16(a.loc + 26, true) + dv.getUint16(a.loc + 28, true), dados = buf.slice(ini, ini + a.tam);
    if (a.metodo === 0) return new TextDecoder().decode(dados);
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx. Use o Chrome atualizado ou salve como CSV.');
    const st = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(st).text();
  };
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const ss = []; const sst = await ler('xl/sharedStrings.xml');
  if (sst) for (const si of xml(sst).getElementsByTagName('si')) ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  // primeira planilha do livro
  let caminho = 'xl/worksheets/sheet1.xml';
  try { const wb = xml(await ler('xl/workbook.xml')), rels = xml(await ler('xl/_rels/workbook.xml.rels')); const s1 = wb.getElementsByTagName('sheet')[0]; const rid = s1.getAttribute('r:id') || s1.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const r = [...rels.getElementsByTagName('Relationship')].find(x => x.getAttribute('Id') === rid); if (r) caminho = 'xl/' + r.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, ''); } catch {}
  const sh = await ler(caminho); if (!sh) throw new Error('Planilha não encontrada no arquivo');
  const col = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; for (const ch of (m ? m[1] : 'A')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const linhas = [];
  for (const row of xml(sh).getElementsByTagName('row')) {
    const out = [];
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
      let val = t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : v ? v.textContent : '';
      if (t === 's') val = ss[Number(val)] ?? '';
      out[col(c.getAttribute('r'))] = val;
    }
    linhas.push(Array.from(out, x => x ?? ''));
  }
  return linhas;
}
const MA_LISTA_COLS = { candidato: ['candidato'], concurso: ['concurso'], unidade: ['unidade'], ra: ['aluno', 'ra'], nome: ['nome'], curso_cod: ['curso'], curso_nome: ['nome curso'], polo_fonte: ['polo'],
  cpf: ['cpf'], data_pagto: ['mensalidade pagto', 'mensalidade. pagto', 'data pagamento'], data_inscricao: ['data inscricao'], inscrito_por: ['inscrito por'], celular: ['celular'], fone: ['fone', 'telefone'] };
function linhasListaMA(tabela) {
  const nz = (t) => normalizar(String(t || '')).replace(/[^a-z0-9]+/g, ' ').trim();
  const iCab = tabela.findIndex(l => l.some(x => nz(x) === 'candidato'));
  if (iCab < 0) throw new Error('Não encontrei a coluna "Candidato". Use Consultar candidatos › Gerar Excel.');
  const cab = tabela[iCab].map(nz), idx = {};
  for (const [k, nomes] of Object.entries(MA_LISTA_COLS)) idx[k] = cab.findIndex(h => nomes.map(nz).includes(h));
  for (const k of ['candidato', 'ra', 'polo_fonte', 'curso_cod']) if (idx[k] < 0) throw new Error(`Coluna obrigatória não encontrada: ${MA_LISTA_COLS[k][0]}`);
  // data do Excel pode vir como número de série
  const data = (v) => { const t = String(v ?? '').trim(); if (/^\d{5}(\.\d+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 864e5); return d.toISOString().slice(0, 10); } return t; };
  // só o celular (normalizado) de quem tem R.A. vai para o sistema; fixo, e-mail e endereço ficam de fora
  return tabela.slice(iCab + 1).filter(l => l[idx.candidato]).map(l => { const o = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i < 0 ? '' : (/^data_/.test(k) ? data(l[i]) : String(l[i] ?? '').trim())]));
    o.celular = celularMA(o.celular, o.fone) || ''; delete o.fone; return o; });
}
function modalListaMA(ciclo, depois) {
  const md = abrirModal('<div id="ml"></div>', 1000), box = $('#ml', md);
  let linhas = [], nomes = [], pv = null;
  box.innerHTML = `<header><h3>Importar lista de alunos do Mundo Azul</h3><button class="btn icone" data-fechar>✕</button></header><div class="corpo">
    <div class="info">No Mundo Azul: <b>Captação › Consultar candidatos</b>, escolha a Unidade de Ensino e o Período, <b>Aplicar Filtros</b> e <b>Gerar Excel</b>. Pode escolher <b>vários arquivos de uma vez</b> (ex.: Graduação e Técnico).<br>
    Conta como matrícula quem tem <b>R.A.</b> Quem tem R.A. e não está lançado no sistema vira <b>Sede/Digital</b> no polo e no produto. Importar de novo <b>não soma</b>: o número do candidato é a chave.</div>
    <label class="campo"><span>Arquivos do Mundo Azul (.xlsx ou .csv)</span><input type="file" id="ml-arq" accept=".xlsx,.csv" multiple></label>
    <p class="muted" style="font-size:12px">O arquivo é lido aqui no navegador. O sistema guarda nome, CPF, R.A., curso, polo, datas e celular para acompanhar oportunidades e inscrições. E-mail e endereço não são enviados nem guardados.</p>
    <div id="ml-prev"></div></div>
    <footer><button class="btn" data-fechar>Cancelar</button><button class="btn prim" id="ml-ok" disabled>Importar</button></footer>`;
  $$('[data-fechar]', box).forEach(b => { b.onclick = fecharModal; });
  $('#ml-arq', box).onchange = async (e) => {
    const fs = [...e.target.files]; if (!fs.length) return;
    $('#ml-prev', box).innerHTML = '<div class="carregando">Lendo…</div>';
    try {
      linhas = []; nomes = fs.map(f => f.name);
      for (const f of fs) linhas.push(...linhasListaMA(await lerXlsxMA(f)));
      pv = await api('/api/ma/lista/previa', { method: 'POST', body: { ciclo: ciclo.id, linhas } });
      mostrar();
    } catch (err) { $('#ml-prev', box).innerHTML = `<div class="erro-box">${esc(err.message)}</div>`; $('#ml-ok', box).disabled = true; }
  };
  const ORIG = { dicionario: 'já salvo', curso_cadastrado: 'pelo cadastro de cursos', codigo: 'pelo código do curso', mesmo_nome: 'mesmo nome já salvo', unidade: 'pela unidade', sem_correspondencia: '' };
  function mostrar() {
    const prods = B.produtos.filter(p => p.ativo);
    const optP = (sel) => `<option value="">— escolha —</option>${prods.map(p => `<option value="${p.id}" ${Number(sel) === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}`;
    const novosPolos = pv.polos.filter(p => !p.salvo);
    $('#ml-prev', box).innerHTML = `
      <div class="rel-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div><span>Linhas</span><b>${int(pv.linhas)}</b><em>${esc(pv.unidades.join(', '))}</em></div><div><span>Com R.A. (matrícula)</span><b>${int(pv.com_ra)}</b><em>${int(pv.sem_ra)} sem R.A. ficam de fora</em></div><div><span>Novas na lista</span><b>${int(pv.novos)}</b><em>${int(pv.ja_importados)} já importadas — atualizadas, não somam</em></div><div><span>Saíram da lista</span><b>${int(pv.sairam)}</b><em>${pv.sairam ? 'deixam de contar (mesma unidade)' : 'nenhuma'}</em></div></div>
      ${pv.duplicados ? `<div class="aviso">${int(pv.duplicados)} linha(s) repetida(s) nos arquivos — contam uma vez.</div>` : ''}
      ${novosPolos.length ? `<h4>Polos do Mundo Azul</h4><table class="t"><thead><tr><th>No Mundo Azul</th><th>No sistema</th><th class="num">Com R.A.</th></tr></thead><tbody>${novosPolos.map(p => `<tr><td>${esc(p.polo_fonte)}</td><td><select data-polo="${esc(p.polo_fonte)}"><option value="">— escolha —</option>${B.polos.filter(x => x.ativo).map(x => `<option value="${x.id}" ${p.sugerido === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></td><td class="num">${int(p.com_ra)}</td></tr>`).join('')}</tbody></table>` : ''}
      <h4>Cursos → produto do sistema</h4><p class="muted" style="font-size:12px;margin-top:0">Confira principalmente os semipresenciais (ESPRE_…) e os híbridos. A escolha fica salva para as próximas importações.</p>
      <div style="max-height:340px;overflow:auto"><table class="t"><thead><tr><th>Curso no Mundo Azul</th><th>Produto</th><th>Como foi sugerido</th><th class="num">Com R.A.</th></tr></thead><tbody>
      ${[...pv.cursos].sort((a, b) => (a.produto_id ? 1 : 0) - (b.produto_id ? 1 : 0) || a.curso_cod.localeCompare(b.curso_cod)).map(c => `<tr><td><b>${esc(c.curso_nome || c.curso_cod)}</b><br><small class="muted">${esc(c.curso_cod)} · ${esc(c.unidade)}</small></td><td><select data-curso="${esc(c.curso_cod)}">${optP(c.produto_id)}</select></td><td class="muted"><small>${esc(ORIG[c.origem] || '')}${c.curso_sistema ? ': ' + esc(c.curso_sistema) : ''}</small></td><td class="num">${int(c.com_ra)}</td></tr>`).join('')}</tbody></table></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="ml-conf"> Conferi os cursos e polos acima</label>`;
    const ok = $('#ml-ok', box);
    const valida = () => { ok.disabled = !$('#ml-conf', box).checked; };
    $('#ml-conf', box).onchange = valida; valida();
    ok.onclick = async () => {
      const cursos = $$('[data-curso]', box).map(sel => ({ curso_cod: sel.dataset.curso, produto_id: Number(sel.value) || null }));
      const polos = $$('[data-polo]', box).map(sel => ({ polo_fonte: sel.dataset.polo, polo_id: Number(sel.value) || null })).filter(x => x.polo_id);
      const faltam = cursos.filter(x => !x.produto_id).length + ($$('[data-polo]', box).length - polos.length);
      if (faltam && !confirm(`${faltam} curso(s)/polo(s) ficaram sem correspondência. Esses alunos aparecem como "falta ligar" e não somam até você escolher. Importar assim mesmo?`)) return;
      ok.disabled = true;
      try { const r = await api('/api/ma/lista', { method: 'POST', body: { ciclo: ciclo.id, linhas, cursos, polos, arquivo: nomes.join(', '), confirmado: true } }); const extra=r.boas_vindas?.novos?` · ${int(r.boas_vindas.enfileirados)} boas-vindas enfileiradas${r.boas_vindas.erro?' (verifique o Chat e o X-Token)':''}`:r.boas_vindas?.baselined?' · importação inicial salva como base, sem mensagens automáticas':''; toast(`Lista importada: ${int(r.com_ra)} com R.A.${extra}`); fecharModal(); depois && depois(); }
      catch (err) { toast(err.message, true); ok.disabled = false; }
    };
  }
}
async function renderListaMA(box, ciclo, ref, depois) {
  if (!box) return;
  try {
    const d = await api('/api/ma/lista?' + qs({ ciclo: ciclo.id, ref }));
    if (!d.tem) { box.innerHTML = podeLancar() ? '<div class="card mt"><div class="card-cab"><h2>Lista de alunos do Mundo Azul</h2></div><div class="corpo"><p class="muted" style="margin:0">Nenhuma lista importada. Use <b>Importar lista de alunos (Excel)</b>: ela mostra quem são as matrículas Sede/Digital, aluno por aluno.</p></div></div>' : ''; return; }
    const R = d.resumo, st = { sede: '<span class="tag warn mini">Sede/Digital</span>', lancada: '<span class="tag ok mini">lançada</span>', mapear: '<span class="tag bad mini">falta ligar curso/polo</span>' };
    const ordem = { mapear: 0, sede: 1, lancada: 2 };
    const itens = [...d.itens].sort((a, b) => ordem[a.status] - ordem[b.status] || String(a.polo || a.polo_fonte).localeCompare(String(b.polo || b.polo_fonte)) || String(a.nome).localeCompare(String(b.nome)));
    const SIT = { sem_ra: '<span class="tag warn mini">inscrito, sem R.A.</span>', nao_encontrada: '<span class="tag bad mini">não está na lista</span>' };
    const semRa = d.lancadas_sem_ra || [];
    box.innerHTML = `<div class="card mt"><div class="card-cab"><h2>Lista de alunos do Mundo Azul</h2><span class="muted">matrículas com R.A. até ${dataBR(d.ref)}${d.ultima ? ` · última importação ${esc(String(d.ultima.criado_em).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))} (${esc(d.ultima.unidades || '')})` : ''}</span></div>
      <div class="corpo"><div class="rel-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><span>Matrículas no Mundo Azul</span><b>${int(R.com_ra)}</b><em>alunos com R.A.</em></div><div><span>Já lançadas no sistema</span><b>${int(R.lancadas)}</b><em>reconhecidas pelo CPF ou nome + polo</em></div><div><span>Sede/Digital</span><b>${int(R.sede)}</b><em>${R.possivel_dup ? `${int(R.possivel_dup)} com possível duplicidade — confira` : 'somam no polo e no produto'}</em></div>
        <div><span>Lançadas sem R.A. no Mundo Azul</span><b>${int(R.sem_ra)}</b><em>há mais de ${int(d.tolerancia)} dia(s) — veja abaixo</em></div><div><span>Lançadas sem CPF</span><b>${int(R.sem_cpf)}</b><em>${R.sem_cpf ? 'a comparação fica só pelo nome' : 'todas com CPF'}</em></div><div><span>Falta ligar</span><b>${int(R.mapear)}</b><em>${R.mapear ? 'curso ou polo sem correspondência — não somam' : 'tudo ligado'}</em></div></div>
      ${R.sem_cpf && B.config.exigir_cpf !== '1' ? `<div class="aviso">${int(R.sem_cpf)} matrícula(s) lançada(s) sem CPF. Sem CPF o sistema compara pelo nome + polo, e um nome escrito diferente faz o aluno contar duas vezes (tutor e Sede/Digital). ${eAdmin() ? 'Recomendo ligar <a href="#/cadastros/config">Configuração › CPF obrigatório no lançamento</a> e completar o CPF das que faltam.' : 'Peça ao administrador para exigir o CPF.'}</div>` : ''}
      ${R.possivel_dup ? `<div class="aviso">${int(R.possivel_dup)} aluno(s) da Sede/Digital têm nome parecido com uma matrícula lançada no mesmo polo que não foi reconhecida (CPF diferente ou vazio). Se for o mesmo aluno, corrija o CPF ou o nome da matrícula: na próxima consulta ele sai da Sede/Digital.</div>` : ''}
      <p class="muted" style="font-size:12px">Produtos cobertos pela lista: ${d.cobertos.map(x => esc(x.nome)).join(', ') || '—'}. A Sede/Digital vem só daqui; produto que não está em nenhuma planilha importada fica sem Sede/Digital.</p></div>
      <div class="corpo sem-pad" style="overflow-x:auto"><table class="t"><thead><tr><th>Situação</th><th>Aluno</th><th>Curso</th><th>Produto</th><th>Polo</th><th>Data</th><th>Inscrito por</th></tr></thead><tbody>
      ${itens.map(i => `<tr><td>${st[i.status]}${i.status === 'lancada' ? `<br><small class="muted">#${i.matricula_id} · ${i.por_cpf ? 'CPF' : 'nome + polo'}</small>` : ''}${i.possivel_dup ? `<br><span class="tag bad mini" title="Matrícula #${i.possivel_dup.matricula_id} · ${esc(i.possivel_dup.aluno)} · ${dataBR(i.possivel_dup.data)}${i.possivel_dup.tem_cpf ? '' : ' · sem CPF'}">possível duplicidade: #${i.possivel_dup.matricula_id}</span>` : ''}</td><td>${esc(i.nome)}${idAluno(i)}</td><td><small>${esc(i.curso)}</small></td><td>${i.produto ? esc(i.produto) : `<span class="muted">${esc(i.curso_cod)}</span>`}</td><td>${i.polo ? esc(i.polo) : `<span class="muted">${esc(i.polo_fonte)}</span>`}</td><td>${dataBR(i.data)}</td><td class="muted"><small>${esc(i.inscrito_por || '')}</small></td></tr>`).join('')}
      </tbody></table></div>
      <div class="card-cab" style="border-top:1px solid var(--borda,#e2e8f0)"><h2>Lançadas no sistema sem R.A. no Mundo Azul</h2><span class="muted">${semRa.length ? `${int(semRa.length)} matrícula(s), lançadas há mais de ${int(d.tolerancia)} dia(s)` : 'nenhuma'}</span></div>
      ${semRa.length ? `<div class="corpo"><p class="muted" style="margin:0;font-size:12px">Matrícula lançada por tutor, num produto coberto pela lista, que não aparece com R.A. no Mundo Azul. <b>Inscrito, sem R.A.</b> = o aluno está na lista mas ainda não pagou. <b>Não está na lista</b> = confira CPF, nome, polo e produto do lançamento, ou se a matrícula foi feita de fato.</p></div>
      <div class="corpo sem-pad" style="overflow-x:auto"><table class="t"><thead><tr><th>Situação</th><th>Aluno</th><th>Tutor</th><th>Polo</th><th>Produto</th><th>Lançada em</th></tr></thead><tbody>
      ${[...semRa].sort((a, b) => a.data.localeCompare(b.data)).map(i => `<tr><td>${SIT[i.situacao]}</td><td>${esc(i.aluno || '—')}${i.tem_cpf ? '' : ' <small class="tag cinza mini">sem CPF</small>'}${idAluno(i)}<small class="muted">#${i.matricula_id}</small></td><td>${esc(i.tutor || '')}</td><td>${esc(i.polo || '')}</td><td>${esc(i.produto || '')}</td><td>${dataBR(i.data)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
  } catch (e) { box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; }
}

// ----------------------------------------------------------------------- zerar dados do Mundo Azul (administrador)
function modalZerarMA(ciclo, depois) {
  const md = abrirModal('<div id="mz"></div>', 620), box = $('#mz', md);
  async function render() {
    const data = $('#mz-data', box)?.value || '';
    const k = await api('/api/ma/resetar?' + qs({ ciclo: ciclo.id, data }));
    const marcado = (id, padrao) => $('#' + id, box) ? $('#' + id, box).checked : padrao;
    const pos = marcado('mz-pos', true), lis = marcado('mz-lista', true), map = marcado('mz-map', false), conf = $('#mz-conf', box)?.value || '';
    box.innerHTML = `<header><h3>Zerar dados do Mundo Azul</h3><button class="btn icone" data-fechar>✕</button></header><div class="corpo">
      <div class="aviso">Apaga do processo <b>${esc(ciclo.nome)}</b> o que você marcar abaixo. Antes, o sistema faz uma <b>cópia de segurança completa</b> do banco (pasta dados\\backups).
      Matrículas lançadas, metas, tutores e campanhas <b>não</b> são tocados. Depois de zerar, a Sede/Digital volta a zero até você registrar de novo.</div>
      <label class="check"><input type="checkbox" id="mz-pos" ${pos ? 'checked' : ''}> Posições do print (leituras coladas, grade e gráficos) — <b>${int(k.posicoes)}</b>${k.data ? ' da data ' + dataBR(k.data) : ' (todas)'}</label>
      <label class="campo" style="margin:4px 0 10px 26px;max-width:260px"><span>Só as posições desta data (vazio = todas)</span><input type="date" id="mz-data" value="${esc(k.data || '')}"></label>
      <label class="check"><input type="checkbox" id="mz-lista" ${lis ? 'checked' : ''}> Lista de alunos importada (Excel) — <b>${int(k.lista_alunos)}</b> aluno(s) em ${int(k.lista_importacoes)} importação(ões)</label>
      <label class="check"><input type="checkbox" id="mz-map" ${map ? 'checked' : ''}> Também as correspondências de nomes (polos e cursos → produtos) — <b>${int(k.mapeamentos)}</b><br><small class="muted">Normalmente não precisa: elas só economizam trabalho na próxima importação.</small></label>
      <label class="campo" style="margin-top:12px;max-width:260px"><span>Digite <b>ZERAR</b> para confirmar</span><input type="text" id="mz-conf" value="${esc(conf)}" autocomplete="off"></label>
      </div><footer><button class="btn" data-fechar>Cancelar</button><button class="btn perigo" id="mz-ok">Zerar agora</button></footer>`;
    $$('[data-fechar]', box).forEach(b => { b.onclick = fecharModal; });
    $('#mz-data', box).onchange = render;
    $('#mz-ok', box).onclick = async () => {
      const corpo = { ciclo: ciclo.id, data: $('#mz-data', box).value, posicoes: $('#mz-pos', box).checked, lista: $('#mz-lista', box).checked, mapeamentos: $('#mz-map', box).checked, confirmacao: $('#mz-conf', box).value };
      if (!corpo.posicoes && !corpo.lista && !corpo.mapeamentos) return toast('Marque o que deseja zerar', true);
      if (corpo.confirmacao.trim().toUpperCase() !== 'ZERAR') return toast('Digite ZERAR para confirmar', true);
      $('#mz-ok', box).disabled = true;
      try { const r = await api('/api/ma/resetar', { method: 'POST', body: corpo }); toast(`Zerado: ${int(r.posicoes)} posição(ões), ${int(r.lista_alunos)} aluno(s) da lista. Cópia: ${r.backup}`); fecharModal(); depois && depois(); }
      catch (e) { toast(e.message, true); $('#mz-ok', box).disabled = false; }
    };
  }
  render().catch(e => { box.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; });
}

// ----------------------------------------------------------------------- contatos para o Google (a partir das planilhas)
// Tudo acontece no navegador: o arquivo do Mundo Azul é lido aqui e o CSV é baixado direto. Nada é enviado ao servidor
// e os telefones não ficam guardados no sistema.
const MA_PREFIXO_CURSO = /^(gradua[cç][aã]o|licenciatura|bacharelado|superior de tecnologia|tecn[oó]logo|t[eé]cnico|curso superior de tecnologia|p[oó]s[- ]gradua[cç][aã]o( lato sensu)?|especializa[cç][aã]o|mba)( em| -)?\s+/i;
function cursoCurtoMA(t) {
  let x = String(t || '').trim(); for (let i = 0; i < 2; i++) x = x.replace(MA_PREFIXO_CURSO, '');
  const min = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'a', 'o', 'na', 'no']);
  return x.toLowerCase().split(/\s+/).map((w, i) => (i && min.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function nomeProprioMA(t) {
  const min = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return String(t || '').trim().toLowerCase().split(/\s+/).map((w, i) => (i && min.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function celularMA(celular, fone) {
  for (const v of [celular, fone]) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    if (d.startsWith('0')) d = d.replace(/^0+/, '');
    if (d.length === 11 && d[2] === '9') return `+55 ${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10 && v === celular) return `+55 ${d.slice(0, 2)} 9${d.slice(2, 6)}-${d.slice(6)}`; // celular antigo sem o 9
  }
  return null;
}
function modalContatosGoogle() {
  const md = abrirModal('<div id="cg"></div>', 980), box = $('#cg', md);
  let base = [], gerados = [];
  // siglas dos polos e período de cada unidade (Configuração salva; sugestão: 3 letras do polo e o número do processo)
  let CG = {}; try { CG = JSON.parse(B.config.contatos_google || '{}'); } catch { CG = {}; }
  CG.siglas ??= {}; CG.periodos ??= {};
  const ciclo = cicloAtual(), mp = /(\d{2})\s*\/\s*(\d{2,4})/.exec(ciclo.nome || ''), periodoProcesso = mp ? `${mp[1]}/${mp[2].slice(-2)}` : '';
  const siglaPadrao = (() => { const nomes = B.polos.filter(p => p.ativo).map(p => p.nome), tres = (n) => { const t = normalizar(n); return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').slice(0, 3); };
    const out = {}; for (const n of nomes) { const t = tres(n), col = nomes.filter(m => tres(m).toLowerCase() === t.toLowerCase()).length > 1; out[n] = col ? n.split(/\s+/).map((w, i) => i ? w.charAt(0).toUpperCase() : w.slice(0, 2)).join('').normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); } return out; })();
  const siglaDe = (polo) => CG.siglas[polo] ?? siglaPadrao[polo] ?? polo.slice(0, 3);
  const periodoDe = (un) => CG.periodos[un] ?? (/GRAD/i.test(un) ? periodoProcesso : '');
  const poloSistema = (fonte) => {
    const n = normalizar(String(fonte || '').replace(/\s*-\s*[A-Z]{2}\s*$/, ''));
    const p = B.polos.find(x => normalizar(x.nome) === n) || B.polos.find(x => n.startsWith(normalizar(x.nome)));
    return p ? p.nome : nomeProprioMA(String(fonte || '').replace(/\s*-\s*[A-Z]{2}\s*$/, ''));
  };
  box.innerHTML = `<header><h3>Contatos para o Google</h3><button class="btn icone" data-fechar>✕</button></header><div class="corpo">
    <div class="info">Gera um arquivo <b>.csv</b> no formato do Google Contatos com os alunos <b>com R.A.</b> e o <b>celular</b> da planilha do Mundo Azul — direto das listas já importadas (não precisa escolher arquivo). Depois: <b>contacts.google.com › Importar › escolha o arquivo</b>.<br>
    O sistema lembra quem já foi exportado: marcando "só quem ainda não foi exportado", cada arquivo traz só os novos.</div>
    <div class="linha-acoes" style="flex-wrap:wrap;gap:12px;margin:6px 0"><label class="check"><input type="radio" name="cg-fonte" value="sistema" checked> Das listas já importadas</label><label class="check"><input type="radio" name="cg-fonte" value="arquivo"> De arquivos do Mundo Azul</label>
      <label class="check" id="cg-novos-l"><input type="checkbox" id="cg-novos" checked> Só quem ainda não foi exportado</label></div>
    <label class="campo" id="cg-arq-l" hidden><span>Arquivos do Mundo Azul (.xlsx ou .csv)</span><input type="file" id="cg-arq" accept=".xlsx,.csv" multiple></label>
    <div class="form-grid">
      <label class="campo"><span>Nome do contato</span><select id="cg-fmt"><option value="spn">Sigla - Período - Aluno (ex.: Fra - 51/27 - Maria Silva)</option><option value="pcn">Polo - Curso - Aluno</option><option value="pn">Polo - Aluno</option><option value="ncp">Aluno - Polo - Curso</option></select></label>
      <label class="campo"><span>Só alunos com pagamento a partir de</span><input type="date" id="cg-de"><small class="muted">vazio = todos; use para importar só os novos</small></label>
      <label class="check"><input type="checkbox" id="cg-email"> Incluir e-mail</label>
      <label class="check"><input type="checkbox" id="cg-ra" checked> Pôr R.A. e curso completo na observação</label>
    </div>
    <div id="cg-cfg"></div><div id="cg-prev"></div></div>
    <footer><button class="btn" data-fechar>Fechar</button><button class="btn prim" id="cg-baixar" disabled>Baixar arquivo para o Google</button></footer>`;
  $$('[data-fechar]', box).forEach(b => { b.onclick = fecharModal; });
  const COLS = { unidade: ['unidade'], candidato: ['candidato'], ra: ['aluno', 'ra'], nome: ['nome'], curso_nome: ['nome curso'], polo: ['polo'], celular: ['celular'], fone: ['fone', 'telefone'], email: ['e mail', 'email'], pagto: ['mensalidade pagto', 'data pagamento'], inscricao: ['data inscricao'] };
  const nz = (t) => normalizar(String(t || '')).replace(/[^a-z0-9]+/g, ' ').trim();
  async function ler(files) {
    base = [];
    for (const f of files) {
      const tab = await lerXlsxMA(f), iCab = tab.findIndex(l => l.some(x => nz(x) === 'candidato'));
      if (iCab < 0) throw new Error(`${f.name}: não encontrei a coluna "Candidato".`);
      const cab = tab[iCab].map(nz), idx = {};
      for (const [k, ns] of Object.entries(COLS)) idx[k] = cab.findIndex(h => ns.map(nz).includes(h));
      if (idx.celular < 0 && idx.fone < 0) throw new Error(`${f.name}: a planilha não tem coluna de celular/fone.`);
      for (const l of tab.slice(iCab + 1)) if (l[idx.candidato]) base.push(Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i < 0 ? '' : String(l[i] ?? '').trim()])));
    }
  }
  const dataISO = (t) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t || ''); if (m) return `${m[3]}-${m[2]}-${m[1]}`; if (/^\d{5}$/.test(t || '')) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 864e5).toISOString().slice(0, 10); return /^\d{4}-\d{2}-\d{2}/.test(t || '') ? t.slice(0, 10) : ''; };
  function montar(semCfg = false) {
    const fmt = $('#cg-fmt', box).value, de = $('#cg-de', box).value, email = $('#cg-email', box).checked, obs = $('#cg-ra', box).checked;
    if (!semCfg) renderCfg(fmt);
    const vistos = new Set(), semFone = [], repetidos = [];
    gerados = [];
    for (const a of base) {
      if (!a.ra) continue;
      const dt = dataISO(a.pagto) || dataISO(a.inscricao);
      if (de && dt && dt < de) continue;
      const tel = celularMA(a.celular, a.fone);
      const nome = nomeProprioMA(a.nome), polo = poloSistema(a.polo), curso = cursoCurtoMA(a.curso_nome);
      if (!tel) { semFone.push(nome); continue; }
      if (vistos.has(tel)) { repetidos.push(nome); continue; }
      vistos.add(tel);
      const per = periodoDe(a.unidade || '');
      const exib = fmt === 'spn' ? [siglaDe(polo), per, nome].filter(Boolean).join(' - ') : fmt === 'pn' ? `${polo} - ${nome}` : fmt === 'ncp' ? `${nome} - ${polo} - ${curso}` : `${polo} - ${curso} - ${nome}`;
      gerados.push({ id: a.id, exib, tel, polo, curso, nome, ra: a.ra, email: email ? a.email : '', nota: obs ? `R.A. ${a.ra} · ${a.curso_nome}${dt ? ' · pagamento ' + dataBR(dt) : ''}` : '' });
    }
    gerados.sort((x, y) => x.exib.localeCompare(y.exib, 'pt-BR'));
    const porPolo = {}; for (const g of gerados) porPolo[g.polo] = (porPolo[g.polo] || 0) + 1;
    $('#cg-prev', box).innerHTML = `<div class="rel-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div><span>Contatos gerados</span><b>${int(gerados.length)}</b><em>alunos com R.A. e celular</em></div><div><span>Sem celular</span><b>${int(semFone.length)}</b><em>${esc(semFone.slice(0, 3).join(', '))}${semFone.length > 3 ? '…' : ''}</em></div><div><span>Celular repetido</span><b>${int(repetidos.length)}</b><em>entra uma vez só</em></div><div><span>Polos</span><b>${int(Object.keys(porPolo).length)}</b><em>${esc(Object.entries(porPolo).map(([p, n]) => p + ' ' + n).join(' · '))}</em></div></div>
      ${gerados.length ? `<div style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th>Nome no Google</th><th>Celular</th><th>Etiqueta</th></tr></thead><tbody>${gerados.slice(0, 200).map(g => `<tr><td>${esc(g.exib)}</td><td style="white-space:nowrap">${esc(g.tel)}</td><td class="muted">Polo ${esc(g.polo)}</td></tr>`).join('')}</tbody></table></div>${gerados.length > 200 ? `<p class="muted">Mostrando 200 de ${int(gerados.length)}.</p>` : ''}` : '<p class="muted">Nenhum contato com R.A. e celular nesses arquivos.</p>'}`;
    $('#cg-baixar', box).disabled = !gerados.length;
  }
  function renderCfg(fmt) {
    const el = $('#cg-cfg', box); if (fmt !== 'spn' || !base.length) { el.innerHTML = ''; return; }
    const polos = [...new Set(base.filter(a => a.ra).map(a => poloSistema(a.polo)))].sort(), uns = [...new Set(base.map(a => a.unidade || ''))].sort();
    el.innerHTML = `<details open class="card" style="padding:10px;margin:8px 0"><summary><b>Siglas dos polos e período de cada unidade</b> <small class="muted">— ficam salvos para as próximas vezes</small></summary>
      <div class="grid g2" style="align-items:start;margin-top:8px"><table class="t"><thead><tr><th>Polo</th><th>Sigla</th></tr></thead><tbody>${polos.map(p => `<tr><td>${esc(p)}</td><td><input type="text" maxlength="8" style="width:90px" data-sigla="${esc(p)}" value="${esc(siglaDe(p))}"></td></tr>`).join('')}</tbody></table>
      <table class="t"><thead><tr><th>Unidade (Mundo Azul)</th><th>Período no nome</th></tr></thead><tbody>${uns.map(u => `<tr><td>${esc(u || '—')}</td><td><input type="text" maxlength="12" style="width:110px" placeholder="ex.: 51/27" data-per="${esc(u)}" value="${esc(periodoDe(u))}"></td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Ex.: Franca + Graduação → <b>${esc(siglaDe(polos[0] || 'Franca'))} - ${esc(periodoDe(uns.find(u => /GRAD/i.test(u)) || '') || '51/27')} - Maria Silva</b>. Período vazio = só sigla e nome. ${eAdmin() ? '<button class="btn peq" id="cg-salvar">Salvar siglas e períodos</button>' : ''}</p></details>`;
    $$('[data-sigla]', el).forEach(i => { i.oninput = () => { CG.siglas[i.dataset.sigla] = i.value.trim(); montarSoLista(); }; });
    $$('[data-per]', el).forEach(i => { i.oninput = () => { CG.periodos[i.dataset.per] = i.value.trim(); montarSoLista(); }; });
    if ($('#cg-salvar', el)) $('#cg-salvar', el).onclick = async () => { try { const v = JSON.stringify(CG); await api('/api/config', { method: 'PUT', body: { contatos_google: v } }); B.config.contatos_google = v; toast('Siglas e períodos salvos'); } catch (e) { toast(e.message, true); } };
  }
  let montarAgendado = null;
  const montarSoLista = () => { clearTimeout(montarAgendado); montarAgendado = setTimeout(() => montar(true), 250); };
  let fonteSistema = true;
  async function carregarSistema() {
    $('#cg-prev', box).innerHTML = '<div class="carregando">Carregando…</div>';
    try {
      const r = await api('/api/ma/contatos?' + qs({ ciclo: cicloAtual().id }));
      const novos = $('#cg-novos', box).checked;
      base = r.alunos.filter(a => !novos || !a.exportado_em).map(a => ({ id: a.id, unidade: a.unidade, candidato: String(a.id), ra: a.ra, nome: a.nome, curso_nome: a.curso_nome, polo: a.polo, celular: a.celular || '', fone: '', email: '', pagto: a.data || '', inscricao: '' }));
      const jaExp = r.alunos.filter(a => a.exportado_em).length, semCel = r.alunos.filter(a => !a.celular).length;
      montar();
      $('#cg-prev', box).insertAdjacentHTML('afterbegin', `<p class="muted" style="font-size:12px;margin:4px 0">${int(r.alunos.length)} aluno(s) com R.A. nas listas · ${int(jaExp)} já exportado(s)${semCel ? ` · ${int(semCel)} sem celular na planilha` : ''}${jaExp && $('#cg-novos', box).checked ? ' · <button class="btn peq" id="cg-desm">Exportar todos de novo</button>' : ''}</p>`);
      if ($('#cg-desm', box)) $('#cg-desm', box).onclick = () => { $('#cg-novos', box).checked = false; carregarSistema(); };
    } catch (err) { $('#cg-prev', box).innerHTML = `<div class="erro-box">${esc(err.message)}</div>`; }
  }
  $$('[name=cg-fonte]', box).forEach(r => { r.onchange = () => { fonteSistema = $('[name=cg-fonte]:checked', box).value === 'sistema'; $('#cg-arq-l', box).hidden = fonteSistema; $('#cg-novos-l', box).hidden = !fonteSistema; base = []; $('#cg-prev', box).innerHTML = ''; $('#cg-baixar', box).disabled = true; if (fonteSistema) carregarSistema(); }; });
  $('#cg-novos', box).onchange = () => { if (fonteSistema) carregarSistema(); };
  $('#cg-arq', box).onchange = async (e) => {
    const fs = [...e.target.files]; if (!fs.length) return;
    $('#cg-prev', box).innerHTML = '<div class="carregando">Lendo…</div>';
    try { await ler(fs); montar(); } catch (err) { $('#cg-prev', box).innerHTML = `<div class="erro-box">${esc(err.message)}</div>`; $('#cg-baixar', box).disabled = true; }
  };
  for (const id of ['#cg-fmt', '#cg-de', '#cg-email', '#cg-ra']) $(id, box).onchange = () => { if (base.length) montar(); };
  carregarSistema();
  $('#cg-baixar', box).onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cab = ['First Name', 'Last Name', 'Labels', 'Phone 1 - Label', 'Phone 1 - Value', 'E-mail 1 - Label', 'E-mail 1 - Value', 'Notes'];
    const linhas = gerados.map(g => [g.exib, '', `Polo ${g.polo} ::: Mundo Azul ::: * myContacts`, 'Mobile', g.tel, g.email ? 'Other' : '', g.email || '', g.nota]);
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(q).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = `contatos-google-${B.hoje}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${int(gerados.length)} contato(s) no arquivo. Agora: contacts.google.com › Importar.`);
    if (fonteSistema) { const ids = gerados.map(g => g.id).filter(Boolean); if (ids.length) api('/api/ma/contatos/marcar', { method: 'POST', body: { ids } }).then(() => carregarSistema()).catch(e => toast(e.message, true)); }
  };
}

// ----------------------------------------------------------------------- boas-vindas (fila semiautomática, gratuita)
// Para cada aluno novo com R.A. (lista do Mundo Azul): mensagem pronta, botão que abre o WhatsApp com o texto, ou copia
// mensagem/número para colar no Aloha. O sistema marca quem já recebeu e não repete. Nada é enviado sozinho.
const BV_PADRAO = 'Olá, {primeiro_nome}! 👋\nSeja muito bem-vindo(a) à Unicesumar – Polo {polo}! 🎓\nSua matrícula em *{curso}* está confirmada (R.A. {ra}).\nQualquer dúvida, é só chamar por aqui. Estamos com você! 💙';
function bvConfig() { try { const c = JSON.parse(B.config.boas_vindas || '{}'); return { padrao: c.padrao || BV_PADRAO, produtos: c.produtos || {}, automatica: c.automatica === true }; } catch { return { padrao: BV_PADRAO, produtos: {}, automatica: false }; } }
function bvTexto(a) {
  const c = bvConfig(), modelo = (a.produto_id && c.produtos[a.produto_id]) || c.padrao;
  const nome = nomeProprioMA(a.nome), primeiro = nome.split(' ')[0] || nome;
  const vars = { primeiro_nome: primeiro, nome, curso: cursoCurtoMA(a.curso_nome), polo: a.polo || '', produto: a.produto || '', ra: a.ra || '' };
  return modelo.replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);
}
async function telaBoasVindas(c) {
  const ciclo = cicloAtual();
  let mostrar = 'pendentes', poloF = '';
  c.innerHTML = '<div class="carregando">Carregando…</div>';
  async function render() {
    let d; try { d = await api('/api/ma/boas-vindas?' + qs({ ciclo: ciclo.id })); } catch (e) { c.innerHTML = `<div class="erro-box">${esc(e.message)}</div>`; return; }
    const todos = d.alunos.filter(a => !poloF || String(a.polo_id) === poloF);
    const pend = todos.filter(a => !a.enviada_em), env = todos.filter(a => a.enviada_em);
    const lista = (mostrar === 'pendentes' ? pend : env);
    const semCel = pend.filter(a => !a.celular).length;
    const polos = [...new Map(d.alunos.filter(a => a.polo_id).map(a => [a.polo_id, a.polo])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
    c.innerHTML = `
      <div class="info"><b>Boas-vindas pela fila do Balbino Chat.</b> A mensagem usa nome, curso, polo e celular da lista importada do Mundo Azul. ${bvConfig().automatica ? '<b>Automação ativada:</b> novos RAs com celular entram na fila após a importação.' : 'A automação está desligada; você pode enviar manualmente ou ativá-la em “Editar mensagem”.'} A primeira importação serve como base e não dispara mensagens antigas.</div>
      <div class="card"><div class="card-cab"><h2>Fila de boas-vindas</h2>
        <div class="linha-acoes"><select id="bv-polo"><option value="">Todos os polos</option>${polos.map(([id, n]) => `<option value="${id}" ${String(id) === poloF ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          <button class="btn ${mostrar === 'pendentes' ? 'prim' : ''}" data-ver="pendentes">Pendentes (${int(pend.length)})</button><button class="btn ${mostrar === 'enviadas' ? 'prim' : ''}" data-ver="enviadas">Já enviadas (${int(env.length)})</button>
          ${eAdmin() ? '<button class="btn" id="bv-modelo">Editar mensagem</button>' : ''}${mostrar === 'pendentes' && pend.length ? '<button class="btn" id="bv-antigos" title="Use uma vez, se esses alunos já receberam boas-vindas antes do sistema">Marcar todos como já recebidos</button>' : ''}</div></div>
        ${!d.alunos.length ? '<div class="corpo"><div class="vazio">Nenhum aluno com R.A. nas listas importadas. Importe as planilhas em <a href="#/mundo-azul/oficial">Mundo Azul — lista de alunos</a>.</div></div>' : ''}
        ${semCel && mostrar === 'pendentes' ? `<div class="corpo" style="padding-bottom:0"><div class="aviso">${int(semCel)} aluno(s) sem celular na planilha: use "Copiar" e procure o contato no Aloha, ou marque como enviada se já falou com ele.</div></div>` : ''}
        <div class="corpo sem-pad" style="overflow-x:auto"><table class="t"><thead><tr><th>Aluno</th><th>Curso · polo</th><th>Matrícula</th><th>Celular</th><th style="min-width:280px">Mensagem</th><th></th></tr></thead><tbody>
        ${lista.map(a => { const txt = bvTexto(a), num = (a.celular || '').replace(/\D/g, ''), naFilaChat=['PENDENTE','NA_FILA','ENVIANDO'].includes(a.chat_status); return `<tr data-linha="${a.id}"><td><b>${esc(nomeProprioMA(a.nome))}</b>${idAluno({ ra: a.ra })}</td><td><small>${esc(cursoCurtoMA(a.curso_nome))}</small><br><small class="muted">${esc(a.polo || '')}${a.produto ? ' · ' + esc(a.produto) : ''}</small></td><td style="white-space:nowrap">${a.data ? dataBR(a.data) : '—'}</td><td style="white-space:nowrap">${a.celular ? esc(a.celular) : '<span class="tag cinza mini">sem celular</span>'}${a.chat_status ? `<br><small class="muted">${esc(a.chat_status==='PENDENTE'?'Aguardando conexão com o Chat':a.chat_status==='NA_FILA'?'Na fila do Chat':a.chat_status==='ENVIANDO'?'Enviando pelo Chat':a.chat_status==='ERRO'?'Erro no Chat':a.chat_status)}</small>` : ''}${a.chat_erro ? `<br><small class="erro-txt">${esc(a.chat_erro)}</small>` : ''}</td>
          <td><div class="muted" style="font-size:12px;white-space:pre-wrap;max-height:84px;overflow:auto">${esc(txt)}</div></td>
          <td style="white-space:nowrap">${mostrar === 'pendentes' ? `${!naFilaChat && num ? `<a class="btn peq prim" target="_blank" rel="noopener" href="https://wa.me/${num}?text=${encodeURIComponent(txt)}" data-enviar="${a.id}">WhatsApp</a> ` : ''}${!naFilaChat ? `<button class="btn peq" data-copiar="${a.id}">Copiar</button> <button class="btn peq" data-marcar="${a.id}" title="Já enviei por outro caminho">✓ Enviada</button>` : ''}`
            : `<small class="muted">${esc(String(a.enviada_em).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))}<br>${esc(a.enviada_por || '')}</small> <button class="btn peq" data-desfazer="${a.id}">Voltar para a fila</button>`}</td></tr>`; }).join('')}
        ${!lista.length && d.alunos.length ? `<tr><td colspan="6" class="vazio">${mostrar === 'pendentes' ? 'Nenhuma boas-vindas pendente. 🎉' : 'Nenhuma enviada ainda.'}</td></tr>` : ''}</tbody></table></div></div>`;
    const marcar = async (ids, extra = {}) => { try { await api('/api/ma/boas-vindas/marcar', { method: 'POST', body: { ids, ...extra } }); } catch (e) { toast(e.message, true); } };
    $('#bv-polo').onchange = (e) => { poloF = e.target.value; render(); };
    $$('[data-ver]', c).forEach(b => { b.onclick = () => { mostrar = b.dataset.ver; render(); }; });
    $$('[data-enviar]', c).forEach(b => { b.onclick = () => { setTimeout(async () => { await marcar([Number(b.dataset.enviar)]); toast('Marcada como enviada'); render(); }, 400); }; });
    $$('[data-copiar]', c).forEach(b => { b.onclick = async () => { const a = d.alunos.find(x => x.id === Number(b.dataset.copiar)); await copiarTexto(bvTexto(a)); const tr = b.closest('tr'); if (tr && !tr.querySelector('.bv-conf')) b.insertAdjacentHTML('afterend', ' <button class="btn peq prim bv-conf">Enviei ✓</button>'); const ok = tr && tr.querySelector('.bv-conf'); if (ok) ok.onclick = async () => { await marcar([a.id]); render(); }; }; });
    $$('[data-marcar]', c).forEach(b => { b.onclick = async () => { await marcar([Number(b.dataset.marcar)]); render(); }; });
    $$('[data-desfazer]', c).forEach(b => { b.onclick = async () => { await marcar([Number(b.dataset.desfazer)], { desfazer: true }); render(); }; });
    if ($('#bv-antigos')) $('#bv-antigos').onclick = async () => { if (!confirm(`Marcar os ${pend.length} aluno(s) pendentes${poloF ? ' deste polo' : ''} como "já receberam boas-vindas"? Use só se eles já receberam antes do sistema.`)) return; await marcar(pend.map(a => a.id), { motivo: 'antigos' }); render(); };
    if ($('#bv-modelo')) $('#bv-modelo').onclick = () => modalModeloBV(render);
  }
  await render();
}
function modalModeloBV(depois) {
  const cfg = bvConfig(), prods = B.produtos.filter(p => p.ativo);
  const m = abrirModal(`<header><h3>Mensagem de boas-vindas</h3><button class="btn icone" data-fechar>✕</button></header><div class="corpo">
    <p class="muted" style="margin-top:0">Variáveis: <code>{primeiro_nome}</code> <code>{nome}</code> <code>{curso}</code> <code>{polo}</code> <code>{produto}</code> <code>{ra}</code>. Para negrito no WhatsApp use *assim*.</p>
    <label class="campo"><span><input type="checkbox" id="bv-automatica" ${cfg.automatica ? 'checked' : ''}> Enfileirar automaticamente novos alunos após importar a lista do Mundo Azul</span><small class="muted">Só entram RAs novos ou que passaram a ter celular. O primeiro arquivo importado vira a base e não dispara para o histórico.</small></label>
    <label class="campo"><span>Mensagem padrão</span><textarea id="bv-padrao" rows="6">${esc(cfg.padrao)}</textarea></label>
    <details><summary>Mensagem diferente por produto (opcional)</summary>${prods.map(p => `<label class="campo"><span>${esc(p.nome)} <small class="muted">(vazio = usa a padrão)</small></span><textarea rows="4" data-bvp="${p.id}">${esc(cfg.produtos[p.id] || '')}</textarea></label>`).join('')}</details>
    <p class="muted" style="font-size:12px">Prévia: <span id="bv-prev" style="white-space:pre-wrap"></span></p></div>
    <footer><button class="btn" data-fechar>Cancelar</button><button class="btn" id="bv-reset">Voltar ao texto sugerido</button><button class="btn prim" id="bv-ok">Salvar</button></footer>`, 720);
  const prev = () => { $('#bv-prev', m).textContent = $('#bv-padrao', m).value.replace(/\{(\w+)\}/g, (x, k) => ({ primeiro_nome: 'Maria', nome: 'Maria da Silva', curso: 'Pedagogia', polo: 'Franca', produto: 'Semi - Licenciatura', ra: '27234017-5' })[k] ?? x); };
  $('#bv-padrao', m).oninput = prev; prev();
  $('#bv-reset', m).onclick = () => { $('#bv-padrao', m).value = BV_PADRAO; prev(); };
  $('#bv-ok', m).onclick = async () => {
    const v = JSON.stringify({ padrao: $('#bv-padrao', m).value.trim() || BV_PADRAO, produtos: Object.fromEntries($$('[data-bvp]', m).map(t => [t.dataset.bvp, t.value.trim()]).filter(([, t]) => t)), automatica: $('#bv-automatica', m).checked });
    try { await api('/api/config', { method: 'PUT', body: { boas_vindas: v } }); B.config.boas_vindas = v; toast('Mensagem salva'); fecharModal(); depois && depois(); } catch (e) { toast(e.message, true); }
  };
}
