(() => {
  'use strict';

  const items = [
    {
      category: 'atividades', type: 'Atividades', course: 'Graduação · disciplinas de 10 semanas', title: 'Semana de Conhecimentos Gerais',
      description: 'Período para realizar a atividade indicada no calendário acadêmico.',
      dates: [['51/27', '09/03 a 12/04'], ['52/27', '18/05 a 21/06'], ['53/27', '03/08 a 06/09'], ['54/27', '13/10 a 15/11']],
      search: 'semana conhecimento geral atividade calendário graduação 10 semanas processo 51 2026'
    },
    {
      category: 'atividades', type: 'Atividades', course: 'Graduação · disciplinas de 5 semanas', title: 'Atividade de estudo · 1ª disciplina',
      description: 'A atividade fica disponível no Studeo durante o período indicado.',
      dates: [['51/27', '23/02 a 22/03'], ['52/27', '04/05 a 31/05'], ['53/27', '20/07 a 16/08'], ['54/27', '28/09 a 25/10']],
      search: 'atividade de estudo primeira disciplina graduação calendário 5 semanas'
    },
    {
      category: 'atividades', type: 'Atividades', course: 'Graduação · disciplinas de 5 semanas', title: 'Atividade de estudo · 2ª disciplina',
      description: 'Consulte a sala da disciplina no Studeo para ver as orientações da atividade.',
      dates: [['51/27', '30/03 a 19/04'], ['52/27', '08/06 a 28/06'], ['53/27', '24/08 a 13/09'], ['54/27', '02/11 a 22/11']],
      search: 'atividade estudo segunda disciplina graduação calendário 5 semanas'
    },
    {
      category: 'atividades', type: 'Atividades', course: 'Cursos profissionalizantes', title: 'Atividade de estudo · 1ª etapa',
      description: 'Prazos previstos no calendário dos cursos profissionalizantes.',
      dates: [['M71', '23/02 a 22/03'], ['M72', '04/05 a 31/05'], ['M73', '20/07 a 16/08'], ['M74', '28/09 a 25/10']],
      search: 'profissionalizante cursos atividade estudo etapa 71 72 73 74'
    },
    {
      category: 'atividades', type: 'Atividades', course: 'Cursos profissionalizantes', title: 'Atividade de estudo · 2ª etapa',
      description: 'Prazos previstos no calendário dos cursos profissionalizantes.',
      dates: [['M71', '30/03 a 19/04'], ['M72', '08/06 a 28/06'], ['M73', '24/08 a 13/09'], ['M74', '02/11 a 22/11']],
      search: 'profissionalizante cursos atividade estudo etapa 71 72 73 74'
    },
    {
      category: 'mapa', type: 'MAPA', course: 'Conexão Pedagógico · Processo 51/2027', title: 'Como o MAPA entra na nota',
      description: 'No resumo da equipe, o MAPA vale 2,0 pontos na composição da nota.',
      dates: [['A.E.01', '1,0 ponto'], ['A.E.02', '1,0 ponto'], ['MAPA', '2,0 pontos'], ['Avaliação presencial', '6,0 pontos']],
      note: 'O prazo de entrega não é único para todos os cursos. Confira a data e as instruções na sala da disciplina no Studeo. Média mínima indicada no encontro: 7,0.',
      search: 'mapa atividade avaliativa nota processo 51 2027 conexão pedagógico'
    },
    {
      category: 'mapa', type: 'MAPA', course: 'Conexão Pedagógico · Processo 51/2027', title: 'Onde consultar o prazo',
      description: 'O cronograma específico aparece dentro da disciplina no Studeo.',
      dates: [['1', 'Abra a disciplina'], ['2', 'Acesse o MAPA'], ['3', 'Confira o prazo e as orientações']],
      note: 'O calendário geral não apresenta uma data única para o MAPA. Não deixe para a última hora: cada disciplina pode ter um cronograma próprio.',
      search: 'prazo entrega data consulta mapa studeo atividade disciplina'
    },
    {
      category: 'provas', type: 'Provas', course: 'Graduação · disciplinas de 10 semanas', title: 'Prova presencial · agendamento',
      description: 'Agende a avaliação dentro da janela do seu módulo.',
      dates: [['51/27', '20/04 a 01/05'], ['52/27', '29/06 a 10/07'], ['53/27', '14/09 a 25/09'], ['54/27', '23/11 a 04/12']],
      search: 'prova presencial agendar agendamento graduação 10 semanas'
    },
    {
      category: 'provas', type: 'Provas', course: 'Graduação · disciplinas de 10 semanas', title: 'Provas presenciais · realização',
      description: 'Confira o período de realização previsto para cada módulo.',
      dates: [['51/27', '27/04 a 02/05'], ['52/27', '06/07 a 11/07'], ['53/27', '21/09 a 26/09'], ['54/27', '30/11 a 05/12']],
      search: 'prova presencial realização graduação 10 semanas avaliação'
    },
    {
      category: 'provas', type: 'Provas', course: 'Graduação · disciplinas de 10 semanas', title: 'Prova online no Studeo',
      description: 'Janela para realizar a avaliação online.',
      dates: [['51/27', '27/04 a 03/05'], ['52/27', '06/07 a 12/07'], ['53/27', '21/09 a 27/09'], ['54/27', '30/11 a 06/12']],
      search: 'prova online studeo graduação 10 semanas'
    },
    {
      category: 'provas', type: 'Provas', course: 'Graduação · disciplinas de 10 semanas', title: '2ª oportunidade · avaliação presencial',
      description: 'O calendário separa o período de agendamento do período de realização.',
      dates: [['Agendamento · 51/27–54/27', '03/05–08/05 · 12/07–17/07 · 27/09–02/10 · 06/12–11/12'], ['Realização · 51/27–54/27', '07/05–09/05 · 16/07–18/07 · 01/10–03/10 · 10/12–12/12']],
      search: 'segunda oportunidade prova presencial agendamento realização'
    },
    {
      category: 'provas', type: 'Provas', course: 'Graduação · disciplinas de 5 semanas', title: 'Provas digitais · 1ª e 2ª disciplinas',
      description: 'As avaliações são realizadas no Studeo, nas janelas de cada módulo.',
      dates: [['1ª · 51/27–54/27', '23/03–29/03 · 01/06–07/06 · 17/08–23/08 · 26/10–01/11'], ['2ª · 51/27–54/27', '20/04–26/04 · 29/06–05/07 · 14/09–20/09 · 23/11–29/11']],
      search: 'prova digital 5 semanas primeira segunda disciplina studeo'
    },
    {
      category: 'provas', type: 'Provas', course: 'Cursos técnicos', title: 'Provas presenciais · calendário técnico',
      description: 'O agendamento e a realização variam conforme a disciplina.',
      dates: [['Agendamento · 1ª disciplina', '16/03–27/03 · 25/05–05/06 · 10/08–21/08 · 19/10–30/10'], ['Agendamento · 2ª e 3ª', '20/04–01/05 · 29/06–10/07 · 14/09–25/09 · 23/11–04/12'], ['Realização · 1ª', '23/03–28/03 · 01/06–06/06 · 17/08–22/08 · 26/10–31/10'], ['Realização · 2ª e 3ª', '27/04–02/05 · 06/07–11/07 · 21/09–26/09 · 30/11–05/12']],
      note: 'Para Enfermagem e Radiologia, confira a regra de realização na 10ª semana do módulo e as orientações específicas do curso.',
      search: 'técnico tecnico prova presencial agendamento realização enfermagem radiologia'
    },
    {
      category: 'provas', type: 'Provas', course: 'Cursos técnicos', title: '2ª oportunidade · cursos técnicos',
      description: 'Janelas de agendamento e realização informadas no calendário.',
      dates: [['Agendamento · 1ª disciplina', '29/03–03/04 · 07/06–12/06 · 23/08–28/08 · 01/11–06/11'], ['Agendamento · 2ª e 3ª', '03/05–08/05 · 12/07–17/07 · 27/09–02/10 · 06/12–11/12'], ['Realização · 1ª', '02/04–04/04 · 11/06–13/06 · 27/08–29/08 · 05/11–07/11'], ['Realização · 2ª e 3ª', '07/05–09/05 · 16/07–18/07 · 01/10–03/10 · 10/12–12/12']],
      search: 'técnico segunda oportunidade prova agendamento realização'
    },
    {
      category: 'provas', type: 'Provas', course: 'Cursos técnicos', title: 'Provas online · módulos 92 a 94',
      description: 'A disponibilidade depende da disciplina e da programação do curso.',
      dates: [['Módulo 92', '04/05 a 05/07'], ['Módulo 93', '20/07 a 20/09'], ['Módulo 94', '28/09 a 29/11']],
      note: 'Confira no Studeo se a avaliação da sua disciplina está liberada no período.',
      search: 'técnico prova online modulo 92 93 94'
    },
    {
      category: 'provas', type: 'Provas', course: 'Cursos profissionalizantes', title: 'Provas digitais · 1ª e 2ª etapas',
      description: 'Avaliações digitais dos módulos 71 a 74.',
      dates: [['1ª etapa · M71–M74', '23/03–29/03 · 01/06–07/06 · 17/08–23/08 · 26/10–01/11'], ['2ª etapa · M71–M74', '20/04–26/04 · 29/06–05/07 · 14/09–20/09 · 23/11–29/11']],
      search: 'profissionalizante prova digital etapa 71 72 73 74'
    },
    {
      category: 'publicacoes', type: 'Publicação de notas', course: 'Graduação · disciplinas de 10 semanas', title: 'Notas por módulo',
      description: 'Datas de lançamento indicadas no calendário acadêmico.',
      dates: [['51/27', '29/05'], ['52/27', '14/08'], ['53/27', '26/10'], ['54/27', '22/12']],
      search: 'publicação publicação de notas lançamento resultado graduação 10 semanas'
    },
    {
      category: 'publicacoes', type: 'Publicação de notas', course: 'Graduação · disciplinas de 5 semanas', title: 'Fechamento e lançamento de notas',
      description: 'Datas previstas para encerramento de cada módulo.',
      dates: [['51/27', '27/04'], ['52/27', '06/07'], ['53/27', '21/09'], ['54/27', '30/11']],
      search: 'publicação notas lançamento fechamento graduação 5 semanas'
    },
    {
      category: 'publicacoes', type: 'Publicação de notas', course: 'Conexão Pedagógico · Processo 51/2027', title: 'Comunicado sobre o novo formato',
      description: 'As disciplinas passam a considerar uma organização de 10 semanas, conforme a matriz do curso.',
      dates: [['Encontros ao vivo', '1h30 · semanas alternadas entre as disciplinas'], ['Avaliações', 'Previsão para as semanas 9 e 10']],
      note: 'A distribuição pode variar conforme o curso e a matriz. Confirme as orientações oficiais antes de repassar ao aluno.',
      search: 'publicação comunicado conexão pedagógico processo 51 2027 disciplinas'
    }
  ];

  const results = document.getElementById('results');
  const query = document.getElementById('query');
  const courseFilter = document.getElementById('courseFilter');
  const count = document.getElementById('resultCount');
  const heading = document.getElementById('resultsHeading');
  const empty = document.getElementById('empty');
  let activeCategory = 'todos';

  const categoryNames = { todos: 'Todas as informações', atividades: 'Atividades', mapa: 'MAPA', provas: 'Datas de provas', publicacoes: 'Publicação de notas' };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

  function setupCourseFilter() {
    const courses = [...new Set(items.map(item => item.course))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const course of courses) {
      const option = document.createElement('option'); option.value = course; option.textContent = course; courseFilter.append(option);
    }
  }

  function render() {
    const terms = normalize(query.value).trim().split(/\s+/).filter(Boolean);
    const selectedCourse = courseFilter.value;
    const matches = items.filter(item => {
      if (activeCategory !== 'todos' && item.category !== activeCategory) return false;
      if (selectedCourse !== 'todos' && item.course !== selectedCourse) return false;
      const searchable = normalize([item.title, item.description, item.course, item.type, item.search, (item.dates || []).flat().join(' '), item.note].join(' '));
      return terms.every(term => searchable.includes(term));
    });

    results.replaceChildren();
    const activityMatches = matches.filter(item => item.category === 'atividades');
    if (activityMatches.length) {
      const byCourse = new Map();
      for (const item of activityMatches) {
        if (!byCourse.has(item.course)) byCourse.set(item.course, new Map());
        const modules = byCourse.get(item.course);
        const disciplineMatch = item.title.match(/\s*[·–-]\s*(1ª|2ª)\s+(disciplina|etapa)$/i);
        const activityTitle = disciplineMatch ? item.title.slice(0, disciplineMatch.index).trim() : item.title;
        for (const [module, date] of item.dates || []) {
          if (!modules.has(module)) modules.set(module, new Map());
          const activities = modules.get(module);
          if (!activities.has(activityTitle)) activities.set(activityTitle, { first: '', second: '', general: '' });
          const row = activities.get(activityTitle);
          if (!disciplineMatch) row.general = date;
          else if (disciplineMatch[1] === '1ª') row.first = date;
          else row.second = date;
        }
      }
      for (const [courseName, modules] of byCourse) {
        const group = document.createElement('section'); group.className = 'calendar-group';
        const heading = document.createElement('h3'); heading.className = 'calendar-title'; heading.textContent = courseName;
        const orderedModules = [...modules.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
        const moduleList = document.createElement('div'); moduleList.className = 'module-list';
        for (const module of orderedModules) {
          const moduleCard = document.createElement('section'); moduleCard.className = 'module-card';
          const moduleTitle = document.createElement('h4'); moduleTitle.className = 'module-heading'; moduleTitle.textContent = `Módulo ${module}`;
          const tableWrap = document.createElement('div'); tableWrap.className = 'activity-table-wrap';
          const table = document.createElement('table'); table.className = 'activity-calendar-table';
          const thead = document.createElement('thead');
          const headerRow = document.createElement('tr');
          for (const label of ['Atividade', '1ª disciplina / etapa', '2ª disciplina / etapa']) {
            const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headerRow.append(th);
          }
          thead.append(headerRow);
          const tbody = document.createElement('tbody');
          for (const [activity, dates] of modules.get(module)) {
            const row = document.createElement('tr');
            const name = document.createElement('th'); name.scope = 'row'; name.textContent = activity;
            row.append(name);
            for (const date of [dates.general || dates.first, dates.general || dates.second]) {
              const cell = document.createElement('td'); cell.textContent = date || '—'; row.append(cell);
            }
            tbody.append(row);
          }
          table.append(thead, tbody); tableWrap.append(table);
          moduleCard.append(moduleTitle, tableWrap); moduleList.append(moduleCard);
        }
        group.append(heading, moduleList); results.append(group);
      }
    }
    for (const item of matches.filter(item => item.category !== 'atividades')) {
        const card = document.createElement('article'); card.className = `info-card tone-${item.category}`;
        const top = document.createElement('div'); top.className = 'card-topline';
        const tag = document.createElement('span'); tag.className = 'category-tag'; tag.textContent = item.type;
        const course = document.createElement('span'); course.className = 'course-tag'; course.textContent = item.course;
        top.append(tag, course);
        const title = document.createElement('h3'); title.textContent = item.title;
        const description = document.createElement('p'); description.className = 'card-description'; description.textContent = item.description;
        const dates = document.createElement('div'); dates.className = 'date-list';
        for (const [label, value] of item.dates || []) {
          const row = document.createElement('div'); row.className = 'date-row';
          const name = document.createElement('span'); name.textContent = label;
          const date = document.createElement('strong'); date.textContent = value;
          row.append(name, date); dates.append(row);
        }
        card.append(top, title, description, dates);
        if (item.note) { const note = document.createElement('p'); note.className = 'card-note'; note.textContent = item.note; card.append(note); }
        results.append(card);
    }

    heading.textContent = categoryNames[activeCategory];
    count.textContent = terms.length || activeCategory !== 'todos' || selectedCourse !== 'todos'
      ? `${matches.length} ${matches.length === 1 ? 'informação' : 'informações'}`
      : `${matches.length} informações para consulta`;
    empty.classList.toggle('hidden', matches.length > 0);
    document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === activeCategory)));
  }

  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    activeCategory = activeCategory === button.dataset.category ? 'todos' : button.dataset.category;
    render();
    document.getElementById('resultsHeading').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
  document.getElementById('searchForm').addEventListener('submit', event => { event.preventDefault(); render(); });
  query.addEventListener('input', render);
  courseFilter.addEventListener('change', render);
  setupCourseFilter();
  render();
})();
