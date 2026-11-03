(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = iso => new Date(iso + 'T12:00:00');
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
  const br = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const brShort = iso => { const d = dateOf(iso); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''); };
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MESES_LABEL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const S = { data: null, today: isoOf(new Date()), product: 'graduacao', year: '' };
  const prodName = id => S.data?.produtos.find(p => p.id === id)?.nome || id;
  const modLabel = (pid, m) => /S$/i.test(m) ? `${m[0]}º semestre` : `Módulo ${m}`;
  const status = o => S.today < o.inicio ? 'proximo' : S.today > o.fim ? 'encerrado' : 'ativo';
  const statusLabel = { ativo: 'Em andamento', proximo: 'Próximo', encerrado: 'Encerrado' };
  const range = o => o.inicio === o.fim ? br(o.inicio) : `${br(o.inicio)} a ${br(o.fim)}`;
  function relative(o) {
    const st = status(o);
    if (st === 'ativo') { const n = diffDays(S.today, o.fim); return n === 0 ? 'termina hoje' : `termina em ${n} dia${n > 1 ? 's' : ''}`; }
    if (st === 'proximo') { const n = diffDays(S.today, o.inicio); return n === 1 ? 'começa amanhã' : `começa em ${n} dias`; }
    const n = diffDays(o.fim, S.today); return n === 1 ? 'terminou ontem' : `terminou há ${n} dias`;
  }

  // ------------------------------------------------------------ interpretação da pergunta
  const PRODUTO_PALAVRAS = [
    [/\b(pos|pos graduacao|posgraduacao|especializacao|hibrida|mba)\b/, 'pos_hibrida'],
    [/\b(graduacao|grad|ead|faculdade)\b/, 'graduacao'],
    [/\b(tecnico|tecnicos|tec)\b/, 'tecnicos'],
    [/\b(profissionalizante|profissionalizantes|profis)\b/, 'profissionalizante'],
    [/\b(presencial|presenciais)\b/, 'presencial']
  ];
  // sinônimos → termos que aparecem nos nomes de eventos/categorias
  const SINONIMOS = {
    ra: ['ra'], rematricula: ['rematricula'], renovacao: ['rematricula'], nota: ['nota'], notas: ['nota'], captacao: ['captacao'], inscricao: ['captacao'], inscricoes: ['captacao'], vestibular: ['captacao'], venda: ['captacao'], vendas: ['captacao'],
    aula: ['letivo'], aulas: ['letivo'], letivo: ['letivo'], inicio: [], periodo: [], aproveitamento: ['aproveitamento'], turma: ['turma'], turmas: ['turma'], fechamento: ['fechamento'], secretaria: ['secretaria'], financeiro: ['financeiro']
  };
  const STOP = new Set('o a os as de da do das dos e em no na nos nas um uma para pra por que qual quais quando quanto onde como é eh ser sera vai vao tem ter esta este essa esse isso data datas dia dias prazo prazos acontece acontecendo calendario evento eventos me mostra mostrar ver sobre ate começa comeca termina terminar acaba acabar abre fecha encerra fim inicio comeco modulo modulos semestre agora hoje amanha semana mes proxima proximo proximos proximas que vem atual atuais andamento ano'.split(' ').map(norm));

  function interpret(text) {
    const n = (' ' + norm(text) + ' ').replace(/\bpos ?graduac(?:ao|oes)\b/g, 'pos');
    const q = { produtos: new Set(), modulos: new Set(), de: null, ate: null, quando: null, termos: [], foco: null, rotulos: [] };
    for (const [re, id] of PRODUTO_PALAVRAS) if (re.test(n)) q.produtos.add(id);
    const modKeys = new Set(S.data.ocorrencias.map(o => o.modulo.toLowerCase()));
    for (const m of n.matchAll(/\b(\d{2})\b/g)) if (modKeys.has(m[1])) q.modulos.add(m[1]);
    for (const m of n.matchAll(/\b([12])\s*(?:o|º)?\s*(?:s|sem|semestre)\b/g)) q.modulos.add(m[1] + 's');
    // datas
    const hoje = S.today, d = dateOf(hoje);
    const dm = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dm) { let y = dm[3] ? Number(dm[3]) : d.getFullYear(); if (y < 100) y += 2000; const iso = `${y}-${pad(dm[2])}-${pad(dm[1])}`; q.de = q.ate = iso; q.quando = `em ${br(iso)}`; }
    else if (/\bamanha\b/.test(n)) { q.de = q.ate = addDays(hoje, 1); q.quando = 'amanhã'; }
    else if (/\b(semana que vem|proxima semana)\b/.test(n)) { const ini = addDays(hoje, 7 - ((d.getDay() + 6) % 7)); q.de = ini; q.ate = addDays(ini, 6); q.quando = 'na próxima semana'; }
    else if (/\b(esta semana|essa semana|nesta semana|semana)\b/.test(n)) { const ini = addDays(hoje, -((d.getDay() + 6) % 7)); q.de = ini; q.ate = addDays(ini, 6); q.quando = 'nesta semana'; }
    else if (/\b(proximo mes|mes que vem)\b/.test(n)) { const x = new Date(d.getFullYear(), d.getMonth() + 1, 1); q.de = isoOf(x); q.ate = isoOf(new Date(x.getFullYear(), x.getMonth() + 1, 0)); q.quando = `em ${MESES_LABEL[x.getMonth()]}`; }
    else if (/\b(este mes|esse mes|neste mes)\b/.test(n)) { q.de = isoOf(new Date(d.getFullYear(), d.getMonth(), 1)); q.ate = isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)); q.quando = `em ${MESES_LABEL[d.getMonth()]}`; }
    else if (/\b(hoje|agora|andamento|atual|atuais|aberto|abertos)\b/.test(n)) { q.de = q.ate = hoje; q.quando = 'hoje'; }
    else { const mi = MESES.findIndex(m => new RegExp(`\\b${m}\\b`).test(n)); if (mi >= 0) { const ym = n.match(/\b(20\d{2})\b/); const y = ym ? Number(ym[1]) : (mi < d.getMonth() - 6 ? d.getFullYear() + 1 : d.getFullYear()); q.de = isoOf(new Date(y, mi, 1)); q.ate = isoOf(new Date(y, mi + 1, 0)); q.quando = `em ${MESES_LABEL[mi]} de ${y}`; } }
    if (/\b(termina|terminar|acaba|encerra|fecha|fim|ultimo dia|ate quando)\b/.test(n)) q.foco = 'fim';
    else if (/\b(comeca|abre|inicio|comeco|primeiro dia)\b/.test(n)) q.foco = 'inicio';
    // termos livres (o que sobrar)
    const usados = new Set(['pos', 'graduacao', 'grad', 'ead', 'faculdade', 'tecnico', 'tecnicos', 'tec', 'profissionalizante', 'profissionalizantes', 'profis', 'presencial', 'presenciais', 'especializacao', 'hibrida', 'mba', 'posgraduacao', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'que', 'vem']);
    const original = new Map(String(text).split(/[^\p{L}\p{N}/]+/u).filter(Boolean).map(w => [norm(w), w.toLocaleLowerCase('pt-BR')]));
    const termoRotulos = [];
    for (const t of n.trim().split(/\s+/)) {
      if (!t || STOP.has(t) || usados.has(t) || /^\d/.test(t) || t.includes('/') || /^[12]s$/.test(t)) continue;
      const syn = SINONIMOS[t];
      if (syn) { if (syn.length) { q.termos.push(syn); termoRotulos.push(original.get(t) || t); } continue; }
      q.termos.push([t.length > 4 ? t.replace(/s$/, '') : t]); termoRotulos.push(original.get(t) || t);
    }
    // um módulo implica o produto dele
    for (const m of q.modulos) { const o = S.data.ocorrencias.find(x => x.modulo.toLowerCase() === m); if (o) q.produtos.add(o.produto); }
    q.rotulos = [...[...q.produtos].map(prodName), ...[...q.modulos].map(m => /s$/.test(m) ? `${m[0]}º semestre` : `Módulo ${m}`), ...(q.quando ? [q.quando] : []), ...(termoRotulos.length ? [`“${termoRotulos.join(' ')}”`] : [])];
    return q;
  }
  function matches(q) {
    return S.data.ocorrencias.filter(o => {
      if (q.produtos.size && !q.produtos.has(o.produto)) return false;
      if (q.modulos.size && !q.modulos.has(o.modulo.toLowerCase())) return false;
      if (q.de && (o.fim < q.de || o.inicio > q.ate)) return false;
      if (q.termos.length) { const alvo = ' ' + norm(o.evento + ' ' + o.categoria) + ' '; if (!q.termos.every(alts => alts.some(t => t.length <= 3 ? new RegExp(`\\b${t}\\b`).test(alvo) : alvo.includes(t)))) return false; }
      return true;
    });
  }
  // relevância: em andamento > próximo (mais perto primeiro) > encerrado recente
  const score = o => { const st = status(o); return st === 'ativo' ? 0 : st === 'proximo' ? 1 + diffDays(S.today, o.inicio) / 1000 : 3 + diffDays(o.fim, S.today) / 1000; };

  function ask(text, push = true) {
    $('q').value = text;
    if (push) history.replaceState(null, '', text ? '?q=' + encodeURIComponent(text) : location.pathname);
    if (!text.trim()) { $('understood').classList.add('hidden'); $('answer').classList.add('hidden'); return; }
    const q = interpret(text);
    $('understood').innerHTML = q.rotulos.length ? `Entendi: ${q.rotulos.map(r => `<span class="chip">${esc(r)}</span>`).join('')}` : 'Mostrando tudo que combina com a busca.';
    $('understood').classList.remove('hidden');
    const rows = matches(q).sort((a, b) => score(a) - score(b) || a.ordem_categoria - b.ordem_categoria);
    const box = $('answer'); box.classList.remove('hidden');
    const marco = marcoBusca(text);
    const calendarioRelevante = rows.length && (q.termos.length || q.produtos.size || q.modulos.size || q.de || !marco.length);
    const frase = o => {
      const st = status(o);
      const quando = q.foco === 'fim' ? `termina em <b>${br(o.fim)}</b>` : q.foco === 'inicio' ? `começa em <b>${br(o.inicio)}</b>` : o.inicio === o.fim ? `é em <b>${br(o.inicio)}</b>` : `vai de <b>${br(o.inicio)}</b> a <b>${br(o.fim)}</b>`;
      return `<article class="direct st-${st}"><span class="st st-${st}">${statusLabel[st]}</span><h3>${esc(o.evento)}</h3><p>${esc(prodName(o.produto))} · ${esc(modLabel(o.produto, o.modulo))} ${quando}.</p><small>${esc(relative(o))}${o.categoria !== o.evento ? ' · ' + esc(o.categoria) : ''}</small></article>`;
    };
    const blocoMarco = marco.length ? `<div class="section-head"><div><p class="eyebrow">Marco Regulatório – 51/2027</p><h2>${marco.length === 1 ? '1 resposta' : marco.length + ' respostas'} da apresentação</h2></div>${calendarioRelevante ? '' : '<button type="button" class="mini" id="clearAsk">Limpar busca</button>'}</div><div class="direct-grid">${marco.map(m => m.html).join('')}</div><p class="sub marco-link"><button type="button" class="mini" data-area-go="marco">Abrir o Marco Regulatório completo</button></p>` : '';
    const blocoCal = calendarioRelevante ? `<div class="section-head${marco.length ? ' spaced' : ''}"><div><p class="eyebrow">Calendário acadêmico</p><h2>${rows.length === 1 ? 'Encontrei 1 data' : `Encontrei ${rows.length} datas`}</h2></div><button type="button" class="mini" id="clearAsk">Limpar busca</button></div>
      <div class="direct-grid">${rows.slice(0, 3).map(frase).join('')}</div>
      ${rows.length > 3 ? `<details class="more" ${rows.length <= 12 ? 'open' : ''}><summary>Ver todas as ${rows.length} datas</summary>${listTable(rows)}</details>` : ''}` : '';
    if (!blocoMarco && !blocoCal) {
      box.innerHTML = `<div class="answer-empty"><h2>Não encontrei isso no calendário nem no Marco Regulatório.</h2><p>Tente por produto, módulo, mês ou evento (ex.: “geração de RA do módulo 54”) ou por um tema do Marco Regulatório (média mínima, ASM, presencialidade, aproveitamento, nome do curso).</p></div>`;
      return;
    }
    box.innerHTML = blocoMarco + blocoCal;
    $('clearAsk')?.addEventListener('click', () => ask(''));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function listTable(rows) {
    return `<div class="table-wrap"><table><thead><tr><th>Evento</th><th>Produto</th><th>Módulo</th><th>Datas</th><th>Situação</th></tr></thead><tbody>${rows.map(o => `<tr><td><b>${esc(o.evento)}</b><span class="sub">${esc(o.categoria)}</span></td><td>${esc(prodName(o.produto))}</td><td>${esc(modLabel(o.produto, o.modulo))}</td><td>${esc(range(o))}</td><td><span class="st st-${status(o)}">${statusLabel[status(o)]}</span><span class="sub">${esc(relative(o))}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  // ------------------------------------------------------------ painel "agora"
  function renderNow() {
    const oc = S.data.ocorrencias;
    $('nowGrid').innerHTML = S.data.produtos.map(p => {
      const let_ = oc.filter(o => o.produto === p.id && norm(o.evento) === 'periodo letivo').sort((a, b) => a.inicio.localeCompare(b.inicio));
      const atual = let_.find(o => status(o) === 'ativo');
      const prox = let_.find(o => status(o) === 'proximo');
      if (!atual && !prox) return `<article class="now"><span class="now-prod">${esc(p.nome)}</span><strong>Sem módulo em andamento</strong><small>Nenhum período letivo futuro no calendário.</small></article>`;
      if (!atual) return `<article class="now"><span class="now-prod">${esc(p.nome)}</span><strong>Intervalo</strong><small>${esc(modLabel(p.id, prox.modulo))} começa em ${br(prox.inicio)} (${esc(relative(prox))})</small></article>`;
      const tot = diffDays(atual.inicio, atual.fim) + 1, feito = diffDays(atual.inicio, S.today) + 1, pct = Math.max(0, Math.min(100, Math.round(feito / tot * 100)));
      return `<button type="button" class="now" data-ask="${esc(p.nome + ' módulo ' + atual.modulo)}"><span class="now-prod">${esc(p.nome)}</span><strong>${esc(modLabel(p.id, atual.modulo))}</strong><span class="progress" aria-label="${pct}% do período"><i data-w="${pct}"></i></span><small>${br(atual.inicio)} a ${br(atual.fim)} · ${esc(relative(atual))}${prox ? ` · depois: ${esc(modLabel(p.id, prox.modulo))} em ${br(prox.inicio)}` : ''}</small></button>`;
    }).join('');
    $('nowGrid').querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
    const ativos = oc.filter(o => status(o) === 'ativo' && norm(o.evento) !== 'periodo letivo').sort((a, b) => a.fim.localeCompare(b.fim));
    $('activeList').innerHTML = ativos.length ? ativos.map(o => `<li><button type="button" data-ask="${esc(o.evento + ' ' + prodName(o.produto) + ' ' + o.modulo)}"><b>${esc(o.evento)}</b><span>${esc(prodName(o.produto))} · ${esc(modLabel(o.produto, o.modulo))}</span><em>${esc(relative(o))} (${br(o.fim)})</em></button></li>`).join('') : '<li class="empty">Nenhum prazo em andamento hoje além dos períodos letivos.</li>';
    const lim = addDays(S.today, 30), marcos = [];
    for (const o of oc) {
      if (o.inicio > S.today && o.inicio <= lim) marcos.push({ data: o.inicio, tipo: o.inicio === o.fim ? 'Dia' : 'Começa', o });
      if (o.fim !== o.inicio && o.fim >= S.today && o.fim <= lim) marcos.push({ data: o.fim, tipo: 'Termina', o });
    }
    marcos.sort((a, b) => a.data.localeCompare(b.data) || a.o.ordem_categoria - b.o.ordem_categoria);
    $('upcomingList').innerHTML = marcos.length ? marcos.slice(0, 14).map(m => `<li><span class="date">${esc(brShort(m.data))}</span><button type="button" data-ask="${esc(m.o.evento + ' ' + prodName(m.o.produto) + ' ' + m.o.modulo)}"><b>${esc(m.tipo)}: ${esc(m.o.evento)}</b><span>${esc(prodName(m.o.produto))} · ${esc(modLabel(m.o.produto, m.o.modulo))}</span></button></li>`).join('') : '<li class="empty">Nada começa ou termina nos próximos 30 dias.</li>';
  }

  // ------------------------------------------------------------ calendário completo (matriz eventos × módulos)
  function renderMatrix() {
    const prod = S.data.produtos.find(p => p.id === S.product);
    const oc = S.data.ocorrencias.filter(o => o.produto === S.product && o.ano === S.year);
    const mods = [...new Set([...prod.modulos, ...oc.map(o => o.modulo)])];
    const cats = [...new Map(oc.sort((a, b) => a.ordem_categoria - b.ordem_categoria || a.categoria.localeCompare(b.categoria, 'pt-BR')).map(o => [o.categoria, []])).keys()];
    if (!oc.length) { $('matrix').innerHTML = '<p class="empty">Sem eventos deste produto no ano selecionado.</p>'; return; }
    let html = `<table class="matrix"><thead><tr><th>Evento</th>${mods.map(m => `<th>${esc(modLabel(S.product, m))}</th>`).join('')}</tr></thead><tbody>`;
    for (const c of cats) {
      html += `<tr class="cat"><td colspan="${mods.length + 1}">${esc(c)}</td></tr>`;
      const evs = [...new Set(oc.filter(o => o.categoria === c).map(o => o.evento))];
      for (const e of evs) html += `<tr><td class="ev">${esc(e)}</td>${mods.map(m => { const o = oc.find(x => x.categoria === c && x.evento === e && x.modulo === m); return o ? `<td class="cell st-${status(o)}" title="${esc(statusLabel[status(o)] + ' · ' + relative(o))}"><b>${esc(br(o.inicio).slice(0, 5))}</b>${o.fim !== o.inicio ? ` a <b>${esc(br(o.fim).slice(0, 5))}</b>` : ''}<span>${esc(o.fim.slice(0, 4) !== o.inicio.slice(0, 4) ? o.inicio.slice(0, 4) + '–' + o.fim.slice(0, 4) : o.inicio.slice(0, 4))}</span></td>` : '<td class="cell none">—</td>'; }).join('')}</tr>`;
    }
    $('matrix').innerHTML = html + '</tbody></table>';
  }
  function renderControls() {
    $('productTabs').innerHTML = S.data.produtos.map(p => `<button type="button" role="tab" data-prod="${p.id}" aria-selected="${p.id === S.product}" class="${p.id === S.product ? 'active' : ''}">${esc(p.nome)}</button>`).join('');
    $('productTabs').querySelectorAll('[data-prod]').forEach(b => b.addEventListener('click', () => { S.product = b.dataset.prod; renderControls(); renderMatrix(); }));
    $('yearSel').innerHTML = S.data.anos.map(a => `<option ${a === S.year ? 'selected' : ''}>${esc(a)}</option>`).join('');
  }
  function renderSuggestions() {
    const sug = ['O que acontece esta semana?', 'Atividades de estudo', 'Datas de provas', 'Geração de RA do próximo módulo', 'Publicação de notas', 'Como funciona o MAPA?'];
    const grad = S.data.ocorrencias.filter(o => o.produto === 'graduacao' && /geracao de ra/.test(norm(o.evento)) && status(o) !== 'encerrado').sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
    if (grad) sug[3] = `Geração de RA do módulo ${grad.modulo}`;
    $('suggestions').innerHTML = sug.map(s => `<button type="button" data-ask="${esc(s)}">${esc(s)}</button>`).join('');
  }

  // ------------------------------------------------------------ carga
  // ------------------------------------------------------------ Marco Regulatório – 51/2027 (dados em apps/informa/marco-regulatorio-51-2027.json)
  const M = { data: null, grupo: 0, portQ: '', mod: 0 };
  const ok = v => v ? '<span class="yes" aria-label="Sim">✓</span>' : '<span class="no" aria-label="Não">✕</span>';
  function gradeHtml(g) {
    const mz = M.data.matriz_cursos, n = Math.max(...Object.values(g.grade).map(a => a.length));
    return `<div class="table-wrap"><table class="grade"><thead><tr><th>Atividade</th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}º ano<span class="sub">${esc(mz.fases[i] || '')}</span></th>`).join('')}</tr></thead><tbody>${mz.linhas.map(l => `<tr><td><b>${esc(l.rotulo)}</b>${l.detalhe ? `<span class="sub">${esc(l.detalhe)}</span>` : ''}</td>${(g.grade[l.id] || []).map(v => `<td class="c ${v ? 'is-yes' : 'is-no'}">${ok(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${g.nota ? `<p class="sub">${esc(g.nota)}</p>` : ''}`;
  }
  function resumoCurso(g) {
    const sim = (id) => g.grade[id].map((v, i) => v ? i + 1 : null).filter(Boolean);
    const anos = l => !l.length ? 'nenhum ano' : l.length === g.grade.provas.length ? 'todos os anos' : l.map(x => x + 'º').join(', ') + ' ano' + (l.length > 1 ? 's' : '');
    return `Aulas ao vivo: ${anos(sim('aulas'))}. Presencialidade: ${anos(sim('presencialidade'))}. ASM: ${anos(sim('asm'))}. Extensão e provas: ${anos(sim('provas'))}.`;
  }
  function marcoBusca(text) {
    if (!M.data) return [];
    const n = ' ' + norm(text) + ' ', out = [];
    const tem = k => new RegExp(`(^| )${norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(n);
    const grupos = M.data.matriz_cursos.grupos.filter(g => [g.nome, ...g.cursos].some(c => { const c2 = norm(c).replace(/^engenharia (de )?/, ''); return tem(c) || (c2.length > 4 && tem(c2)); }));
    for (const g of grupos.slice(0, 2)) out.push({ score: 5, html: `<article class="direct marco-card"><span class="st st-proximo">Atividades do curso</span><h3>${esc(g.nome)}</h3><p>${esc(resumoCurso(g))}</p>${g.nota ? `<small>${esc(g.nota)}</small>` : ''}</article>` });
    for (const f of M.data.perguntas) { const hits = f.chaves.filter(tem).length; if (hits) out.push({ score: hits, html: `<article class="direct marco-card"><span class="st st-ativo">Marco 51/2027</span><h3>${esc(f.pergunta)}</h3><p>${esc(f.resposta)}</p></article>` }); }
    if (!out.length && /\b(marco|regulatorio|51\/2027|2027)\b/.test(n)) for (const d of M.data.destaques) out.push({ score: 1, html: `<article class="direct marco-card"><span class="st st-ativo">Marco 51/2027</span><h3>${esc(d.rotulo)}: ${esc(d.valor)}</h3><p>${esc(d.detalhe)}</p></article>` });
    return out.sort((a, b) => b.score - a.score).slice(0, 4);
  }
  function renderPortfolio() {
    const pf = M.data.portfolio, mod = pf.modalidades[M.mod], q = norm(M.portQ);
    const areas = mod.areas.map(a => ({ ...a, cursos: a.cursos.filter(([c]) => !q || norm(c).includes(q) || norm(a.area).includes(q)) })).filter(a => a.cursos.length);
    $('portList').innerHTML = areas.length ? areas.map(a => `<article class="port-area"><h4>${esc(a.area)}</h4><ul>${a.cursos.map(([c, t]) => `<li><span>${esc(c)}</span><em class="tipo t-${t}">${esc(pf.tipos[t])}</em></li>`).join('')}</ul></article>`).join('') : '<p class="empty">Nenhum curso com esse nome nesta modalidade.</p>';
    $('portCount').textContent = `${areas.reduce((n, a) => n + a.cursos.length, 0)} curso(s)`;
  }
  function renderMarco() {
    const d = M.data, el = $('area-marco'), mz = d.matriz_cursos;
    const gruposMenu = [
      { nome: 'Licenciaturas', grupos: ['Licenciaturas', 'Acompanhamento do Transtorno do Espectro Autista', 'Psicopedagogia'] },
      { nome: 'Engenharias e áreas técnicas', grupos: ['Engenharias e Agronomia', 'Automação Industrial', 'Manutenção Industrial'] },
      { nome: 'Saúde', grupos: ['Educação Física', 'Biomedicina', 'Farmácia'] }
    ].map(c => ({ nome: c.nome, grupos: mz.grupos.map((g, i) => ({ ...g, indice: i })).filter(g => c.grupos.includes(g.nome)) }));
    const opcoesCurso = termo => {
      const q = norm(termo);
      return gruposMenu.map(c => {
        const opcoes = c.grupos.map(g => ({ ...g, cursos: g.cursos.filter(nome => !q || norm(nome).includes(q)) })).filter(g => g.cursos.length);
        return opcoes.length ? `<optgroup label="${esc(c.nome)}">${opcoes.map(g => g.cursos.map(nome => `<option value="${g.indice}">${esc(nome)}</option>`).join('')).join('')}</optgroup>` : '';
      }).join('');
    };
    const conteudoSecao = s => `
      ${s.itens ? `<div class="m-itens">${s.itens.map(i => `<div class="m-item"><b>${esc(i.titulo)}</b><p>${esc(i.texto)}</p></div>`).join('')}</div>` : ''}
      ${s.tabela ? `<div class="m-tabela"><h4>${esc(s.tabela.titulo)}</h4><div class="table-wrap"><table><thead><tr>${s.tabela.colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.tabela.linhas.map((l, i, all) => `<tr class="${i === all.length - 1 ? 'total' : ''}">${l.map((c, j) => `<td class="${j ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="sub">${esc(s.tabela.nota || '')}</p></div>` : ''}
      ${s.cartoes ? `<div class="m-cartoes">${s.cartoes.map(c => `<article class="m-cartao"><h4>${esc(c.titulo)}</h4><span class="chip">${esc(c.selo)}</span><ul>${c.pontos.map(p => `<li>${esc(p)}</li>`).join('')}</ul><p><b>Frequência:</b> ${esc(c.frequencia)}</p><p><b>Agendamento:</b> ${esc(c.agendamento)}</p></article>`).join('')}</div>` : ''}
      ${s.nota ? `<p class="sub m-section-note">${esc(s.nota)}</p>` : ''}`;
    el.innerHTML = `
      <div class="section-head"><div><p class="eyebrow">Conexão Pedagógica · Processo 51/2027</p><h2 id="marcoTitle">${esc(d.titulo)}</h2><p class="sub">${esc(d.fonte)}</p></div></div>
      <div class="fonte-aviso">${esc(d.aviso)}</div>
      <div class="m-destaques">${d.destaques.map(x => `<article class="now"><span class="now-prod">${esc(x.rotulo)}</span><strong>${esc(x.valor)}</strong><small>${esc(x.detalhe)}</small></article>`).join('')}</div>
      <nav class="m-indice" aria-label="Ir direto para"><a href="#m-cursos">Atividades por curso</a><a href="#m-orientacoes">Regras acadêmicas</a><a href="#m-portfolio">Cursos disponíveis</a></nav>
      <section class="card marco-sec" id="m-cursos"><header><h3>${esc(mz.titulo)}</h3><p>Busque e selecione o curso para consultar a matriz correspondente.</p></header>
        <div class="m-course-filter">
          <label class="field m-course-search"><span>Buscar curso</span><input id="cursoBusca" type="search" autocomplete="off" placeholder="Digite o nome do curso"></label>
          <label class="field m-curso"><span>Curso</span><select id="cursoSel">${opcoesCurso('')}</select></label>
          <span class="sub m-course-hint">A matriz aparece abaixo após a seleção.</span>
        </div>
        <div id="gradeBox"></div><p class="sub">${esc(mz.nota)}</p></section>
      <section class="card marco-sec" id="m-orientacoes"><header><h3>Regras e orientações do processo</h3><p>Abra somente o assunto que deseja consultar.</p></header>
        <div class="m-accordions">${d.secoes.map((s, i) => `<details class="m-accordion" id="m-${esc(s.id)}" ${i === 0 ? 'open' : ''}><summary><span><b>${esc(s.titulo)}</b>${s.subtitulo ? `<small>${esc(s.subtitulo)}</small>` : ''}</span><i aria-hidden="true"></i></summary><div class="m-accordion-body">${conteudoSecao(s)}</div></details>`).join('')}</div></section>
      <details class="card marco-sec m-portfolio-collapse" id="m-portfolio"><summary><span><b>Portfólio de cursos</b><small>${esc(d.portfolio.nota)}</small></span><i aria-hidden="true"></i></summary>
        <div class="m-portfolio-body">
          <div class="cal-controls"><div class="segmented" id="portMod">${d.portfolio.modalidades.map((m, i) => `<button type="button" data-mod="${i}" class="${i === M.mod ? 'active' : ''}">${esc(m.nome)}</button>`).join('')}</div>
          <label class="field"><span>Buscar curso no portfólio</span><input id="portQ" type="search" placeholder="Ex.: Pedagogia, Gestão, Dados"></label><span class="sub" id="portCount"></span></div>
          <div class="port-grid" id="portList"></div></div></details>`;
    const preencherMatriz = termo => {
      const sel = $('cursoSel'), previous = sel.value;
      const html = opcoesCurso(termo);
      sel.innerHTML = html || '<option value="">Nenhum curso encontrado</option>';
      if (!html) { $('gradeBox').innerHTML = '<p class="empty">Não encontrei um curso com esse nome.</p>'; return; }
      const valores = [...sel.options].map(o => o.value);
      sel.value = valores.includes(previous) ? previous : valores[0];
      M.grupo = Number(sel.value);
      $('gradeBox').innerHTML = gradeHtml(mz.grupos[M.grupo]);
    };
    $('cursoBusca').addEventListener('input', e => preencherMatriz(e.target.value));
    $('cursoSel').addEventListener('change', () => { M.grupo = Number($('cursoSel').value); $('gradeBox').innerHTML = gradeHtml(mz.grupos[M.grupo]); });
    el.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => { M.mod = Number(b.dataset.mod); el.querySelectorAll('[data-mod]').forEach(x => x.classList.toggle('active', x === b)); renderPortfolio(); }));
    $('portQ').addEventListener('input', e => { M.portQ = e.target.value; renderPortfolio(); });
    renderPortfolio();
  }
  function setArea(area, scroll = false) {
    document.querySelectorAll('.area-tab').forEach(b => { const on = b.dataset.area === area; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('area-calendario').classList.toggle('hidden', area !== 'calendario');
    $('area-marco').classList.toggle('hidden', area !== 'marco');
    if (area === 'marco' && location.hash !== '#marco') history.replaceState(null, '', location.pathname + location.search + '#marco');
    if (area === 'calendario' && location.hash === '#marco') history.replaceState(null, '', location.pathname + location.search);
    if (scroll) $('area-' + area).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.querySelectorAll('.area-tab').forEach(b => b.addEventListener('click', () => setArea(b.dataset.area)));
  document.addEventListener('click', ev => { const g = ev.target.closest('[data-area-go]'); if (g) setArea(g.dataset.areaGo, true); });
  window.addEventListener('hashchange', () => { if (location.hash === '#marco') setArea('marco', true); });

  async function loadMarco() {
    try {
      const r = await fetch('/api/informa/marco', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Falha ao carregar (${r.status})`);
      M.data = await r.json(); renderMarco();
    } catch (e) { $('area-marco').innerHTML = `<div class="erro">Não foi possível carregar o Marco Regulatório: ${esc(e.message)}</div>`; }
  }
  async function load() {
    await loadMarco();
    if (location.hash === '#marco') setArea('marco');
    const res = await fetch('/api/informa/calendario', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 401) { location.assign('/?next=' + encodeURIComponent('/informa/')); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Falha ao carregar o calendário (${res.status}).`);
    S.data = data;
    const ano = S.today.slice(0, 4); S.year = data.anos.includes(ano) ? ano : data.anos[data.anos.length - 1];
    const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('today').textContent = hoje.charAt(0).toUpperCase() + hoje.slice(1);
    if (data.fonte.aviso) { $('fonteAviso').textContent = data.fonte.aviso; $('fonteAviso').classList.remove('hidden'); }
    $('fonte').innerHTML = `Fonte: <a href="${esc(data.fonte.site)}" target="_blank" rel="noopener">Calendário Administrativo Unicesumar</a>${data.fonte.atualizado_em ? ` · dados lidos em ${esc(new Date(data.fonte.atualizado_em).toLocaleString('pt-BR'))}` : ' · dados base do site'} · ${data.ocorrencias.length} datas cadastradas.`;
    renderSuggestions(); renderNow(); renderControls(); renderMatrix();
    const q = new URLSearchParams(location.search).get('q'); if (q) ask(q, false);
    if (location.hash === '#busca') $('q').focus();
  }
  $('askForm').addEventListener('submit', ev => { ev.preventDefault(); ask($('q').value.trim()); });
  $('yearSel').addEventListener('change', () => { S.year = $('yearSel').value; renderMatrix(); });
  document.addEventListener('click', ev => { const b = ev.target.closest('[data-ask]'); if (b) ask(b.dataset.ask); });
  load().catch(e => { $('erro').textContent = e.message; $('erro').classList.remove('hidden'); });
})();
