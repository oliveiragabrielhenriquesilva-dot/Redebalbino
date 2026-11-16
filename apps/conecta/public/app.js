(async()=>{
'use strict';

const modalityLabel=c=>({ead:'EAD',semipresencial:'Semipresencial',naoinformada:'Modalidade não informada'})[c.modalidade]||'Modalidade não informada';
const response=await fetch('/conecta/dados.json',{credentials:'same-origin',cache:'no-store'});if(response.status===401||response.status===403){location.assign('/?next='+encodeURIComponent(location.pathname+location.hash));return;}if(!response.ok)throw Error('Não foi possível carregar o conteúdo do Conecta.');const DATA=await response.json(),$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();let mode='overview',selected=null,visible=[];
const sections=[['Como o curso acontece',[['resumo','Organização do curso']]],['Distribuição das atividades',[['distribuicao','Ao longo do curso, ano ou módulo']]],['Aulas e encontros',[['aoVivo','Aulas ao vivo'],['sincronas','Atividade Síncrona Mediada (ASM)'],['presencialTeorico','Encontros presenciais teóricos']]],['Práticas e outros ambientes',[['laboratorio','Laboratórios'],['outrosAmbientes','Outros ambientes']]],['Frequência e estrutura do polo',[['frequencia','Frequência e participação'],['estruturaPolo','Estrutura necessária no polo']]],['Particularidades e exceções',[['particularidades','Orientações específicas do curso']]]];
function fillFilters(){const pool=DATA.courses.filter(c=>mode==='all'||c.modalidade===mode);for(const [id,key,label] of [['area','area','Todas as áreas'],['degree','grau','Todas as formações']]){const old=$(id).value,opts=[...new Set(pool.map(c=>c[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));$(id).innerHTML=`<option value="">${label}</option>`+opts.map(v=>`<option>${esc(v)}</option>`).join('');if(opts.includes(old))$(id).value=old;}}
let catalogModality='',catalogLimit=12;
function renderCatalog(keepLimit=false){
 if(!keepLimit)catalogLimit=12;
 const q=norm($('search').value.trim());
 visible=DATA.courses.filter(c=>(mode==='all'||c.modalidade===mode)&&(!catalogModality||c.modalidade===catalogModality)&&(!$('area').value||c.area===$('area').value)&&(!$('degree').value||c.grau===$('degree').value)&&(!q||norm(c.name+' '+c.area+' '+(c.argumentario?.source_course_slug||'').replace(/-/g,' ')).includes(q))).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.modalidade.localeCompare(b.modalidade)||a.grau.localeCompare(b.grau));
 const showing=visible.slice(0,catalogLimit);
 $('results').textContent=`${visible.length} ${visible.length===1?'curso encontrado':'cursos encontrados'}`;
 $('catalog').innerHTML=visible.length?showing.map(c=>`<a class="course-card" href="#curso=${encodeURIComponent(c.id)}" data-course-link="${esc(c.id)}" aria-label="Abrir ${esc(c.name)}, ${esc(modalityLabel(c))}, ${esc(c.grau||c.area)}"><div class="catalog-card-top"><span class="tag ${c.modalidade==='ead'?'':'semi'}">${esc(modalityLabel(c))}</span>${c.grau?`<span class="catalog-degree">${esc(c.grau)}</span>`:''}</div><h3>${esc(c.name)}</h3><p>${esc(c.area)}</p><div class="meta"><span>${c.argumentario?'Ver ficha e argumentos':'Ver ficha do curso'}</span><span class="catalog-arrow" aria-hidden="true">→</span></div></a>`).join(''):'<div class="empty"><h3>Nenhum curso encontrado</h3><p>Tente outro nome ou remova os filtros selecionados.</p><button class="btn" id="emptyClear">Limpar filtros</button></div>';
 $('catalogMore').hidden=showing.length>=visible.length;
 $('catalogMore').textContent=`Mostrar mais ${Math.min(12,visible.length-showing.length)} cursos`;
 $('catalogShown').textContent=visible.length?`Exibindo ${showing.length} de ${visible.length}`:'';
 document.querySelectorAll('[data-catalog-modality]').forEach(b=>{const active=b.dataset.catalogModality===catalogModality;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
 const filters=[$('area').value,$('degree').value].filter(Boolean);$('selectedFilters').textContent=filters.join(' · ');$('advancedCount').textContent=filters.length?` (${filters.length})`:'';
}
document.addEventListener('click',e=>{
 const a=e.target.closest('a[data-course-link]');if(a&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();openCourse(a.dataset.courseLink);return;}
 const b=e.target.closest('button[data-catalog-modality]');if(b){catalogModality=b.dataset.catalogModality;renderCatalog();}
 if(e.target.closest('#catalogMore')){catalogLimit+=12;renderCatalog(true);}
});

function showMode(m){
 if(m==='commercial'||m==='prices')m='all';
 if(mode!==m)catalogModality='';
 mode=m;$('home').hidden=m!=='home';
 if($('sourceLink'))$('sourceLink').href=m==='overview'?'https://bussola.unicesumar.edu.br/categoria/novo-marco-regulatorio':'https://bussola.unicesumar.edu.br/argumentario';
 selected=null;$('overview').hidden=m!=='overview';$('catalogView').hidden=m==='overview'||m==='home';$('detail').hidden=true;
 $('pageTitle').textContent=({home:'O que você precisa consultar?',overview:'Marco Regulatório 2027',all:'Cursos e Argumentário Comercial',ead:'Cursos EAD',semipresencial:'Cursos semipresenciais'})[m];
 $('pageSub').textContent=m==='home'?'Escolha entre consultar um curso ou as orientações acadêmicas de 2027.':m==='overview'?'Orientações de 2027 e particularidades de cada curso.':'Busque o curso e abra sua ficha para consultar argumentos, dados acadêmicos e simular a mensalidade.';
 document.querySelectorAll('nav [data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===m);b.setAttribute('aria-current',b.dataset.mode===m?'page':'false')});
 if(m!=='overview'&&m!=='home'){fillFilters();renderCatalog()}
}
const commercialLabels={body:'Conteúdo',description:'Descrição',intro:'Introdução',gancho:'Gancho comercial',fraseApoio:'Frase de apoio',diferenciaisFrase:'Frase de apoio',mercadoRecemFormado:'Mercado para o recém-formado',salarioTexto:'Faixa salarial — informação da fonte',camposTexto:'Campos de atuação',camposGancho:'Gancho de atuação',salarioGancho:'Gancho comercial',publicoTexto:'Público-alvo',abordagem:'Abordagem',quebraGelo:'Quebra-gelo',scripts:'Scripts de atendimento',objecoes:'Objeções e respostas',tecnicas:'Técnicas',items:'',modules:'',etapas:'Etapas',exemplo:'Exemplo',exemplos:'Exemplos',explicacao:'Explicação',fala:'Fala',falas:'Diálogo',situacoes:'Situações',situacao:'Situação',notas:'Notas',notes:'Observações',notaFinal:'Orientação final',orientacao:'Orientação',perguntas:'Perguntas',resposta:'Resposta',script:'Script',text:'Texto',role:'Papel',q:'Pergunta',a:'Resposta'};
function commercialHas(v){return v!==null&&v!==undefined&&(typeof v==='string'?v.trim().length>0:Array.isArray(v)?v.some(commercialHas):typeof v==='object'?Object.entries(v).some(([k,x])=>k!=='id'&&commercialHas(x)):true)}
function commercialValue(v){
 if(!commercialHas(v))return '';
 if(typeof v==='string')return `<div class="source-text">${esc(v)}</div>`;
 if(Array.isArray(v)){if(v.every(x=>typeof x==='string'))return `<ul class="comm-list">${v.filter(commercialHas).map(x=>`<li class="source-text">${esc(x)}</li>`).join('')}</ul>`;return v.filter(commercialHas).map(x=>`<div class="comm-item">${commercialValue(x)}</div>`).join('')}
 if(typeof v==='object'){
   if('label' in v&&'value' in v)return `<div class="comm-fact"><span>${esc(v.label)}</span><strong>${esc(v.value)}</strong></div>`;
   const title=v.title||v.q||'';return (title?`<h4 class="comm-title">${esc(title)}</h4>`:'')+Object.entries(v).filter(([k,x])=>!['id','title','q'].includes(k)&&commercialHas(x)).map(([k,x])=>`<div class="comm-part">${commercialLabels[k]?`<div class="comm-label">${esc(commercialLabels[k])}</div>`:''}${commercialValue(x)}</div>`).join('');
 }
 return `<div class="source-text">${esc(v)}</div>`;
}
function commercialContent(c){const a=c.argumentario,s=a.sheet;const groups=[
 ['Ficha técnica do curso',['ficha']],['Objetivo e gancho comercial',['objetivo','gancho','fraseApoio']],['Diferenciais do curso',['diferenciais','diferenciaisFrase']],['Mercado de trabalho e faixa salarial',['mercadoRecemFormado','salarioTexto','camposTexto','camposGancho','salarioGancho','publicoTexto','salario','campos','publico']],['FAQ — Dúvidas frequentes',['faq']],['Matriz curricular',['matriz']],['Guia de vendas e scripts',['guiaV2','guia','scripts','objecoes']],['Técnicas de fechamento',['fechamento','fechamentoScripts']],['Checklist de sinais de compra',['sinais']]
 ];const updated=a.updated_at&&!Number.isNaN(Date.parse(a.updated_at))?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(new Date(a.updated_at)):'não informada';const matrix=a.matrix_reference?`Matriz identificada como ${esc(a.matrix_reference)} na fonte.`:'O ano da matriz não está explicitado na fonte.';return `<div class="comm-intro"><h3>Argumentário comercial · ${esc(c.name)}</h3><p>Conteúdo importado da Bússola. Atualização registrada na fonte: ${updated}. Captura: 16/11/2026.</p><p>Consulta interna do polo. ${matrix} As orientações de 2027 estão disponíveis como apoio nas demais abas.</p></div><div class="comm-accordions">${groups.filter(([title,keys])=>keys.some(k=>commercialHas(s[k]))).map(([title,keys],i)=>`<details ${i===0?'open':''}><summary><span class="comm-number">${String(i+1).padStart(2,'0')}</span>${title}</summary><div class="comm-body ${i===0?'comm-facts':''}">${keys.filter(k=>commercialHas(s[k])).map(k=>`<section class="comm-section">${keys.length>1&&commercialLabels[k]?`<h4 class="comm-label">${commercialLabels[k]}</h4>`:''}${commercialValue(s[k])}</section>`).join('')}</div></details>`).join('')}${a.extra_content?`<details><summary>Conteúdo complementar da fonte</summary><div class="comm-body">${commercialValue(a.extra_content)}</div></details>`:''}${a.extra_sections?.length?`<details><summary>Seções complementares</summary><div class="comm-body">${commercialValue(a.extra_sections)}</div></details>`:''}</div>`}

function renderCourseBase(id,updateHash=true){
 const c=DATA.courses.find(c=>c.id===id);if(!c)return;selected=c;
 $('overview').hidden=true;$('catalogView').hidden=true;$('detail').hidden=false;
 $('pageTitle').textContent=c.name;$('pageSub').textContent='Modelo acadêmico 2027';
 const card=(title,fields)=>{const fs=fields.filter(([key])=>c[key]?.trim());if(!fs.length)return '';return `<section class="panel"><h3>${title}</h3>${fs.map(([key,label])=>`<div class="field">${fs.length>1?`<h4>${label}</h4>`:''}<div class="source-text">${esc(c[key])}</div></div>`).join('')}</section>`};
 const panels=[
 ['course','Sobre o curso',card('Como o curso acontece',[['resumo','Organização']])+card('Distribuição das atividades',[['distribuicao','Distribuição']])],
 ['classes','Aulas e práticas',card('Aulas e atividades online',[['aoVivo','Aulas ao vivo'],['sincronas','Atividade Síncrona Mediada (ASM)']])+card('Encontros e práticas presenciais',[['presencialTeorico','Encontros teóricos'],['laboratorio','Práticas em laboratório'],['outrosAmbientes','Outros ambientes']])],
 ['participation','Frequência e particularidades',card('Frequência e participação',[['frequencia','Frequência']])+card('Estrutura do polo',[['estruturaPolo','Estrutura']])+card('Particularidades e exceções',[['particularidades','Particularidades']])],
 ['rules','Regras gerais de 2027',DATA.blocks.map(b=>`<details><summary>${esc(b.title)}</summary><div class="general-body"><div class="scope">${esc(b.scope)}</div><div class="source-text">${esc(b.body)}</div></div></details>`).join('')]
 ].filter(p=>p[2]);
 if(c.argumentario)panels.unshift(['commercial','Argumentário comercial',commercialContent(c)]);
 const meta=[['Formação',c.grau],['Duração',c.duracao],['Carga horária',c.cargaHoraria]].filter(x=>x[1]);
 const idx=visible.findIndex(x=>x.id===id);
 $('detail').innerHTML=`<div class="detail-top"><button class="btn" id="back">← Voltar aos cursos</button><span class="small muted">Novo Marco · 2027</span><button class="btn" id="coursePrint">Imprimir ficha</button></div><div class="course-hero"><span class="tag ${c.modalidade==='ead'?'':'semi'}">${esc(modalityLabel(c))}</span><h2>${esc(c.name)}</h2><p>${esc(c.area)}</p>${!c.academicSource?'<p class="small muted" data-import-style="import-style-3">Ficha comercial. O material de 2027 enviado não contém quadro específico deste curso.</p>':''}${meta.length?`<div class="detail-meta">${meta.map(([label,value])=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`:''}</div><div class="course-tabs" role="tablist" aria-label="Informações do curso">${panels.map(([key,label],i)=>`<button role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${i===0}" class="${i===0?'active':''}" data-course-tab="${key}">${label}</button>`).join('')}</div>${panels.map(([key,label,content],i)=>`<div id="panel-${key}" role="tabpanel" aria-labelledby="tab-${key}" class="course-tab-panel ${key==='rules'?'rules-grid':'detail-sections'}" ${i?'hidden':''}>${content}</div>`).join('')}<div class="bottom-nav"><button class="btn" id="previous" ${idx<=0?'disabled':''}>← Curso anterior</button><button class="btn" id="nextCourse" ${idx<0||idx===visible.length-1?'disabled':''}>Próximo curso →</button></div>`;
 if(updateHash)history.replaceState(null,'','#curso='+encodeURIComponent(c.id));window.scrollTo({top:0,behavior:'instant'});
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.courseTab){const key=b.dataset.courseTab;document.querySelectorAll('.course-tabs button').forEach(t=>{const active=t.dataset.courseTab===key;t.classList.toggle('active',active);t.setAttribute('aria-selected',String(active))});document.querySelectorAll('.course-tab-panel').forEach(p=>p.hidden=p.id!=='panel-'+key)}if(b.id==='coursePrint'){$('detail').querySelectorAll('.course-tab-panel').forEach(p=>p.hidden=false);window.print();const active=document.querySelector('.course-tabs button.active');$('detail').querySelectorAll('.course-tab-panel').forEach(p=>p.hidden=p.id!=='panel-'+active.dataset.courseTab)}});

function reset(){catalogModality='';catalogLimit=12;['search','area','degree'].forEach(id=>$(id).value='');renderCatalog()}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.mode){showMode(b.dataset.mode);history.replaceState(null,'',location.pathname);window.scrollTo(0,0)}if(b.dataset.course)openCourse(b.dataset.course);if(b.id==='back'){showMode(mode==='overview'?'all':mode);history.replaceState(null,'',location.pathname);window.scrollTo(0,0)}if(b.id==='emptyClear')reset();if(b.id==='previous'||b.id==='nextCourse'){const i=visible.findIndex(c=>c.id===selected.id),c=visible[i+(b.id==='previous'?-1:1)];if(c)openCourse(c.id)}});
$('general').innerHTML=DATA.blocks.map((b,i)=>`<details ${i===2?'open':''}><summary>${esc(b.title)}</summary><div class="general-body"><div class="scope">${esc(b.scope)}</div><div class="source-text">${esc(b.body)}</div></div></details>`).join('');$('search').oninput=()=>renderCatalog();$('area').onchange=()=>renderCatalog();$('degree').onchange=()=>renderCatalog();$('clear').onclick=reset;$('expand').onclick=()=>{const ds=[...$('general').querySelectorAll('details')],open=ds.some(x=>!x.open);ds.forEach(x=>x.open=open);$('expand').textContent=open?'Recolher tudo':'Expandir tudo'};$('print').onclick=()=>{const closed=[...document.querySelectorAll('section:not([hidden]) details:not([open])')];closed.forEach(d=>d.open=true);window.print();closed.forEach(d=>d.open=false)};
const feeState=new Map();
const brl=cents=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function percentage(raw){const s=String(raw).trim().replace(',','.');if(!/^\d{1,3}(\.\d{1,2})?$/.test(s))return null;const n=Number(s);return n>=0&&n<=100?Math.round(n*100):null;}
function feeCalculation(base,discountBps,punctualBps){
  const without=Math.floor((base*(10000-discountBps)+5000)/10000);
  const final=Math.floor((without*(10000-punctualBps)+5000)/10000);
  return {base,without,final,courseDiscount:base-without,punctualDiscount:without-final,saving:base-final};
}
function feeSettings(c){if(!feeState.has(c.id))feeState.set(c.id,{discount:'0',punctual:'10',code:c.pricing?.code||''});return feeState.get(c.id);}
function feePrice(c){const state=feeSettings(c);return (c.pricingOptions||[]).find(p=>p.code===state.code)||null;}
function feeMarkup(c){
 const state=feeSettings(c),p=feePrice(c),options=c.pricingOptions||[];
 if(!p)return `<div class="fee-missing"><strong>Mensalidade</strong><span>Valor não disponível na tabela enviada para este curso e modalidade.</span></div>`;
 return `<div class="fee-compact-head"><h3>Simular mensalidade</h3><span>Região 6 · Processo 51/2027</span></div><div class="fee-grid"><div class="fee-base"><span>Valor integral fixo</span><strong>${brl(p.price)}</strong></div><div class="fee-fields"><label>Desconto (%)<input id="feeDiscount" type="text" inputmode="decimal" maxlength="6" value="${esc(state.discount)}" aria-describedby="feeHint feeError"></label><label>Pontualidade (%)<input id="feePunctual" type="text" inputmode="decimal" maxlength="6" value="${esc(state.punctual)}" aria-describedby="feeHint feeError"></label></div><div class="fee-result" aria-live="polite" aria-atomic="true"><span>Com pontualidade / mês</span><strong id="feeFinal">—</strong></div></div><p id="feeError" role="alert" class="fee-error" hidden></p><div class="fee-bottom"><div class="fee-summary"><span>Sem pontualidade</span><b id="feeWithout">—</b></div><div class="fee-summary"><span>Economia mensal</span><b id="feeSaving">—</b></div><details class="fee-breakdown"><summary>Como foi calculado</summary><div class="fee-steps"><div><span>Valor integral</span><b>${brl(p.price)}</b></div><div><span>1. Desconto do curso</span><b id="feeCourseDiscount">—</b></div><div><span>Valor após desconto</span><b id="feeAfter">—</b></div><div><span>2. Pontualidade</span><b id="feePunctualDiscount">—</b></div><p id="feeHint" class="fee-hint">Primeiro o desconto do curso; depois, a pontualidade sobre o valor já descontado. Arredondamento em centavos a cada etapa.</p><p class="fee-source">${esc(p.code)} · Tabela de 16/11/2026</p></div></details></div>`;
}

function updateFee(){
 if(!selected)return;const p=feePrice(selected);if(!p||!$('feeDiscount'))return;
 const state=feeSettings(selected);state.discount=$('feeDiscount').value;state.punctual=$('feePunctual').value;
 const d=percentage(state.discount),t=percentage(state.punctual),valid=d!==null&&t!==null;
 $('feeDiscount').setAttribute('aria-invalid',String(d===null));$('feePunctual').setAttribute('aria-invalid',String(t===null));$('feeError').hidden=valid;
 $('feeError').textContent=valid?'':'Informe percentuais de 0 a 100, com até duas casas decimais.';
 const ids=['feeFinal','feeWithout','feeSaving','feeCourseDiscount','feeAfter','feePunctualDiscount'];if(!valid){ids.forEach(id=>$(id).textContent='—');return;}
 const result=feeCalculation(p.price,d,t);
 $('feeFinal').textContent=brl(result.final);$('feeWithout').textContent=brl(result.without);$('feeSaving').textContent=brl(result.saving);$('feeCourseDiscount').textContent='− '+brl(result.courseDiscount);$('feeAfter').textContent=brl(result.without);$('feePunctualDiscount').textContent='− '+brl(result.punctualDiscount);
}
function openCourse(id,updateHash=true){renderCourseBase(id,updateHash);if(!selected||selected.id!==id)return;const hero=document.querySelector('#detail .course-hero');if(!hero)return;hero.classList.add('has-calculator');hero.innerHTML='<div class="fee-course-info">'+hero.innerHTML+'</div><section id="feeCalculator" class="fee-calculator" aria-label="Calculadora de mensalidade">'+feeMarkup(selected)+'</section>';updateFee();}
document.addEventListener('input',e=>{if(e.target.id==='feeDiscount'||e.target.id==='feePunctual')updateFee();});
document.addEventListener('change',e=>{if(e.target.id==='feeCode'&&selected){feeSettings(selected).code=e.target.value;$('feeCalculator').innerHTML=feeMarkup(selected);updateFee();}});

showMode('home');if(location.hash.startsWith('#curso=')){showMode('all');openCourse(decodeURIComponent(location.hash.slice(7)),false)}

})().catch(()=>{const main=document.querySelector('main');const p=document.createElement('p');p.setAttribute('role','alert');p.textContent='Não foi possível carregar o Balbino Conecta. Atualize a página ou entre novamente no Portal.';main.replaceChildren(p);});
