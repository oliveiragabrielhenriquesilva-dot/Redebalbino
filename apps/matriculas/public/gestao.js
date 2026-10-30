'use strict';
const somarConhecido = (xs,k) => xs.some(x=>x[k]==null) ? null : xs.reduce((a,x)=>a+(x[k]||0),0);
const diferencaConhecida = (a,b) => a==null||b==null ? null : a-b;
const avisoSpaces = () => '<div class="info aviso-spaces"><b>Aguardando definição dos Spaces.</b> Meta, realizado, atingimento e quantidade restante continuam disponíveis. Esperado, SAVE/GAP e ritmo geral serão ativados após a definição. Produtos com prazo próprio mantêm seu acompanhamento.</div>';
const variacaoTxt = x => x.percentual==null ? (x.atual?'Sem base anterior':'—') : `${x.percentual>0?'+':''}${pctTxt(x.percentual)}`;

async function centralRelatoriosV27(c){
  const polo=poloTravado()?B.usuario.polo_id:(estado.polo||''),ps=B.polos.filter(p=>p.ativo);
  const itens=[
    ['Rotina diária','Dia a dia por polo','Por semana: matrículas, esperado e SAVE/GAP de cada dia, por polo e tutor, e o placar para o grupo.','#/relatorio-diario'],
    ['Rotina diária','Previsão da próxima semana','Meta da semana que vem e quanto precisa até o fim dela, por polo, produto e tutor.','#/relatorio-previsao-semana'],
    ['Rotina diária','Acompanhamento por polo','Resultado completo do polo: metas, produtos, equipe, financeiro e origens.','#/relatorio/'+(polo||'todos')],
    ['Metas e Spaces','Visão geral do Space','O próximo marco: meta do Space × realizado por produto e polo.','#/relatorio-visao-space'],
    ['Metas e Spaces','Visão geral por produto','Meta do processo × realizado de cada produto, com as linhas de cada polo.','#/relatorio-rede-produtos'],
    ['Metas e Spaces','Produto × Space / Polo','Todos os marcos lado a lado, por produto e polo (inclui o acompanhamento da Pós).','#/relatorio-produto-space'],
    ['Metas e Spaces','Metas e Spaces','O planejamento: metas cadastradas por polo e produto e o andamento de cada Space.','#/relatorio-metas/'+(polo||'geral')],
    ['Análises','Origens por polo','De onde vêm as matrículas em cada polo: origem × polo, principais origens e ticket.','#/relatorio-origens'],
    ['Análises','Comparativos e qualidade','Evolução entre períodos e pendências de cadastro e metas.','#/gestao'],
    ['Mundo Azul','Sede/Digital','Matrículas do Mundo Azul que os tutores não lançaram, por polo e produto.','#/relatorio-sede-digital'],
    ['Mundo Azul','Lista de alunos do Mundo Azul','Importar a planilha e conferir aluno por aluno, incluindo lançadas sem R.A.','#/mundo-azul/oficial']
  ];
  c.innerHTML=`<div class="g-cab"><div><h2>Central de relatórios</h2><p>${esc(cicloAtual().nome)} · posição ${dataBR(posicaoAtual())}</p></div></div>
  ${!B.spaces.some(x=>x.ciclo_id===estado.ciclo)?avisoSpaces():''}
  ${['Rotina diária','Metas e Spaces','Análises','Mundo Azul'].map(grupo=>`<section class="rel-grupo"><h3>${grupo}</h3><div class="rel-catalogo">${itens.filter(x=>x[0]===grupo).map(([,n,d,url])=>`<article class="card rel-card"><div><h3>${n}</h3><p>${d}</p></div><a class="btn peq" href="${url}" target="_blank" rel="noopener">Abrir</a></article>`).join('')}</div></section>`).join('')}
  <section class="card mt"><div class="card-cab"><h2>Relatório do tutor</h2></div><div class="corpo"><div class="rel-selecao">
    <label>Polo<select id="central-polo" ${poloTravado()?'disabled':''}>${ps.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    <label>Tutor<select id="central-tutor"></select></label>
    <label>Semana de referência<input type="date" id="central-semana" value="${posicaoAtual()}"></label>
    <button class="btn" id="central-processo">Processo</button><button class="btn prim" id="central-semanal">Semana</button>
  </div><p class="muted">As vendas contam no polo de crédito do tutor. Processo abre com todos os tutores quando essa opção estiver selecionada.</p></div></section>
  <section class="card mt"><div class="card-cab"><h2>Campanhas</h2></div><div class="corpo rel-selecao"><label>Campanha<select id="central-campanha"><option>Carregando…</option></select></label><button class="btn" id="central-abrir-campanha">Abrir relatório</button></div></section>
  <section class="card mt"><div class="card-cab"><h2>Fechamentos preservados</h2></div><div class="corpo"><p>Uma consulta comum usa as regras atuais. O fechamento analítico guarda os números, matrículas, metas diárias/semanais e configurações da posição, sem alterações posteriores.</p>
  ${eAdmin()?`<div class="rel-selecao"><label>Nome<input type="text" id="fechar-nome" value="Fechamento ${dataBR(posicaoAtual())}"></label><label>Posição<input type="date" id="fechar-ref" value="${posicaoAtual()}" max="${B.hoje}"></label><button class="btn prim" id="fechar-criar">Preservar fechamento${polo?' do polo':' da rede'}</button></div>`:''}
  <div id="central-fechamentos" class="mt">Carregando…</div></div></section>`;
  $('#central-polo').value=polo||ps[0]?.id||'';
  let listaTutorGeracao=0;
  async function tutores(){const geracao=++listaTutorGeracao,pid=Number($('#central-polo').value),el=$('#central-tutor');el.innerHTML='<option value="todos">Carregando equipe e histórico…</option>';try{const ts=await api('/api/tutores-processo?'+qs({ciclo:estado.ciclo,polo:pid,ref:posicaoAtual()}));if(geracao!==listaTutorGeracao||!el.isConnected)return;el.innerHTML='<option value="todos">Equipe e histórico do polo</option>'+ts.map(t=>`<option value="${t.id}">${esc(t.nome)}${t.atual?'':' (histórico)'}</option>`).join('');}catch(e){if(el.isConnected)el.innerHTML='<option value="todos">Não foi possível carregar</option>';toast(e.message,true);}}
  await tutores();$('#central-polo').onchange=tutores;
  const abrir=url=>window.open(urlRelatorio(url),'_blank','noopener');
  $('#central-processo').onclick=()=>abrir(`#/relatorio-equipe/${$('#central-polo').value}/${$('#central-tutor').value}`);
  $('#central-semanal').onclick=()=>{if($('#central-tutor').value==='todos')return toast('Selecione um tutor para o relatório semanal.',true);if(!$('#central-semana').reportValidity()||!$('#central-semana').value)return;abrir(`#/relatorio-tutor/${$('#central-tutor').value}/${$('#central-polo').value}/${estado.ciclo}/${$('#central-semana').value}`);};
  const [campanhas,fechamentos]=await Promise.all([api('/api/campanhas'),api('/api/fechamentos?'+qs({ciclo:estado.ciclo,polo}))]);
  if(!$('#central-campanha',c))return;
  $('#central-campanha').innerHTML=campanhas.length?campanhas.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join(''):'<option value="">Nenhuma campanha</option>';
  $('#central-abrir-campanha').disabled=!campanhas.length;
  $('#central-abrir-campanha').onclick=()=>abrir('#/relatorio-campanha/'+$('#central-campanha').value);
  $('#central-fechamentos').innerHTML=fechamentos.length?`<table class="t"><thead><tr><th>Fechamento</th><th>Posição</th><th>Criado em</th><th></th></tr></thead><tbody>${fechamentos.map(f=>`<tr><td>${esc(f.nome)}</td><td>${dataBR(f.ref)}</td><td>${esc(f.criado_em)}</td><td><a class="btn peq" href="#/relatorio-fechamento/${f.id}" target="_blank" rel="noopener">Abrir</a></td></tr>`).join('')}</tbody></table>`:'<p class="muted">Nenhum fechamento preservado neste processo.</p>';
  if($('#fechar-criar'))$('#fechar-criar').onclick=async()=>{const b=$('#fechar-criar');b.disabled=true;try{const r=await api('/api/fechamentos',{method:'POST',body:{ciclo:estado.ciclo,polo,ref:$('#fechar-ref').value,nome:$('#fechar-nome').value}});toast('Fechamento preservado');abrir('#/relatorio-fechamento/'+r.id);await centralRelatoriosV27(c);}catch(e){toast(e.message,true);b.disabled=false;}};
}

function tabelaComparativa(linhas,tutor=false){
  return `<div class="tabela-scroll"><table class="t"><thead><tr><th>${tutor?'Tutor':'Polo'}</th>${tutor?'<th>Polos de crédito com vendas</th>':''}<th class="num">Atual</th><th class="num">Anterior</th><th class="num">Diferença</th><th class="num">Variação</th><th class="num">RPV atual</th><th class="num">Ticket</th></tr></thead><tbody>${linhas.map(x=>`<tr><td>${esc(x.nome)}</td>${tutor?`<td>${esc(x.polos.join(', ')||'—')}</td>`:''}<td class="num">${int(x.atual)}</td><td class="num">${int(x.anterior)}</td><td class="num">${x.variacao>0?'+':''}${int(x.variacao)}</td><td class="num">${variacaoTxt(x)}</td><td class="num">${brl(x.rpv)}</td><td class="num">${x.ticket==null?'—':brl(x.ticket)}</td></tr>`).join('')||'<tr><td colspan="8">Nenhum registro neste recorte.</td></tr>'}</tbody></table></div>`;
}
function listaQualidade(d){return d.itens.length?`<ul class="qualidade-lista">${d.itens.map(i=>`<li><span class="tag ${i.nivel==='warn'?'warn':'cinza'}">${i.nivel==='warn'?'Conferir':'Informação'}</span> ${esc(i.mensagem)}</li>`).join('')}</ul>`:'<p>Nenhuma pendência detectada pelas verificações automáticas.</p>';}
async function telaGestao(c){
  const ref=posicaoAtual();
  c.innerHTML=`<div class="g-cab"><div><h2>Gestão e qualidade</h2><p>${esc(cicloAtual().nome)} · ${estado.polo?'Polo '+esc(nomePor('polos',estado.polo)):'Todos os polos'}</p></div></div><div class="filtros"><label class="campo"><span>De</span><input id="gestao-de" type="date" value="${segundaDe(ref)}"></label><label class="campo"><span>Até</span><input id="gestao-ate" type="date" value="${ref}" max="${B.hoje}"></label><label class="campo"><span>Produto</span><select id="gestao-produto"><option value="">Todos</option>${B.produtos.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label><button class="btn prim" id="gestao-gerar">Atualizar</button><button class="btn" onclick="window.print()">Imprimir / PDF</button></div><div id="gestao-resultado"></div>`;
  let geracao=0;
  async function gerar(){const v=++geracao,box=$('#gestao-resultado',c);if(!box)return;box.innerHTML='<div class="carregando">Conferindo…</div>';try{const q={ciclo:estado.ciclo,polo:estado.polo,de:$('#gestao-de').value,ate:$('#gestao-ate').value,ref:$('#gestao-ate').value,produto:$('#gestao-produto').value};const [d,k]=await Promise.all([api('/api/comparativo?'+qs(q)),api('/api/qualidade?'+qs(q))]);if(v!==geracao||!box.isConnected)return;
    box.innerHTML=`<p class="info">Atual: <b>${dataBR(d.de)} a ${dataBR(d.ate)}</b> · anterior: <b>${dataBR(d.anterior_de)} a ${dataBR(d.anterior_ate)}</b> · ${d.dias} dia(s) em cada período. Produto: ${esc(nomePor('produtos',q.produto)||'todos')}.</p><div class="g-kpis g3"><div class="g-kpi"><span>Matrículas no período</span><b>${int(d.totais.atual)}</b><em>${int(d.totais.anterior)} no anterior</em></div><div class="g-kpi"><span>Variação</span><b>${variacaoTxt(d.totais)}</b><em>${d.totais.variacao>0?'+':''}${int(d.totais.variacao)} matrícula(s)</em></div><div class="g-kpi"><span>RPV no período</span><b>${brl(d.totais.rpv)}</b><em>${brl(d.totais.rpv_anterior)} no anterior</em></div></div><section class="card mt"><div class="card-cab"><h2>Evolução por polo</h2></div>${tabelaComparativa(d.polos)}</section><section class="card mt"><div class="card-cab"><h2>Tutor consolidado entre polos</h2></div>${tabelaComparativa(d.tutores,true)}</section><p class="nota">${esc(d.nota)}</p><section class="card mt"><div class="card-cab"><h2>Qualidade dos dados e metas</h2><span>${k.avisos} aviso(s)</span></div><div class="corpo">${listaQualidade(k)}</div></section><p class="nota">Pendências verificadas para todo o processo/polo selecionado. Consultas comuns usam configurações atuais; preserve um fechamento em Relatórios para guardar uma posição.</p>`;
  }catch(e){if(v===geracao&&box.isConnected)box.innerHTML=`<div class="erro-box">${esc(e.message)}</div>`;}}
  $('#gestao-gerar').onclick=gerar;await gerar();
}

async function resumoGestaoPainel(c,d){
  const host=document.createElement('section');host.className='card mt resumo-gestao';host.innerHTML='<div class="corpo">Conferindo evolução e metas…</div>';c.appendChild(host);
  const [g,k]=await Promise.all([api('/api/comparativo?'+qs({ciclo:estado.ciclo,polo:estado.polo,ref:d.ref})),api('/api/qualidade?'+qs({ciclo:estado.ciclo,polo:estado.polo,ref:d.ref}))]);
  if(!host.isConnected)return;host.innerHTML=`<div class="card-cab"><h2>Evolução e qualidade</h2><a href="#/gestao">Abrir detalhes</a></div><div class="corpo"><p>${dataBR(g.de)} a ${dataBR(g.ate)}: <b>${int(g.totais.atual)}</b> matrícula(s) lançada(s), contra ${int(g.totais.anterior)} no período anterior de mesma duração (${variacaoTxt(g.totais)}). Comparação de todos os produtos, sem Sede/Digital.</p>${listaQualidade(k)}</div>`;
}

async function telaFechamento(id){
  const app=$('#app');app.innerHTML='<div class="carregando">Abrindo fechamento preservado…</div>';
  try{const f=await api('/api/fechamentos/'+Number(id)),d=f.dados,ps=Object.entries(d.paineis);document.title=f.nome;
    app.innerHTML=`<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a><b>${esc(f.nome)}</b><button class="btn prim" onclick="window.print()">Imprimir / Salvar PDF</button></div><div class="rel">${ps.map(([pid,p])=>{const t=p.totais,h=p.ritmo.hoje_situacao.total,po=d.metadados.polos.find(x=>String(x.id)===pid),ciclo=d.metadados.ciclos.find(x=>x.id===d.ciclo);return `<section class="rel-pagina"><h1>${esc(f.nome)}</h1><p>${esc(ciclo?.nome)} · ${pid==='rede'?'Rede':esc(po?.nome)} · posição ${dataBR(f.ref)}</p><p>Fechamento preservado em ${esc(f.criado_em)} por ${esc(f.criado_por)}. Os números e regras abaixo não mudam com edições posteriores.</p>${resumoRelatorio({meta:t.meta,realizado:t.qtd,esperado:h.esperado,ref:f.ref,spaces:p.ritmo.spaces,modo:p.ritmo.modo})}<p>Composição: ${int(t.qtd_tutores)} lançadas + ${int(t.sede)} Sede/Digital = ${int(t.qtd)}. RPV: ${brl(t.valor)}; ticket das lançadas: ${tkTxt(t)}.</p><h2>Produtos</h2><table class="t"><thead><tr><th>Produto</th><th class="num">Meta</th><th class="num">Realizado</th><th class="num">Esperado</th><th>SAVE/GAP</th></tr></thead><tbody>${p.porProduto.map(x=>{const r=p.ritmo.hoje_situacao.linhas.flatMap(l=>l.produtos).find(z=>z.produto_id===x.id);return `<tr><td>${esc(x.nome)}</td><td class="num">${int(x.meta)}</td><td class="num">${int(x.qtd)}</td><td class="num">${int(r?.esperado)}</td><td>${saveGap(r?.saldo)}</td></tr>`;}).join('')}</tbody></table><h2>Responsáveis — equipe e histórico</h2><table class="t"><thead><tr><th>Tutor</th><th>Polo</th><th class="num">Realizado</th><th class="num">Meta</th><th class="num">Esperado</th><th>SAVE/GAP</th><th class="num">RPV</th></tr></thead><tbody>${p.porTutor.map(t=>`<tr><td>${esc(t.nome)}${t.atual===false?' (histórico)':''}</td><td>${esc(t.polo)}</td><td class="num">${int(t.qtd)}</td><td class="num">${int(t.meta)}</td><td class="num">${int(t.esperado)}</td><td>${saveGap(t.saldo)}</td><td class="num">${brl(t.valor)}</td></tr>`).join('')}</tbody></table>${quadroMatriculasExternas(p,pid!=='rede')}<h2>Regras preservadas</h2><p>Contagem: ${esc(MODO_TXT[p.ritmo.modo])}. Início: ${dataBR(p.ritmo.inicio)}. Final: ${dataBR(p.ritmo.final?.data)}.</p><p>Spaces: ${p.ritmo.spaces.map(x=>`${esc(x.nome)}: ${dataBR(x.data)} (${pctTxt(x.percentual)})`).join(' · ')||'Aguardando definição dos Spaces'}.</p><p>Prazos próprios: ${d.metadados.produtos.filter(x=>x.meta_ate).map(x=>`${esc(x.nome)}: ${dataBR(x.meta_ate)}`).join(' · ')||'nenhum'}.</p></section>`;}).join('')}${detalhamentoFechamento(f)}</div>`;
  }catch(e){app.innerHTML=`<div class="rel-barra"><a class="btn" href="#/relatorios">‹ Relatórios</a></div><div class="erro-box">${esc(e.message)}</div>`;}
}

// Exporta a tabela visível, inclusive os filtros/títulos da consulta; neutraliza fórmulas em planilhas.
function exportarTabela(table){
  const cel=v=>{v=String(v||'').trim();if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  const linhas=[];linhas.push([document.title,'Exportado em '+new Date().toLocaleString('pt-BR')]);
  const cab=table.closest('section')?.querySelector('h1,h2,h3');if(cab)linhas.push([cab.innerText]);
  document.querySelectorAll('.rel-timbre-data,.filtros input,.filtros select,.rel-barra input,.rel-barra select,.topo select').forEach(el=>{const v=el.matches('select')?el.selectedOptions[0]?.textContent:el.value||el.textContent;if(v)linhas.push([el.labels?.[0]?.innerText||el.title||'Consulta',v]);});
  for(const tr of table.rows){const r=[];for(const td of tr.cells){r.push(td.innerText.replace(/\s*\n\s*/g,' · '));for(let i=1;i<td.colSpan;i++)r.push('');}linhas.push(r);}
  const blob=new Blob(['\ufeff'+linhas.map(l=>l.map(cel).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='relatorio-'+posicaoAtual()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function urlRelatorio(hash){const url=new URL(location.href);url.hash=hash;url.searchParams.set('ciclo',estado.ciclo);url.searchParams.set('ref',posicaoAtual());return url.href;}
const tabelasExportaveis=new MutationObserver(()=>{document.querySelectorAll('a[target="_blank"][href^="#/relatorio"]').forEach(a=>{a.href=urlRelatorio(a.getAttribute('href'));});document.querySelectorAll('#app table.t').forEach(t=>{if(t.dataset.exportavel||t.querySelector('input,select,button[data-salvar]'))return;t.dataset.exportavel='1';const b=document.createElement('button');b.className='btn peq exportar-tabela';b.textContent='Exportar CSV';b.type='button';b.onclick=()=>exportarTabela(t);t.before(b);});});
tabelasExportaveis.observe(document.getElementById('app'),{childList:true,subtree:true});

function modalRestaurarBackup(){
  const m=abrirModal(`<header><h3>Restaurar backup</h3><button class="btn icone" data-fechar>✕</button></header><div class="corpo"><p>Escolha um backup .db deste sistema. Ele será validado e preparado para o próximo início do servidor. Uma cópia completa da base atual será preservada antes da troca.</p><label class="campo"><span>Arquivo de backup (máx. 40 MB)</span><input type="file" id="restore-arq" accept=".db"></label><label class="campo"><span>Sua senha de administrador</span><input type="password" id="restore-senha" autocomplete="current-password"></label><label class="check"><input type="checkbox" id="restore-confirmar"> Confirmo a substituição dos dados pelo backup no próximo início.</label><div id="restore-msg"></div></div><footer><button class="btn" data-fechar>Cancelar</button><button class="btn perigo" id="restore-ok">Preparar restauração</button></footer>`,600);
  $('#restore-ok',m).onclick=async()=>{const arq=$('#restore-arq',m).files[0];if(!arq||arq.size>40*1024*1024)return toast('Escolha um arquivo .db de até 40 MB.',true);if(!$('#restore-confirmar',m).checked)return toast('Marque a confirmação de substituição dos dados.',true);const b=$('#restore-ok',m);b.disabled=true;try{const base64=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(arq);});const r=await api('/api/backup-restaurar',{method:'POST',body:{senha:$('#restore-senha',m).value,base64}});$('#restore-msg',m).innerHTML=`<div class="info">${esc(r.msg)}</div>`;}catch(e){$('#restore-msg',m).innerHTML=`<div class="erro-box">${esc(e.message)}</div>`;b.disabled=false;}};
}

function quadroMatriculasExternas(d,umPolo){
  const xs=d.externasRecebidas||[],n=xs.reduce((a,x)=>a+x.qtd,0),v=xs.reduce((a,x)=>a+x.valor,0);
  if(!xs.length)return umPolo?'<section class="externas-recebidas mt"><div class="externas-cab"><div><h3>Matrículas de tutores de outros polos</h3><p>Nenhuma matrícula recebida neste recorte.</p></div></div></section>':'';
  const grupos=new Map();
  for(const x of xs){const chave=`${x.tutor_id}-${x.polo_origem_id}-${x.polo_id}`;if(!grupos.has(chave))grupos.set(chave,{...x,qtd:0,valor:0,produtos:[]});const g=grupos.get(chave);g.qtd+=x.qtd;g.valor+=x.valor;g.produtos.push(x);}
  return `<section class="externas-recebidas mt"><div class="g-sec externas-cab"><h3>Matrículas de tutores de outros polos</h3><span>${int(n)} matrícula${n===1?'':'s'} · RPV ${brl(v)}</span></div>
    <div class="externas-cards g-polos">${[...grupos.values()].map(g=>`<article class="g-polo nd externa-card"><div class="g-polo-top"><b>${esc(g.tutor)}</b><span class="tag cinza mini">Outro polo</span></div><div class="g-polo-num"><strong>${int(g.qtd)}</strong><small>matr.</small><span title="RPV recebido no polo de destino">${brl(g.valor)}</span></div><div class="externa-info" title="Origem e crédito: ${esc(g.polo_origem)} · Destino: ${esc(g.polo_destino)}">Origem: ${esc(g.polo_origem)}${umPolo?'':' → '+esc(g.polo_destino)}</div><div class="externa-info" title="${esc(g.produtos.map(p=>p.produto+': '+p.qtd).join(' · '))}">${g.produtos.map(p=>`${esc(p.produto)}${g.produtos.length>1?' ('+int(p.qtd)+')':''}`).join(' · ')}</div></article>`).join('')}</div>
    <button type="button" class="btn peq externas-exportar" data-exportar-externas="${esc(JSON.stringify(xs))}">Exportar CSV</button></section>`;

}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-exportar-externas]');if(!b)return;
  const xs=JSON.parse(b.dataset.exportarExternas),linhas=[['Matrículas de tutores de outros polos'],['Posição',posicaoAtual()],['Tutor','Polo de origem / crédito','Polo de destino','Produto','Matrículas','RPV']];
  for(const x of xs)linhas.push([x.tutor,x.polo_origem,x.polo_destino,x.produto,x.qtd,x.valor.toFixed(2).replace('.',',')]);
  const cel=v=>{v=String(v??'');if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  const url=URL.createObjectURL(new Blob(['\ufeff'+linhas.map(l=>l.map(cel).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='tutores-outros-polos-'+posicaoAtual()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

function metaRpvTxt(x){
  const valor=x.rpv_meta==null?'—':brl(x.rpv_meta);
  return valor+(x.meta_rpv_parcial?' <span class="tag warn mini">parcial</span>':'');
}
function avisoFinanceiro(d){
  const t=d.totais;
  if(!d.usaMeta)return '<div class="info">Recorte por período, tutor ou origem: RPV e quantidade mostram somente o realizado. Não há meta nem atingimento de RPV para esse recorte. O ticket de referência usa o mix vendido com alvo configurado.</div>';
  if(t.meta_rpv_parcial)return `<div class="aviso">Meta financeira incompleta: ${int(t.meta_qtd_coberta)} de ${int(t.meta_qtd_total)} matrículas de meta têm ticket configurado. RPV-alvo conhecido: ${t.rpv_meta==null?'não informado':brl(t.rpv_meta)}. O atingimento fica indisponível até completar o cadastro. <a href="#/gestao">Ver pendências</a>.</div>`;
  return '';
}
function detalhamentoFechamento(f){
  const d=f.dados,a=d.analitico;
  if(!a)return '<section class="rel-pagina"><h2>Fechamento resumido anterior à V28</h2><p>Os totais foram preservados. Este arquivo não contém matrícula por matrícula nem metas diárias/semanais congeladas. Um novo fechamento analítico registra a configuração atual, sem reconstruir retroativamente dados antigos.</p></section>';
  const tabela=(cab,linhas)=>`<div class="tabela-scroll"><table class="t"><thead><tr>${cab.map(x=>'<th>'+x+'</th>').join('')}</tr></thead><tbody>${linhas.length?linhas.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join(''):`<tr><td colspan="${cab.length}">Nenhum registro.</td></tr>`}</tbody></table></div>`;
  const polo=id=>d.metadados.polos.find(p=>p.id===id)?.nome||nomePor('polos',id)||String(id),tutor=id=>d.metadados.tutores.find(t=>t.id===id)?.nome||a.matriculas.find(m=>m.tutor_id===id)?.tutor||String(id),produto=id=>d.metadados.produtos.find(p=>p.id===id)?.nome||String(id);
  return `<section class="rel-pagina fechamento-analitico"><h1>Detalhamento analítico preservado</h1><p>${esc(f.nome)} · posição ${dataBR(f.ref)} · ${int(a.matriculas.length)} matrícula(s) registradas até a posição. Inclui registros fora do prazo da meta, identificados na coluna de composição. Cada registro aparece uma vez nesta relação; uma venda pode compor o comercial do destino e o crédito da origem.</p>
    <details open><summary>Matrículas e composição dos resultados</summary>${tabela(['ID','Data','Aluno','Tutor','Destino','Crédito individual','Produto'],a.matriculas.map(m=>[int(m.id),dataBR(m.data),esc(m.aluno||'—'),esc(m.tutor),esc(m.polo_destino),esc(m.polo_credito),esc(m.produto)]))}<h3>Valores e composição por matrícula</h3>${tabela(['ID','Aluno','CPF','Mensalidade','Conta na meta'],a.matriculas.map(m=>[int(m.id),esc(m.aluno||'—'),esc(m.cpf||'—'),brl(m.valor),m.conta_meta?'Sim':'Não — após prazo do produto']))}</details>
    <details><summary>Metas do processo, por polo e produto</summary>${tabela(['Polo','Produto','Quantidade'],a.metas.map(m=>[esc(polo(m.polo_id)),esc(produto(m.produto_id)),int(m.quantidade)]))}</details>
    <details><summary>Metas individuais cadastradas</summary>${tabela(['Polo','Tutor','Meta'],a.metas_tutor.map(m=>[esc(polo(m.polo_id)),esc(tutor(m.tutor_id)),int(m.quantidade)]))}<p>Na divisão automática, a meta calculada por tutor também está preservada no resumo do polo.</p></details>
    <details><summary>Metas de ticket</summary>${tabela(['Polo','Produto','Ticket-alvo'],a.metas_rpv.map(m=>[m.polo_id===0?'Padrão':esc(polo(m.polo_id)),esc(produto(m.produto_id)),brl(m.valor)]))}</details>
    <details><summary>Metas semanais</summary>${tabela(['Polo','Tutor','Semana (início)','Meta'],a.metas_semanais.map(m=>[esc(polo(m.polo_id)),esc(tutor(m.tutor_id)),dataBR(m.semana),int(m.quantidade)]))}</details>
    <details><summary>Metas diárias</summary>${tabela(['Polo','Tutor','Data','Meta'],a.metas_diarias.map(m=>[esc(polo(m.polo_id)),esc(tutor(m.tutor_id)),dataBR(m.data),int(m.quantidade)]))}</details>
    <details><summary>Exceções de crédito registradas</summary>${tabela(['Matrícula','Antes','Depois','Motivo','Responsável','Registrado em'],a.excecoes_credito.map(e=>[int(e.matricula_id),esc(polo(e.credito_anterior)),esc(polo(e.credito_novo)),esc(e.motivo),esc(e.usuario),esc(e.criado_em)]))}</details>
    <details><summary>Configurações preservadas</summary>${tabela(['Configuração','Valor'],Object.entries(d.metadados.config).filter(([k])=>k!=='logo').map(([k,v])=>[esc(k),esc(v)]))}</details>
  </section>`;
}

window.addEventListener('beforeprint',()=>{document.querySelectorAll('.fechamento-analitico details:not([open])').forEach(e=>{e.dataset.fecharAposImpressao='1';e.open=true;});});
window.addEventListener('afterprint',()=>{document.querySelectorAll('.fechamento-analitico details[data-fechar-apos-impressao]').forEach(e=>{e.open=false;delete e.dataset.fecharAposImpressao;});});
