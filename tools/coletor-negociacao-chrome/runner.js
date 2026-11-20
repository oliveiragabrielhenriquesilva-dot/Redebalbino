(function(root){
'use strict';
// Only the site adapter can navigate. The runner has no operation for emitting agreements.
function createRunner({site,load,save,now=()=>new Date().toISOString()}){
 let busy=false;
 async function run(){
  if(busy)return;busy=true;
  let token;
  try{
   let state=await load();token=state?.runToken;
   if(!state||state.status!=='running')return;
   if(state.phase==='discover'){
    while((state=await load()).status==='running'&&state.runToken===token&&state.phase==='discover'){
     if(site.blocked())throw Error('Entre no portal ou conclua a verificação de segurança manualmente antes de retomar.');
     const page=await site.list();state=await load();if(!state||state.status!=='running'||state.runToken!==token)break;const seen=new Set(state.queue.map(x=>x.ra+'/'+x.action));
     for(const row of page.rows)if(!seen.has(row.ra+'/'+row.action)&&state.queue.length<state.limit){state.queue.push(row);seen.add(row.ra+'/'+row.action);}
     state.message='Lista preparada: '+state.queue.length+' consulta(s).';await save(state);
     if(!state.morePages||state.queue.length>=state.limit||!page.hasNext){state.phase='collect';await save(state);break;}
     if(state.pages.includes(page.signature))throw Error('A paginação repetiu uma página. Coleta pausada para conferência.');
     state.pages.push(page.signature);await save(state);await site.next(page.signature);
    }
   }
   while((state=await load()).status==='running'&&state.runToken===token&&state.phase==='collect'){
    const index=state.queue.findIndex(x=>x.status==='pending');
    if(index<0){state.status='finished';state.message='Lote concluído. Confira os resultados antes de usar os valores.';await save(state);break;}
    const item=state.queue[index];state.message='Consultando '+item.ra+' · ação '+item.action;state.current=item.ra;await save(state);
    try{
     if(site.blocked())throw Object.assign(Error('A sessão foi encerrada ou há verificação de segurança. Faça o acesso e retome.'),{pause:true});
     await site.open(item);const row=await site.read(item,async()=>{const s=await load();return !s||s.status!=='running'||s.runToken!==token;});
     state=await load();if(!state||state.status!=='running'||state.runToken!==token)break;
     state.queue[index]={...item,...row,status:'ok',error:null,capturedAt:now()};await save(state);
    }catch(error){
     state=await load();if(!state||state.status!=='running'||state.runToken!==token)break;
     if(error.pause){state.status='paused';state.message=error.message;await save(state);break;}
     state.queue[index]={...item,status:'error',error:String(error.message||error).slice(0,300),capturedAt:now()};await save(state);
    }
   }
  }catch(error){const state=await load();if(state?.status==='running'&&state.runToken===token){state.status='paused';state.message=String(error.message||error);await save(state);}}
  finally{busy=false;}
 }
 return {run,isBusy:()=>busy};
}
if(typeof module==='object'&&module.exports)module.exports={createRunner};else root.BalbinoCollectorRunner={createRunner};
})(typeof globalThis==='undefined'?this:globalThis);
