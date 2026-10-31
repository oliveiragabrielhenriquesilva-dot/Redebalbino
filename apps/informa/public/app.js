(() => {
  'use strict';
  const entries = [
    {
      title: 'Calendário da Graduação · disciplinas de 10 semanas', category: 'calendarios', tag: 'Graduação', icon: '▦',
      description: 'Períodos de módulos, atividades de estudo, provas presenciais e online, notas e substitutivas.',
      search: 'graduação graduacao disciplinas 10 semanas calendário academico prova presencial prova online atividade estudo semana conhecimentos gerais MAPA nota substitutiva módulo 51 52 53 54',
      summary: 'Datas de provas e atividades organizadas pelos módulos 51 a 54.',
      details: [
        'Prova presencial — agendamento: M51 20/04 a 01/05; M52 29/06 a 10/07; M53 14/09 a 25/09; M54 23/11 a 04/12/2026.',
        'Prova presencial — realização: M51 27/04 a 02/05; M52 06/07 a 11/07; M53 21/09 a 26/09; M54 30/11 a 05/12/2026.',
        'Prova online no Studeo: M51 27/04 a 03/05; M52 06/07 a 12/07; M53 21/09 a 27/09; M54 30/11 a 06/12/2026.',
        'Avaliação presencial — 2ª oportunidade: agendamento M51 03/05 a 08/05; M52 12/07 a 17/07; M53 27/09 a 02/10; M54 06/12 a 11/12/2026. Realização M51 07/05 a 09/05; M52 16/07 a 18/07; M53 01/10 a 03/10; M54 10/12 a 12/12/2026.',
        'Semana de Conhecimentos Gerais: M51 09/03 a 12/04; M52 18/05 a 21/06; M53 03/08 a 06/09; M54 13/10 a 15/11/2026.',
        'Lançamento de notas: 29/05, 14/08, 26/10 e 22/12/2026 (M51 a M54). Consulte o calendário oficial do curso para as datas de substitutivas e de visualização de cópia.'
      ]
    },
    {
      title: 'Calendário da Graduação · disciplinas de 5 semanas', category: 'calendarios', tag: 'Graduação', icon: '▦',
      description: 'Períodos dos módulos, atividade de estudo no Studeo, prova digital e lançamento de notas.',
      search: 'graduação graduacao disciplinas 5 semanas calendário academico prova digital atividade de estudo Studeo notas módulo 51 52 53 54',
      summary: 'Atividades e avaliações de cada disciplina nos módulos 51 a 54.',
      details: [
        'Módulos: M51 23/02 a 02/05; M52 04/05 a 11/07; M53 20/07 a 26/09; M54 28/09 a 05/12/2026.',
        'Atividade de estudo — 1ª disciplina: M51 23/02 a 22/03; M52 04/05 a 31/05; M53 20/07 a 16/08; M54 28/09 a 25/10/2026.',
        'Atividade de estudo — 2ª disciplina: M51 30/03 a 19/04; M52 08/06 a 28/06; M53 24/08 a 13/09; M54 02/11 a 22/11/2026.',
        'Prova digital no Studeo — 1ª disciplina: M51 23/03 a 29/03; M52 01/06 a 07/06; M53 17/08 a 23/08; M54 26/10 a 01/11/2026.',
        'Prova digital no Studeo — 2ª disciplina: M51 20/04 a 26/04; M52 29/06 a 05/07; M53 14/09 a 20/09; M54 23/11 a 29/11/2026.',
        'Fechamento e lançamento de notas: M51 27/04; M52 06/07; M53 21/09; M54 30/11/2026.'
      ]
    },
    {
      title: 'Calendário dos Cursos Técnicos', category: 'calendarios', tag: 'Técnicos', icon: '▦',
      description: 'Agendamento e realização de provas no polo, avaliações online e atividades práticas presenciais.',
      search: 'técnico tecnico enfermagem radiologia prova presencial online substitutiva agendamento aulas práticas hibrido saúde calendário 2026',
      summary: 'O calendário traz janelas de prova presencial, prova online, substitutiva e prática por módulo.',
      details: [
        'Prova presencial — agendamento da 1ª disciplina: 16/03 a 27/03; 25/05 a 05/06; 10/08 a 21/08; 19/10 a 30/10/2026. Da 2ª e 3ª disciplinas: 20/04 a 01/05; 29/06 a 10/07; 14/09 a 25/09; 23/11 a 04/12/2026.',
        'Prova presencial — realização da 1ª disciplina: 23/03 a 28/03; 01/06 a 06/06; 17/08 a 22/08; 26/10 a 31/10/2026. Da 2ª e 3ª: 27/04 a 02/05; 06/07 a 11/07; 21/09 a 26/09; 30/11 a 05/12/2026.',
        '2ª oportunidade — agendamento da 1ª disciplina: 29/03 a 03/04; 07/06 a 12/06; 23/08 a 28/08; 01/11 a 06/11/2026. Da 2ª e 3ª: 03/05 a 08/05; 12/07 a 17/07; 27/09 a 02/10; 06/12 a 11/12/2026.',
        'Prova presencial — 2ª oportunidade: 1ª disciplina 02/04 a 04/04; 11/06 a 13/06; 27/08 a 29/08; 05/11 a 07/11/2026. 2ª e 3ª disciplinas 07/05 a 09/05; 16/07 a 18/07; 01/10 a 03/10; 10/12 a 12/12/2026.',
        'Prova online no Studeo: Módulos 92, 93 e 94 têm janelas de 04/05 a 05/07; 20/07 a 20/09; 28/09 a 29/11/2026. A legenda do calendário indica que a disponibilidade depende da disciplina.',
        'Para Enfermagem e Radiologia, as provas presenciais são realizadas na 10ª semana do módulo. O calendário também informa datas de substitutivas, lançamento de notas e aulas práticas dos cursos híbridos de Saúde.'
      ]
    },
    {
      title: 'Calendário dos Cursos Profissionalizantes', category: 'calendarios', tag: 'Profissionalizantes', icon: '▦',
      description: 'Calendário acadêmico 2026 dos cursos profissionalizantes.',
      search: 'cursos profissionalizantes calendário acadêmico datas prova atividade 2026',
      summary: 'Períodos das atividades de estudo e das provas digitais nos módulos 71 a 74.',
      details: [
        'Atividade de estudo — 1ª etapa: M71 23/02 a 22/03; M72 04/05 a 31/05; M73 20/07 a 16/08; M74 28/09 a 25/10/2026.',
        'Atividade de estudo — 2ª etapa: M71 30/03 a 19/04; M72 08/06 a 28/06; M73 24/08 a 13/09; M74 02/11 a 22/11/2026.',
        'Prova digital — 1ª etapa: M71 23/03 a 29/03; M72 01/06 a 07/06; M73 17/08 a 23/08; M74 26/10 a 01/11/2026.',
        'Prova digital — 2ª etapa: M71 20/04 a 26/04; M72 29/06 a 05/07; M73 14/09 a 20/09; M74 23/11 a 29/11/2026. Fechamento das notas: 27/04, 06/07, 21/09 e 30/11/2026.'
      ]
    },
    {
      title: 'Conexão Pedagógico · Processo 51/2027', category: 'pedagogico', tag: 'Resumo da equipe', icon: 'i',
      description: 'Resumo de consulta sobre a organização das disciplinas, encontros e avaliações para 2027.',
      search: 'conexão conexao pedagógico pedagogico processo 51 2027 jornada aprendizagem 10 semanas nota média aprovação avaliação MAPA atividade estudo Teams ao vivo calendário',
      summary: 'A organização geral passa a considerar disciplinas de 10 semanas. A composição resumida da nota é: A.E.01 (1,0), A.E.02 (1,0), M.A.P.A. (2,0) e avaliação presencial (6,0), com média mínima indicada de 7,0.',
      details: [
        'Os encontros ao vivo de 1h30 seguem alternância: Disciplina 1 nas semanas 1, 3, 5 e 7; Disciplina 2 nas semanas 2, 4, 6 e 8.',
        'As avaliações presenciais estão previstas para as semanas 9 e 10. Datas e formato precisam ser conferidos no calendário correspondente ao curso.',
        'Ciência da Criatividade e Gestão de Cooperativas foram apontadas no resumo como cursos sem aulas ao vivo. A distribuição pode variar conforme o curso e a matriz.',
        'Práticas, estágios e TCC podem seguir orientações próprias.'
      ],
      note: 'Este resumo foi elaborado a partir do material apresentado no Conexão Pedagógico. Para decisões e atendimento ao aluno, confirme a regra vigente na comunicação oficial e na matriz do curso.'
    }
  ];

  const cards = document.getElementById('cards');
  const query = document.getElementById('query');
  const category = document.getElementById('category');
  const count = document.getElementById('resultCount');
  const empty = document.getElementById('empty');
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

  function render() {
    const terms = normalize(query.value).trim().split(/\s+/).filter(Boolean);
    const searchingDate = /\d{1,2}[/.]\d{1,2}/.test(query.value);
    const selected = category.value;
    const matches = entries.filter(item => {
      if (selected !== 'todos' && item.category !== selected) return false;
      const text = normalize([item.title, item.description, item.search, item.tag, item.summary, ...(item.details || [])].join(' '));
      return terms.every(term => text.includes(term));
    });
    cards.replaceChildren();
    for (const item of matches) {
      const card = document.createElement('article'); card.className = 'card';
      const top = document.createElement('div'); top.className = 'card-top';
      const icon = document.createElement('span'); icon.className = 'card-icon'; icon.textContent = item.icon; icon.setAttribute('aria-hidden', 'true');
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = item.tag; top.append(icon, tag);
      const title = document.createElement('h3'); title.textContent = item.title;
      const description = document.createElement('p'); description.textContent = item.description;
      card.append(top, title, description);

      if (item.summary) {
        const summary = document.createElement('p'); summary.className = 'summary'; summary.textContent = item.summary; card.append(summary);
      }
      if (item.details) {
        const details = document.createElement('details'); details.className = 'full-details';
        details.open = searchingDate;
        const more = document.createElement('summary'); more.textContent = 'Ver o resumo completo'; details.append(more);
        for (const text of item.details) { const paragraph = document.createElement('p'); paragraph.textContent = text; details.append(paragraph); }
        if (item.note) { const note = document.createElement('p'); note.className = 'source-note'; note.textContent = item.note; details.append(note); }
        card.append(details);
      }
      cards.append(card);
    }
    count.textContent = terms.length ? `${matches.length} resultado${matches.length === 1 ? '' : 's'}` : `${matches.length} conteúdos disponíveis`;
    empty.classList.toggle('hidden', matches.length > 0);
  }

  document.getElementById('searchForm').addEventListener('submit', event => { event.preventDefault(); render(); });
  query.addEventListener('input', render);
  category.addEventListener('change', render);
  document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => { query.value = button.dataset.query; render(); query.focus(); }));
  render();
})();
