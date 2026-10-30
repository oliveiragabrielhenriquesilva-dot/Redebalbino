import { all, save, addMessage, pushLog } from './store.js';

function timeInSaoPaulo(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  return Object.fromEntries(parts.map(p=>[p.type,p.value]));
}
export function outsideBusinessHours(settings){
  const p=timeInSaoPaulo(); if(['Sat','Sun'].includes(p.weekday))return true;
  const now=`${p.hour}:${p.minute}`, start=settings.businessHours?.start||'08:00', end=settings.businessHours?.end||'18:00';
  return now<start||now>end;
}
export function assignConversation(conversation){
  const db=all(); if(conversation.ownerId||db.settings.autoAssign===false)return conversation.ownerId||null;
  const canDept=u=>{if(u.role==='SUPER_ADMIN')return true;const ac=u.access||{};return ac.allDepartments!==false||(Array.isArray(ac.departmentIds)&&ac.departmentIds.includes(conversation.departmentId))};const canConn=u=>{if(u.role==='SUPER_ADMIN')return true;const ac=u.access||{};return ac.allConnections!==false||(Array.isArray(ac.connectionIds)&&ac.connectionIds.includes(conversation.instanceId))};const maxConcurrent=Math.max(0,Number(db.settings.maxConcurrentConversations||0));const activeCount=u=>db.conversations.filter(c=>c.ownerId===u.id&&['OPEN','WAITING_CUSTOMER','WAITING_INTERNAL'].includes(c.status)).length;const users=db.users.filter(u=>u.active!==false&&u.status==='ONLINE'&&canDept(u)&&canConn(u)&&(u.departmentId===conversation.departmentId||!u.departmentId)&&(!maxConcurrent||activeCount(u)<maxConcurrent));
  if(!users.length)return null;
  if(db.departments.find(d=>d.id===conversation.departmentId)?.distribution==='ROUND_ROBIN'){
    const recent=[...db.logs].find(l=>l.event==='CONVERSATION_AUTO_ASSIGNED'&&users.some(u=>u.id===l.data?.ownerId));
    const idx=Math.max(0,users.findIndex(u=>u.id===recent?.data?.ownerId)); conversation.ownerId=users[(idx+1)%users.length].id;
  }else{
    const counts=new Map(users.map(u=>[u.id,db.conversations.filter(c=>c.ownerId===u.id&&c.status!=='CLOSED').length]));
    users.sort((a,b)=>(counts.get(a.id)||0)-(counts.get(b.id)||0)); conversation.ownerId=users[0].id;
  }
  if(conversation.ownerId){conversation.status='OPEN';conversation.claimedAt=Date.now();conversation.claimedBy=conversation.ownerId;delete conversation.queuedAt} save(); pushLog('CONVERSATION_AUTO_ASSIGNED',{conversationId:conversation.id,ownerId:conversation.ownerId,departmentId:conversation.departmentId}); return conversation.ownerId;
}
function applyAction(action,{conversation,contact}){
  const db=all();
  if(action.startsWith('MOVE:')){const depId=action.split(':')[1];if(db.departments.some(d=>d.id===depId)){conversation.departmentId=depId;conversation.ownerId=null;conversation.status='WAITING';conversation.triageStatus='ROUTED';save();return true}}
  if(action.startsWith('TAG:')){const tag=action.slice(4).trim();if(tag&&!contact.tags.includes(tag)){contact.tags.push(tag);save();return true}}
  if(action.startsWith('PRIORITY:')){conversation.priority=action.slice(9).trim().toUpperCase()||'NORMAL';save();return true}
  if(action.startsWith('ASSIGN:')){const ownerId=action.slice(7).trim();if(db.users.some(u=>u.id===ownerId)){conversation.ownerId=ownerId;conversation.status='OPEN';save();return true}}
  return false;
}
function cleanChoiceText(text=''){
  return String(text||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[._-]+/g,' ').replace(/\s+/g,' ');
}
function flowNodes(settings){
  return Array.isArray(settings.queueFlowNodes)?settings.queueFlowNodes.filter(n=>n?.id&&n?.title&&Array.isArray(n.options)&&n.options.length):[];
}
function flowNode(settings,id){return flowNodes(settings).find(n=>n.id===id)||null}
function startNode(settings){return flowNode(settings,settings.queueFlowStartNodeId)||flowNodes(settings)[0]||null}
function findChoice(node,text,interaction){
  if(!node)return null;
  const selectedId=String(interaction?.selectedId||'').trim();
  if(selectedId){const byId=node.options.find(o=>o.id===selectedId);if(byId)return byId}
  const selectedText=String(interaction?.selectedText||'').trim();
  const rawCandidates=[selectedText,String(text||'').trim()].filter(Boolean);
  for(const raw of rawCandidates){
    // Listas longas são enviadas como texto numerado para máxima compatibilidade
    // com o WhatsApp. Aceitamos "1", "1.", "1)" etc.
    const numeric=raw.match(/^\s*(\d{1,3})\s*[.)-]?\s*$/);
    if(numeric){
      const index=Number(numeric[1])-1;
      if(index>=0&&index<node.options.length)return node.options[index];
    }
    const candidate=cleanChoiceText(raw);
    const byLabel=node.options.find(o=>cleanChoiceText(o.label)===candidate||cleanChoiceText(o.value)===candidate);
    if(byLabel)return byLabel;
  }
  return null;
}
function textChoicePreview(node,intro=null){
  return `${intro||node.title}\n\n${node.options.map((o,i)=>`${i+1}. ${o.label}`).join('\n')}`.trim();
}
function formatConfirmation(settings,departmentName){
  return String(settings.queueRoutingConfirmation||'Perfeito! Seu atendimento foi direcionado para {setor}. Aguarde um atendente.').replaceAll('{setor}',departmentName||'o setor selecionado');
}
async function sendAutomated({conversation,sendReply,text,auto,type='TEXT',meta=null}){
  try{
    const sent=await sendReply(text);
    const rec=addMessage({conversationId:conversation.id,direction:'OUT',type,body:text,status:'SENT',auto,externalId:sent?.key?.id||sent?.result?.key?.id||null,meta});
    pushLog('AUTOMATION_REPLY_SENT',{conversationId:conversation.id,messageId:rec.id,auto});
    return rec;
  }catch(e){
    const rec=addMessage({conversationId:conversation.id,direction:'OUT',type:'TEXT',body:text,status:'QUEUED',auto,sendError:e.message,meta});
    pushLog('AUTOMATION_REPLY_QUEUED',{conversationId:conversation.id,messageId:rec.id,auto,error:e.message});
    return rec;
  }
}
async function sendFlowNode({conversation,node,settings,sendReply,sendChoice,invalid=false}){
  const invalidIntro=invalid?(settings.queueRoutingInvalid||'Não consegui identificar sua escolha. Selecione uma das opções disponíveis:'):null;
  const preview=textChoicePreview(node,invalidIntro);
  if(!sendChoice)return sendAutomated({conversation,sendReply,text:preview,auto:invalid?'QUEUE_FLOW_RETRY':'QUEUE_FLOW_STEP',meta:{flowNodeId:node.id,interaction:'TEXT'}});
  try{
    const sent=await sendChoice({
      nodeId:node.id,
      title:invalidIntro||node.title,
      footer:settings.queueRoutingFooter||'Balbino Chat',
      interaction:(node.interaction&&node.interaction!=='AUTO')?node.interaction:(settings.queueInteractivePreference||'AUTO'),
      fallback:settings.queueInteractiveFallback||'TEXT_LABELS',
      options:node.options.map(o=>({id:o.id,label:o.label,description:o.description||''}))
    });
    if(sent?.requiresHuman){
      conversation.triageStatus='ROUTED';conversation.status='WAITING';conversation.ownerId=null;conversation.departmentId=null;conversation.queuedAt=conversation.queuedAt||Date.now();conversation.updatedAt=Date.now();save();
      pushLog('QUEUE_FLOW_HUMAN_FALLBACK',{conversationId:conversation.id,nodeId:node.id});
      return true;
    }
    const result=sent?.result||sent;
    const modeUsed=sent?.modeUsed||'TEXT';
    const body=sent?.displayText||preview;
    const rec=addMessage({conversationId:conversation.id,direction:'OUT',type:modeUsed==='TEXT'?'TEXT':'LIST',body,status:'SENT',auto:invalid?'QUEUE_FLOW_RETRY':'QUEUE_FLOW_STEP',externalId:result?.key?.id||null,meta:{flowNodeId:node.id,interaction:modeUsed,options:node.options.map(o=>({id:o.id,label:o.label}))}});
    pushLog('QUEUE_FLOW_STEP_SENT',{conversationId:conversation.id,nodeId:node.id,modeUsed,messageId:rec.id});
    return rec;
  }catch(e){
    pushLog('QUEUE_FLOW_STEP_ERROR',{conversationId:conversation.id,nodeId:node.id,error:e.message});
    return sendAutomated({conversation,sendReply,text:preview,auto:'QUEUE_FLOW_TEXT_FALLBACK',meta:{flowNodeId:node.id,interaction:'TEXT'}});
  }
}
function captureChoice(contact,conversation,node,option){
  const key=String(node.captureKey||'').trim();
  contact.triageData={...(contact.triageData||{})};conversation.triageData={...(conversation.triageData||{})};
  if(key){contact.triageData[key]=option.value||option.label;conversation.triageData[key]=option.value||option.label;
    if(key==='perfil')contact.profileType=option.value||option.label;
    if(key==='polo')contact.campus=option.value||option.label;
    if(key==='assunto')contact.serviceTopic=option.value||option.label;
  }
  conversation.triagePath=Array.isArray(conversation.triagePath)?conversation.triagePath:[];
  conversation.triagePath.push({nodeId:node.id,optionId:option.id,label:option.label,value:option.value||option.label,at:Date.now()});
}
async function routeChoice({conversation,contact,node,option,settings,sendReply,sendChoice}){
  const db=all();captureChoice(contact,conversation,node,option);
  const afterMessage=String(option.afterMessage||'').trim();
  if(option.nextNodeId){
    const next=flowNode(settings,option.nextNodeId);
    if(next){
      conversation.triageStatus='AWAITING_CHOICE';conversation.triageFlowNodeId=next.id;conversation.updatedAt=Date.now();save();
      pushLog('QUEUE_FLOW_ADVANCED',{conversationId:conversation.id,fromNodeId:node.id,optionId:option.id,nextNodeId:next.id});
      if(settings.queueRoutingEnabled!==false){
        if(afterMessage)await sendAutomated({conversation,sendReply,text:afterMessage,auto:'QUEUE_FLOW_OPTION_MESSAGE',meta:{flowNodeId:node.id,optionId:option.id}});
        await sendFlowNode({conversation,node:next,settings,sendReply,sendChoice});
      }
      return true;
    }
  }
  if(option.departmentId){
    const dep=db.departments.find(d=>d.id===option.departmentId&&d.active!==false);
    if(dep){
      conversation.departmentId=dep.id;conversation.ownerId=null;conversation.status='WAITING';conversation.queuedAt=conversation.queuedAt||Date.now();conversation.triageStatus='ROUTED';conversation.queueChoice=option.id;conversation.queueLabel=option.label;conversation.queueRoutedAt=Date.now();conversation.updatedAt=Date.now();delete conversation.triageFlowNodeId;save();
      if(settings.queueAutoAssignAfterRouting===true)assignConversation(conversation);
      pushLog('QUEUE_ROUTED_BY_FLOW',{conversationId:conversation.id,departmentId:dep.id,nodeId:node.id,optionId:option.id,label:option.label,triageData:conversation.triageData||{}});
      if(settings.queueRoutingEnabled!==false){const routeText=afterMessage||String(dep.greeting||'').trim()||formatConfirmation(settings,dep.name);await sendAutomated({conversation,sendReply,text:routeText,auto:afterMessage?'QUEUE_FLOW_OPTION_MESSAGE':'QUEUE_ROUTED',meta:afterMessage?{flowNodeId:node.id,optionId:option.id}:null})};
      return true;
    }
  }
  // Nó terminal sem destino configurado: encaminha para fila geral, sem inventar menu numérico.
  conversation.ownerId=null;conversation.status='WAITING';conversation.departmentId=null;conversation.queuedAt=conversation.queuedAt||Date.now();conversation.triageStatus='ROUTED';conversation.updatedAt=Date.now();delete conversation.triageFlowNodeId;save();
  pushLog('QUEUE_FLOW_TERMINAL_SHARED_QUEUE',{conversationId:conversation.id,nodeId:node.id,optionId:option.id});
  if(settings.queueRoutingEnabled!==false)await sendAutomated({conversation,sendReply,text:afterMessage||'Perfeito! Sua escolha foi registrada. Aguarde um atendente.',auto:afterMessage?'QUEUE_FLOW_OPTION_MESSAGE':'QUEUE_ROUTED_SHARED',meta:afterMessage?{flowNodeId:node.id,optionId:option.id}:null});
  return true;
}
async function processQueueRouting({contact,conversation,text,interaction,sendReply,sendChoice,firstContact}){
  const db=all(),settings=db.settings,nodes=flowNodes(settings);
  if(settings.queueRoutingEnabled===false||!nodes.length||conversation.ownerId||conversation.isGroup||conversation.isChannel)return false;
  if(conversation.triageStatus==='ROUTED')return false;

  // Um primeiro contato sempre recebe a primeira etapa antes de qualquer tentativa de interpretar o texto inicial.
  if(firstContact||!conversation.triageFlowNodeId||conversation.triageStatus!=='AWAITING_CHOICE'){
    const node=startNode(settings);if(!node)return false;
    conversation.ownerId=null;conversation.status='WAITING';conversation.departmentId=null;conversation.queuedAt=conversation.queuedAt||Date.now();conversation.triageStatus='AWAITING_CHOICE';conversation.triageFlowNodeId=node.id;conversation.triageStartedAt=conversation.triageStartedAt||Date.now();conversation.updatedAt=Date.now();conversation.triagePath=[];save();
    pushLog('QUEUE_FLOW_STARTED',{conversationId:conversation.id,nodeId:node.id});
    if(settings.queueRoutingEnabled!==false)await sendFlowNode({conversation,node,settings,sendReply,sendChoice});
    return true;
  }

  const node=flowNode(settings,conversation.triageFlowNodeId)||startNode(settings);if(!node)return false;
  const chosen=findChoice(node,text,interaction);
  if(chosen)return routeChoice({conversation,contact,node,option:chosen,settings,sendReply,sendChoice});

  pushLog('QUEUE_FLOW_INVALID_CHOICE',{conversationId:conversation.id,nodeId:node.id,text:String(text||'').slice(0,120),selectedId:interaction?.selectedId||null});
  if(settings.queueRoutingEnabled!==false)await sendFlowNode({conversation,node,settings,sendReply,sendChoice,invalid:true});
  return true;
}
export async function processIncoming({contact,conversation,text,interaction=null,sendReply,sendChoice=null}){
  const db=all(), lower=String(text||'').toLowerCase();
  const incoming=db.messages.filter(m=>m.conversationId===conversation.id&&m.direction==='IN');
  const firstContact=incoming.length===1;

  if(await processQueueRouting({contact,conversation,text,interaction,sendReply,sendChoice,firstContact}))return;

  for(const a of db.automations.filter(x=>x.enabled&&x.trigger?.startsWith('KEYWORD:'))){
    const keyword=a.trigger.split(':').slice(1).join(':').toLowerCase();
    if(keyword&&lower.includes(keyword)){
      if(a.action?.startsWith('SEND:')){
        if(db.settings.autoRepliesEnabled===false){pushLog('AUTOMATION_REPLY_SKIPPED',{automationId:a.id,conversationId:conversation.id,reason:'AUTO_REPLIES_DISABLED'})}
        else await sendAutomated({conversation,sendReply,text:a.action.slice(5),auto:a.id});
      }else applyAction(a.action||'',{conversation,contact});
      pushLog('AUTOMATION_TRIGGERED',{automationId:a.id,conversationId:conversation.id,keyword,action:a.action});
    }
  }
  if(!conversation.ownerId&&db.settings.sharedQueueFirstContact!==false){
    conversation.status='WAITING';conversation.queuedAt=conversation.queuedAt||Date.now();save();
    if(firstContact)pushLog('CONVERSATION_QUEUED',{conversationId:conversation.id,reason:'FIRST_CONTACT',departmentId:conversation.departmentId||null});
  }else if(conversation.status!=='WAITING')assignConversation(conversation);
  const replies=[];
  if(db.settings.autoRepliesEnabled!==false){
    if(firstContact&&db.automations.some(a=>a.enabled&&a.trigger==='FIRST_CONTACT'))replies.push({text:db.settings.welcomeMessage||'Olá! Recebemos sua mensagem.',auto:'FIRST_CONTACT'});
    if(outsideBusinessHours(db.settings)&&db.automations.some(a=>a.enabled&&a.trigger==='OUT_OF_HOURS')){
      const recently=db.messages.some(m=>m.conversationId===conversation.id&&m.direction==='OUT'&&m.auto==='OUT_OF_HOURS'&&Date.now()-m.createdAt<12*3600000);
      if(!recently)replies.push({text:db.settings.awayMessage,auto:'OUT_OF_HOURS'});
    }
  }
  for(const item of replies)await sendAutomated({conversation,sendReply,text:item.text,auto:item.auto});
}
