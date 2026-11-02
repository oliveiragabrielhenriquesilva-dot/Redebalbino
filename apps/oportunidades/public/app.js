(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const state={ciclo:'',situacao:'abertas',q:'',data:null,selected:null};
  const etapas={novo:'Novo',contato:'Contato iniciado',negociacao:'Em negociação',pendencia:'Inscrição pendente',perdido:'Perdida'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateLabel=value=>{if(!value)return '—';const [y,m,d]=String(value).slice(0,10).split('-');return y&&m&&d?d+'/'+m+'/'+y:'—'};
  const digits=value=>String(value||'').replace(/\D/g,'');
  const stageLabel=(row)=>row.situacao==='matriculado'?'Matriculado':etapas[row.etapa]||'Novo';
  const showError=(message='')=>{const node=$('error');node.textContent=message;node.classList.toggle('hidden',!message)};
  async function request(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Falha na consulta (${response.status})`);
    return data;
  }
  function query(){
    const params=new URLSearchParams({situacao:state.situacao});
    if(state.ciclo)params.set('ciclo',state.ciclo);
    if(state.q)params.set('q',state.q);
    return '/oportunidades/api/ma/oportunidades?'+params;
  }
  function renderMetrics(r){
    $('metric-open').textContent=r.abertas??0;
    $('metric-new').textContent=r.novas??0;
    $('metric-contact').textContent=r.em_contato??0;
    $('metric-enrolled').textContent=r.matriculadas??0;
    $('metric-overdue').textContent=r.retornos_atrasados??0;
  }
  function renderRows(rows){
    $('result-count').textContent=rows.length+' candidato(s)';
    if(!rows.length){$('rows').innerHTML='<tr><td colspan="8" class="empty">Nenhum candidato nesta visualização.</td></tr>';return}
    $('rows').innerHTML=rows.map(r=>{
      const phone=digits(r.telefone);
      const whatsapp=phone?'<a class="mini" target="_blank" rel="noopener" href="https://wa.me/'+esc(phone)+'">WhatsApp</a>':'';
      const badge=r.situacao==='matriculado'?'pill matriculado':r.etapa==='perdido'?'pill perdido':'pill';
      return '<tr><td><span class="person">'+esc(r.nome||'Nome não informado')+'</span><span class="sub">Candidato '+esc(r.candidato||'—')+(r.ra?' · RA '+esc(r.ra):'')+'</span></td><td>'+esc(r.curso_nome||'Curso não informado')+'</td><td>'+esc(r.polo_fonte||'Polo não informado')+'</td><td>'+esc(r.telefone||'Sem celular')+'</td><td><span class="'+badge+'">'+esc(stageLabel(r))+'</span></td><td>'+esc(r.responsavel||'—')+'</td><td>'+esc(dateLabel(r.proximo_contato))+'</td><td><div class="table-actions">'+whatsapp+(state.data?.pode_editar?'<button class="mini" data-edit="'+esc(r.candidato_id)+'">Acompanhar</button>':'')+'</div></td></tr>';
    }).join('');
    document.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',()=>openEdit(Number(button.dataset.edit))));
  }
  function fillCycles(data){
    const select=$('cycle'),selected=state.ciclo||String(data.ciclo||'');
    select.innerHTML=(data.ciclos||[]).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.nome)+'</option>').join('');
    state.ciclo=selected;select.value=selected;
  }
  async function load(){
    showError('');
    try{
      const data=await request(query());state.data=data;state.ciclo=String(data.ciclo||state.ciclo);fillCycles(data);renderMetrics(data.resumo||{});renderRows(data.lista||[]);
    }catch(error){showError(error.message);$('rows').innerHTML='<tr><td colspan="8" class="empty">Não foi possível carregar os candidatos.</td></tr>'}
  }
  function openEdit(id){
    const row=state.data?.lista?.find(x=>Number(x.candidato_id)===id);if(!row)return;
    state.selected=row;$('candidate-id').value=String(id);$('edit-title').textContent=row.nome||'Candidato '+row.candidato;
    $('stage').value=etapas[row.etapa]?row.etapa:'novo';$('follow-up').value=row.proximo_contato||'';$('notes').value=row.observacao||'';
    $('owner').innerHTML='<option value="">Sem responsável</option>'+(state.data.responsaveis||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.nome)+'</option>').join('');
    $('owner').value=row.responsavel_id?String(row.responsavel_id):'';$('save-error').textContent='';$('edit-dialog').showModal();
  }
  function close(){ $('edit-dialog').close();state.selected=null}
  $('edit-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!state.selected)return;
    const button=$('save');button.disabled=true;$('save-error').textContent='';
    try{
      await request('/oportunidades/api/ma/oportunidades/'+encodeURIComponent($('candidate-id').value),{method:'PUT',body:JSON.stringify({etapa:$('stage').value,responsavel_id:$('owner').value,proximo_contato:$('follow-up').value,observacao:$('notes').value})});
      close();await load();
    }catch(error){$('save-error').textContent=error.message}
    finally{button.disabled=false}
  });
  $('close-dialog').addEventListener('click',close);$('cancel-edit').addEventListener('click',close);
  $('cycle').addEventListener('change',()=>{state.ciclo=$('cycle').value;load()});
  $('view').addEventListener('change',()=>{state.situacao=$('view').value;load()});
  let searchTimer; $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=$('search').value.trim();load()},250)});
  $('logout').addEventListener('click',async()=>{try{await request('/api/portal/logout',{method:'POST',body:'{}'})}catch{}location.assign('/')});
  load();
})();
