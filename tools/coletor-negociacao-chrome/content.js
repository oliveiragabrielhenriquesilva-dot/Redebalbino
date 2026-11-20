(()=>{
'use strict';
const core=BalbinoCollectorCore,STORE='balbinoCollectorV1';
const ownTab=chrome.runtime.sendMessage({type:'BALBINO_TAB_ID'}).then(r=>r.tabId);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const visible=el=>!!el&&el.getClientRects().length>0;
const getState=async()=>{const v=(await chrome.storage.local.get(STORE))[STORE];return v?.origin===location.origin?v:null;};
const save=state=>chrome.storage.local.set({[STORE]:{...state,updatedAt:new Date().toISOString()}});
function blocked(){return /#!\/access\/login/.test(location.hash)||/just a moment|verify you are human|performing security verification/i.test(document.title+' '+document.body.innerText.slice(0,600));}
function rows(){return [...document.querySelectorAll('table tbody tr')].map(tr=>{const cells=[...tr.querySelectorAll('td')],ra=cells[0]?.innerText.trim(),action=cells[7]?.innerText.trim();return core.RA.test(ra||'')&&/^\d+$/.test(action||'')?{ra,action,course:cells[2]?.innerText.trim()||'',status:'pending'}:null;}).filter(Boolean);}
const nextButton=()=>[...document.querySelectorAll('a[ng-click="service.navigator.next()"]')].find(visible);
async function waitFor(fn,timeout=30000){const started=Date.now();while(Date.now()-started<timeout){const result=fn();if(result)return result;if(blocked())throw Object.assign(Error('Sessão encerrada ou verificação de segurança. Entre manualmente e retome.'),{pause:true});await sleep(350);}throw Error('O portal não terminou de carregar em 30 segundos.');}
const site={blocked,
 async list(){if(location.hash!==core.LIST)throw Error('Abra Atendimentos no portal antes de preparar a lista.');const list=await waitFor(()=>{const v=rows();return v.length?v:null;});const next=nextButton();return {rows:list,signature:list.map(core.key).join('|'),hasNext:!!next&&!next.closest('.disabled')&&next.getAttribute('aria-disabled')!=='true'};},
 async next(signature){const next=nextButton();if(!next||next.closest('.disabled'))throw Error('Próxima página indisponível.');next.click();await waitFor(()=>rows().map(core.key).join('|')!==signature&&rows().length);await sleep(650);},
 async open(item){if(location.origin!=='https://portal.ead.cesumar.br')throw Error('Origem não autorizada.');const hash=core.detailHash(item);if(location.hash!==hash)location.hash=hash;await sleep(2000);},
 async read(item,cancelled){
  const start=Date.now();let previous='',stableAt=0,lastError='Dados ainda indisponíveis.';
  while(Date.now()-start<30000){
   if(await cancelled())throw Error('Consulta pausada.');if(blocked())throw Object.assign(Error('Entre no portal ou conclua a verificação de segurança e retome.'),{pause:true});
   try{const input=document.getElementById('inputvl_entrada_total');if(!visible(input)||!input.disabled)throw Error('Campo de pagamento ainda indisponível.');const value=core.parseSummary(document.body.innerText,item,location.hash,input.value);const current=JSON.stringify(value);
    if(current!==previous){previous=current;stableAt=Date.now();}else if(Date.now()-stableAt>=1600)return value;
   }catch(e){lastError=e.message;previous='';stableAt=0;}
   await sleep(400);
  }
  throw Error(lastError+' Consulta não estabilizou em 30 segundos.');
 }
};
const runner=BalbinoCollectorRunner.createRunner({site,load:getState,save});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 (async()=>{
  if(message?.type==='BALBINO_START'){
   if(runner.isBusy())throw Error('Há uma consulta em andamento. Pause antes de criar outro lote.');if(blocked())throw Error('Entre normalmente no portal antes de iniciar.');if(location.hash!==core.LIST)throw Error('Abra a tela Atendimentos com a lista de alunos antes de iniciar.');
   const current=await getState();if(current?.status==='running')throw Error('Já existe um lote em andamento.');
   const limit=Number(message.limit);if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('Use um limite de 1 a 500 consultas.');
   const list=rows();if(!list.length)throw Error('A lista não possui alunos visíveis.');
   const state={tabId:await ownTab,runToken:crypto.randomUUID(),version:1,origin:location.origin,status:'running',phase:'discover',queue:[],pages:[],limit,morePages:message.morePages===true,startedAt:new Date().toISOString(),message:'Preparando lista visível…'};await save(state);reply({ok:true});runner.run();return;
  }
  if(message?.type==='BALBINO_RESUME'){
   const state=await getState();if(!state)throw Error('Não há lote para retomar.');if(state.tabId!==await ownTab)throw Error('Retome na mesma aba do portal usada para iniciar o lote.');if(runner.isBusy())throw Error('Aguarde a consulta atual terminar de pausar.');if(blocked())throw Error('Entre no portal antes de retomar.');
   if(message.retryErrors)state.queue=state.queue.map(r=>r.status==='error'?{ra:r.ra,action:r.action,course:r.course,status:'pending'}:r);
   if(state.phase==='discover'&&location.hash!==core.LIST)throw Error('Abra Atendimentos antes de retomar a preparação da lista.');state.runToken=crypto.randomUUID();state.status='running';await save(state);reply({ok:true});runner.run();return;
  }
  reply({ok:false,error:'Comando não reconhecido.'});
 })().catch(e=>reply({ok:false,error:e.message}));return true;
});
// A full page reload always pauses: never starts a capture without a fresh user command.
getState().then(async state=>{if(state?.status==='running'&&state.tabId===await ownTab){state.status='paused';state.message='A página foi recarregada. Confira a sessão e clique em Retomar.';await save(state);}});
})();
