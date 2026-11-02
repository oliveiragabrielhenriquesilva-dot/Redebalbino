(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  async function readExcel(file){
    const buf=new Uint8Array(await file.arrayBuffer()),dv=new DataView(buf.buffer);
    if(/\.csv$/i.test(file.name)||buf[0]!==0x50){
      const text=new TextDecoder('utf-8').decode(buf);
      const sep=(text.split('\n')[0].match(/;/g)||[]).length>=(text.split('\n')[0].match(/,/g)||[]).length?';':',';
      return text.split(/\r?\n/).filter(x=>x.trim()).map(line=>{const out=[];let value='',quoted=false;for(const ch of line){if(ch==='"')quoted=!quoted;else if(ch===sep&&!quoted){out.push(value);value=''}else value+=ch}out.push(value);return out.map(x=>x.trim())});
    }
    let end=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-70000);i--)if(dv.getUint32(i,true)===0x06054b50){end=i;break}
    if(end<0)throw new Error('O arquivo não parece ser um Excel .xlsx válido.');
    const count=dv.getUint16(end+10,true);let offset=dv.getUint32(end+16,true);const files={};
    for(let i=0;i<count;i++){const method=dv.getUint16(offset+10,true),size=dv.getUint32(offset+20,true),nl=dv.getUint16(offset+28,true),el=dv.getUint16(offset+30,true),cl=dv.getUint16(offset+32,true),local=dv.getUint32(offset+42,true);const name=new TextDecoder().decode(buf.slice(offset+46,offset+46+nl));files[name]={method,size,local};offset+=46+nl+el+cl}
    const read=async name=>{const f=files[name];if(!f)return null;const start=f.local+30+dv.getUint16(f.local+26,true)+dv.getUint16(f.local+28,true),data=buf.slice(start,start+f.size);if(f.method===0)return new TextDecoder().decode(data);if(typeof DecompressionStream==='undefined')throw new Error('Este navegador não abre .xlsx. Atualize o Chrome ou salve o arquivo como CSV.');return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()};
    const xml=text=>new DOMParser().parseFromString(text,'application/xml'),shared=[];
    const ss=await read('xl/sharedStrings.xml');if(ss)for(const si of xml(ss).getElementsByTagName('si'))shared.push([...si.getElementsByTagName('t')].map(x=>x.textContent).join(''));
    let path='xl/worksheets/sheet1.xml';
    try{const wb=xml(await read('xl/workbook.xml')),rels=xml(await read('xl/_rels/workbook.xml.rels')),sheet=wb.getElementsByTagName('sheet')[0],rid=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),rel=[...rels.getElementsByTagName('Relationship')].find(x=>x.getAttribute('Id')===rid);if(rel)path='xl/'+rel.getAttribute('Target').replace(/^\/?xl\//,'').replace(/^\//,'')}catch{}
    const source=await read(path);if(!source)throw new Error('Não encontrei a primeira planilha no arquivo.');
    const col=ref=>{const m=/^([A-Z]+)/.exec(ref||'');let n=0;for(const ch of(m?m[1]:'A'))n=n*26+ch.charCodeAt(0)-64;return n-1};
    return [...xml(source).getElementsByTagName('row')].map(row=>{const cells=[];for(const cell of row.getElementsByTagName('c')){const type=cell.getAttribute('t'),v=cell.getElementsByTagName('v')[0];let value=type==='inlineStr'?[...cell.getElementsByTagName('t')].map(x=>x.textContent).join(''):v?v.textContent:'';if(type==='s')value=shared[Number(value)]||'';cells[col(cell.getAttribute('r'))]=value}return Array.from(cells,x=>x??'')});
  }
  function normalizeHeader(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim()}
  function excelDate(value){
    const text=String(value||'').trim();if(!text)return '';
    if(/^\d{4}-\d{2}-\d{2}/.test(text))return text.slice(0,10);
    const br=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);if(br)return br[3]+'-'+br[2]+'-'+br[1];
    if(/^\d{5}(\.\d+)?$/.test(text)){const d=new Date(Date.UTC(1899,11,30)+Math.floor(Number(text))*86400000);return d.toISOString().slice(0,10)}
    return '';
  }
  async function parseFollowupWorkbook(file){
    const table=await readExcel(file),headIndex=table.findIndex(row=>row.some(v=>normalizeHeader(v)==='identificador aluno'));
    if(headIndex<0)throw new Error('Não encontrei a coluna “Identificador Aluno” na planilha.');
    const headers=table[headIndex].map(normalizeHeader),aliases={
      identificador:['identificador aluno','identificador','id aluno'],nome:['nome completo','nome'],cpf:['cpf'],telefone:['telefone','celular'],
      curso_cod:['curso codigo','codigo curso','curso'],curso_nome:['curso nome','nome curso','curso'],
      polo_fonte:['polo'],prioridade:['prioridade'],ultimo_atendimento:['dt ult atendimento','dt ultimo atendimento','data ultimo atendimento'],
      data_retorno:['dt retorno','data retorno'],data_registro:['dt registro','data registro'],interacoes:['interacoes'],
      status_origem:['status'],origem:['origem'],localizacao:['localizacao'],contato:['contato'],responsavel_origem:['resp ultimo atendimento','responsavel ultimo atendimento']
    };
    const idx={};for(const [key,names] of Object.entries(aliases))idx[key]=headers.findIndex(h=>names.includes(h));
    const read=(row,key)=>idx[key]<0?'':String(row[idx[key]]??'').trim();
    const rows=[];
    for(const row of table.slice(headIndex+1)){
      const identifier=read(row,'identificador').replace(/\.0$/,'');if(!identifier)continue;
      const course=read(row,'curso_cod');
      rows.push({identificador:identifier,nome:read(row,'nome'),cpf:read(row,'cpf'),telefone:read(row,'telefone'),curso_cod:course,curso_nome:read(row,'curso_nome')||course,polo_fonte:read(row,'polo_fonte'),prioridade:read(row,'prioridade'),ultimo_atendimento:excelDate(read(row,'ultimo_atendimento')),data_retorno:excelDate(read(row,'data_retorno')),data_registro:excelDate(read(row,'data_registro')),interacoes:read(row,'interacoes'),status_origem:read(row,'status_origem'),origem:read(row,'origem'),localizacao:read(row,'localizacao'),contato:read(row,'contato'),responsavel_origem:read(row,'responsavel_origem')});
    }
    if(!rows.length)throw new Error('A planilha não tem candidatos abaixo do cabeçalho.');
    return rows;
  }
  const state={ciclo:'',situacao:'abertas',q:'',data:null,selected:null};
  const etapas={novo:'Novo',contato:'Contato iniciado',negociacao:'Em negociação',pendencia:'Inscrição pendente',perdido:'Perdida'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateLabel=value=>{if(!value)return '—';const [y,m,d]=String(value).slice(0,10).split('-');return y&&m&&d?d+'/'+m+'/'+y:'—'};
  const digits=value=>String(value||'').replace(/\D/g,'');
  const stageLabel=(row)=>row.situacao==='matriculado'?'Matriculado':etapas[row.etapa]||'Novo';
  const showError=(message='')=>{const node=$('error');node.textContent=message;node.classList.toggle('hidden',!message)};
  const showNotice=(message='')=>{const node=$('notice');node.textContent=message;node.classList.toggle('hidden',!message)};
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
    if(!rows.length){$('rows').innerHTML='<tr><td colspan="9" class="empty">Nenhum candidato nesta visualização.</td></tr>';return}
    $('rows').innerHTML=rows.map(r=>{
      const phone=digits(r.telefone);
      const whatsapp=phone?'<a class="mini" target="_blank" rel="noopener" href="https://wa.me/'+esc(phone)+'">WhatsApp</a>':'';
      const badge=r.situacao==='matriculado'?'pill matriculado':r.etapa==='perdido'?'pill perdido':'pill';
      return '<tr><td><span class="person">'+esc(r.nome||'Nome não informado')+'</span><span class="sub">ID '+esc(r.identificador||'—')+(r.ra?' · RA '+esc(r.ra):'')+(r.telefone?' · '+esc(r.telefone):'')+'</span></td><td>'+esc(r.curso_nome||r.curso_cod||'Curso não informado')+'</td><td>'+esc(r.polo_fonte||'Polo não informado')+'</td><td>'+esc(r.prioridade||'—')+'</td><td>'+esc(dateLabel(r.ultimo_atendimento))+'</td><td><span class="'+badge+'">'+esc(stageLabel(r))+'</span>'+(r.status_origem?'<span class="sub">'+esc(r.status_origem)+'</span>':'')+'</td><td>'+esc(r.responsavel||'—')+(r.responsavel_origem?'<span class="sub">No relatório: '+esc(r.responsavel_origem)+'</span>':'')+'</td><td>'+esc(dateLabel(r.proximo_contato))+'</td><td><div class="table-actions">'+whatsapp+(state.data?.pode_editar?'<button class="mini" data-edit="'+esc(r.candidato_id)+'">Acompanhar</button>':'')+'</div></td></tr>';
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
      const data=await request(query());state.data=data;state.ciclo=String(data.ciclo||state.ciclo);fillCycles(data);$('upload').closest('.upload').hidden=!data.pode_editar;renderMetrics(data.resumo||{});renderRows(data.lista||[]);
    }catch(error){showError(error.message);$('rows').innerHTML='<tr><td colspan="9" class="empty">Não foi possível carregar os candidatos.</td></tr>'}
  }
  function openEdit(id){
    const row=state.data?.lista?.find(x=>Number(x.candidato_id)===id);if(!row)return;
    state.selected=row;$('candidate-id').value=String(id);$('edit-title').textContent=row.nome||'Candidato '+row.identificador;
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
  $('upload').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    showError('');showNotice('');
    try{
      const linhas=await parseFollowupWorkbook(file);
      const ciclo=state.data?.ciclos?.find(x=>String(x.id)===state.ciclo);
      if(!ciclo)throw new Error('Selecione um processo antes de importar.');
      if(!confirm('Importar '+linhas.length+' registros para '+ciclo.nome+'? A importação atualiza os dados do relatório e preserva as etapas, responsáveis e anotações já registradas.'))return;
      const result=await request('/oportunidades/api/ma/oportunidades/importar',{method:'POST',body:JSON.stringify({ciclo:state.ciclo,linhas})});
      showNotice('Importação concluída: '+result.novos+' novos, '+result.atualizados+' atualizados, '+result.ignorados+' ignorados.');
      await load();
    }catch(error){showError(error.message)}
    finally{event.target.value=''}
  });
  $('view').addEventListener('change',()=>{state.situacao=$('view').value;load()});
  let searchTimer; $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=$('search').value.trim();load()},250)});
  $('logout').addEventListener('click',async()=>{try{await request('/api/portal/logout',{method:'POST',body:'{}'})}catch{}location.assign('/')});
  load();
})();
