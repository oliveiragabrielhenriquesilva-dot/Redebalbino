(() => {
  'use strict';
  const api = '/api/informa/calendar';
  const results = document.getElementById('results');
  const query = document.getElementById('query');
  const courseFilter = document.getElementById('courseFilter');
  const count = document.getElementById('resultCount');
  const heading = document.getElementById('resultsHeading');
  const empty = document.getElementById('empty');
  const toolbar = document.querySelector('.results-toolbar');
  const topActions = document.querySelector('.top-actions');
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  let calendar = null;
  let activeCategory = 'todos';
  let adminMode = false;
  let statusNode = null;

  function categoryOf(event) {
    const name = normalize(event.name);
    if (name.includes('atividade') || name.includes('conhecimentos gerais')) return 'atividades';
    if (name.includes('nota') || name.includes('lancamento') || name.includes('fechamento')) return 'publicacoes';
    return 'provas';
  }
  function categoryLabel(category) {
    return ({ atividades: 'Atividades', provas: 'Provas', publicacoes: 'Notas' })[category] || 'Calendário';
  }
  function field(value, label, courseId, moduleIndex, eventIndex, key) {
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'date-editor'; input.value = value || '';
    input.placeholder = 'DD/MM/AAAA ou período'; input.setAttribute('aria-label', `${label}: ${courseId}, módulo ${moduleIndex}, atividade ${eventIndex + 1}`);
    input.dataset.course = courseId; input.dataset.module = moduleIndex; input.dataset.event = eventIndex; input.dataset.key = key;
    return input;
  }
  function dateCell(value, shared, course, moduleIndex, eventIndex, key) {
    const cell = document.createElement('td');
    if (adminMode) cell.append(field(value, shared ? 'Data compartilhada' : key === 'first' ? course.disciplineLabels[0] : course.disciplineLabels[1], course.id, moduleIndex, eventIndex, key));
    else cell.textContent = value || '—';
    return cell;
  }
  function render() {
    if (!calendar) return;
    const terms = normalize(query.value).trim().split(/\s+/).filter(Boolean);
    const selectedCourse = courseFilter.value;
    results.replaceChildren();
    let shown = 0;
    for (const course of calendar.courses) {
      if (selectedCourse !== 'todos' && selectedCourse !== course.id) continue;
      const matchingModules = course.modules.map((module, index) => ({ module, index, events: module.events.filter(event =>
        (activeCategory === 'todos' || categoryOf(event) === activeCategory)
        && terms.every(term => normalize([course.title, module.label, event.name, event.first, event.second, event.common].join(' ')).includes(term)))
      })).filter(entry => entry.events.length);
      if (!matchingModules.length) continue;
      const group = document.createElement('section'); group.className = 'calendar-group';
      const title = document.createElement('h3'); title.className = 'calendar-title'; title.textContent = course.title;
      group.append(title);
      const moduleList = document.createElement('div'); moduleList.className = 'module-list';
      matchingModules.forEach(({ module, index: actualIndex, events: moduleEvents }) => {
        const card = document.createElement('article'); card.className = 'module-card';
        const wrap = document.createElement('div'); wrap.className = 'activity-table-wrap';
        const table = document.createElement('table'); table.className = 'activity-calendar-table';
        const thead = document.createElement('thead');
        const titleRow = document.createElement('tr'); titleRow.className = 'module-title-row';
        const moduleTitle = document.createElement('th'); moduleTitle.colSpan = 3; moduleTitle.scope = 'colgroup'; moduleTitle.textContent = `Módulo ${module.label}/${calendar.year}`;
        titleRow.append(moduleTitle); thead.append(titleRow);
        const headerRow = document.createElement('tr');
        const activityHead = document.createElement('th'); activityHead.scope = 'col'; activityHead.textContent = 'Atividade'; headerRow.append(activityHead);
        for (const label of course.disciplineLabels) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headerRow.append(th); }
        thead.append(headerRow);
        const tbody = document.createElement('tbody');
        for (const event of moduleEvents) {
          const eventIndex = module.events.indexOf(event);
          const row = document.createElement('tr');
          const name = document.createElement('th'); name.scope = 'row'; name.textContent = event.name; row.append(name);
          if (event.common) {
            row.append(dateCell(event.common, true, course, actualIndex, eventIndex, 'common'));
            row.lastChild.colSpan = 2;
          } else {
            row.append(dateCell(event.first, false, course, actualIndex, eventIndex, 'first'));
            row.append(dateCell(event.second, false, course, actualIndex, eventIndex, 'second'));
          }
          tbody.append(row); shown++;
        }
        table.append(thead, tbody); wrap.append(table); card.append(wrap); moduleList.append(card);
      });
      group.append(moduleList); results.append(group);
    }
    if (activeCategory === 'todos' || activeCategory === 'mapa') {
      const note = document.createElement('aside'); note.className = 'info-card tone-mapa mapa-note';
      const title = document.createElement('h3'); title.textContent = 'MAPA';
      const text = document.createElement('p'); text.className = 'card-description'; text.textContent = 'Os calendários gerais não informam uma data única para entrega. Confira o prazo na sala da disciplina no Studeo.';
      const points = document.createElement('p'); points.className = 'card-description'; points.textContent = 'No resumo do Conexão Pedagógico, a composição apresentada foi: A.E.01 (1,0), A.E.02 (1,0), MAPA (2,0) e avaliação presencial (6,0). Confirme os critérios e prazos na orientação do seu curso.';
      note.append(title, text, points); results.append(note);
    }
    heading.textContent = activeCategory === 'todos' ? 'Calendários acadêmicos' : ({atividades:'Atividades',provas:'Datas de provas',publicacoes:'Publicação de notas',mapa:'MAPA'})[activeCategory];
    count.textContent = `${shown} ${shown === 1 ? 'prazo exibido' : 'prazos exibidos'} · calendário ${calendar.year}`;
    empty.classList.toggle('hidden', shown > 0 || activeCategory === 'mapa');
    document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === activeCategory)));
    updateAdminStatus();
  }
  function updateAdminStatus(message = '') {
    if (statusNode) statusNode.textContent = message || (adminMode ? 'Edição ativa. Preencha as datas e salve para publicar.' : '');
  }
  async function loadCalendar() {
    const response = await fetch(api, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar o calendário. Atualize a página.');
    calendar = await response.json();
    while (courseFilter.options.length > 1) courseFilter.remove(1);
    for (const course of calendar.courses) {
      const option = document.createElement('option'); option.value = course.id; option.textContent = course.title; courseFilter.append(option);
    }
    render();
  }
  function addAdminControls() {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'portal-link admin-toggle'; button.textContent = 'Editar datas'; button.hidden = true;
    topActions.prepend(button);
    const actions = document.createElement('div'); actions.className = 'admin-actions hidden';
    const status = document.createElement('span'); status.className = 'admin-status'; statusNode = status;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'admin-button secondary'; cancel.textContent = 'Cancelar';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'admin-button primary'; save.textContent = 'Salvar datas';
    actions.append(status, cancel, save); toolbar.after(actions);
    button.addEventListener('click', () => {
      adminMode = !adminMode; button.textContent = adminMode ? 'Sair da edição' : 'Editar datas';
      actions.classList.toggle('hidden', !adminMode); render();
    });
    cancel.addEventListener('click', async () => { adminMode = false; button.textContent = 'Editar datas'; actions.classList.add('hidden'); await loadCalendar(); updateAdminStatus('Alterações descartadas.'); });
    save.addEventListener('click', async () => {
      const next = structuredClone(calendar);
      document.querySelectorAll('.date-editor').forEach(input => {
        const course = next.courses.find(item => item.id === input.dataset.course);
        const event = course?.modules[Number(input.dataset.module)]?.events[Number(input.dataset.event)];
        if (event) event[input.dataset.key] = input.value.trim();
      });
      save.disabled = true; updateAdminStatus('Salvando…');
      try {
        const response = await fetch(api, { method: 'PUT', credentials: 'same-origin', headers: {'Content-Type':'application/json'}, body: JSON.stringify(next) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
        calendar = result.calendar; render(); updateAdminStatus('Datas salvas. A consulta já está atualizada.');
      } catch (error) { updateAdminStatus(error.message); }
      finally { save.disabled = false; }
    });
    fetch('/api/portal/me', { credentials: 'same-origin', cache: 'no-store' }).then(response => response.json()).then(data => {
      if (data.user?.isAdmin) button.hidden = false;
      if (data.user?.isAdmin && location.hash === '#admin') button.click();
    }).catch(() => {});
  }

  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    activeCategory = activeCategory === button.dataset.category ? 'todos' : button.dataset.category;
    render(); document.getElementById('resultsHeading').scrollIntoView({behavior:'smooth',block:'nearest'});
  }));
  document.addEventListener('input', event => {
    const input = event.target.closest('.date-editor');
    if (!input || !calendar) return;
    const course = calendar.courses.find(item => item.id === input.dataset.course);
    const date = course?.modules[Number(input.dataset.module)]?.events[Number(input.dataset.event)];
    if (date) date[input.dataset.key] = input.value.trim();
  });
  document.getElementById('searchForm').addEventListener('submit', event => { event.preventDefault(); render(); });
  query.addEventListener('input', render); courseFilter.addEventListener('change', render);
  addAdminControls();
  loadCalendar().catch(error => { empty.textContent = error.message; empty.classList.remove('hidden'); });
})();
