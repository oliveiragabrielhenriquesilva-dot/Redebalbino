(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ª/g, 'a').replace(/º/g, 'o').toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = iso => new Date(`${iso}T12:00:00`);
  const addDays = (iso, amount) => { const d = dateOf(iso); d.setDate(d.getDate() + amount); return isoOf(d); };
  const diffDays = (from, to) => Math.round((dateOf(to) - dateOf(from)) / 864e5);
  const br = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const brShort = iso => dateOf(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MONTH_LABELS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const CATEGORY_LABELS = ['Lançamento de notas', 'Rematrícula automática', 'Aproveitamento de estudos', 'Divisão de turmas', 'Fechamento de período e rematrícula', 'Serviços da secretaria', 'Políticas preditivas e de retenção', 'Outras rotinas'];
  const STORAGE_KEY = 'balbino-informa-produto-v1';
  const THEME_STORAGE_KEY = 'balbino-informa-tema-v1';
  const S = { data: null, today: isoOf(new Date()), product: 'graduacao', year: '', currentOnly: false, matrixSearch: '', category: '', marco: null, course: '' };
  function setTheme(theme, persist = false) {
    const isDark = theme !== 'light';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const button = $('themeToggle');
    if (button) {
      button.innerHTML = isDark ? '☾ <span>Tema escuro</span>' : '☀ <span>Tema claro</span>';
      button.setAttribute('aria-pressed', String(isDark));
      button.setAttribute('aria-label', `${isDark ? 'Tema escuro' : 'Tema claro'}. Clique para alternar para o tema ${isDark ? 'claro' : 'escuro'}`);
      button.title = `${isDark ? 'Tema escuro' : 'Tema claro'} · clique para alternar`;
    }
    if (persist) try { localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light'); } catch (_) { /* preferência indisponível */ }
  }
  try { setTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'dark'); } catch (_) { setTheme('dark'); }
  $('themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
  const prodName = id => S.data?.produtos.find(p => p.id === id)?.nome || id;
  const modLabel = (pid, module) => /S$/i.test(String(module)) ? `${String(module)[0]}º semestre` : `Módulo ${module}`;
  const status = o => S.today < o.inicio ? 'proximo' : S.today > o.fim ? 'encerrado' : 'ativo';
  const statusLabel = { ativo: 'Em andamento', proximo: 'Próximo', encerrado: 'Encerrado' };
  const eventName = o => String(o.evento || '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  const relative = o => {
    if (status(o) === 'ativo') { const n = diffDays(S.today, o.fim); return n <= 0 ? 'termina hoje' : `termina em ${n} dia${n === 1 ? '' : 's'}`; }
    if (status(o) === 'proximo') { const n = diffDays(S.today, o.inicio); return n === 1 ? 'começa amanhã' : `começa em ${n} dias`; }
    const n = diffDays(o.fim, S.today); return n === 1 ? 'terminou ontem' : `terminou há ${n} dias`;
  };
  const dateRange = o => o.inicio === o.fim ? br(o.inicio) : `${br(o.inicio)} a ${br(o.fim)}`;
  const filteredOccurrences = () => S.data.ocorrencias.filter(o => S.product === 'todos' || o.produto === S.product);
  const observations = o => String(o.observacao || o.observações || o.observacoes || o.nota || '').trim() || (/\*+/.test(o.evento || '') ? 'Ver observações no calendário oficial.' : '');
  const categoryOf = value => {
    const n = norm(value);
    if (n.includes('lancamento de nota')) return CATEGORY_LABELS[0];
    if (n.includes('rematricula automatica')) return CATEGORY_LABELS[1];
    if (n.includes('aproveitamento')) return CATEGORY_LABELS[2];
    if (n.includes('divisao de turma')) return CATEGORY_LABELS[3];
    if (n.includes('fechamento') || n.includes('periodo e rematricula')) return CATEGORY_LABELS[4];
    if (n.includes('secretaria') || n.includes('financeiro') || n.includes('servicos atendidos')) return CATEGORY_LABELS[5];
    if (n.includes('preditiva') || n.includes('retencao')) return CATEGORY_LABELS[6];
    return CATEGORY_LABELS[7];
  };
  const selectedProducts = () => S.product === 'todos' ? S.data.produtos.map(p => p.id) : [S.product];

  function moduleFor(product, upcoming = false) {
    const periods = S.data.ocorrencias.filter(o => o.produto === product && norm(o.evento) === 'periodo letivo').sort((a, b) => a.inicio.localeCompare(b.inicio));
    return upcoming ? periods.find(o => o.inicio > S.today) : periods.find(o => o.inicio <= S.today && o.fim >= S.today);
  }
  function weekBounds(from = S.today) {
    const d = dateOf(from), offset = (d.getDay() + 6) % 7;
    return { start: addDays(from, -offset), end: addDays(from, 6 - offset) };
  }
  function interpretedRange(n) {
    const d = dateOf(S.today), dm = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dm) { let y = dm[3] ? Number(dm[3]) : d.getFullYear(); if (y < 100) y += 2000; const iso = `${y}-${pad(dm[2])}-${pad(dm[1])}`; return { from: iso, to: iso, label: `Em ${br(iso)}` }; }
    if (/\b(esta semana|essa semana|nesta semana)\b/.test(n)) { const w = weekBounds(); return { from: S.today, to: w.end, label: 'Esta semana' }; }
    if (/\b(semana que vem|proxima semana)\b/.test(n)) { const next = addDays(weekBounds().end, 1); const w = weekBounds(next); return { from: next, to: w.end, label: 'Próxima semana' }; }
    if (/\b(proximo mes|mes que vem)\b/.test(n)) { const x = new Date(d.getFullYear(), d.getMonth() + 1, 1); return { from: isoOf(x), to: isoOf(new Date(x.getFullYear(), x.getMonth() + 1, 0)), label: `Mês que vem · ${MONTH_LABELS[x.getMonth()]}` }; }
    if (/\b(este mes|esse mes|neste mes)\b/.test(n)) return { from: isoOf(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: `Este mês · ${MONTH_LABELS[d.getMonth()]}` };
    const mi = MONTHS.findIndex(m => new RegExp(`\\b${m}\\b`).test(n));
    if (mi >= 0) { const yMatch = n.match(/\b(20\d{2})\b/); const y = yMatch ? Number(yMatch[1]) : (mi < d.getMonth() ? d.getFullYear() + 1 : d.getFullYear()); return { from: isoOf(new Date(y, mi, 1)), to: isoOf(new Date(y, mi + 1, 0)), label: `${MONTH_LABELS[mi]} de ${y}` }; }
    if (/\b(hoje|agora|em andamento|atual|atuais)\b/.test(n)) return { from: S.today, to: S.today, label: 'Hoje' };
    return null;
  }
  function interpret(raw) {
    const text = norm(raw), n = ` ${text} `;
    const q = { raw, products: new Set(), modules: new Set(), range: interpretedRange(n), terms: [], flags: {}, focus: '', chips: [] };
    const productPatterns = [
      [/(^| )(pos|pos graduacao|posgraduacao|especializacao|hibrida|mba)( |$)/, 'pos_hibrida'],
      [/(^| )(graduacao|grad|ead|faculdade)( |$)/, 'graduacao'],
      [/(^| )(tecnico|tecnicos|tec)( |$)/, 'tecnicos'],
      [/(^| )(profissionalizante|profissionalizantes|profis)( |$)/, 'profissionalizante'],
      [/(^| )(presencial|presenciais)( |$)/, 'presencial']
    ];
    for (const [re, id] of productPatterns) if (re.test(n)) q.products.add(id);
    for (const m of n.matchAll(/\b(\d{2})\b/g)) if (S.data.ocorrencias.some(o => String(o.modulo).toLowerCase() === m[1])) q.modules.add(m[1]);
    for (const m of n.matchAll(/\b([12])\s*(?:a|o)?\s*(?:s|sem|semestre)\b/g)) q.modules.add(`${m[1]}s`);
    if (/\bmodulo atual\b/.test(n)) for (const id of selectedProducts()) { const o = moduleFor(id); if (o) q.modules.add(String(o.modulo).toLowerCase()); }
    if (/\b(proximo modulo|modulo seguinte)\b/.test(n)) for (const id of selectedProducts()) { const o = moduleFor(id, true); if (o) q.modules.add(String(o.modulo).toLowerCase()); }
    if (/\b(termina|terminar|acaba|encerra|fecha|fim|ultimo dia|ate quando)\b/.test(n)) q.focus = 'fim';
    else if (/\b(comeca|lanca|abre|inicio|primeiro dia|quando sai)\b/.test(n)) q.focus = 'inicio';
    q.flags.discipline = /\b1a\s*disciplina\b/.test(n) ? 1 : /\b2a\s*disciplina\b/.test(n) ? 2 : 0;
    q.flags.sub = /\bsub\b/.test(n);
    q.flags.audience = /\bveteranos\b/.test(n) ? 'veteranos' : /\bingressantes\b/.test(n) ? 'ingressantes' : '';
    q.flags.payment = /\binadimplentes\b/.test(n) ? 'inadimplentes' : /\badimplentes\b/.test(n) ? 'adimplentes' : '';
    const ignored = new Set('o a os as de da do das dos e em no na nos nas um uma para pra por que qual quais quando quanto onde como eh ser sera vai vao tem ter esta este essa esse isso data datas dia dias prazo prazos acontece acontecendo calendario evento eventos me mostra mostrar ver sobre ate com neste nessa nesse esse aquela aqui la modulo modulos semestre agora hoje amanha semana semanas mes ano atual atuais andamento proximo proxima proximos proximas vem lanca lancamento nota notas disciplina disciplinas sub veteranos ingressantes adimplentes inadimplentes termina terminar acaba encerra fecha fim comeca comecam inicio comecar janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' '));
    const words = text.split(/\s+/).filter(Boolean);
    const productWords = new Set(['pos', 'graduacao', 'grad', 'ead', 'faculdade', 'tecnico', 'tecnicos', 'tec', 'profissionalizante', 'profissionalizantes', 'profis', 'presencial', 'presenciais', 'hibrida', 'mba', 'especializacao']);
    for (const word of words) {
      const synonym = { ra: ['ra'], rematricula: ['rematricula'], renovacao: ['rematricula'], nota: ['nota'], notas: ['nota'], captacao: ['captacao'], inscricao: ['captacao'], inscricoes: ['captacao'], vestibular: ['captacao'], venda: ['captacao'], vendas: ['captacao'], aula: ['letivo'], aulas: ['letivo'], letivo: ['letivo'], aproveitamento: ['aproveitamento'], turma: ['turma'], turmas: ['turma'], fechamento: ['fechamento'], secretaria: ['secretaria'], financeiro: ['financeiro'], asm: ['asm'] }[word];
      if (synonym) { q.terms.push(synonym); continue; }
      if (ignored.has(word) || productWords.has(word) || /^\d/.test(word) || /^\d{4}$/.test(word) || ['a', 'o'].includes(word)) continue;
      q.terms.push([word.length > 4 ? word.replace(/s$/, '') : word]);
    }
    const addChip = (label, token) => q.chips.push({ label, token });
    if (S.product !== 'todos') addChip(prodName(S.product), '__selected_product__');
    for (const id of q.products) if (id !== S.product) addChip(prodName(id), id);
    for (const id of q.modules) addChip(/s$/.test(id) ? `${id[0]}º semestre` : `Módulo ${id}`, id);
    if (q.range) addChip(q.range.label, q.range.label);
    if (q.flags.discipline) addChip(`${q.flags.discipline}ª disciplina`, `${q.flags.discipline}ª disciplina`);
    if (q.flags.sub) addChip('SUB', 'SUB');
    if (q.flags.audience) addChip(q.flags.audience, q.flags.audience);
    if (q.flags.payment) addChip(q.flags.payment, q.flags.payment);
    for (const term of q.terms) addChip(term.join(' / '), term[0]);
    return q;
  }
  function occurrenceText(o) { return norm(`${o.evento} ${o.categoria} ${o.observacao || o.observacoes || ''} ${prodName(o.produto)} ${o.modulo}`); }
  function hasOrdinal(text, ordinal) {
    const n = ` ${norm(text)} `;
    const patterns = ordinal === 1 ? [/\b1a\s*disciplina\b/, /\bdisciplina\s*1\b/, /\bprimeira\s*disciplina\b/] : [/\b2a\s*disciplina\b/, /\bdisciplina\s*2\b/, /\bsegunda\s*disciplina\b/];
    return patterns.some(re => re.test(n));
  }
  function matches(q) {
    const explicitProducts = q.products.size ? q.products : null;
    const selected = new Set(selectedProducts());
    return filteredOccurrences().filter(o => {
      if (!selected.has(o.produto) || (explicitProducts && !explicitProducts.has(o.produto))) return false;
      if (q.modules.size && !q.modules.has(String(o.modulo).toLowerCase())) return false;
      if (q.range && norm(o.evento) === 'periodo letivo') return false;
      if (q.range && (o.fim < q.range.from || o.inicio > q.range.to)) return false;
      const hay = occurrenceText(o);
      if (q.flags.discipline && !hasOrdinal(`${o.evento} ${o.categoria} ${o.observacao || ''}`, q.flags.discipline)) return false;
      if (q.flags.sub && !/\bsub\b/.test(hay)) return false;
      if (q.flags.audience && !new RegExp(`\\b${q.flags.audience}\\b`).test(hay)) return false;
      if (q.flags.payment && !new RegExp(`\\b${q.flags.payment}\\b`).test(hay)) return false;
      if (q.terms.length && !q.terms.every(alternatives => alternatives.some(term => term.length <= 3 ? new RegExp(`\\b${term}\\b`).test(hay) : hay.includes(term)))) return false;
      return true;
    });
  }
  const score = o => status(o) === 'ativo' ? 0 : status(o) === 'proximo' ? 1 + diffDays(S.today, o.inicio) / 1000 : 3 + diffDays(o.fim, S.today) / 1000;
  function groupedRows(rows) {
    const map = new Map();
    for (const o of rows) {
      const name = eventName(o), key = `${norm(name)}|${o.inicio}|${o.fim}`;
      if (!map.has(key)) map.set(key, { name, inicio: o.inicio, fim: o.fim, category: o.categoria, rows: [] });
      map.get(key).rows.push(o);
    }
    return [...map.values()].sort((a, b) => score({ inicio: a.inicio, fim: a.fim }) - score({ inicio: b.inicio, fim: b.fim }));
  }
  function resultCard(group, focus = '') {
    const modules = [...new Set(group.rows.map(o => `${prodName(o.produto)} · ${modLabel(o.produto, o.modulo)}`))];
    const representative = group.rows[0], stamp = group.inicio === group.fim ? `Dia ${br(group.inicio)}` : focus === 'fim' ? `Termina em ${br(group.fim)}` : focus === 'inicio' ? `Começa em ${br(group.inicio)}` : `${br(group.inicio)} a ${br(group.fim)}`;
    const all = group.rows.map(o => observations(o)).filter(Boolean);
    return `<article class="answer-event"><span class="st st-${status(representative)}">${esc(statusLabel[status(representative)])}</span><h3>${esc(group.name)}</h3><p class="answer-context">${esc(modules.join(' / '))}</p><time class="answer-date" datetime="${esc(group.inicio)}">${esc(stamp)}</time><p class="answer-relative">${esc(relative(representative))}</p><button type="button" class="text-button" data-open-event="${esc(group.name)}">Ver detalhes do evento</button>${all.length ? `<p class="answer-note">${esc([...new Set(all)].join(' · '))}</p>` : ''}</article>`;
  }
  function removeChip(token) {
    if (!token) return;
    if (token === '__selected_product__') {
      S.product = 'todos'; $('myProduct').value = S.product;
      try { localStorage.setItem(STORAGE_KEY, S.product); } catch (_) { /* armazenamento local indisponível */ }
      renderNow(); renderAgenda(); renderCategoryShortcuts(); renderCalendar();
      if ($('categoryResults') && !$('categoryResults').classList.contains('hidden')) renderCategoryResults();
      ask($('q').value);
      return;
    }
    const raw = $('q').value;
    let next = raw;
    if (/semana/i.test(token)) next = raw.replace(/(esta|essa|nesta|pr[oó]xima|semana que vem)\s+semana/ig, '');
    else if (/m[eê]s/i.test(token)) next = raw.replace(/(pr[oó]ximo m[eê]s|m[eê]s que vem|este m[eê]s|esse m[eê]s|neste m[eê]s|\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)( de \d{4})?\b)/ig, '');
    else if (S.data.produtos.some(p => p.id === token)) { const label = prodName(token); next = raw.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''); }
    else if (/^\d{2}$/.test(token)) next = raw.replace(new RegExp(`m[oó]dulo\\s*${token}`, 'i'), '');
    else if (/disciplina/i.test(token)) next = raw.replace(/[12]\s*[ªaºo]?\s*disciplina/ig, '');
    else next = raw.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
    ask(next.replace(/\s+/g, ' ').trim());
  }
  function renderUnderstood(q) {
    if (!q.chips.length) { $('understood').classList.add('hidden'); return; }
    $('understood').innerHTML = `<span class="understood-label">Entendi</span>${q.chips.map((c, i) => `<button type="button" class="chip-removable" data-remove-chip="${i}" aria-label="Remover filtro ${esc(c.label)}">${esc(c.label)} <b aria-hidden="true">×</b></button>`).join('')}`;
    $('understood').classList.remove('hidden');
    $('understood').querySelectorAll('[data-remove-chip]').forEach(b => b.addEventListener('click', () => removeChip(q.chips[Number(b.dataset.removeChip)]?.token)));
  }
  function marcoAnswers(raw) {
    if (!S.marco) return [];
    const n = norm(raw), found = [];
    for (const item of S.marco.perguntas || []) {
      const hits = (item.chaves || []).filter(k => n.includes(norm(k))).length;
      if (hits) found.push({ score: hits + 2, title: item.pergunta, text: item.resposta, tag: 'Processo 51/2027' });
    }
    const catalog = S.marco.portfolio.modalidades.flatMap(m => m.areas.flatMap(a => a.cursos.map(([name, type]) => ({ name, type, modality: m.nome, area: a.area }))));
    const course = catalog.filter(c => n.includes(norm(c.name)) || (norm(c.name).length > 6 && n.includes(norm(c.name).replace(/^engenharia (de )?/, ''))));
    for (const c of course.slice(0, 2)) {
      const group = S.marco.matriz_cursos.grupos.find(g => g.cursos.includes(c.name));
      const scheduleText = group && courseScheduleSummary(group, n);
      found.push({ score: scheduleText ? 10 : 2, title: c.name, text: group ? `${c.modality} · ${group.nome}. ${scheduleText || group.nota || 'A matriz está disponível no Processo 51/2027.'}` : `${c.modality} · ${c.area}. A apresentação não traz uma grade de atividades específica para este curso.`, tag: scheduleText ? 'Rotina do curso' : 'Curso' });
    }
    if (!found.length && /\b(processo 51|51\/2027|marco regulatorio|2027)\b/.test(n)) for (const d of S.marco.destaques.slice(0, 3)) found.push({ score: 1, title: `${d.rotulo}: ${d.valor}`, text: d.detalhe, tag: 'Processo 51/2027' });
    return found.sort((a, b) => b.score - a.score).slice(0, 5);
  }
  function courseScheduleSummary(group, query) {
    const plans = group.jornadas_semanais || [];
    if (!plans.length) return '';
    const activityFilter = /\basm\b/.test(query) ? 'asm' : /\b(presencialidade|polo)\b/.test(query) ? 'presencialidade' : /\b(aula ao vivo|aulas ao vivo|teams)\b/.test(query) ? 'aulas ao vivo' : '';
    const relevant = plans.flatMap(plan => {
      const activities = (plan.atividades || []).filter(item => !activityFilter || norm(item.atividade) === norm(activityFilter));
      if (!activities.length) return [];
      const years = plan.anos.map(year => `${year}º ano`).join(', ');
      return activities.map(item => `${years}: ${item.atividade} · ${item.disciplina} · ${weekRange(item.semanas)} · ${item.onde}`);
    });
    const covered = new Set(plans.flatMap(plan => plan.anos));
    const annualKeys = activityFilter === 'asm' ? ['asm'] : activityFilter === 'presencialidade' ? ['presencialidade'] : activityFilter === 'aulas ao vivo' ? ['aulas'] : ['aulas', 'asm', 'presencialidade'];
    const applicable = Array.from({ length: Number(group.anos) || 0 }, (_, index) => index + 1).filter(year => annualKeys.some(key => group.grade?.[key]?.[year - 1]));
    const missing = applicable.filter(year => !covered.has(year));
    if (missing.length) {
      const labels = missing.map(year => `${year}º ano`).join(', ');
      relevant.push(`Para ${labels}, o vídeo não detalha as semanas; consulte a agenda da disciplina no Studeo.`);
    }
    return relevant.join(' ');
  }
  function ask(raw, push = true) {
    const text = String(raw || '').trim(); $('q').value = text;
    if (push) history.replaceState(null, '', text ? `?q=${encodeURIComponent(text)}${S.visibleArea === 'marco' ? '#marco' : ''}` : location.pathname + (S.visibleArea === 'marco' ? '#marco' : ''));
    const box = $('answer');
    if (!text) { $('understood').classList.add('hidden'); box.classList.add('hidden'); return; }
    const q = interpret(text), rows = matches(q).sort((a, b) => score(a) - score(b) || (a.ordem_categoria || 0) - (b.ordem_categoria || 0));
    const groups = groupedRows(rows), answers = marcoAnswers(text);
    renderUnderstood(q);
    const allFiltered = q.flags.discipline || q.flags.sub || q.flags.audience || q.flags.payment;
    let html = '';
    if (groups.length) {
      const main = groups[0];
      html += `<div class="section-head"><div><p class="eyebrow">RESPOSTA DIRETA · CALENDÁRIO ACADÊMICO</p><h2>${groups.length === 1 ? 'Encontrei este prazo' : 'Prazo mais relevante'}</h2></div><button type="button" class="mini" id="clearAsk">Limpar busca</button></div>${resultCard(main, q.focus)}`;
      if (groups.length > 1) html += `<div class="see-also"><h3>Veja também</h3><ul>${groups.slice(1, 6).map(g => `<li>${resultCard(g, q.focus)}</li>`).join('')}</ul></div>`;
    } else if (answers.length) {
      html += `<div class="section-head"><div><p class="eyebrow">RESPOSTA DIRETA · PROCESSO 51/2027</p><h2>Encontrei esta orientação</h2></div><button type="button" class="mini" id="clearAsk">Limpar busca</button></div><div class="faq-answer"><span class="st st-proximo">${esc(answers[0].tag)}</span><h3>${esc(answers[0].title)}</h3><p>${esc(answers[0].text)}</p><button type="button" class="text-button" data-area-go="marco">Abrir Processo 51/2027</button></div>${answers.length > 1 ? `<div class="see-also"><h3>Veja também</h3><ul>${answers.slice(1, 6).map(a => `<li><article class="faq-answer"><span class="st st-proximo">${esc(a.tag)}</span><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></article></li>`).join('')}</ul></div>` : ''}`;
    } else {
      const term = allFiltered ? 'Não encontrei datas com todos esses filtros.' : 'Não encontrei essa informação.';
      html = `<div class="answer-empty"><p class="eyebrow">BUSCA</p><h2>${term}</h2><p>Confira os filtros marcados e tente outro termo. Para temas acadêmicos, busque também no Processo 51/2027.</p><button type="button" class="mini" id="clearAsk">Limpar busca</button><button type="button" class="mini" data-area-go="marco">Abrir Processo 51/2027</button></div>`;
    }
    box.innerHTML = html; box.classList.remove('hidden');
    $('clearAsk')?.addEventListener('click', () => ask(''));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSuggestions() {
    const suggestions = ['O que acontece esta semana?', 'Lançamento de notas', 'Geração de RA do próximo módulo', 'Rematrícula', 'Aproveitamento de estudos veteranos', 'Média mínima 2027'];
    $('suggestions').innerHTML = suggestions.map(s => `<button type="button" data-ask="${esc(s)}">${esc(s)}</button>`).join('');
  }

  function currentModuleCard(product) {
    const periods = S.data.ocorrencias.filter(o => o.produto === product.id && norm(o.evento) === 'periodo letivo').sort((a, b) => a.inicio.localeCompare(b.inicio));
    const current = periods.find(o => status(o) === 'ativo'), next = periods.find(o => o.inicio > S.today);
    const featured = S.product === product.id;
    if (!featured) return `<article class="now compact"><span class="now-prod">${esc(product.nome)}</span><strong>${current ? esc(modLabel(product.id, current.modulo)) : next ? `A seguir · ${esc(modLabel(product.id, next.modulo))}` : 'Sem módulo'}</strong><small>${current ? esc(relative(current)) : next ? `${br(next.inicio)} · ${esc(relative(next))}` : 'Sem período cadastrado.'}</small></article>`;
    if (!current) return `<article class="now now-featured"><span class="now-prod">${esc(product.nome)}</span><strong>${next ? `Próximo · ${esc(modLabel(product.id, next.modulo))}` : 'Sem módulo em andamento'}</strong><small>${next ? `${br(next.inicio)} · ${esc(relative(next))}` : 'Nenhum período letivo disponível no calendário.'}</small></article>`;
    const total = diffDays(current.inicio, current.fim) + 1, elapsed = diffDays(current.inicio, S.today) + 1, pct = Math.max(0, Math.min(100, Math.round(elapsed / total * 100)));
    return `<button type="button" class="now now-featured" data-ask="${esc(`${product.nome} módulo ${current.modulo}`)}"><span class="now-prod">${esc(product.nome)}</span><strong>${esc(modLabel(product.id, current.modulo))}</strong><span class="progress" aria-label="${pct}% do período"><i data-w="${pct}"></i></span><small>${br(current.inicio)} a ${br(current.fim)} · ${esc(relative(current))}${next ? ` · próximo: ${esc(modLabel(product.id, next.modulo))} em ${br(next.inicio)}` : ''}</small></button>`;
  }
  function renderNow() {
    $('nowGrid').innerHTML = S.data.produtos.map(currentModuleCard).join('');
    $('nowGrid').querySelectorAll('.progress > i[data-w]').forEach(el => { el.style.width = `${el.dataset.w}%`; });
    renderHeroContext();
  }
  function renderHeroContext() {
    const date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const chosen = S.product === 'todos' ? S.data.produtos[0]?.id : S.product;
    const period = chosen && moduleFor(chosen);
    const suffix = period ? ` · ${prodName(chosen)} · ${modLabel(chosen, period.modulo)} (${relative(period)})` : '';
    $('today').textContent = `${date}${suffix}`;
  }

  function agendaEntries(from, to, includeActive = false) {
    const source = filteredOccurrences().filter(o => norm(o.evento) !== 'periodo letivo'), entries = [];
    for (const o of source) {
      if (includeActive && o.inicio <= from && o.fim >= from) entries.push({ date: from, type: o.inicio === o.fim || o.inicio < from ? 'Dia' : 'Começa', row: o });
      if (o.inicio >= from && o.inicio <= to && !(includeActive && o.inicio === from)) entries.push({ date: o.inicio, type: o.inicio === o.fim ? 'Dia' : 'Começa', row: o });
      if (o.fim !== o.inicio && o.fim >= from && o.fim <= to && !(includeActive && o.inicio <= from && o.fim >= from && o.fim === from)) entries.push({ date: o.fim, type: 'Termina', row: o });
    }
    const groups = new Map();
    for (const e of entries) {
      const key = `${e.date}|${e.type}|${norm(eventName(e.row))}`;
      if (!groups.has(key)) groups.set(key, { date: e.date, type: e.type, event: eventName(e.row), rows: [] });
      groups.get(key).rows.push(e.row);
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.event.localeCompare(b.event, 'pt-BR'));
  }
  function agendaHtml(items, emptyText) {
    if (!items.length) return `<li class="empty">${esc(emptyText)}</li>`;
    return items.map(item => {
      const productTags = [...new Set(item.rows.map(o => prodName(o.produto)))], modules = [...new Set(item.rows.map(o => `${prodName(o.produto)} · ${modLabel(o.produto, o.modulo)}`))];
      return `<li class="agenda-item"><time class="date" datetime="${esc(item.date)}">${esc(brShort(item.date))}</time><button type="button" data-open-event="${esc(item.event)}"><b>${esc(item.type)}: ${esc(item.event)}</b><span>${modules.map(esc).join(' · ')}</span><span class="product-tags">${productTags.map(p => `<i>${esc(p)}</i>`).join('')}</span><small>${esc(item.date === S.today ? 'Hoje' : relative({ inicio: item.date, fim: item.date }))}</small></button></li>`;
    }).join('');
  }
  function renderAgenda() {
    const today = S.today, week = weekBounds(today), restWeekFrom = addDays(today, 1), nextFourFrom = addDays(week.end, 1), nextFourTo = addDays(nextFourFrom, 27);
    $('todayLabel').textContent = br(today);
    $('weekLabel').textContent = `${br(restWeekFrom)} a ${br(week.end)}`;
    $('monthLabel').textContent = `${br(nextFourFrom)} a ${br(nextFourTo)}`;
    $('weekList').innerHTML = agendaHtml(restWeekFrom <= week.end ? agendaEntries(restWeekFrom, week.end) : [], 'Sem outros prazos nesta semana.');
    $('todayList').innerHTML = agendaHtml(agendaEntries(today, today, true), 'Nenhum prazo para hoje.');
    $('monthList').innerHTML = agendaHtml(agendaEntries(nextFourFrom, nextFourTo), 'Nenhum prazo nas próximas quatro semanas.');
  }

  function renderCategoryShortcuts() {
    $('categoryShortcuts').innerHTML = CATEGORY_LABELS.map(label => `<button type="button" class="category-pill" data-category="${esc(label)}" aria-pressed="${S.category === label}">${esc(label)}</button>`).join('');
    $('categoryShortcuts').querySelectorAll('[data-category]').forEach(b => b.addEventListener('click', () => {
      S.category = b.dataset.category; renderCategoryShortcuts(); renderCategoryResults(); $('categoryResults').classList.remove('hidden');
    }));
  }
  function groupByEventModule(rows) {
    const map = new Map();
    for (const o of rows) {
      const key = `${norm(eventName(o))}|${o.modulo}`;
      if (!map.has(key)) map.set(key, { event: eventName(o), module: o.modulo, rows: [] });
      map.get(key).rows.push(o);
    }
    return [...map.values()].sort((a, b) => (moduleFor(a.rows[0].produto)?.modulo === a.module ? -1 : 0) - (moduleFor(b.rows[0].produto)?.modulo === b.module ? -1 : 0) || String(a.module).localeCompare(String(b.module), 'pt-BR', { numeric: true }) || a.event.localeCompare(b.event, 'pt-BR'));
  }
  function renderCategoryResults() {
    const rows = filteredOccurrences().filter(o => categoryOf(o.categoria) === S.category), groups = groupByEventModule(rows);
    const currentMods = new Set(selectedProducts().map(id => moduleFor(id)?.modulo).filter(Boolean).map(String));
    const current = groups.filter(g => currentMods.has(String(g.module))), rest = groups.filter(g => !currentMods.has(String(g.module)));
    const item = g => {
      const first = g.rows[0], products = [...new Set(g.rows.map(o => prodName(o.produto)))], dates = [...new Set(g.rows.map(dateRange))];
      return `<button type="button" class="category-event" data-open-event="${esc(g.event)}"><span class="category-event-heading"><b>${esc(g.event)}</b><i>${esc(dates.join(' · '))}</i></span><span>${esc(products.join(' · '))} · ${esc(modLabel(first.produto, g.module))}</span><small>${esc(relative(first))}</small></button>`;
    };
    $('categoryResults').innerHTML = `<div class="section-head"><div><p class="eyebrow">${esc(S.category)}</p><h3>${esc(S.category)}</h3></div><button type="button" class="mini" id="closeCategory">Fechar categoria</button></div>${current.length ? `<div class="current-category"><h4>Módulo atual</h4>${current.map(item).join('')}</div>` : ''}<details class="other-modules" ${!current.length ? 'open' : ''}><summary>Demais módulos <span>${rest.length} evento(s)</span></summary><div>${rest.length ? rest.map(item).join('') : '<p class="empty">Nenhum evento desta categoria nos demais módulos.</p>'}</div></details>`;
    $('closeCategory').addEventListener('click', () => $('categoryResults').classList.add('hidden'));
  }

  function renderCalendar() {
    const all = filteredOccurrences().filter(o => o.ano === S.year), query = norm(S.matrixSearch);
    const rows = all.filter(o => (!S.currentOnly || selectedProducts().includes(o.produto) && String(moduleFor(o.produto)?.modulo || '') === String(o.modulo)) && (!query || norm(`${o.evento} ${o.categoria} ${o.produto}`).includes(query)));
    if (!rows.length) { $('matrix').innerHTML = '<p class="empty">Nenhum evento corresponde aos filtros selecionados.</p>'; return; }
    const products = S.product === 'todos' ? S.data.produtos : S.data.produtos.filter(p => p.id === S.product);
    $('matrix').innerHTML = products.map(product => {
      const pRows = rows.filter(o => o.produto === product.id); if (!pRows.length) return '';
      const modules = [...new Set([...(product.modulos || []).map(String), ...pRows.map(o => String(o.modulo))])].filter(m => !S.currentOnly || String(moduleFor(product.id)?.modulo || '') === m).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      const categories = [...new Set(pRows.map(o => o.categoria))].sort((a, b) => (pRows.find(o => o.categoria === a)?.ordem_categoria || 999) - (pRows.find(o => o.categoria === b)?.ordem_categoria || 999) || a.localeCompare(b, 'pt-BR'));
      return `<details class="product-matrix" ${S.product !== 'todos' ? 'open' : ''}><summary>${esc(product.nome)} <span>${pRows.length} prazo(s)</span></summary>${categories.map(category => {
        const cRows = pRows.filter(o => o.categoria === category), events = [...new Set(cRows.map(eventName))];
        return `<details class="matrix-category"><summary>${esc(category)} <span>${events.length} evento(s)</span></summary><div class="table-wrap"><table class="matrix"><thead><tr><th>Evento</th>${modules.map(m => `<th>${esc(modLabel(product.id, m))}</th>`).join('')}</tr></thead><tbody>${events.map(name => `<tr><td class="ev"><button type="button" class="event-open" data-open-event="${esc(name)}">${esc(name)}</button>${observations(cRows.find(o => eventName(o) === name) || {}) ? `<span class="sub">${esc(observations(cRows.find(o => eventName(o) === name) || {}))}</span>` : ''}</td>${modules.map(module => { const o = cRows.find(x => eventName(x) === name && String(x.modulo) === module); return o ? `<td class="cell st-${status(o)}" title="${esc(statusLabel[status(o)] + ' · ' + relative(o))}"><b>${esc(br(o.inicio).slice(0, 5))}</b>${o.fim !== o.inicio ? ` a <b>${esc(br(o.fim).slice(0, 5))}</b>` : ''}<span>${esc(o.inicio.slice(0, 4))}</span></td>` : '<td class="cell none">—</td>'; }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
      }).join('')}</details>`;
    }).join('');
  }
  function renderProductSelect() {
    $('myProduct').innerHTML = `<option value="todos">Todos os produtos</option>${S.data.produtos.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}`;
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved && (saved === 'todos' || S.data.produtos.some(p => p.id === saved))) S.product = saved; } catch (_) { /* valor padrão: Graduação EAD */ }
    $('myProduct').value = S.product;
    $('myProduct').addEventListener('change', () => {
      S.product = $('myProduct').value;
      try { localStorage.setItem(STORAGE_KEY, S.product); } catch (_) { /* armazenamento local indisponível */ }
      renderNow(); renderAgenda(); renderCategoryShortcuts(); renderCalendar();
      if ($('categoryResults') && ! $('categoryResults').classList.contains('hidden')) renderCategoryResults();
      const query = $('q').value.trim(); if (query) ask(query, false);
    });
  }
  function renderYears() {
    const years = S.data.anos;
    const currentYear = S.today.slice(0, 4);
    S.year = years.includes(currentYear) ? currentYear : (years[years.length - 1] || currentYear);
    $('yearSel').innerHTML = years.map(y => `<option value="${esc(y)}" ${y === S.year ? 'selected' : ''}>${esc(y)}</option>`).join('');
    $('yearSel').addEventListener('change', () => { S.year = $('yearSel').value; renderCalendar(); });
  }

  function openEvent(name) {
    const key = norm(name), rows = S.data.ocorrencias.filter(o => norm(eventName(o)) === key).sort((a, b) => a.inicio.localeCompare(b.inicio) || a.produto.localeCompare(b.produto));
    $('eventTitle').textContent = eventName({ evento: name });
    const entries = rows.map(o => `<article class="event-detail-row"><div><b>${esc(prodName(o.produto))} · ${esc(modLabel(o.produto, o.modulo))}</b><span>${esc(o.categoria)}</span></div><time datetime="${esc(o.inicio)}">${esc(dateRange(o))}</time><small>${esc(relative(o))}</small>${observations(o) ? `<p>Observação: ${esc(observations(o))}</p>` : ''}</article>`);
    $('eventBody').innerHTML = entries.length ? entries.join('') : '<p class="empty">Não há outros detalhes cadastrados para este evento.</p>';
    $('eventDialog').showModal();
  }
  $('closeEvent').addEventListener('click', () => $('eventDialog').close());
  $('eventDialog').addEventListener('click', e => { if (e.target === $('eventDialog')) $('eventDialog').close(); });
  document.addEventListener('click', e => { const b = e.target.closest('[data-open-event]'); if (b) openEvent(b.dataset.openEvent); });

  // Processo 51/2027: conteúdo vem integralmente de marco-regulatorio-51-2027.json.
  const M = { data: null, course: '', courseYear: '1', portfolioQuery: '', portfolioModality: 0 };
  const yesNo = value => value ? '<span class="yes" aria-label="Sim">✓</span>' : '<span class="no" aria-label="Não">✕</span>';
  function gradeHtml(group) {
    const mz = M.data.matriz_cursos, max = Math.max(...Object.values(group.grade).map(a => a.length));
    return `<div class="table-wrap"><table class="grade"><thead><tr><th>Atividade</th>${Array.from({ length: max }, (_, i) => `<th>${i + 1}º ano<span class="sub">${esc(mz.fases[i] || '')}</span></th>`).join('')}</tr></thead><tbody>${mz.linhas.map(line => `<tr><td><b>${esc(line.rotulo)}</b>${line.detalhe ? `<span class="sub">${esc(line.detalhe)}</span>` : ''}</td>${(group.grade[line.id] || []).map(v => `<td class="c ${v ? 'is-yes' : 'is-no'}">${yesNo(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${group.nota ? `<p class="sub">${esc(group.nota)}</p>` : ''}`;
  }
  function sectionContent(section) {
    if (!section) return '';
    return `${section.itens ? `<div class="m-itens">${section.itens.map(i => `<article class="m-item"><b>${esc(i.titulo)}</b><p>${esc(i.texto)}</p></article>`).join('')}</div>` : ''}${section.tabela ? `<div class="m-tabela"><h4>${esc(section.tabela.titulo)}</h4><div class="table-wrap"><table><thead><tr>${section.tabela.colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${section.tabela.linhas.map((row, i, all) => `<tr class="${i === all.length - 1 ? 'total' : ''}">${row.map((cell, j) => `<td class="${j ? 'n' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="sub">${esc(section.tabela.nota || '')}</p></div>` : ''}${section.cartoes ? `<div class="m-cartoes">${section.cartoes.map(card => `<article class="m-cartao"><h4>${esc(card.titulo)}</h4><span class="chip">${esc(card.selo)}</span><ul>${card.pontos.map(p => `<li>${esc(p)}</li>`).join('')}</ul><p><b>Frequência:</b> ${esc(card.frequencia)}</p><p><b>Agendamento:</b> ${esc(card.agendamento)}</p></article>`).join('')}</div>` : ''}${section.nota ? `<p class="sub">${esc(section.nota)}</p>` : ''}`;
  }
  function marcoCourseCatalog() {
    return M.data.portfolio.modalidades.flatMap((modality, mi) => modality.areas.flatMap((area, ai) => area.cursos.map(([name, type], ci) => ({ key: `${mi}-${ai}-${ci}`, name, type, typeName: M.data.portfolio.tipos[type] || 'Curso', modality: modality.nome, area: area.area }))));
  }
  function activityGuideHtml() {
    const section = M.data.secoes.find(s => s.id === 'atividades');
    if (!section?.cartoes?.length) return '';
    return `<details class="activity-guide"><summary><span><b>O que significam ASM, presencialidade e aula ao vivo?</b><small>Onde acontece, frequência e agendamento</small></span><i aria-hidden="true"></i></summary><div class="activity-guide-body"><div class="activity-guide-grid">${section.cartoes.map(card => `<article class="activity-guide-card"><div class="activity-guide-title"><h5>${esc(card.titulo)}</h5><span class="chip">${esc(card.selo)}</span></div><p><b>Onde:</b> ${esc(card.onde || 'Consulte as orientações da disciplina no Studeo.')}</p><ul>${(card.pontos || []).map(point => `<li>${esc(point)}</li>`).join('')}</ul><p><b>Frequência:</b> ${esc(card.frequencia)}</p><p><b>Agendamento:</b> ${esc(card.agendamento)}</p></article>`).join('')}</div></div></details>`;
  }
  function weekRange(weeks = []) {
    if (!weeks.length) return '—';
    const sorted = [...weeks].sort((a, b) => a - b), ranges = [];
    let start = sorted[0], end = start;
    for (const week of sorted.slice(1)) {
      if (week === end + 1) { end = week; continue; }
      ranges.push(start === end ? `Semana ${start}` : `Semanas ${start}–${end}`);
      start = end = week;
    }
    ranges.push(start === end ? `Semana ${start}` : `Semanas ${start}–${end}`);
    return ranges.join(', ');
  }
  function presenceLocation(group, course) {
    if (group?.nome === 'Engenharias e Agronomia') return 'No Polo de Apoio, em sala de aula e/ou laboratório específico; atividade teórica e prática.';
    if (group?.nome === 'Educação Física') return 'Presencial, em sala de aula; algumas disciplinas podem usar espaço conveniado com quadra.';
    if (group?.nome === 'Licenciaturas' || /acompanhamento do transtorno do espectro autista/i.test(course.name)) return 'No Mova Play, em ambiente virtual; o vídeo não indica ida ao Polo físico.';
    if (/automação industrial|manutenção industrial/i.test(course.name)) return 'No Polo de Apoio, em sala de aula e/ou laboratório específico do curso.';
    return 'No Polo de Apoio; o curso define sala, laboratório ou outro espaço conforme o Studeo.';
  }
  function weeklyLegendHtml(course, group) {
    const presence = presenceLocation(group, course);
    const isVirtual = /mova play/i.test(presence);
    const placeClass = isVirtual ? 'place-mova' : 'place-polo';
    const presencePrefix = isVirtual ? 'Presencialidade teórica · Mova Play' : 'Presencialidade · Polo de Apoio';
    return `<div class="weekly-legend"><span class="place-tag place-online">ASM e aula ao vivo · online</span><span class="place-tag ${placeClass}">${esc(presencePrefix)}</span><span class="place-tag place-prova">Prova presencial · confira local no Studeo</span></div>`;
  }
  function yearActivitySummary(group, year, course) {
    const index = Number(year) - 1;
    const applicable = M.data.matriz_cursos.linhas.filter(line => Boolean(group.grade?.[line.id]?.[index]));
    const location = line => {
      if (line.id === 'aulas') return 'Online, via Teams; pode acompanhar de casa (1h30 por encontro).';
      if (line.id === 'asm') return 'Online e em tempo real; pode acompanhar de casa, sem deslocamento ao Polo (3h por encontro).';
      if (line.id === 'provas') return 'Presencial nas semanas 9 e 10; confira no Studeo a data e o local da prova.';
      if (line.id === 'extensao') return 'O vídeo indica que se aplica neste ano, mas não especifica semana ou local.';
      if (line.id === 'presencialidade') return presenceLocation(group, course);
      return 'Consulte as orientações da disciplina no Studeo.';
    };
    if (!applicable.length) return '';
    return `<aside class="year-summary"><b>O que o vídeo confirma para o ${esc(year)}º ano</b><ul>${applicable.map(line => `<li><strong>${esc(line.rotulo)}:</strong> ${esc(location(line))}</li>`).join('')}</ul></aside>`;
  }
  function weeklyPlanHtml(course, group, isEad) {
    const isException = M.data.jornada_ead?.excecoes?.some(name => norm(name) === norm(course.name));
    const planGroups = isEad ? (isException ? [] : [{ anos: [1], atividades: M.data.jornada_ead?.atividades || [], nota: M.data.jornada_ead?.nota || '' }]) : (group?.jornadas_semanais || []);
    if (!planGroups.length && (isEad || !group)) {
      const message = isException
        ? 'O vídeo informa que este curso não tem aulas ao vivo. Ele não detalha uma grade semanal específica; consulte as atividades da disciplina no Studeo.'
        : `O vídeo mostra quais atividades se aplicam por ano, mas não informa as semanas para ${esc(course.name)}. Consulte o calendário da disciplina no Studeo para confirmar a agenda.`;
      return `<section class="weekly-plan"><header><div><p class="eyebrow">ROTINA DO CURSO</p><h4>Semana a semana</h4></div></header><p class="weekly-notice">${message}</p>${group ? `<details class="annual-overview" open><summary>O que o vídeo informa por ano</summary>${gradeHtml(group)}</details>` : ''}</section>`;
    }
    const courseYears = !isEad && group ? Number(group.anos) : 1;
    const availableYears = Array.from({ length: courseYears }, (_, index) => index + 1);
    if (!availableYears.includes(Number(M.courseYear))) M.courseYear = String(availableYears[0]);
    const active = planGroups.find(item => item.anos.includes(Number(M.courseYear)));
    const activities = active?.atividades || [];
    const rows = activities.map(item => `<tr><td><b>${esc(weekRange(item.semanas))}</b></td><td><strong>${esc(item.atividade)}</strong>${item.detalhe ? `<span class="weekly-detail">${esc(item.detalhe)}</span>` : ''}</td><td>${esc(item.disciplina)}</td><td><span class="place-tag place-${esc(item.tipo)}">${esc(item.onde)}</span></td></tr>`).join('');
    const yearOptions = availableYears.map(year => `<option value="${year}" ${year === Number(M.courseYear) ? 'selected' : ''}>${year}º ano</option>`).join('');
    const hasWeeklyDetail = Boolean(active?.atividades?.length);
    const detailedYears = [...new Set(planGroups.flatMap(plan => plan.anos))].sort((a, b) => a - b);
    const detailedYearsLabel = detailedYears.length ? detailedYears.map(year => `${year}º`).join(', ').replace(/, ([^,]+)$/, ' e $1') : '';
    const missingYearNote = !hasWeeklyDetail ? `${yearActivitySummary(group, M.courseYear, course)}<p class="weekly-notice">O vídeo não detalha as semanas para o ${M.courseYear}º ano de ${esc(course.name)}. Ele confirma as atividades aplicáveis acima, mas não informa em quais semanas elas acontecem neste ano. Confira as datas e os agendamentos no Studeo.</p>` : '';
    return `<section class="weekly-plan" aria-labelledby="weeklyPlanTitle"><header><div><p class="eyebrow">ROTINA DO CURSO</p><h4 id="weeklyPlanTitle">O que acontece em cada semana</h4><p>Organização apresentada para ${esc(course.name)}. Escolha seu ano:</p></div>${courseYears > 1 ? `<label class="field year-field"><span>Ano do curso</span><select id="courseYear">${yearOptions}</select></label>` : ''}</header>${weeklyLegendHtml(course, group)}${hasWeeklyDetail ? `<div class="table-wrap weekly-table-wrap"><table class="weekly-table"><thead><tr><th>Quando</th><th>Atividade</th><th>Disciplina</th><th>Onde acontece</th></tr></thead><tbody>${rows}</tbody></table></div>` : missingYearNote}${active?.nota ? `<p class="weekly-notice">${esc(active.nota)}</p>` : ''}${group ? `<details class="annual-overview" ${!hasWeeklyDetail ? 'open' : ''}><summary>Ver a matriz de atividades por ano</summary>${gradeHtml(group)}</details>` : ''}</section>`;

  }
  function renderCourseCard() {
    const host = $('courseCard'), course = marcoCourseCatalog().find(c => c.key === M.course);
    if (!course) { host.innerHTML = '<div class="course-empty"><b>Selecione um curso</b><p>Escolha um curso para consultar somente as informações aplicáveis.</p></div>'; return; }
    const isEad = /ead/i.test(course.modality), matrix = !isEad && M.data.matriz_cursos.grupos.find(g => g.cursos.includes(course.name));
    if (isEad) {
      host.innerHTML = `<article class="course-rule-card"><header><p class="eyebrow">${esc(course.modality)} · ${esc(course.area)}</p><h3>${esc(course.name)}</h3><p>Confira acima as regras comuns EaD; abaixo, a rotina semanal deste curso, quando informada no material.</p></header>${weeklyPlanHtml(course, null, true)}</article>`;
      return;
    }
    host.innerHTML = `<article class="course-rule-card"><header><p class="eyebrow">${esc(course.modality)} · ${esc(course.area)} · ${esc(course.typeName)}</p><h3>${esc(course.name)}</h3></header>${/semipresencial/i.test(course.modality) ? activityGuideHtml() : ''}${weeklyPlanHtml(course, matrix, false)}</article>`;
    $('courseYear')?.addEventListener('change', e => { M.courseYear = e.target.value; renderCourseCard(); });
  }
  function renderCourseOptions(search = '') {
    const catalog = marcoCourseCatalog(), q = norm(search), options = catalog.filter(c => !q || norm(`${c.name} ${c.area} ${c.modality} ${c.typeName}`).includes(q));
    const groups = new Map();
    for (const course of options) { const group = `${course.modality} · ${course.area}`; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(course); }
    $('courseSelect').innerHTML = `<option value="">Selecione um curso</option>${[...groups.entries()].map(([label, courses]) => `<optgroup label="${esc(label)}">${courses.map(c => `<option value="${esc(c.key)}">${esc(c.name)} · ${esc(c.typeName)}</option>`).join('')}</optgroup>`).join('')}`;
    if (options.some(c => c.key === M.course)) $('courseSelect').value = M.course; else { M.course = ''; $('courseSelect').value = ''; }
    $('courseCount').textContent = `${options.length} curso(s)`;
    renderCourseCard();
  }
  function renderFaq() {
    const questions = M.data.perguntas || [], sections = M.data.secoes || [];
    const skip = new Set(['qual a media minima para aprovacao', 'quantas semanas tem cada disciplina', 'como e a avaliacao presencial', 'como e composta a nota da disciplina']);
    const sectionsByQuestion = {
      'quais as regras de aproveitamento de estudos': ['aproveitamento'],
      'o que e o espaco calouro': ['calouro']
    };
    const faq = questions.filter(q => !skip.has(norm(q.pergunta))).map(q => {
      const attached = (sectionsByQuestion[norm(q.pergunta)] || []).map(id => sections.find(s => s.id === id)).filter(Boolean);
      const extras = attached.map(sectionContent).filter(Boolean).join('');
      return `<details class="faq-item"><summary>${esc(q.pergunta)}<i aria-hidden="true"></i></summary><div><p>${esc(q.resposta)}</p>${extras}</div></details>`;
    });
    const jornada = sections.find(s => s.id === 'jornada');
    if (jornada) faq.push(`<details class="faq-item"><summary>${esc(jornada.titulo)}<i aria-hidden="true"></i></summary><div>${sectionContent(jornada)}</div></details>`);
    $('faqList').innerHTML = faq.join('');
  }
  function renderPortfolio() {
    const query = norm(M.portfolioQuery), selected = M.data.portfolio.modalidades[M.portfolioModality];
    const areas = selected.areas.map(a => ({ ...a, cursos: a.cursos.filter(([name]) => !query || norm(`${name} ${a.area} ${selected.nome}`).includes(query)) })).filter(a => a.cursos.length);
    $('portfolioList').innerHTML = areas.length ? areas.map(a => `<details class="portfolio-area"><summary>${esc(a.area)} <span>${a.cursos.length}</span></summary><ul>${a.cursos.map(([name, type]) => `<li><span>${esc(name)}</span><em>${esc(M.data.portfolio.tipos[type])}</em></li>`).join('')}</ul></details>`).join('') : '<p class="empty">Nenhum curso encontrado.</p>';
    $('portfolioCount').textContent = `${areas.reduce((sum, a) => sum + a.cursos.length, 0)} curso(s)`;
  }
  function eadOverviewHtml() {
    const section = M.data.secoes.find(item => item.id === 'mudancas-ead');
    if (!section) return '';
    const item = label => section.itens?.find(entry => norm(entry.titulo) === norm(label));
    const highlight = label => M.data.destaques?.find(entry => norm(entry.rotulo) === norm(label));
    const duration = item('Duração das disciplinas');
    const exam = item('Avaliação presencial');
    const average = item('Média mínima para aprovação');
    const durationSummary = highlight('Duração das disciplinas');
    const examSummary = highlight('Avaliação presencial');
    const averageSummary = highlight('Média mínima para aprovação');
    const ead = M.data.portfolio.modalidades.find(modality => /ead/i.test(modality.nome));
    const healthAreas = ead?.areas.filter(area => /sa[uú]de|bem-estar/i.test(area.area)) || [];
    const healthList = healthAreas.map(area => `<details class="ead-health-area"><summary>${esc(area.area)} <span>${area.cursos.length} cursos</span></summary><ul>${area.cursos.map(([name]) => `<li>${esc(name)}</li>`).join('')}</ul></details>`).join('');
    const table = section.tabela;
    return `<section class="card ead-overview" aria-labelledby="eadOverviewTitle">
      <header><p class="eyebrow">REGRAS GERAIS · A PARTIR DE 2027</p><h3 id="eadOverviewTitle">${esc(section.titulo)}</h3><p>${esc(section.subtitulo)}</p></header>
      <div class="ead-overview-facts">
        <article><span>${esc(duration?.titulo || '')}</span><strong>${esc(durationSummary?.valor || '')}</strong><p>${esc(duration?.texto || durationSummary?.detalhe || '')}</p></article>
        <article><span>${esc(average?.titulo || '')}</span><strong>${esc(averageSummary?.valor || '')}</strong><p>${esc(averageSummary?.detalhe || average?.texto || '')}</p></article>
        <article><span>${esc(exam?.titulo || '')}</span><strong>${esc(examSummary?.valor || '')}</strong><p>${esc(examSummary?.detalhe || exam?.texto || '')}</p></article>
      </div>
      ${table ? `<div class="ead-grade-summary"><div><h4>${esc(table.titulo)}</h4><p>Veja os componentes da composição regular e a pontuação de cada atividade.</p></div><div class="table-wrap"><table><thead><tr>${table.colunas.map(col => `<th>${esc(col)}</th>`).join('')}</tr></thead><tbody>${table.linhas.map((row, i, all) => `<tr class="${i === all.length - 1 ? 'total' : ''}">${row.map((cell, j) => `<td class="${j ? 'n' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}
      <p class="ead-exception"><b>Atenção:</b> ${esc(table?.nota || '')} Confira também as orientações específicas do curso no Studeo.</p>
      ${healthList ? `<details class="ead-health"><summary><span><b>Cursos EaD da área Saúde e Bem-estar</b><small>Esta regra geral também se aplica a essas áreas; a rotina depende do curso.</small></span><i aria-hidden="true"></i></summary><div class="ead-health-list">${healthList}</div></details>` : ''}
    </section>`;
  }
  function renderMarco() {
    const d = M.data;
    $('area-marco').innerHTML = `<section class="marco-heading"><div><p class="eyebrow">CONSULTA ACADÊMICA</p><h2 id="marcoTitle">Processo 51/2027</h2><p>${esc(d.aviso)}</p></div></section>
      ${eadOverviewHtml()}
      <section class="card marco-course-section" aria-labelledby="marcoCourseTitle"><header><p class="eyebrow">INFORMAÇÃO POR CURSO</p><h3 id="marcoCourseTitle">Agora consulte a rotina do seu curso</h3><p>As regras gerais EaD estão acima. Aqui você vê as semanas e particularidades que o material apresenta para cada curso.</p></header><div class="course-controls"><label class="field"><span>Buscar curso</span><input id="courseSearch" type="search" placeholder="Ex.: Administração, Farmácia, Educação Física"></label><label class="field"><span>Curso</span><select id="courseSelect"><option value="">Selecione um curso</option></select></label><span class="sub" id="courseCount"></span></div><div id="courseCard"></div></section>
      <section class="card marco-faq-section"><header><p class="eyebrow">ORIENTAÇÕES</p><h3>Perguntas frequentes</h3><p>Abra somente a dúvida que precisa consultar.</p></header><div class="faq-list" id="faqList"></div></section>
      <details class="card portfolio-card"><summary><span><b>Portfólio completo de cursos</b><small>${esc(d.portfolio.nota)}</small></span><i aria-hidden="true"></i></summary><div class="portfolio-body"><div class="portfolio-controls"><div class="segmented" id="portfolioModalities">${d.portfolio.modalidades.map((m, i) => `<button type="button" data-portfolio-modality="${i}" aria-pressed="${i === M.portfolioModality}" class="${i === M.portfolioModality ? 'active' : ''}">${esc(m.nome)}</button>`).join('')}</div><label class="field"><span>Buscar no portfólio</span><input id="portfolioSearch" type="search" placeholder="Digite o nome do curso"></label><span id="portfolioCount" class="sub"></span></div><div id="portfolioList" class="portfolio-list"></div></div></details>`;
    renderCourseOptions(); renderFaq(); renderPortfolio();
    $('courseSearch').addEventListener('input', e => renderCourseOptions(e.target.value));
    $('courseSelect').addEventListener('change', e => { M.course = e.target.value; M.courseYear = '1'; renderCourseCard(); });
    $('portfolioSearch').addEventListener('input', e => { M.portfolioQuery = e.target.value; renderPortfolio(); });
    $('portfolioModalities').querySelectorAll('[data-portfolio-modality]').forEach(b => b.addEventListener('click', () => { M.portfolioModality = Number(b.dataset.portfolioModality); $('portfolioModalities').querySelectorAll('[data-portfolio-modality]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); renderPortfolio(); }));
  }

  function setArea(area, scroll = false) {
    S.visibleArea = area;
    document.querySelectorAll('.main-nav [data-area]').forEach(b => { const active = b.dataset.area === area; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    $('area-inicio').classList.toggle('hidden', area !== 'inicio');
    $('area-calendario').classList.toggle('hidden', area !== 'calendario');
    $('area-marco').classList.toggle('hidden', area !== 'marco');
    const targetHash = area === 'marco' ? '#marco' : area === 'calendario' ? '#calendario' : '';
    if (location.hash !== targetHash) history.replaceState(null, '', location.pathname + location.search + targetHash);
    if (scroll) $('area-' + area).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.querySelectorAll('.main-nav [data-area]').forEach(b => b.addEventListener('click', () => setArea(b.dataset.area, true)));
  document.querySelectorAll('[data-area-link]').forEach(link => link.addEventListener('click', e => {
    e.preventDefault();
    setArea(link.dataset.areaLink, true);
  }));
  document.addEventListener('click', e => { const b = e.target.closest('[data-area-go]'); if (b) setArea(b.dataset.area, true); const askButton = e.target.closest('[data-ask]'); if (askButton) ask(askButton.dataset.ask); });
  window.addEventListener('hashchange', () => { if (location.hash === '#marco') setArea('marco', true); else if (location.hash === '#calendario') setArea('calendario', true); else setArea('inicio', true); });
  $('askForm').addEventListener('submit', e => { e.preventDefault(); ask($('q').value); });
  $('matrixSearch').addEventListener('input', e => { S.matrixSearch = e.target.value; renderCalendar(); });
  $('currentOnly').addEventListener('change', e => { S.currentOnly = e.target.checked; renderCalendar(); });

  async function loadMarco() {
    const res = await fetch('/api/informa/marco', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Falha ao carregar o Processo 51/2027 (${res.status}).`);
    M.data = await res.json(); S.marco = M.data; renderMarco();
  }
  async function load() {
    await loadMarco();
    if (location.hash === '#marco') setArea('marco'); else if (location.hash === '#calendario') setArea('calendario');
    const res = await fetch('/api/informa/calendario', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 401) { location.assign('/?next=' + encodeURIComponent('/informa/')); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Falha ao carregar o calendário (${res.status}).`);
    S.data = data; const thisYear = S.today.slice(0, 4); S.year = data.anos.includes(thisYear) ? thisYear : data.anos[data.anos.length - 1];
    renderHeroContext();
    if (data.fonte.aviso) { $('fonteAviso').textContent = data.fonte.aviso; $('fonteAviso').classList.remove('hidden'); }
    $('fonte').innerHTML = `Fonte: <a href="${esc(data.fonte.site)}" target="_blank" rel="noopener">Calendário Administrativo Unicesumar</a>${data.fonte.atualizado_em ? ` · dados lidos em ${esc(new Date(data.fonte.atualizado_em).toLocaleString('pt-BR'))}` : ' · dados base do site'} · ${data.ocorrencias.length} datas.`;
    renderProductSelect(); renderYears(); renderSuggestions(); renderNow(); renderAgenda(); renderCategoryShortcuts(); renderCalendar();
    const query = new URLSearchParams(location.search).get('q'); if (query) ask(query, false);
    if (location.hash === '#busca') $('q').focus();
  }
  load().catch(e => { $('erro').textContent = e.message; $('erro').classList.remove('hidden'); });
})();

