/* Transcrição exclusiva da coluna Módulo 54, nos documentos fornecidos. */
(function(root){
'use strict';
const DATA={
  "module": "54/2026",
  "source": "Calendário Acadêmico Graduação 2026 — UniCesumar; documentos de 5 e 10 semanas fornecidos pela equipe.",
  "common": [
    {
      "id": "periodo",
      "title": "Período do módulo",
      "start": "2026-09-28",
      "end": "2026-12-05",
      "discipline": "Ambas",
      "phase": "geral"
    },
    {
      "id": "inaugural",
      "title": "Aula inaugural — ingressantes",
      "start": "2026-09-22",
      "end": "2026-09-22",
      "discipline": "Ambas",
      "phase": "geral"
    },
    {
      "id": "conhecimentos",
      "title": "Semana de Conhecimentos Gerais",
      "start": "2026-10-13",
      "end": "2026-11-15",
      "discipline": "Ambas",
      "phase": "geral"
    }
  ],
  "five": [
    {
      "id": "agendamento-1",
      "title": "Agendamento da prova presencial no polo",
      "start": "2026-10-19",
      "end": "2026-10-30",
      "discipline": "1ª disciplina",
      "phase": "regular"
    },
    {
      "id": "agendamento-2",
      "title": "Agendamento da prova presencial no polo",
      "start": "2026-11-23",
      "end": "2026-12-04",
      "discipline": "2ª disciplina",
      "phase": "regular"
    },
    {
      "id": "prova-1",
      "title": "Realização da prova presencial no polo",
      "start": "2026-10-26",
      "end": "2026-10-31",
      "discipline": "1ª disciplina",
      "phase": "regular"
    },
    {
      "id": "prova-2",
      "title": "Realização da prova presencial no polo",
      "start": "2026-11-30",
      "end": "2026-12-05",
      "discipline": "2ª disciplina",
      "phase": "regular"
    },
    {
      "id": "agendamento-2op-1",
      "title": "Agendamento da avaliação presencial — 2ª oportunidade",
      "start": "2026-11-01",
      "end": "2026-11-06",
      "discipline": "1ª disciplina",
      "phase": "segunda"
    },
    {
      "id": "agendamento-2op-2",
      "title": "Agendamento da avaliação presencial — 2ª oportunidade",
      "start": "2026-12-06",
      "end": "2026-12-11",
      "discipline": "2ª disciplina",
      "phase": "segunda"
    },
    {
      "id": "avaliacao-2op-1",
      "title": "Realização da avaliação presencial — 2ª oportunidade",
      "start": "2026-11-05",
      "end": "2026-11-07",
      "discipline": "1ª disciplina",
      "phase": "segunda"
    },
    {
      "id": "avaliacao-2op-2",
      "title": "Realização da avaliação presencial — 2ª oportunidade",
      "start": "2026-12-10",
      "end": "2026-12-12",
      "discipline": "2ª disciplina",
      "phase": "segunda"
    },
    {
      "id": "copia",
      "title": "Visualização da cópia da prova presencial",
      "start": "2027-01-13",
      "end": "2027-01-19",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "online",
      "title": "Realização da prova online no Studeo",
      "start": "2026-11-30",
      "end": "2026-12-06",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "notas-1",
      "title": "Lançamento/publicação de notas",
      "start": "2026-11-30",
      "end": "2026-11-30",
      "discipline": "1ª disciplina",
      "phase": "regular"
    },
    {
      "id": "notas-2",
      "title": "Lançamento/publicação de notas",
      "start": "2026-12-22",
      "end": "2026-12-22",
      "discipline": "2ª disciplina",
      "phase": "regular"
    },
    {
      "id": "solicitacao-sub-1",
      "title": "Solicitação da avaliação substitutiva",
      "start": "2026-12-02",
      "end": "2026-12-08",
      "discipline": "1ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "solicitacao-sub-2",
      "title": "Solicitação da avaliação substitutiva",
      "start": "2027-01-13",
      "end": "2027-01-19",
      "discipline": "2ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "agendamento-sub-1",
      "title": "Agendamento da avaliação presencial — substitutiva",
      "start": "2026-12-02",
      "end": "2026-12-08",
      "discipline": "1ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "agendamento-sub-2",
      "title": "Agendamento da avaliação presencial — substitutiva",
      "start": "2027-01-13",
      "end": "2027-01-19",
      "discipline": "2ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "avaliacao-sub-1",
      "title": "Realização da avaliação presencial — substitutiva",
      "start": "2026-12-07",
      "end": "2026-12-09",
      "discipline": "1ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "avaliacao-sub-2",
      "title": "Realização da avaliação presencial — substitutiva",
      "start": "2027-01-18",
      "end": "2027-01-20",
      "discipline": "2ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "online-sub",
      "title": "Realização da prova substitutiva online no Studeo",
      "start": "2027-01-18",
      "end": "2027-01-24",
      "discipline": "Ambas",
      "phase": "substitutiva"
    },
    {
      "id": "notas-sub-1",
      "title": "Lançamento/publicação de notas — substitutiva",
      "start": "2026-12-22",
      "end": "2026-12-22",
      "discipline": "1ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "notas-sub-2",
      "title": "Lançamento/publicação de notas — substitutiva",
      "start": "2027-02-08",
      "end": "2027-02-08",
      "discipline": "2ª disciplina",
      "phase": "substitutiva"
    },
    {
      "id": "copia-sub",
      "title": "Visualização da cópia da prova presencial — substitutiva",
      "start": "2027-02-10",
      "end": "2027-02-16",
      "discipline": "Ambas",
      "phase": "substitutiva"
    }
  ],
  "ten": [
    {
      "id": "agendamento",
      "title": "Agendamento da avaliação presencial no polo",
      "start": "2026-11-23",
      "end": "2026-12-04",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "prova",
      "title": "Realização da avaliação presencial no polo",
      "start": "2026-11-30",
      "end": "2026-12-05",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "agendamento-2op",
      "title": "Agendamento da avaliação presencial — 2ª oportunidade",
      "start": "2026-12-06",
      "end": "2026-12-11",
      "discipline": "Ambas",
      "phase": "segunda"
    },
    {
      "id": "avaliacao-2op",
      "title": "Realização da avaliação presencial — 2ª oportunidade",
      "start": "2026-12-10",
      "end": "2026-12-12",
      "discipline": "Ambas",
      "phase": "segunda"
    },
    {
      "id": "copia",
      "title": "Visualização da cópia da prova presencial",
      "start": "2027-01-13",
      "end": "2027-01-19",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "online",
      "title": "Realização da prova online no Studeo",
      "start": "2026-11-30",
      "end": "2026-12-06",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "notas",
      "title": "Lançamento/publicação de notas",
      "start": "2026-12-22",
      "end": "2026-12-22",
      "discipline": "Ambas",
      "phase": "regular"
    },
    {
      "id": "solicitacao-sub",
      "title": "Solicitação da avaliação substitutiva",
      "start": "2027-01-13",
      "end": "2027-01-19",
      "discipline": "Ambas",
      "phase": "substitutiva"
    },
    {
      "id": "agendamento-sub",
      "title": "Agendamento da avaliação presencial — substitutiva",
      "start": "2027-01-13",
      "end": "2027-01-19",
      "discipline": "Ambas",
      "phase": "substitutiva"
    },
    {
      "id": "avaliacao-sub",
      "title": "Realização da avaliação presencial — substitutiva",
      "start": "2027-01-18",
      "end": "2027-01-20",
      "discipline": "Ambas",
      "phase": "substitutiva"
    },
    {
      "id": "online-sub",
      "title": "Realização da prova substitutiva online no Studeo",
      "start": "2027-01-18",
      "end": "2027-01-24",
      "discipline": "Ambas",
      "phase": "substitutiva"
    },
    {
      "id": "notas-sub",
      "title": "Lançamento/publicação de notas — substitutiva",
      "start": "2027-02-08",
      "end": "2027-02-08",
      "discipline": "Ambas",
      "phase": "substitutiva"
    },
    {
      "id": "copia-sub",
      "title": "Visualização da cópia da prova presencial — substitutiva",
      "start": "2027-02-10",
      "end": "2027-02-16",
      "discipline": "Ambas",
      "phase": "substitutiva"
    }
  ]
};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = iso => iso.split('-').reverse().join('/');
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const phases = {geral:'Informações gerais',regular:'Avaliação regular',segunda:'2ª oportunidade',substitutiva:'Substitutiva'};
function events(weeks){return [...DATA.common,...(weeks===10?DATA.ten:DATA.five)].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)||a.title.localeCompare(b.title,'pt-BR'));}
function status(event,ref=today()){return event.end<ref?'Encerrado':event.start>ref?'Próximo':'Em andamento';}
let box, weeks=5, phase='', discipline='', month='';
function hub(){
 box.innerHTML='<div class="cal-intro"><p class="muted">Selecione o módulo. As datas de cada organização de disciplinas estão separadas dentro dele.</p></div><div class="cal-module-list"><a class="cal-module-card" href="#calendario-academico/54-2026"><span class="cal-module-year">GRADUAÇÃO · 2026</span><h2>Módulo 54/2026</h2><p>28 de setembro a 5 de dezembro de 2026</p><div class="cal-chips"><span>Disciplinas de 5 semanas</span><span>Disciplinas de 10 semanas</span></div><span class="cal-card-action">Consultar datas <span aria-hidden="true">→</span></span></a></div>';
}
function filtered(){return events(weeks).filter(e=>(!phase||e.phase===phase)&&(!discipline||e.discipline===discipline||e.discipline==='Ambas')&&(!month||(e.start<=month+'-31'&&e.end>=month+'-01')));}
function agenda(){
 const list=filtered();const output=box.querySelector('#cal-events');
 output.innerHTML=list.length?list.map(e=>`<article class="cal-event"><div class="cal-event-date"><time datetime="${e.start}">${date(e.start)}</time>${e.end!==e.start?`<span>até <time datetime="${e.end}">${date(e.end)}</time></span>`:''}</div><div class="cal-event-main"><div class="cal-chips"><span>${esc(phases[e.phase])}</span>${weeks===5?`<span>${esc(e.discipline==='Ambas'?'1ª e 2ª disciplinas':e.discipline)}</span>`:''}</div><h3>${esc(e.title)}</h3></div><span class="cal-status ${e.end<today()?'past':e.start>today()?'future':'current'}">${status(e)}</span></article>`).join(''):'<p class="cal-empty">Nenhuma data encontrada para esses filtros.</p>';
 box.querySelector('#cal-count').textContent=`${list.length} evento(s) · referência: ${date(today())}`;
}
function moduleView(){
 const months=[['2026-09','Setembro/2026'],['2026-10','Outubro/2026'],['2026-11','Novembro/2026'],['2026-12','Dezembro/2026'],['2027-01','Janeiro/2027'],['2027-02','Fevereiro/2027']];
 box.innerHTML=`<a class="cal-back" href="#calendario-academico">← Voltar aos módulos</a><div class="cal-module-heading"><div><span class="eyebrow">Graduação · calendário acadêmico</span><h2>Módulo 54/2026</h2><p>Período letivo: <strong>28/09/2026 a 05/12/2026</strong></p></div><span class="cal-module-note">Avaliações, notas e substitutivas incluem prazos em 2027.</span></div><div class="cal-duration" role="tablist" aria-label="Duração das disciplinas"><button type="button" id="cal-tab-5" role="tab" aria-controls="cal-panel" data-cal-weeks="5" aria-selected="${weeks===5}" class="${weeks===5?'active':''}">Disciplinas de 5 semanas</button><button type="button" id="cal-tab-10" role="tab" aria-controls="cal-panel" data-cal-weeks="10" aria-selected="${weeks===10}" class="${weeks===10?'active':''}">Disciplinas de 10 semanas</button></div><section id="cal-panel" role="tabpanel" aria-labelledby="cal-tab-${weeks}" tabindex="0"><p class="cal-context">${weeks===5?'Confira os prazos da 1ª e da 2ª disciplina separadamente.':'Prazos das disciplinas com duração de 10 semanas.'}</p><div class="cal-filters"><label>Etapa<select data-cal-filter="phase"><option value="">Todas as etapas</option>${Object.entries(phases).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>${weeks===5?'<label>Disciplina<select data-cal-filter="discipline"><option value="">Todas as disciplinas</option><option>1ª disciplina</option><option>2ª disciplina</option></select></label>':''}<label>Mês<select data-cal-filter="month"><option value="">Todos os meses</option>${months.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label></div><p class="small muted" id="cal-count" aria-live="polite"></p><div class="cal-events" id="cal-events"></div></section><div class="cal-source"><p><strong>Provas online:</strong> conforme a matriz da disciplina, ficam disponíveis no Studeo sem necessidade de agendamento. Para a substitutiva, é necessário solicitar o serviço.</p><p>Fonte: ${esc(DATA.source)} Datas transcritas exclusivamente da coluna Módulo 54.</p></div>`;
 for(const [key,value] of Object.entries({phase,discipline,month})){const el=box.querySelector(`[data-cal-filter="${key}"]`);if(el)el.value=value;}
 agenda();
}
function route(hash){
 if(!box)return;
 if(hash.startsWith('#calendario-academico/54-2026')){weeks=hash.endsWith('/10-semanas')?10:5;phase=discipline=month='';moduleView();}else hub();
}
function mount(element){
 box=element;route(location.hash);
 box.onclick=event=>{const button=event.target.closest('[data-cal-weeks]');if(!button)return;weeks=Number(button.dataset.calWeeks);phase=discipline=month='';history.replaceState(null,'','#calendario-academico/54-2026/'+weeks+'-semanas');moduleView();box.querySelector('#cal-tab-'+weeks).focus();};
 box.onkeydown=event=>{if(!event.target.matches('[data-cal-weeks]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?5:event.key==='End'?10:weeks===5?10:5;box.querySelector('#cal-tab-'+target).click();};
 box.onchange=event=>{const key=event.target.dataset.calFilter;if(!key)return;if(key==='phase')phase=event.target.value;if(key==='discipline')discipline=event.target.value;if(key==='month')month=event.target.value;agenda();};
}
if(typeof module==='object'&&module.exports)module.exports={DATA,events,status};else root.BalbinoCalendar={mount,route};
})(typeof globalThis==='undefined'?this:globalThis);
