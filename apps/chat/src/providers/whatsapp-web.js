import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, save, flush, pushLog, upsertWhatsAppContact, upsertWhatsAppGroup, upsertWhatsAppChannel, getGroupByJid, getChannelByJid, ensureConversation, addMessage, addHistoricalMessage, markMessagesDirty, uid, handleInboundConversationState, registerConnectionSelfIdentity, repairMultiConnectionData } from '../store.js';
import { processIncoming } from '../automation-engine.js';
import { processMatriculaMessage } from '../matricula-engine.js';
import { findMessageForInstance, messagesForExternalIdInstance, externalMessageKey, messageBelongsToInstance } from '../message-identity.js';
import { uploadsDir, sessionsDir, uploadDiskPath } from '../runtime-paths.js';

const sockets=new Map();
const emitters=new Set();
const syncRuntime=new Map();
const channelMetaFetchAt=new Map();
const avatarFetchAt=new Map();
const avatarSyncRuntime=new Map();
const whatsappActivityAt=new Map();
const openSockets=new Set();
const reconnectTimers=new Map();
function clearReconnectTimer(instanceId){const t=reconnectTimers.get(instanceId);if(t){clearTimeout(t);reconnectTimers.delete(instanceId)}}
function scheduleReconnect(instanceId,delayMs,reason='UNKNOWN'){
  clearReconnectTimer(instanceId);
  const timer=setTimeout(()=>{reconnectTimers.delete(instanceId);connectInstance(instanceId).catch(e=>{const conn=all().connections.find(c=>c.id===instanceId);if(conn){conn.lastError={status:null,message:e.message,at:Date.now()};conn.state='ERROR';save();emit('connection.update',conn)}pushLog('CONNECTION_RECONNECT_ERROR',{instanceId,reason,error:String(e?.message||e)})})},Math.max(500,Number(delayMs)||1500));
  reconnectTimers.set(instanceId,timer);
  pushLog('CONNECTION_RECONNECT_SCHEDULED',{instanceId,delayMs:Math.max(500,Number(delayMs)||1500),reason});
}
function noteWhatsAppActivity(instanceId){whatsappActivityAt.set(instanceId,Date.now())}
function runtimeSocketReady(instanceId){
  const conn=all().connections.find(c=>c.id===instanceId),sock=sockets.get(instanceId);
  return Boolean(sock&&openSockets.has(instanceId)&&conn?.state==='CONNECTED');
}
export function isWhatsAppReady(instanceId='principal'){return runtimeSocketReady(instanceId)}
async function readySocket(instanceId,{waitMs=4500}={}){
  const started=Date.now();
  while(Date.now()-started<=waitMs){
    if(runtimeSocketReady(instanceId))return sockets.get(instanceId);
    const conn=all().connections.find(c=>c.id===instanceId);
    if(!conn)throw new Error('Instância não encontrada');
    if(['EXPIRED','ERROR','DISCONNECTED','QR_REQUIRED'].includes(conn.state))throw new Error(`WhatsApp não está pronto para envio (estado: ${conn.state})`);
    await sleep(250);
  }
  const conn=all().connections.find(c=>c.id===instanceId);
  throw new Error(`WhatsApp ainda não está pronto para envio (estado: ${conn?.state||'DESCONHECIDO'})`);
}
function reassignOrphanConversations(instanceId){
  const db=all(),connections=(db.connections||[]).filter(c=>c&&c.id);
  // Só há reassociação automática se existir uma única conexão cadastrada.
  // Em ambientes com vários WhatsApps, não escolhemos uma instância arbitrariamente.
  if(connections.length!==1||connections[0].id!==instanceId)return 0;
  const validIds=new Set(connections.map(c=>c.id));let changed=0;
  for(const cv of db.conversations||[]){
    if(cv.isGroup||cv.isChannel||validIds.has(cv.instanceId))continue;
    const previousInstanceId=cv.instanceId||null;
    cv.instanceId=instanceId;cv.updatedAt=Date.now();changed++;
    for(const scheduled of db.scheduledMessages||[]){if(scheduled.contactId===cv.contactId&&scheduled.instanceId===previousInstanceId)scheduled.instanceId=instanceId}
    pushLog('CONVERSATION_INSTANCE_REASSIGNED',{conversationId:cv.id,contactId:cv.contactId,from:previousInstanceId,to:instanceId,reason:'SINGLE_CONNECTION_RECOVERY'});
  }
  if(changed){save();emit('conversation.updated',{instanceId,instanceReassigned:true,count:changed});pushLog('ORPHAN_CONVERSATIONS_REASSIGNED',{instanceId,count:changed})}
  return changed;
}
const silentLogger={
  level:'silent',
  child(){return this},
  trace(){},debug(){},info(){},warn(){},error(){},fatal(){}
};
const yieldToEventLoop=()=>new Promise(resolve=>setImmediate(resolve));
function avatarExtension(contentType=''){
  const t=String(contentType||'').toLowerCase();
  if(t.includes('png'))return '.png';
  if(t.includes('webp'))return '.webp';
  return '.jpg';
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function withTimeout(promise,ms,label='Operação'){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error(`${label} excedeu ${Math.ceil(ms/1000)}s`);e.code='BALBINO_TIMEOUT';reject(e)},ms)})])}
  finally{if(timer)clearTimeout(timer)}
}
function validAvatarUrl(value=''){const v=String(value||'').trim();return /^https?:\/\//i.test(v)||v.startsWith('/uploads/')}
async function avatarJidCandidates(sock,contact){
  const out=[];const add=v=>{v=String(v||'').trim();if(v&&v.includes('@')&&!out.includes(v))out.push(v)};
  add(contact?.whatsappJid);add(contact?.whatsappJidAlt);
  for(const jid of [...out]){
    if(jid.endsWith('@lid')){try{add(await withTimeout(Promise.resolve(sock?.signalRepository?.lidMapping?.getPNForLID?.(jid)),3000,'Mapeamento LID→telefone'))}catch{}}
    if(jid.endsWith('@s.whatsapp.net')){try{add(await withTimeout(Promise.resolve(sock?.signalRepository?.lidMapping?.getLIDForPN?.(jid)),3000,'Mapeamento telefone→LID'))}catch{}}
  }
  const digits=String(contact?.phone||'').replace(/\D/g,'');if(digits)add(`${digits}@s.whatsapp.net`);
  return out;
}
async function fetchAvatarBytes(remote){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(remote,{signal:AbortSignal.timeout(10000)});
      if(!response.ok){const err=new Error(`HTTP ${response.status}`);err.status=response.status;throw err}
      const length=Number(response.headers.get('content-length')||0);if(length>8*1024*1024)throw new Error('Foto maior que 8 MB');
      const buf=Buffer.from(await response.arrayBuffer());if(!buf.length)throw new Error('Foto vazia');if(buf.length>8*1024*1024)throw new Error('Foto maior que 8 MB');
      return{buf,contentType:response.headers.get('content-type')||''};
    }catch(e){lastError=e;const msg=String(e?.message||e||'');if(!/429|5\d\d|fetch failed|timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(msg)||attempt===2)break;await sleep(700*(attempt+1))}
  }
  throw lastError||new Error('Falha ao baixar foto');
}
async function cacheContactAvatar(sock,contact,{force=false}={}){
  if(!sock||!contact||contact.isGroup||contact.isChannel)return{status:'SKIPPED'};
  const now=Date.now(),last=Number(avatarFetchAt.get(contact.id)||contact.avatarCheckedAt||0);
  // Sincronização normal é incremental: não repete imediatamente fotos já obtidas,
  // contatos sem foto e erros transitórios. Isso permite RETOMAR uma varredura grande
  // sem reconsultar milhares de contatos desde o início.
  if(!force){
    if(contact.avatar&&Number(contact.avatarUpdatedAt||0)&&now-Number(contact.avatarUpdatedAt)<24*3600000)return{status:'SKIPPED',reason:'CACHED'};
    if(contact.avatarUnavailableAt&&now-Number(contact.avatarUnavailableAt)<24*3600000)return{status:'SKIPPED',reason:'NO_PHOTO_RECENT'};
    if(contact.avatarErrorAt&&now-Number(contact.avatarErrorAt)<15*60000)return{status:'SKIPPED',reason:'ERROR_COOLDOWN'};
    if(last&&now-last<2*60000)return{status:'SKIPPED',reason:'RECENT'};
  }
  avatarFetchAt.set(contact.id,now);contact.avatarCheckedAt=now;
  const candidates=await avatarJidCandidates(sock,contact);if(!candidates.length)return{status:'SKIPPED'};
  let transientError=null,noPhotoCount=0;
  for(const jid of candidates){
    try{
      let remote=null;
      for(let attempt=0;attempt<2&&!remote;attempt++){
        try{remote=await withTimeout(Promise.resolve(sock.profilePictureUrl(jid,'image')),7000,'Consulta da foto')}catch(e){const msg=String(e?.message||e||'');if(/404|not found|item-not-found|unauthorized|forbidden|401|403/i.test(msg)){noPhotoCount++;break}transientError=e;if(attempt===0&&/429|5\d\d|timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)){await sleep(500);continue}break}
      }
      if(!remote){continue}
      const {buf,contentType}=await fetchAvatarBytes(remote);
      const dir=path.join(uploadsDir,'contact-avatars');fs.mkdirSync(dir,{recursive:true});
      const ext=avatarExtension(contentType);const filename=`${contact.id}${ext}`;
      for(const oldExt of ['.jpg','.png','.webp']){const old=path.join(dir,`${contact.id}${oldExt}`);if(old!==path.join(dir,filename)&&fs.existsSync(old)){try{fs.unlinkSync(old)}catch{}}}
      fs.writeFileSync(path.join(dir,filename),buf);
      contact.avatar=`/uploads/contact-avatars/${filename}?v=${now}`;contact.avatarSource='whatsapp';contact.avatarUpdatedAt=now;contact.avatarResolvedJid=jid;delete contact.avatarUnavailableAt;delete contact.avatarErrorAt;delete contact.avatarLastError;
      return{status:'UPDATED',avatar:contact.avatar,jid};
    }catch(e){
      const msg=String(e?.message||e||'');
      if(/404|not found|item-not-found|unauthorized|forbidden|401|403/i.test(msg)){noPhotoCount++;continue}
      transientError=e;pushLog('CONTACT_AVATAR_CANDIDATE_ERROR',{contactId:contact.id,jid,error:msg});
    }
  }
  if(transientError){const err=String(transientError?.message||transientError);contact.avatarErrorAt=now;contact.avatarLastError=err;pushLog('CONTACT_AVATAR_ERROR',{contactId:contact.id,jids:candidates,error:err});return{status:'ERROR',error:err}}
  contact.avatarUnavailableAt=now;return{status:'NO_PHOTO',candidates:candidates.length,noPhotoCount};
}
function scheduleContactAvatar(sock,contact,delay=250,{force=false}={}){
  if(!contact||contact.isGroup||contact.isChannel||(!force&&contact.avatar))return;
  setTimeout(async()=>{const r=await cacheContactAvatar(sock,contact,{force}).catch(()=>null);if(r?.status==='UPDATED'){save();emit('contacts.updated',{contactId:contact.id,avatar:true});emit('conversation.updated',{contactId:contact.id,avatar:true})}},delay);
}

async function cacheGroupAvatar(sock,group,{force=false}={}){
  if(!sock||!group?.jid)return{status:'SKIPPED'};
  const contact=all().contacts.find(c=>c.id===group.contactId)||null;
  if(!contact)return{status:'SKIPPED'};
  const now=Date.now();
  if(!force&&contact.avatar&&Number(contact.avatarUpdatedAt||0)&&now-Number(contact.avatarUpdatedAt)<24*3600000)return{status:'SKIPPED',reason:'CACHED'};
  try{
    const remote=await withTimeout(Promise.resolve(sock.profilePictureUrl(group.jid,'image')),7000,'Consulta da foto do grupo');
    if(!remote)return{status:'NO_PHOTO'};
    const {buf,contentType}=await fetchAvatarBytes(remote);
    const dir=path.join(uploadsDir,'contact-avatars');fs.mkdirSync(dir,{recursive:true});
    const ext=avatarExtension(contentType);const filename=`${contact.id}${ext}`;
    for(const oldExt of ['.jpg','.png','.webp']){const old=path.join(dir,`${contact.id}${oldExt}`);if(old!==path.join(dir,filename)&&fs.existsSync(old)){try{fs.unlinkSync(old)}catch{}}}
    fs.writeFileSync(path.join(dir,filename),buf);
    const local=`/uploads/contact-avatars/${filename}?v=${now}`;
    contact.avatar=local;contact.avatarSource='whatsapp-group';contact.avatarUpdatedAt=now;contact.avatarCheckedAt=now;
    group.avatar=local;group.avatarUpdatedAt=now;
    delete contact.avatarUnavailableAt;delete contact.avatarErrorAt;delete contact.avatarLastError;
    return{status:'UPDATED',avatar:local};
  }catch(e){
    const msg=String(e?.message||e||'');
    contact.avatarCheckedAt=now;
    if(/404|not found|item-not-found|unauthorized|forbidden|401|403/i.test(msg)){contact.avatarUnavailableAt=now;return{status:'NO_PHOTO'}}
    contact.avatarErrorAt=now;contact.avatarLastError=msg;pushLog('GROUP_AVATAR_ERROR',{groupId:group.id,jid:group.jid,error:msg});return{status:'ERROR',error:msg};
  }
}
function scheduleGroupAvatar(sock,group,delay=500,{force=false}={}){
  if(!group)return;
  const contact=all().contacts.find(c=>c.id===group.contactId)||null;
  if(!force&&contact?.avatar)return;
  setTimeout(async()=>{const r=await cacheGroupAvatar(sock,group,{force}).catch(()=>null);if(r?.status==='UPDATED'){save();emit('contacts.updated',{contactId:group.contactId,groupId:group.id,avatar:true});emit('groups.updated',{instanceId:group.instanceId,groupId:group.id,avatar:true});emit('conversation.updated',{contactId:group.contactId,groupId:group.id,avatar:true})}},delay);
}
export function registerEmitter(fn){emitters.add(fn);return()=>emitters.delete(fn)}
function emit(event,payload){for(const fn of emitters){try{fn(event,payload)}catch{}}}
function phoneFromJid(jid=''){return String(jid||'').split('@')[0].split(':')[0].replace(/\D/g,'')}
function normalizeDestination(value=''){const raw=String(value||'').trim();if(!raw)throw new Error('Destino do WhatsApp ausente');if(raw.includes('@'))return raw;const digits=raw.replace(/\D/g,'');if(!digits)throw new Error('Destino do WhatsApp inválido');return `${digits}@s.whatsapp.net`}
async function preferCurrentAddressingJid(sock,jid=''){
  // Regra conservadora de entrega: nunca convertemos automaticamente um número
  // telefônico (PN) em LID no momento do envio. Quando a conversa realmente
  // chegou por LID, o próprio remoteJid recebido é preservado pelo servidor.
  // Para conversas iniciadas manualmente, o destino permanece o número real.
  return normalizeDestination(jid);
}
async function resolveDestination(sock,value=''){return preferCurrentAddressingJid(sock,value)}
async function resolveReplyDestination(sock,msg,contact=null){
  // Primeiro respeita exatamente o endereço usado pela mensagem recebida.
  // remoteJidAlt é apenas o endereço alternativo e não deve ter prioridade.
  const candidates=[msg?.key?.remoteJid,contact?.whatsappJid,msg?.key?.remoteJidAlt,contact?.whatsappJidAlt,contact?.phone].filter(Boolean);
  for(const candidate of candidates){
    try{return await preferCurrentAddressingJid(sock,candidate)}catch{}
  }
  return resolveDestination(sock,contact?.phone||'');
}
function unwrapMessageContent(input={}){
  let m=input?.message||input||{};
  for(let i=0;i<12;i++){
    const child=m.associatedChildMessage?.message||m.associatedChildMessage;
    // Baileys 7 pode entregar conteúdo dentro de wrappers diferentes conforme o
    // dispositivo que enviou a mensagem. Mantemos aqui os wrappers oficiais mais
    // comuns e alguns formatos que aparecem em versões RC.
    const lottie=m.lottieStickerMessage?.message||m.lottieStickerMessage;
    const groupStatus=m.groupStatusMessage?.message||m.groupStatusMessage||m.groupStatusMessageV2?.message||m.groupStatusMessageV2;
    const edited=m.editedMessage?.message||m.editedMessage;
    const deviceSent=m.deviceSentMessage?.message||m.deviceSentMessage;
    const nested=m.ephemeralMessage?.message||m.viewOnceMessage?.message||m.viewOnceMessageV2?.message||m.viewOnceMessageV2Extension?.message||m.documentWithCaptionMessage?.message||edited||deviceSent||lottie||groupStatus||child;
    if(!nested||nested===m)break;m=nested;
  }
  if(m.protocolMessage?.editedMessage)m=m.protocolMessage.editedMessage;
  return m||{};
}
function normalizedMediaEnvelope(msg){
  const inner=unwrapMessageContent(msg);
  if(!inner||inner===msg?.message)return msg;
  return {...msg,message:inner};
}
function listMessageText(node){
  if(!node||typeof node!=='object')return '';
  const parts=[];if(node?.title)parts.push(node.title);if(node?.description)parts.push(node.description);
  for(const section of Array.isArray(node?.sections)?node.sections:[]){if(section?.title)parts.push(section.title);for(const row of Array.isArray(section?.rows)?section.rows:[]){const line=[row?.title,row?.description].filter(Boolean).join(' — ');if(line)parts.push(`• ${line}`)}}
  if(node?.footerText)parts.push(node.footerText);return parts.join('\n').replace(/\n{3,}/g,'\n\n').trim()
}
function pollText(node){if(!node||typeof node!=='object')return '';const opts=(Array.isArray(node?.options)?node.options:[]).map(o=>o?.optionName||o?.name).filter(Boolean);return [node?.name||'Enquete',...opts.map(x=>`• ${x}`)].join('\n')}
function interactionSelection(msg){
  try{
    const m=unwrapMessageContent(msg)||{};
    if(m.interactiveResponseMessage){
      const r=m.interactiveResponseMessage,raw=r?.nativeFlowResponseMessage?.paramsJson||'{}';let params={};try{params=JSON.parse(raw)}catch{}
      return{kind:'INTERACTIVE',selectedId:String(params.id||params.row_id||params.selectedRowId||params.selected_id||'').trim(),selectedText:String(params.display_text||params.title||r?.body?.text||'').trim(),params};
    }
    if(m.listResponseMessage){return{kind:'LIST',selectedId:String(m.listResponseMessage?.singleSelectReply?.selectedRowId||'').trim(),selectedText:String(m.listResponseMessage?.title||m.listResponseMessage?.description||'').trim()}}
    if(m.buttonsResponseMessage){return{kind:'BUTTON',selectedId:String(m.buttonsResponseMessage?.selectedButtonId||'').trim(),selectedText:String(m.buttonsResponseMessage?.selectedDisplayText||'').trim()}}
    if(m.templateButtonReplyMessage){return{kind:'TEMPLATE',selectedId:String(m.templateButtonReplyMessage?.selectedId||'').trim(),selectedText:String(m.templateButtonReplyMessage?.selectedDisplayText||'').trim()}}
  }catch(e){pushLog('INTERACTION_SELECTION_ERROR',{messageId:msg?.key?.id||null,error:e.message})}
  return null;
}
function extractText(msg){
  try{
    const m=unwrapMessageContent(msg)||{};const interactive=m?.interactiveMessage||null,choice=interactionSelection(msg);
    return choice?.selectedText||m?.conversation||m?.extendedTextMessage?.text||m?.imageMessage?.caption||m?.videoMessage?.caption||m?.documentMessage?.caption||m?.buttonsResponseMessage?.selectedDisplayText||m?.listResponseMessage?.title||m?.listResponseMessage?.description||listMessageText(m?.listMessage)||interactive?.body?.text||interactive?.header?.title||m?.buttonsMessage?.contentText||m?.templateButtonReplyMessage?.selectedDisplayText||(m?.pollCreationMessage?.name?pollText(m.pollCreationMessage):'')||(m?.pollCreationMessageV2?.name?pollText(m.pollCreationMessageV2):'')||(m?.pollCreationMessageV3?.name?pollText(m.pollCreationMessageV3):'')||m?.eventMessage?.name||'';
  }catch(e){pushLog('MESSAGE_TEXT_EXTRACT_ERROR',{messageId:msg?.key?.id||null,remoteJid:msg?.key?.remoteJid||null,error:e.message});return ''}
}
function rawLottieSticker(msg){
  const root=msg?.message||msg||{};const l=root?.lottieStickerMessage||msg?.lottieStickerMessage||null;
  if(!l)return null;const inner=l?.message||l;return inner?.stickerMessage||inner?.message?.stickerMessage||inner||null;
}
function extractType(msg){const m=unwrapMessageContent(msg);if(m.imageMessage)return'IMAGE';if(m.videoMessage)return'VIDEO';if(m.audioMessage)return'AUDIO';if(m.documentMessage)return'DOCUMENT';if(m.stickerMessage||rawLottieSticker(msg))return'STICKER';if(m.locationMessage||m.liveLocationMessage)return'LOCATION';if(m.contactMessage||m.contactsArrayMessage)return'CONTACT';if(m.listMessage||m.listResponseMessage||m.interactiveMessage||m.interactiveResponseMessage||m.buttonsMessage||m.buttonsResponseMessage||m.templateButtonReplyMessage)return'LIST';if(m.pollCreationMessage||m.pollCreationMessageV2||m.pollCreationMessageV3)return'POLL';if(m.pollUpdateMessage)return'POLL_UPDATE';if(m.eventMessage)return'EVENT';return'TEXT'}
function isReactionEnvelope(msg){return Boolean(unwrapMessageContent(msg)?.reactionMessage)}
function editEnvelopePayload(input,key=null){
  // WhatsApp/Baileys pode entregar uma edição recebida em formatos diferentes:
  // 1) protocolMessage { key: <mensagem original>, editedMessage: ... }
  // 2) editedMessage direto, usando a própria key do messages.update/upsert
  // 3) qualquer um dos formatos acima dentro de wrappers (ephemeral/deviceSent/etc.).
  // O caso (1) é especialmente importante para mensagens editadas PELO CONTATO:
  // a key do evento pode ser a do evento de edição e NÃO a da mensagem original.
  const seen=new Set();
  const queue=[];
  const add=v=>{if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);queue.push(v)}};
  add(input?.message);add(input);add(input?.update?.message);add(input?.update);
  for(let i=0;i<queue.length&&i<40;i++){
    const node=queue[i];
    const pm=node?.protocolMessage||null;
    if(pm?.editedMessage){
      const target=pm?.key?.id?pm.key:key;
      if(target?.id)return{targetKey:target,editedMessage:pm.editedMessage?.message||pm.editedMessage,editedAt:toMillis(pm.timestampMs||node?.messageTimestamp)||Date.now(),format:'PROTOCOL'};
    }
    if(node?.editedMessage){
      const edited=node.editedMessage?.message||node.editedMessage;
      if(edited&&key?.id)return{targetKey:key,editedMessage:edited,editedAt:toMillis(node?.messageTimestamp)||Date.now(),format:'DIRECT'};
    }
    // wrappers conhecidos e uma varredura rasa adicional para novas variantes RC
    for(const child of [node?.ephemeralMessage?.message,node?.viewOnceMessage?.message,node?.viewOnceMessageV2?.message,node?.viewOnceMessageV2Extension?.message,node?.documentWithCaptionMessage?.message,node?.deviceSentMessage?.message,node?.associatedChildMessage?.message,node?.lottieStickerMessage?.message,node?.message])add(child);
    for(const [name,value] of Object.entries(node||{})){
      if(name==='contextInfo'||name==='messageContextInfo'||name==='key'||name==='participant'||name==='senderKeyDistributionMessage')continue;
      if(value&&typeof value==='object'&&!Buffer.isBuffer(value))add(value);
    }
  }
  return null;
}
function protocolEditPayload(msg){
  return editEnvelopePayload(msg,msg?.key||null);
}
function updateEditPayload(update,key){
  return editEnvelopePayload(update,key||null);
}
function applyMessageEdit(instanceId,{targetKey,editedMessage,editedAt,format=null},source='WHATSAPP'){
  const externalId=targetKey?.id;if(!externalId)return null;
  const db=all();
  let rec=findMessageForInstance(db,externalId,instanceId);
  // Em grupos/LID, algumas builds mudam apenas o endereço da key no evento de edição.
  // O ID externo continua sendo o vínculo mais confiável; se houver mais de um registro
  // com o mesmo ID, preferimos o que pertence à mesma instância/conversa remota.
  const matches=messagesForExternalIdInstance(db,externalId,instanceId);
  if(matches.length>1){
    const remote=String(targetKey?.remoteJid||'');
    rec=matches.find(m=>String(m.remoteJid||'')===remote)||matches.find(m=>String(m.remoteJidAlt||'')===remote)||matches[0];
  }
  if(!rec){pushLog('MESSAGE_EDIT_TARGET_NOT_FOUND',{instanceId,externalId,source,format,remoteJid:targetKey?.remoteJid||null,fromMe:targetKey?.fromMe??null});return{handled:true,updated:false}}
  const envelope={key:{...targetKey,remoteJid:targetKey?.remoteJid||rec.remoteJid||rec.destination||null,fromMe:targetKey?.fromMe??(rec.direction==='OUT')},message:editedMessage};
  const nextType=extractType(envelope),nextBody=extractText(envelope);
  if(nextType==='TEXT'&&!String(nextBody||'').trim()){pushLog('MESSAGE_EDIT_EMPTY',{instanceId,externalId,messageId:rec.id,source});return{handled:true,updated:false,message:rec}}
  const previousBody=String(rec.body||''),normalizedBody=String(nextBody||previousBody);
  const now=editedAt||Date.now();
  if(normalizedBody!==previousBody){
    const history=Array.isArray(rec.editHistory)?rec.editHistory:[];
    const last=history[history.length-1];
    if(!last||String(last.body||'')!==previousBody)history.push({body:previousBody,at:now,source,editor:targetKey?.fromMe?'SELF':'CONTACT'});
    rec.editHistory=history.slice(-20);rec.body=normalizedBody;
  }
  rec.editedAt=now;rec.editedBy=targetKey?.fromMe?'SELF':'CONTACT';
  rec.meta={...(rec.meta||{}),edited:true,editSource:source,editCount:Array.isArray(rec.editHistory)?rec.editHistory.length:1};
  markMessagesDirty([rec]);save();emit('message.status',{conversationId:rec.conversationId,message:rec});emit('conversation.updated',{conversationId:rec.conversationId,messageEdited:true});
  pushLog('MESSAGE_EDIT_APPLIED',{instanceId,conversationId:rec.conversationId,messageId:rec.id,externalId,source,format,editedBy:rec.editedBy,changed:normalizedBody!==previousBody});
  return{handled:true,updated:true,message:rec};
}
function isProtocolOnly(msg){const m=unwrapMessageContent(msg);return Boolean(m.protocolMessage||m.senderKeyDistributionMessage||m.keepInChatMessage||m.pinInChatMessage)}
function defaultMessageLabel(type){return({IMAGE:'Imagem',VIDEO:'Vídeo',AUDIO:'Áudio',DOCUMENT:'Documento',STICKER:'Sticker',LOCATION:'Localização',CONTACT:'Contato',LIST:'Lista interativa',POLL:'Enquete',POLL_UPDATE:'Atualização de enquete',EVENT:'Evento'})[type]||''}
function mimeExt(mime='',type=''){const map={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','video/mp4':'.mp4','audio/ogg; codecs=opus':'.ogg','audio/ogg':'.ogg','audio/mpeg':'.mp3','application/pdf':'.pdf'};return map[mime]||(type==='IMAGE'?'.jpg':type==='VIDEO'?'.mp4':type==='AUDIO'?'.ogg':type==='STICKER'?'.webp':'')}
function mediaNode(msg,type){const messageNode=unwrapMessageContent(msg);return type==='IMAGE'?messageNode.imageMessage:type==='VIDEO'?messageNode.videoMessage:type==='AUDIO'?messageNode.audioMessage:type==='DOCUMENT'?messageNode.documentMessage:type==='STICKER'?(messageNode.stickerMessage||rawLottieSticker(msg)):null}
function isAnimatedWebPBuffer(buf){
  if(!Buffer.isBuffer(buf)||buf.length<16)return false;
  // WebP animado possui chunk ANIM e/ou ANMF. Não dependemos apenas do isAnimated
  // recebido do WhatsApp, pois algumas mensagens chegam sem esse metadado.
  const head=buf.subarray(0,12).toString('ascii');
  if(!head.startsWith('RIFF')||!head.endsWith('WEBP'))return false;
  const probe=buf.subarray(12,Math.min(buf.length,256*1024)).toString('latin1');
  return probe.includes('ANIM')||probe.includes('ANMF');
}
function saveMediaBuffer(buf,node,msg,type,{thumbnailOnly=false,mimetype=null}={}){
  if(!Buffer.isBuffer(buf)||!buf.length)return null;const uploadDir=uploadsDir;fs.mkdirSync(uploadDir,{recursive:true});
  const sticker=type==='STICKER';const resolvedMime=thumbnailOnly?(mimetype||'image/jpeg'):(sticker?'image/webp':(mimetype||node?.mimetype||'application/octet-stream'));
  let original=node?.fileName||`${type.toLowerCase()}-${msg.key?.id||Date.now()}${mimeExt(resolvedMime,thumbnailOnly?'IMAGE':type)}`;
  if(sticker&&!thumbnailOnly&&!/\.webp$/i.test(original))original=`${path.parse(original).name||`sticker-${msg.key?.id||Date.now()}`}.webp`;
  if(thumbnailOnly&&!/\.(jpe?g|png)$/i.test(original))original=`${path.parse(original).name||`sticker-preview-${msg.key?.id||Date.now()}`}.jpg`;
  const safe=path.basename(original).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120);const filename=`${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${safe}`;fs.writeFileSync(path.join(uploadDir,filename),buf);
  const isAnimated=sticker&&!thumbnailOnly&&(Boolean(node?.isAnimated)||isAnimatedWebPBuffer(buf));
  return{path:`/uploads/${filename}`,name:original,mimetype:resolvedMime,size:buf.length,ptt:Boolean(node?.ptt),thumbnailOnly:Boolean(thumbnailOnly),isAnimated,width:Number(node?.width||0)||null,height:Number(node?.height||0)||null};
}
function mediaThumbnail(node){
  for(const value of [node?.jpegThumbnail,node?.pngThumbnail,node?.thumbnail]){try{if(value){const b=Buffer.from(value);if(b.length)return b}}catch{}}return null;
}
async function saveInboundMedia(baileys,sock,msg,type){
  let node=mediaNode(msg,type);if(!node)return null;let firstError=null;
  const sticker=type==='STICKER',declaredAnimated=sticker&&Boolean(node?.isAnimated),normalizedMsg=normalizedMediaEnvelope(msg);
  const lottieWrapped=Boolean(msg?.message?.lottieStickerMessage||msg?.lottieStickerMessage);
  if(sticker&&lottieWrapped)pushLog('LOTTIE_STICKER_UNWRAPPED',{messageId:msg.key?.id,isAnimated:declaredAnimated,hasInnerSticker:Boolean(node)});
  const saveDownloaded=(raw,label,currentNode=node)=>{
    const buf=Buffer.from(raw||[]);if(!buf.length)return null;
    const saved=saveMediaBuffer(buf,currentNode||node,msg,type);
    if(saved){pushLog(saved.isAnimated?'ANIMATED_STICKER_SAVED':'MEDIA_SAVED',{messageId:msg.key?.id,type,size:saved.size,attempt:label,isAnimated:saved.isAnimated||Boolean(currentNode?.isAnimated)||declaredAnimated,lottieWrapped});return saved}
    return null;
  };
  const downloadWhole=async(envelope,label)=>{
    if(typeof baileys.downloadMediaMessage!=='function')return null;
    try{
      const timeoutMs=sticker?20000:10000;
      const buf=await withTimeout(baileys.downloadMediaMessage(envelope,'buffer',{}, {logger:silentLogger,reuploadRequest:async m=>sock.updateMediaMessage(m)}),timeoutMs,'Download da mídia');
      return saveDownloaded(buf,label,mediaNode(envelope,type)||node);
    }catch(e){if(!firstError)firstError=e;pushLog('MEDIA_DOWNLOAD_RETRY',{messageId:msg.key?.id,type,attempt:label,isAnimated:declaredAnimated,lottieWrapped,status:e?.output?.statusCode||e?.status||null,error:String(e?.message||e)});return null}
  };
  const directDownload=async(envelope,label)=>{
    const currentNode=mediaNode(envelope,type)||node;if(!currentNode)return null;
    const kinds=sticker?['sticker']:type==='DOCUMENT'?['document']:[type.toLowerCase()];
    for(const kind of kinds){
      try{
        const stream=await withTimeout(Promise.resolve(baileys.downloadContentFromMessage(currentNode,kind)),sticker?20000:10000,'Download direto da mídia');const chunks=[];
        for await(const chunk of stream)chunks.push(chunk);
        const saved=saveDownloaded(Buffer.concat(chunks),`${label}_${kind.toUpperCase()}`,currentNode);if(saved)return saved;
      }catch(e){if(!firstError)firstError=e;pushLog('MEDIA_DIRECT_DOWNLOAD_ERROR',{messageId:msg.key?.id,type,attempt:`${label}_${kind}`,isAnimated:declaredAnimated,lottieWrapped,status:e?.output?.statusCode||e?.status||null,error:String(e?.message||e)})}
    }
    return null;
  };

  // Lottie é um wrapper de future-proof message. A v0.8.13 sempre entrega ao
  // downloader um envelope cujo conteúdo raiz já é o stickerMessage interno.
  let candidates=[normalizedMsg,msg].filter(Boolean);
  for(let i=0;i<candidates.length;i++){
    let saved=await downloadWhole(candidates[i],`INITIAL_${i+1}`);if(saved)return saved;
    saved=await directDownload(candidates[i],`DIRECT_${i+1}`);if(saved)return saved;
  }

  // URLs de sticker expiram rapidamente. updateMediaMessage pode tanto retornar
  // uma nova mensagem como atualizar o objeto recebido in-place; tratamos os dois casos.
  if(sticker&&typeof sock?.updateMediaMessage==='function'){
    for(let cycle=1;cycle<=5;cycle++){
      try{
        const target=cycle%2?normalizedMsg:msg;
        const updated=await withTimeout(Promise.resolve(sock.updateMediaMessage(target)),12000,'Reenvio da figurinha');
        const refreshedCandidates=[updated, target, normalizedMediaEnvelope(updated||target), normalizedMediaEnvelope(msg)].filter(Boolean);
        for(let i=0;i<refreshedCandidates.length;i++){
          const refreshed=refreshedCandidates[i];const refreshedNode=mediaNode(refreshed,type);if(refreshedNode)node=refreshedNode;
          let saved=await downloadWhole(refreshed,`REUPLOAD_${cycle}_${i+1}`);if(saved)return saved;
          saved=await directDownload(refreshed,`REUPLOAD_DIRECT_${cycle}_${i+1}`);if(saved)return saved;
        }
      }catch(e){if(!firstError)firstError=e;pushLog('STICKER_REUPLOAD_ERROR',{messageId:msg.key?.id,cycle,isAnimated:declaredAnimated,lottieWrapped,status:e?.output?.statusCode||e?.status||null,error:String(e?.message||e)})}
      if(cycle<5)await sleep(1000*cycle);
    }
  }

  // Se o CDN ainda não respondeu, fazemos uma última janela curta. Eventos
  // duplicados/updates posteriores também tentarão recuperar o arquivo novamente.
  if(sticker){
    for(let attempt=1;attempt<=4;attempt++){
      await sleep(1600*attempt);
      for(const candidate of [normalizedMediaEnvelope(msg),msg]){
        let saved=await downloadWhole(candidate,`LATE_${attempt}`);if(saved)return saved;
        saved=await directDownload(candidate,`LATE_DIRECT_${attempt}`);if(saved)return saved;
      }
    }
  }

  if(sticker){const thumb=mediaThumbnail(node);if(thumb){pushLog('STICKER_THUMBNAIL_FALLBACK',{messageId:msg.key?.id,size:thumb.length,isAnimated:declaredAnimated,lottieWrapped});return saveMediaBuffer(thumb,node,msg,type,{thumbnailOnly:true,mimetype:'image/jpeg'})}}
  pushLog('MEDIA_DOWNLOAD_ERROR',{messageId:msg.key?.id,type,isAnimated:declaredAnimated,lottieWrapped,status:firstError?.output?.statusCode||firstError?.status||null,error:String(firstError?.message||firstError||'Mídia indisponível')});return null;
}

function specialPayload(msg,type){const m=unwrapMessageContent(msg);if(type==='LOCATION'){const l=m.locationMessage||m.liveLocationMessage;return{latitude:l?.degreesLatitude,longitude:l?.degreesLongitude,name:l?.name||'',address:l?.address||''}}if(type==='CONTACT'){const c=m.contactMessage;return{displayName:c?.displayName||'',vcard:c?.vcard||'',contacts:(m.contactsArrayMessage?.contacts||[]).map(x=>({displayName:x?.displayName||'',vcard:x?.vcard||''}))}}if(type==='LIST'){const l=m.listMessage||{},choice=interactionSelection(msg);return{title:l.title||m.interactiveMessage?.header?.title||m.listResponseMessage?.title||'',description:l.description||m.interactiveMessage?.body?.text||m.listResponseMessage?.description||choice?.selectedText||'',footer:l.footerText||m.interactiveMessage?.footer?.text||'',buttonText:l.buttonText||'',selectedId:choice?.selectedId||'',selectedText:choice?.selectedText||'',sections:(l.sections||[]).map(section=>({title:section?.title||'',rows:(section?.rows||[]).map(row=>({title:row?.title||'',description:row?.description||'',rowId:row?.rowId||''}))}))}}if(type==='POLL'){const node=m.pollCreationMessage||m.pollCreationMessageV2||m.pollCreationMessageV3||{},secret=m?.messageContextInfo?.messageSecret;return{name:node.name||'',options:(node.options||[]).map(o=>o?.optionName||o?.name).filter(Boolean),selectableCount:Number(node.selectableOptionsCount||1),messageSecret:secret?Buffer.from(secret).toString('base64'):null,pollVotes:{},pollResults:[]}}if(type==='EVENT'){const e=m.eventMessage||{};return{name:e.name||'',description:e.description||'',startTime:numberFromLong(e.startTime)||null,endTime:numberFromLong(e.endTime)||null}}return null}
function applyReactionEnvelope(instanceId,msg){
  const reaction=unwrapMessageContent(msg)?.reactionMessage,targetId=reaction?.key?.id;if(!targetId)return false;const rec=findMessageForInstance(all(),targetId,instanceId);if(!rec)return false;const actor=msg?.key?.participant||msg?.key?.remoteJid||'whatsapp',emoji=reaction?.text||'';rec.reactions=(rec.reactions||[]).filter(r=>r.from!==actor);if(emoji)rec.reactions.push({emoji,from:actor,at:toMillis(msg?.messageTimestamp)||Date.now()});save();emit('message.status',{conversationId:rec.conversationId,message:rec});pushLog('MESSAGE_REACTION_UPDATED',{conversationId:rec.conversationId,messageId:rec.id,actor,emoji:emoji||null});return true
}

function numberFromLong(v){try{if(v==null)return 0;if(typeof v==='number')return v;if(typeof v==='bigint')return Number(v);if(typeof v?.toNumber==='function')return v.toNumber();return Number(v)||0}catch{return 0}}
function toMillis(v){const n=numberFromLong(v);if(!n)return 0;return n<10_000_000_000?n*1000:n}
function historyStatus(msg){const st=Number(msg?.status);if(st>=4)return'READ';if(st===3)return'DELIVERED';if(st>=2)return'SENT';return msg?.key?.fromMe?'SENT':'READ'}
function ensureHistoryConversation(contactId,instanceId,createdAt){
  const db=all();
  const active=db.conversations.find(c=>c.contactId===contactId&&c.instanceId===instanceId&&['OPEN','WAITING'].includes(c.status));
  if(active){active.hasImportedHistory=true;return active}
  let cv=db.conversations.find(c=>c.contactId===contactId&&c.instanceId===instanceId&&c.status==='HISTORY');
  if(!cv){
    cv={id:uid('cv'),contactId,instanceId,departmentId:'d-comercial',ownerId:null,status:'HISTORY',priority:'NORMAL',unread:0,createdAt:createdAt||Date.now(),updatedAt:createdAt||Date.now(),archivedAt:createdAt||Date.now(),importedHistory:true};
    db.conversations.push(cv);
  }
  cv.importedHistory=true;cv.hasImportedHistory=true;cv.unread=0;
  return cv;
}
function updateSyncState(conn,patch={}){
  conn.sync={mode:'ALL',status:'IDLE',contacts:0,conversations:0,messages:0,duplicates:0,chunks:0,progress:0,...(conn.sync||{}),...patch};
  conn.lastEventAt=Date.now();save();emit('connection.sync',{instanceId:conn.id,sync:conn.sync});return conn.sync;
}
function upsertHistoryContactMemory(_db,{phone='',whatsappJid=null,whatsappJidAlt=null,name='',avatar=null,nameSource='addressbook'}){return upsertWhatsAppContact({phone,whatsappJid,whatsappJidAlt,name,avatar,nameSource})}

function addHistoryMessageMemory(_db,message){return addHistoricalMessage(message)}
function groupParticipantId(msg){return msg?.key?.participant||msg?.key?.participantAlt||msg?.participant||null}
function groupParticipantName(msg){return msg?.pushName||''}
function quoteLikeContext(ctx){
  if(!ctx||typeof ctx!=='object')return false;
  const key=ctx.parentMessageKey||ctx.replyToMessageKey||ctx.targetMessageKey||ctx?.messageAssociation?.parentMessageKey||ctx?.messageAssociation?.replyToMessageKey||null;
  return Boolean(ctx.stanzaId||ctx.stanzaID||ctx.quotedStanzaID||ctx.quotedStanzaId||ctx.quotedMessage||ctx.repliedMessage||ctx.replyMessage||ctx.quotedMessageId||ctx.quotedMsgId||ctx.replyToMessageId||key?.id||key?.ID);
}
function quoteContextExternalId(ctx={}){
  const key=ctx.parentMessageKey||ctx.replyToMessageKey||ctx.targetMessageKey||ctx?.messageAssociation?.parentMessageKey||ctx?.messageAssociation?.replyToMessageKey||null;
  return ctx.stanzaId||ctx.stanzaID||ctx.quotedStanzaID||ctx.quotedStanzaId||ctx.quotedMessageId||ctx.quotedMsgId||ctx.replyToMessageId||key?.id||key?.ID||null;
}
function quoteContextQuotedMessage(ctx={}){
  return ctx.quotedMessage||ctx.repliedMessage||ctx.replyMessage||ctx?.messageAssociation?.quotedMessage||ctx?.messageAssociation?.repliedMessage||null;
}
function collectQuoteContexts(value,depth=0,seen=new Set(),out=[]){
  if(!value||typeof value!=='object'||depth>18||seen.has(value))return out;
  seen.add(value);
  if(Buffer.isBuffer(value)||value instanceof Uint8Array)return out;
  // Captura o próprio objeto e também campos contextInfo/messageContextInfo. Em algumas
  // compilações do WhatsApp há mais de um contextInfo no mesmo envelope; por isso não
  // retornamos no primeiro encontrado.
  if(quoteLikeContext(value))out.push(value);
  for(const key of ['contextInfo','messageContextInfo']){
    const ctx=value?.[key];if(quoteLikeContext(ctx))out.push(ctx);
  }
  for(const child of Object.values(value))collectQuoteContexts(child,depth+1,seen,out);
  return out;
}
function messageContextCandidates(msg){
  const raw=msg?.message||msg||{},m=unwrapMessageContent(msg)||{},out=[];
  const add=ctx=>{if(ctx&&typeof ctx==='object'&&quoteLikeContext(ctx)&&!out.includes(ctx))out.push(ctx)};
  const inspect=node=>{if(!node||typeof node!=='object')return;add(node.contextInfo);add(node.messageContextInfo);if(quoteLikeContext(node))add(node)};
  const known=[
    raw?.extendedTextMessage,raw?.imageMessage,raw?.videoMessage,raw?.audioMessage,raw?.documentMessage,raw?.stickerMessage,
    raw?.contactMessage,raw?.contactsArrayMessage,raw?.locationMessage,raw?.liveLocationMessage,raw?.listResponseMessage,
    raw?.buttonsResponseMessage,raw?.templateButtonReplyMessage,raw?.interactiveResponseMessage,
    m?.extendedTextMessage,m?.imageMessage,m?.videoMessage,m?.audioMessage,m?.documentMessage,m?.stickerMessage,
    m?.contactMessage,m?.contactsArrayMessage,m?.locationMessage,m?.liveLocationMessage,m?.listResponseMessage,
    m?.buttonsResponseMessage,m?.templateButtonReplyMessage,m?.interactiveResponseMessage,m?.pollCreationMessage,
    m?.pollCreationMessageV2,m?.pollCreationMessageV3,m?.eventMessage
  ];
  for(const node of known)inspect(node);
  inspect(raw);inspect(m);inspect(msg);
  for(const ctx of collectQuoteContexts(msg))add(ctx);
  return out;
}
function messageContextInfo(msg){
  return messageContextCandidates(msg)[0]||null;
}
function jidContactName(jid=''){
  if(!jid)return'';const db=all();
  const exact=db.contacts.find(c=>[c.whatsappJid,c.whatsappJidAlt].filter(Boolean).includes(jid));
  if(exact?.name)return exact.name;
  const phone=phoneFromJid(jid);if(phone){const byPhone=db.contacts.find(c=>String(c.phone||'').replace(/\D/g,'')===String(phone).replace(/\D/g,''));if(byPhone?.name)return byPhone.name}
  return'';
}
function quotedReference(msg,{conversationId=null,isGroup=false}={}){
  try{
    const db=all(),contexts=messageContextCandidates(msg);
    if(!contexts.length){
      pushLog('QUOTED_CONTEXT_NOT_FOUND',{messageId:msg?.key?.id||null,conversationId,topKeys:Object.keys(msg?.message||{}).slice(0,12)});
      return null;
    }
    // Escolhe o contexto mais provável da resposta. Prioridade máxima para um stanzaId
    // que exista no nosso banco; depois para contextos que carreguem quotedMessage.
    const ranked=contexts.map((ctx,index)=>{
      const externalId=quoteContextExternalId(ctx),quotedMessage=quoteContextQuotedMessage(ctx);
      const quoteInstanceId=conversationId?db.conversations.find(c=>c.id===conversationId)?.instanceId:null;const existing=externalId?db.messages.find(m=>m.externalId===externalId&&(!conversationId||m.conversationId===conversationId))||(quoteInstanceId?findMessageForInstance(db,externalId,quoteInstanceId):db.messages.find(m=>m.externalId===externalId)):null;
      let score=0;if(existing)score+=1000;if(quotedMessage)score+=500;if(externalId)score+=200;if(ctx.participant||ctx.participantPn||ctx.participantAlt)score+=20;score-=index;
      return{ctx,externalId,quotedMessage,existing,score,index};
    }).sort((a,b)=>b.score-a.score);
    const best=ranked[0],ctx=best.ctx;
    const parentKey=ctx.parentMessageKey||ctx.replyToMessageKey||ctx.targetMessageKey||ctx?.messageAssociation?.parentMessageKey||ctx?.messageAssociation?.replyToMessageKey||null;
    const externalId=best.externalId,quotedMessage=best.quotedMessage,existing=best.existing;
    if(!externalId&&!quotedMessage)return null;
    const quotedEnvelope=quotedMessage?{message:quotedMessage}:null;
    const qType=existing?.type||(quotedEnvelope?extractType(quotedEnvelope):'TEXT');
    const qBody=String(existing?.body||(quotedEnvelope?extractText(quotedEnvelope):'')||defaultMessageLabel(qType)||'Mensagem').trim();
    const participantJid=ctx.participantPn||ctx.participant||ctx.participantAlt||ctx.remoteJid||parentKey?.participantPn||parentKey?.participant||parentKey?.remoteJid||existing?.participantJid||null;
    let senderName=existing?.senderName||'';
    if(!senderName&&existing?.direction==='OUT')senderName=db.users.find(u=>u.id===existing.authorId)?.name||'Você';
    if(!senderName&&participantJid)senderName=jidContactName(participantJid);
    if(!senderName&&!isGroup&&existing?.direction==='IN'){
      const cv=db.conversations.find(c=>c.id===conversationId),ct=cv?db.contacts.find(c=>c.id===cv.contactId):null;senderName=ct?.name||'';
    }
    if(!senderName&&!isGroup&&existing?.direction==='OUT')senderName='Você';
    if(!senderName&&isGroup&&participantJid){const phone=phoneFromJid(participantJid);senderName=phone?`+${phone}`:'Participante'}
    const quoted={id:existing?.id||null,externalId:externalId||existing?.externalId||null,direction:existing?.direction||null,type:qType,body:qBody.slice(0,600),senderName:senderName||'Mensagem citada',participantJid};
    pushLog('QUOTED_MESSAGE_CAPTURED',{messageId:msg?.key?.id||null,conversationId,quotedExternalId:quoted.externalId||null,quotedMessageId:quoted.id||null,quotedType:quoted.type||null,contextCount:contexts.length,contextScore:best.score,matchedExisting:Boolean(existing),hasEmbeddedQuoted:Boolean(quotedMessage)});
    return quoted;
  }catch(e){pushLog('QUOTED_MESSAGE_EXTRACT_ERROR',{messageId:msg?.key?.id||null,error:String(e?.message||e)});return null}
}
function recoverMissingInboundMedia(baileys,sock,instanceId,record,msg,reason='RETRY'){
  if(!record||record.file||!msg?.message)return false;
  const msgType=extractType(msg);if(!['STICKER','IMAGE','VIDEO','AUDIO','DOCUMENT'].includes(msgType))return false;
  if(record.type!=='STICKER'&&record.type!==msgType)return false;
  const now=Date.now(),last=Number(record.meta?.mediaRecoveringAt||0);if(last&&now-last<4000)return false;
  record.meta={...(record.meta||{}),mediaPending:true,mediaRecoveringAt:now};delete record.meta.mediaError;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});
  Promise.resolve().then(async()=>{
    const file=await saveInboundMedia(baileys,sock,msg,msgType);
    if(file){record.file=file;record.type=msgType;record.meta={...(record.meta||{}),mediaPending:false,mediaReadyAt:Date.now()};delete record.meta.mediaError;delete record.meta.mediaRecoveringAt;if(!record.body||record.body===defaultMessageLabel(msgType))record.body=file.name||record.body;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});emit('conversation.updated',{conversationId:record.conversationId,mediaReady:true});pushLog('MESSAGE_MEDIA_RECOVERED',{instanceId,conversationId:record.conversationId,messageId:record.id,externalId:record.externalId,type:msgType,reason,isAnimated:Boolean(file.isAnimated),thumbnailOnly:Boolean(file.thumbnailOnly)})}
    else{record.meta={...(record.meta||{}),mediaPending:false,mediaError:msgType==='STICKER'?'Figurinha aguardando recuperação automática.':'Mídia indisponível'};delete record.meta.mediaRecoveringAt;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});pushLog('MESSAGE_MEDIA_RECOVERY_FAILED',{instanceId,conversationId:record.conversationId,messageId:record.id,externalId:record.externalId,type:msgType,reason})}
  }).catch(e=>{record.meta={...(record.meta||{}),mediaPending:false,mediaError:String(e?.message||e)};delete record.meta.mediaRecoveringAt;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});pushLog('MESSAGE_MEDIA_RECOVERY_ERROR',{instanceId,messageId:record.id,error:String(e?.message||e),reason})});
  return true;
}
function scheduleStickerRecovery(baileys,sock,instanceId,record,msg){
  if(!record||record.file||record.type!=='STICKER'||!msg?.message)return false;
  const token=`${instanceId}:${record.externalId||record.id}:${Date.now()}`;
  record.meta={...(record.meta||{}),mediaPending:true,mediaRecoveryToken:token,mediaRetryStep:0};delete record.meta.mediaError;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});
  const delays=[5000,15000,45000,90000];
  delays.forEach((delay,index)=>setTimeout(async()=>{
    try{
      if(record.file||record.meta?.mediaRecoveryToken!==token)return;
      record.meta={...(record.meta||{}),mediaPending:true,mediaRetryStep:index+1,mediaRecoveringAt:Date.now()};delete record.meta.mediaError;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});
      pushLog('STICKER_AUTO_RETRY',{instanceId,conversationId:record.conversationId,messageId:record.id,externalId:record.externalId,attempt:index+1,delay});
      const file=await saveInboundMedia(baileys,sock,msg,'STICKER');
      if(file){record.file=file;record.meta={...(record.meta||{}),mediaPending:false,mediaReadyAt:Date.now(),mediaRecoveredAutomatically:true};delete record.meta.mediaError;delete record.meta.mediaRecoveringAt;delete record.meta.mediaRecoveryToken;delete record.meta.mediaRetryStep;if(!record.body||record.body===defaultMessageLabel('STICKER'))record.body=file.name||record.body;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});emit('conversation.updated',{conversationId:record.conversationId,mediaReady:true});pushLog('STICKER_AUTO_RECOVERED',{instanceId,conversationId:record.conversationId,messageId:record.id,externalId:record.externalId,attempt:index+1,isAnimated:Boolean(file.isAnimated),thumbnailOnly:Boolean(file.thumbnailOnly)});return}
      if(index===delays.length-1){record.meta={...(record.meta||{}),mediaPending:false,mediaError:'Não foi possível carregar a figurinha. Reenvie a figurinha para uma nova tentativa.'};delete record.meta.mediaRecoveringAt;delete record.meta.mediaRecoveryToken;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record});pushLog('STICKER_AUTO_RECOVERY_EXHAUSTED',{instanceId,conversationId:record.conversationId,messageId:record.id,externalId:record.externalId,attempts:delays.length})}
    }catch(e){pushLog('STICKER_AUTO_RETRY_ERROR',{instanceId,messageId:record.id,attempt:index+1,error:String(e?.message||e)});if(index===delays.length-1){record.meta={...(record.meta||{}),mediaPending:false,mediaError:'Não foi possível carregar a figurinha.'};delete record.meta.mediaRecoveryToken;delete record.meta.mediaRecoveringAt;markMessagesDirty([record]);save();emit('message.status',{conversationId:record.conversationId,message:record})}}
  },delay));
  return true;
}

function ensureGroupFromJid(jid,instanceId,meta={}){
  const existing=getGroupByJid(jid,instanceId);
  return upsertWhatsAppGroup({id:jid,subject:meta.subject||meta.name||existing?.subject||'Grupo WhatsApp',...meta},instanceId);
}
function ensureChannelFromJid(jid,instanceId,meta={}){
  const existing=getChannelByJid(jid,instanceId);
  return upsertWhatsAppChannel({id:jid,name:meta.name||existing?.name||'Canal WhatsApp',...meta},instanceId);
}
async function refreshChannelMetadata(sock,jid,instanceId,{force=false}={}){
  if(!jid?.endsWith('@newsletter'))return null;const key=`${instanceId}:${jid}`,last=channelMetaFetchAt.get(key)||0;if(!force&&Date.now()-last<10*60*1000)return getChannelByJid(jid,instanceId);channelMetaFetchAt.set(key,Date.now());
  if(typeof sock?.newsletterMetadata!=='function')return ensureChannelFromJid(jid,instanceId);
  try{const meta=await sock.newsletterMetadata('jid',jid);const ch=upsertWhatsAppChannel({...meta,id:meta?.id||jid},instanceId);save();emit('channels.updated',{instanceId,channelJid:jid});return ch}catch(e){pushLog('CHANNEL_METADATA_ERROR',{instanceId,jid,error:e.message});return ensureChannelFromJid(jid,instanceId)}
}
async function refreshKnownChannels(sock,instanceId){
  const known=all().channels.filter(ch=>ch.instanceId===instanceId);let changed=0;for(const ch of known){const before=ch.updatedAt;const next=await refreshChannelMetadata(sock,ch.jid,instanceId,{force:true});if(next&&next.updatedAt!==before)changed++;await yieldToEventLoop()}emit('channels.updated',{instanceId,count:known.length});pushLog('CHANNELS_SYNCED',{instanceId,count:known.length,changed});return all().channels.filter(ch=>ch.instanceId===instanceId)
}
async function refreshGroupsFromSocket(sock,instanceId,{force=false}={}){
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn||!sock?.groupFetchAllParticipating)return[];
  if(!force&&conn.groupsSyncedAt&&Date.now()-Number(conn.groupsSyncedAt)<30*60*1000)return all().groups.filter(g=>g.instanceId===instanceId);
  try{
    const result=await sock.groupFetchAllParticipating();const metas=Object.values(result||{});let changed=0;
    for(const meta of metas){const g=upsertWhatsAppGroup(meta,instanceId);if(g){changed++;scheduleGroupAvatar(sock,g,900,{force:true})}}
    conn.groupsSyncedAt=Date.now();conn.groupsCount=metas.length;save();emit('groups.updated',{instanceId,count:metas.length});pushLog('GROUPS_SYNCED',{instanceId,count:metas.length,changed});return all().groups.filter(g=>g.instanceId===instanceId)
  }catch(e){pushLog('GROUPS_SYNC_ERROR',{instanceId,error:e.message});throw e}
}

async function importHistoryBatch(instanceId,payload={}){
  const db=all(),conn=db.connections.find(c=>c.id===instanceId);if(!conn)return;
  if(!conn.syncRequested)return;
  const sync=updateSyncState(conn,{status:'RECEIVING',lastChunkAt:Date.now(),chunks:Number(conn.sync?.chunks||0)+1,note:'Importando em segundo plano...'});
  const mode=sync.mode||'ALL';
  const contactsByJid=new Map();
  const seenContacts=new Set(sync.seenContactIds||[]);
  const seenConversations=new Set(sync.seenConversationIds||[]);
  let runtime=syncRuntime.get(instanceId);
  if(!runtime){runtime={externalIds:new Set(db.messages.filter(m=>messageBelongsToInstance(db,m,instanceId)).map(m=>externalMessageKey(instanceId,m.externalId)).filter(Boolean))};syncRuntime.set(instanceId,runtime)}
  const externalIds=runtime.externalIds;
  const newestByConversation=new Map();
  for(const mapping of payload.lidPnMappings||[]){
    try{const lid=mapping?.lid,pn=mapping?.pn;if(!lid||!pn)continue;const c=upsertWhatsAppContact({phone:phoneFromJid(pn),whatsappJid:lid,whatsappJidAlt:pn,name:'',nameSource:'fallback'});if(c?.id)seenContacts.add(c.id)}catch(e){pushLog('HISTORY_LID_MAPPING_ERROR',{instanceId,error:e.message})}
  }
  let work=0,cancelled=false;
  const maybeYield=async()=>{
    work++;
    if(work%150===0){
      await yieldToEventLoop();
      if(!conn.syncRequested)cancelled=true;
    }
  };
  for(const item of payload.contacts||[]){
    if(cancelled)break;
    try{
      const jid=item?.id;if(!jid||String(jid).endsWith('@g.us')||String(jid).endsWith('@newsletter')||jid==='status@broadcast')continue;
      const lid=item?.lid||(String(jid).endsWith('@lid')?jid:null);
      const pn=item?.phoneNumber||item?.pnJid||(String(jid).endsWith('@s.whatsapp.net')?jid:null);
      contactsByJid.set(jid,item);if(lid)contactsByJid.set(lid,item);if(pn)contactsByJid.set(pn,item);
      if(mode!=='HISTORY'){
        const phone=pn?phoneFromJid(pn):String(jid).endsWith('@s.whatsapp.net')?phoneFromJid(jid):'';
        const c=upsertHistoryContactMemory(db,{phone,whatsappJid:lid||jid,whatsappJidAlt:pn&&pn!==(lid||jid)?pn:null,name:item.name||item.notify||item.verifiedName||'',avatar:item.imgUrl||null,nameSource:'addressbook'});
        if(c?.id)seenContacts.add(c.id);
      }
    }catch(e){pushLog('HISTORY_CONTACT_IMPORT_ERROR',{instanceId,error:e.message})}
    await maybeYield();
  }
  if(!cancelled&&mode!=='CONTACTS'){
    for(const chat of payload.chats||[]){
      if(cancelled)break;
      try{
        const jid=chat?.id;if(!jid||jid==='status@broadcast'||jid.endsWith('@broadcast'))continue;
        const ts=toMillis(chat.conversationTimestamp)||Date.now();
        let contact,channel=null;
        if(jid.endsWith('@g.us')){const g=ensureGroupFromJid(jid,instanceId,{subject:chat.name||chat.subject||'Grupo WhatsApp'});contact=db.contacts.find(c=>c.id===g?.contactId)}
        else if(jid.endsWith('@newsletter')){channel=ensureChannelFromJid(jid,instanceId,{name:chat.name||chat.subject||'Canal WhatsApp'});contact=db.contacts.find(c=>c.id===channel?.contactId)}
        else{const hc=contactsByJid.get(jid)||{};const phone=phoneFromJid(jid);contact=upsertHistoryContactMemory(db,{phone,whatsappJid:jid,name:hc.name||hc.notify||hc.verifiedName||phone,nameSource:(hc.name||hc.notify||hc.verifiedName)?'addressbook':'fallback'})}
        if(!contact)continue;const cv=ensureHistoryConversation(contact.id,instanceId,ts);cv.isGroup=Boolean(contact.isGroup);cv.isChannel=Boolean(contact.isChannel);if(contact.isGroup)cv.groupId=getGroupByJid(jid,instanceId)?.id||null;if(contact.isChannel)cv.channelId=channel?.id||getChannelByJid(jid,instanceId)?.id||null;seenConversations.add(cv.id);newestByConversation.set(cv.id,Math.max(newestByConversation.get(cv.id)||0,ts));
      }catch(e){pushLog('HISTORY_CHAT_IMPORT_ERROR',{instanceId,error:e.message})}
      await maybeYield();
    }
    for(const msg of payload.messages||[]){
      if(cancelled)break;
      try{
        if(!msg?.message||!msg.key?.id)continue;
        if(isReactionEnvelope(msg)){applyReactionEnvelope(instanceId,msg);continue}
        if(isProtocolOnly(msg))continue;
        const jid=msg.key.remoteJid;if(!jid||jid==='status@broadcast'||jid.endsWith('@broadcast'))continue;
        const scopedExternalKey=externalMessageKey(instanceId,msg.key.id);
        if(externalIds.has(scopedExternalKey)){
          const existingMessage=findMessageForInstance(db,msg.key.id,instanceId);
          if(existingMessage&&!existingMessage.quoted){
            const recoveredQuote=quotedReference(msg,{conversationId:existingMessage.conversationId,isGroup:String(msg.key.remoteJid||'').endsWith('@g.us')});
            if(recoveredQuote){existingMessage.quoted=recoveredQuote;markMessagesDirty([existingMessage]);sync.updated=(sync.updated||0)+1;pushLog('QUOTED_MESSAGE_BACKFILLED_HISTORY',{instanceId,externalId:msg.key.id,messageId:existingMessage.id,quotedExternalId:recoveredQuote.externalId||null})}
          }
          sync.duplicates++;continue
        }
        const altJid=msg.key.remoteJidAlt||null;
        let contact,group=null,channel=null;
        if(jid.endsWith('@g.us')){group=ensureGroupFromJid(jid,instanceId,{subject:'Grupo WhatsApp'});contact=db.contacts.find(c=>c.id===group?.contactId)}
        else if(jid.endsWith('@newsletter')){channel=ensureChannelFromJid(jid,instanceId,{name:msg.pushName||'Canal WhatsApp'});contact=db.contacts.find(c=>c.id===channel?.contactId)}
        else{const phoneJid=[jid,altJid].find(x=>String(x||'').endsWith('@s.whatsapp.net'))||null;const phone=phoneJid?phoneFromJid(phoneJid):phoneFromJid(jid);const hc=contactsByJid.get(jid)||contactsByJid.get(altJid)||{};contact=upsertHistoryContactMemory(db,{phone,whatsappJid:jid,whatsappJidAlt:altJid,name:hc.name||hc.notify||hc.verifiedName||(!msg.key.fromMe?msg.pushName:'')||phone,nameSource:(hc.name||hc.notify||hc.verifiedName)?'addressbook':(!msg.key.fromMe&&msg.pushName?'profile':'fallback')})}
        if(!contact)continue;const createdAt=toMillis(msg.messageTimestamp)||Date.now();
        const cv=ensureHistoryConversation(contact.id,instanceId,createdAt);cv.isGroup=Boolean(contact.isGroup);cv.isChannel=Boolean(contact.isChannel);if(!cv.isGroup&&!cv.isChannel){cv.peerJid=jid;cv.peerJidAlt=altJid||cv.peerJidAlt||null;}if(group)cv.groupId=group.id;if(channel)cv.channelId=channel.id;seenConversations.add(cv.id);
        const type=extractType(msg),rawBody=extractText(msg);if(type==='TEXT'&&!rawBody)continue;const body=rawBody||defaultMessageLabel(type)||'Mensagem';
        const rec=addHistoryMessageMemory(db,{conversationId:cv.id,instanceId,direction:msg.key.fromMe?'OUT':'IN',type,body,status:msg.key.fromMe?historyStatus(msg):'READ',externalId:msg.key.id,remoteJid:jid,remoteJidAlt:altJid,participantJid:jid.endsWith('@g.us')?groupParticipantId(msg):null,senderName:jid.endsWith('@g.us')?groupParticipantName(msg):null,quoted:quotedReference(msg,{conversationId:cv.id,isGroup:jid.endsWith('@g.us')}),groupId:group?.id||null,channelId:channel?.id||null,isChannel:Boolean(channel),meta:specialPayload(msg,type),createdAt,historical:true,importedAt:Date.now()});
        externalIds.add(scopedExternalKey);sync.messages++;newestByConversation.set(cv.id,Math.max(newestByConversation.get(cv.id)||0,createdAt));
        if(msg.key.fromMe&&rec.status==='SENT')rec.sentAt=createdAt;
      }catch(e){pushLog('HISTORY_MESSAGE_IMPORT_ERROR',{instanceId,messageId:msg?.key?.id,error:e.message})}
      await maybeYield();
    }
    for(const [cid,newest] of newestByConversation){
      const cv=db.conversations.find(c=>c.id===cid);if(!cv)continue;
      if(newest){cv.updatedAt=Math.max(Number(cv.updatedAt)||0,newest);if(cv.status==='HISTORY')cv.archivedAt=cv.updatedAt}if(cv.status==='HISTORY')cv.unread=0;
    }
  }
  sync.seenContactIds=[...seenContacts];sync.seenConversationIds=[...seenConversations];
  sync.contacts=seenContacts.size;sync.conversations=seenConversations.size;
  if(payload.progress!=null)sync.progress=Number(payload.progress)||0;
  sync.isLatest=Boolean(payload.isLatest);sync.syncType=payload.syncType!=null?String(payload.syncType):sync.syncType;
  if(cancelled||!conn.syncRequested){
    sync.status='CANCELLED';sync.completedAt=Date.now();sync.note='Sincronização cancelada. A conexão normal foi priorizada.';
  }else if(payload.isLatest===true||Number(payload.progress)>=100){
    sync.status='COMPLETED';sync.completedAt=Date.now();conn.syncRequested=false;sync.note='Sincronização recebida do WhatsApp.';
  }
  save();emit('connection.sync',{instanceId,sync});emit('contacts.updated',{});emit('groups.updated',{instanceId,historySync:true});emit('channels.updated',{instanceId,historySync:true});emit('conversation.updated',{historySync:true});
  pushLog('WHATSAPP_HISTORY_IMPORTED',{instanceId,mode,contacts:sync.contacts,messages:sync.messages,duplicates:sync.duplicates,conversations:sync.conversations,progress:sync.progress,isLatest:sync.isLatest,status:sync.status});
  // Não iniciamos mais uma varredura completa de fotos automaticamente após sincronizar contatos/histórico.
  // Fotos novas/recentes continuam sendo buscadas sob demanda e a varredura completa fica manual.
  if(all().channels.some(ch=>ch.instanceId===instanceId)){const liveSock=sockets.get(instanceId);if(liveSock)setTimeout(()=>refreshKnownChannels(liveSock,instanceId).catch(()=>{}),1200)}
  if(['COMPLETED','CANCELLED','NO_DATA','PARTIAL','ERROR'].includes(sync.status)){syncRuntime.delete(instanceId);try{flush()}catch{}}
}


function normalizePollJid(baileys,jid=''){
  const value=String(jid||'').trim();if(!value)return'';
  try{return baileys?.jidNormalizedUser?baileys.jidNormalizedUser(value):value.replace(/:\d+@/,'@')}catch{return value.replace(/:\d+@/,'@')}
}
function pollKeyAuthor(baileys,key={},sock=null){
  const me=normalizePollJid(baileys,sock?.user?.id||'');
  try{if(typeof baileys?.getKeyAuthor==='function')return normalizePollJid(baileys,baileys.getKeyAuthor(key,me))}catch{}
  if(key?.fromMe)return normalizePollJid(baileys,sock?.user?.lid||sock?.user?.id||'');
  return normalizePollJid(baileys,key?.participant||key?.participantAlt||key?.remoteJidAlt||key?.remoteJid||'');
}
function pollOptionHashes(options=[]){const map=new Map();for(const option of options){const name=String(option||'');if(!name)continue;map.set(crypto.createHash('sha256').update(name).digest('hex'),name)}return map}
function selectedPollOptions(vote,options=[]){const map=pollOptionHashes(options),out=[];for(const raw of vote?.selectedOptions||[]){try{const hex=Buffer.from(raw).toString('hex');const name=map.get(hex);if(name&&!out.includes(name))out.push(name)}catch{}}return out}
function rebuildPollResults(rec){
  const meta=rec.meta||{},options=(meta.options||[]).map(String),votes=meta.pollVotes&&typeof meta.pollVotes==='object'?meta.pollVotes:{};
  const results=options.map(name=>({name,voters:[],count:0})),byName=new Map(results.map(r=>[r.name,r]));
  for(const [voter,selections] of Object.entries(votes)){for(const name of Array.isArray(selections)?selections:[]){const row=byName.get(String(name));if(row&&!row.voters.includes(voter))row.voters.push(voter)}}
  for(const row of results)row.count=row.voters.length;
  rec.meta={...meta,pollVotes:votes,pollResults:results,pollUpdatedAt:Date.now()};markMessagesDirty([rec]);return results;
}
function applyDecodedPollUpdates(baileys,sock,instanceId,rec,pollUpdates=[]){
  if(!rec||rec.type!=='POLL'||!pollUpdates?.length)return false;
  const meta=rec.meta||{},options=(meta.options||[]).map(String),votes={...(meta.pollVotes||{})};let changed=false;
  for(const update of pollUpdates){
    const key=update?.pollUpdateMessageKey||update?.key||{},voter=pollKeyAuthor(baileys,key,sock);if(!voter)continue;
    const selected=selectedPollOptions(update?.vote,options);
    if(selected.length)votes[voter]=selected;else delete votes[voter];changed=true;
  }
  if(!changed)return false;rec.meta={...meta,pollVotes:votes};const results=rebuildPollResults(rec);save();emit('message.status',{conversationId:rec.conversationId,message:rec});emit('conversation.updated',{conversationId:rec.conversationId,pollUpdated:true});pushLog('POLL_UPDATED',{instanceId,messageId:rec.id,options:results.length,voters:Object.keys(votes).length});return true;
}
function pollCreatorCandidates(baileys,sock,creationKey={},rec={}){
  const vals=[];const add=v=>{const n=normalizePollJid(baileys,v);if(n&&!vals.includes(n))vals.push(n)};
  if(creationKey?.fromMe){add(sock?.user?.lid);add(sock?.user?.id)}
  add(creationKey?.participant);add(creationKey?.participantAlt);add(rec?.participantJid);add(rec?.participantJidAlt);
  const remote=String(creationKey?.remoteJid||rec?.remoteJid||'');if(remote&&!remote.endsWith('@g.us')&&!remote.endsWith('@newsletter'))add(remote);
  add(creationKey?.remoteJidAlt);add(rec?.remoteJidAlt);
  try{const me=normalizePollJid(baileys,sock?.user?.id||'');if(typeof baileys?.getKeyAuthor==='function')add(baileys.getKeyAuthor(creationKey,me))}catch{}
  return vals;
}
function pollVoterCandidates(baileys,sock,msg={}){
  const key=msg?.key||{},vals=[];const add=v=>{const n=normalizePollJid(baileys,v);if(n&&!vals.includes(n))vals.push(n)};
  if(key?.fromMe){add(sock?.user?.id);add(sock?.user?.lid)}
  add(key?.participant);add(key?.participantAlt);add(key?.remoteJidAlt);
  const remote=String(key?.remoteJid||'');if(remote&&!remote.endsWith('@g.us')&&!remote.endsWith('@newsletter'))add(remote);
  add(pollKeyAuthor(baileys,key,sock));return vals;
}
async function consumePollUpdateEnvelope(baileys,sock,instanceId,msg){
  const node=unwrapMessageContent(msg)?.pollUpdateMessage;if(!node)return false;
  const creationKey=node?.pollCreationMessageKey||{},pollId=creationKey?.id||null;
  if(!pollId){pushLog('POLL_UPDATE_SKIPPED',{instanceId,updateId:msg?.key?.id||null,reason:'MISSING_POLL_ID'});return true}
  const rec=findMessageForInstance(all(),pollId,instanceId,m=>m.type==='POLL');
  if(!rec){pushLog('POLL_UPDATE_SKIPPED',{instanceId,updateId:msg?.key?.id||null,pollId,reason:'POLL_NOT_FOUND'});return true}
  const secretB64=rec?.meta?.messageSecret;if(!secretB64){pushLog('POLL_UPDATE_SKIPPED',{instanceId,updateId:msg?.key?.id||null,pollId,reason:'MISSING_MESSAGE_SECRET'});return true}
  if(typeof baileys?.decryptPollVote!=='function'){pushLog('POLL_UPDATE_SKIPPED',{instanceId,updateId:msg?.key?.id||null,pollId,reason:'DECRYPT_HELPER_UNAVAILABLE'});return true}
  let decoded=null,usedCreator='',usedVoter='',lastError=null;const pollEncKey=Buffer.from(String(secretB64),'base64');
  for(const creator of pollCreatorCandidates(baileys,sock,creationKey,rec)){
    for(const voter of pollVoterCandidates(baileys,sock,msg)){
      try{decoded=baileys.decryptPollVote(node.vote,{pollEncKey,pollCreatorJid:creator,pollMsgId:pollId,voterJid:voter});usedCreator=creator;usedVoter=voter;break}catch(e){lastError=e}
    }
    if(decoded)break;
  }
  if(!decoded){pushLog('POLL_VOTE_DECRYPT_FAILED',{instanceId,updateId:msg?.key?.id||null,pollId,error:String(lastError?.message||lastError||'Falha ao descriptografar voto')});return true}
  const update={pollUpdateMessageKey:msg.key,vote:decoded,senderTimestampMs:numberFromLong(node.senderTimestampMs)||Date.now()};
  applyDecodedPollUpdates(baileys,sock,instanceId,rec,[update]);pushLog('POLL_VOTE_DECRYPTED',{instanceId,updateId:msg?.key?.id||null,pollId,creator:usedCreator,voter:usedVoter});return true;
}

export async function connectInstance(instanceId='principal'){
  const db=all();let conn=db.connections.find(c=>c.id===instanceId);
  const existing=sockets.get(instanceId);
  if(existing){
    if(runtimeSocketReady(instanceId)||['CONNECTING','QR_REQUIRED','RECONNECTING'].includes(conn?.state))return existing;
    sockets.delete(instanceId);openSockets.delete(instanceId);
    try{existing.end?.(new Error('Balbino Chat: descartando socket sem estado ativo'))}catch{}
  }
  if(!conn){conn={id:instanceId,name:instanceId,phone:'',state:'DISCONNECTED',qr:null,lastEventAt:null,connectedAt:null};db.connections.push(conn);save()}
  let baileys,QRCode;try{baileys=await import('@whiskeysockets/baileys');QRCode=(await import('qrcode')).default}catch{throw new Error('Conector WhatsApp não instalado. Execute: npm run install:whatsapp')}
  const makeWASocket=baileys.default;const{useMultiFileAuthState,DisconnectReason,Browsers}=baileys;
  const authDir=path.join(sessionsDir,instanceId);
  // Se o WhatsApp marcou a credencial como expirada/logged out (401), uma nova
  // tentativa explícita de conexão deve começar com uma autenticação limpa.
  // Somente os arquivos de autenticação desta instância são removidos; CRM,
  // conversas, mídia e configurações permanecem intactos.
  if(conn.state==='EXPIRED'){
    try{fs.rmSync(authDir,{recursive:true,force:true});pushLog('CONNECTION_AUTH_RESET',{instanceId,reason:'EXPIRED_401'})}
    catch(e){pushLog('CONNECTION_AUTH_RESET_ERROR',{instanceId,error:e.message})}
    conn.phone='';conn.qr=null;conn.connectedAt=null;conn.lastError=null;
  }
  fs.mkdirSync(authDir,{recursive:true});const{state,saveCreds}=await useMultiFileAuthState(authDir);
  conn.state='CONNECTING';conn.lastError=null;conn.lastEventAt=Date.now();save();emit('connection.update',conn);pushLog('CONNECTION_CONNECTING',{instanceId});
  // v0.5.22: no Baileys 7 usamos a versão de protocolo embutida/testada pelo próprio pacote.
  // Evita alternar para uma versão Web mais antiga em uma reconexão, cenário que pode causar loops 408.
  conn.waVersion='BAILEYS_DEFAULT';
  const historyRequested=Boolean(conn.syncRequested);
  // Em 2026 o WhatsApp passou a encerrar algumas conexões que anunciam o subplatform Desktop
  // com status 428. Mantemos o perfil WEB_BROWSER/Chrome também durante history sync.
  const browser=Browsers?.macOS?Browsers.macOS('Chrome'):['Mac OS','Chrome','14.4.1'];
  const sock=makeWASocket({
    logger:silentLogger,
    auth:state,
    browser,
    markOnlineOnConnect:false,
    syncFullHistory:historyRequested,
    ...(historyRequested?{shouldSyncHistoryMessage:()=>true}:{}),
    cachedGroupMetadata:async jid=>getGroupByJid(jid,instanceId)||undefined,
    generateHighQualityLinkPreview:true,
    // Baileys 7: recuperação automática de sessões Signal e mensagens que chegaram cifradas.
    enableAutoSessionRecreation:true,
    enableRecentMessageCache:true,
    retryRequestDelayMs:500,
    maxMsgRetryCount:5,
    getMessage:async key=>{
      try{
        const rec=findMessageForInstance(all(),key?.id,instanceId);
        if(!rec)return undefined;
        if(rec.type==='TEXT')return{conversation:String(rec.body||'')};
        if(rec.type==='POLL'){const meta=rec.meta||{},options=(meta.options||[]).map(optionName=>({optionName:String(optionName)})),secret=meta.messageSecret?Buffer.from(String(meta.messageSecret),'base64'):null;return{...(secret?{messageContextInfo:{messageSecret:secret}}:{}),pollCreationMessageV3:{name:String(meta.name||rec.body||'Enquete'),options,selectableOptionsCount:Number(meta.selectableCount||1)}}}
        return undefined;
      }catch{return undefined}
    }
  });
  sockets.set(instanceId,sock);sock.ev.on('creds.update',saveCreds);
  sock.ev.on('connection.update',async u=>{
    if(u.connection==='close'&&sockets.get(instanceId)!==sock)return;
    conn.lastEventAt=Date.now();
    if(u.qr){conn.qr=await QRCode.toDataURL(u.qr);conn.state='QR_REQUIRED';pushLog('CONNECTION_QR_REQUIRED',{instanceId})}
    if(u.connection==='open'){
      openSockets.add(instanceId);clearReconnectTimer(instanceId);
      conn.state='CONNECTED';conn.qr=null;conn.lastError=null;conn.connectedAt=Date.now();conn.phone=phoneFromJid(sock.user?.id||'');conn.reconnect428Count=0;conn.sync428Attempts=0;registerConnectionSelfIdentity(instanceId,{profileName:sock.user?.name||'',phone:conn.phone,source:'socket-open'});try{repairMultiConnectionData({reason:`connection-open:${instanceId}`,mergeConversations:false})}catch(e){pushLog('MULTICONNECTION_REPAIR_ERROR',{instanceId,error:String(e?.message||e)})}pushLog('CONNECTION_CONNECTED',{instanceId,phone:conn.phone,profileName:sock.user?.name||null});if(all().settings.syncGroupsOnConnect!==false)setTimeout(()=>refreshGroupsFromSocket(sock,instanceId).catch(()=>{}),2500);if(all().settings.syncChannelsOnConnect!==false)setTimeout(()=>refreshKnownChannels(sock,instanceId).catch(()=>{}),4000);if(conn.syncRequested){updateSyncState(conn,{status:'WAITING_PHONE',connectedAt:Date.now(),note:'Aguardando o WhatsApp disponibilizar contatos e histórico.'});setTimeout(()=>{if(conn.syncRequested&&['WAITING_PHONE','STARTING','RECEIVING'].includes(conn.sync?.status)){const got=Number(conn.sync?.chunks||0)>0;conn.syncRequested=false;updateSyncState(conn,{status:got?'PARTIAL':'NO_DATA',completedAt:Date.now(),note:got?'O WhatsApp enviou parte do histórico disponível.':'O WhatsApp não disponibilizou novos dados nesta tentativa. Tente novamente mais tarde ou após religar o aparelho principal.'})}},60000)}
      reassignOrphanConversations(instanceId);
      for(const queued of all().messages.filter(m=>m.direction==='OUT'&&m.status==='QUEUED')){
        const cv=all().conversations.find(c=>c.id===queued.conversationId&&c.instanceId===instanceId);if(!cv)continue;const ct=all().contacts.find(c=>c.id===cv.contactId);if(!ct)continue;
        try{const destination=queued.destination||ct.whatsappJidAlt||ct.whatsappJid||ct.phone;let result;if(queued.type==='CONTACT'&&queued.meta?.contactCard){result=await sendContact(instanceId,destination,queued.meta.contactCard)}else if(queued.file?.path){const disk=uploadDiskPath(queued.file.path);result=await sendMedia(instanceId,destination,disk,queued.file.mimetype,queued.file.name,queued.body||'',Boolean(queued.file.ptt))}else result=await sendText(instanceId,destination,queued.body,{quoted:queued.quoted});queued.status='SENT';queued.externalId=result?.key?.id||queued.externalId;queued.sendError=null;save();emit('message.status',{conversationId:cv.id,message:queued});pushLog('QUEUED_MESSAGE_SENT',{messageId:queued.id,instanceId})}catch(e){queued.sendError=e.message;save();pushLog('QUEUED_MESSAGE_RETRY_FAILED',{messageId:queued.id,error:e.message})}
      }
    }
    if(u.connection==='close'){
      openSockets.delete(instanceId);
      const avatarRuntime=avatarSyncRuntime.get(instanceId);
      if(avatarRuntime&&!avatarRuntime.finished){avatarRuntime.cancelRequested=true;avatarRuntime.state.status='INTERRUPTED';avatarRuntime.state.note='Sincronização de fotos pausada automaticamente porque a conexão mudou de estado. O atendimento tem prioridade.';avatarRuntime.state.lastProgressAt=Date.now();conn.avatarSync={...avatarRuntime.state};emit('connection.avatar-sync',{instanceId,avatarSync:{...avatarRuntime.state}})}
      const err=u.lastDisconnect?.error,status=err?.output?.statusCode||err?.statusCode||err?.data?.statusCode||null,message=err?.message||err?.output?.payload?.message||'Conexão encerrada';
      const loggedOut=status===DisconnectReason?.loggedOut;
      const is428=Number(status)===428;
      const canReconnect=!loggedOut&&(is428||status===DisconnectReason?.connectionLost||status===DisconnectReason?.timedOut||status===DisconnectReason?.restartRequired||status===DisconnectReason?.unavailableService||status==null);
      conn.lastError={status,message,at:Date.now()};
      sockets.delete(instanceId);
      let reconnectDelay=is428?1800:3500,reconnectReason=is428?'428':'CONNECTION_CLOSED';
      if(is428&&conn.syncRequested){
        // v0.5.20: um 428 durante sincronização encerra APENAS a sincronização.
        // Não insistimos em syncFullHistory, pois o atendimento normal tem prioridade.
        conn.syncRequested=false;conn.sync428Attempts=0;syncRuntime.delete(instanceId);conn.state='RECONNECTING';
        updateSyncState(conn,{status:'INTERRUPTED',completedAt:Date.now(),error:'Connection Terminated (428)',note:'O WhatsApp interrompeu a sincronização de histórico. O Balbino Chat voltou automaticamente ao modo normal de atendimento.'});
        reconnectDelay=1200;reconnectReason='HISTORY_SYNC_428_FALLBACK_IMMEDIATE';
        pushLog('HISTORY_SYNC_428_FALLBACK_IMMEDIATE',{instanceId,status});
      }else{
        if(is428){
          const count=Number(conn.reconnect428Count||0)+1;conn.reconnect428Count=count;
          reconnectDelay=Math.min(1500+(count-1)*1500,9000);
          reconnectReason=`428_${count}`;
        }else{conn.sync428Attempts=0;conn.reconnect428Count=0}
        conn.state=loggedOut?'EXPIRED':canReconnect?'RECONNECTING':'ERROR';
      }
      pushLog('CONNECTION_CLOSED',{instanceId,status,message,loggedOut,canReconnect,syncRequested:Boolean(conn.syncRequested),reconnectDelay});
      if(canReconnect)scheduleReconnect(instanceId,reconnectDelay,reconnectReason)
    }
    save();emit('connection.update',conn)
  });
  sock.ev.on('messaging-history.set',async payload=>{
    if(!conn.syncRequested){
      pushLog('HISTORY_SYNC_IGNORED',{instanceId,reason:'NOT_REQUESTED',syncType:payload?.syncType!=null?String(payload.syncType):null,messages:(payload?.messages||[]).length,contacts:(payload?.contacts||[]).length});
      return;
    }
    try{await importHistoryBatch(instanceId,payload)}
    catch(e){updateSyncState(conn,{status:'ERROR',error:e.message});pushLog('HISTORY_SYNC_ERROR',{instanceId,error:e.message})}
  });
  sock.ev.on('groups.upsert',items=>{let changed=0;for(const meta of items||[]){const g=upsertWhatsAppGroup(meta,instanceId);if(g){changed++;scheduleGroupAvatar(sock,g,900)}}if(changed){save();emit('groups.updated',{instanceId,count:changed});pushLog('GROUPS_UPSERTED',{instanceId,count:changed})}});
  sock.ev.on('groups.update',async items=>{let changed=0;for(const partial of items||[]){try{let meta=partial;if(partial?.id&&sock.groupMetadata){try{meta=await sock.groupMetadata(partial.id)}catch{}}if(upsertWhatsAppGroup(meta,instanceId))changed++}catch(e){pushLog('GROUP_UPDATE_ERROR',{instanceId,error:e.message})}}if(changed){save();emit('groups.updated',{instanceId,count:changed})}});
  sock.ev.on('group-participants.update',async event=>{try{let meta=null;if(event?.id&&sock.groupMetadata)meta=await sock.groupMetadata(event.id);if(meta){const g=upsertWhatsAppGroup(meta,instanceId);if(g)scheduleGroupAvatar(sock,g,1000)}save();emit('groups.updated',{instanceId,groupJid:event?.id,action:event?.action});pushLog('GROUP_PARTICIPANTS_UPDATED',{instanceId,groupJid:event?.id,action:event?.action,count:(event?.participants||[]).length})}catch(e){pushLog('GROUP_PARTICIPANTS_ERROR',{instanceId,error:e.message})}});
  const applyContactEvent=item=>{const jid=item?.id;if(!jid||String(jid).endsWith('@g.us')||String(jid).endsWith('@newsletter'))return null;const lid=item?.lid||(String(jid).endsWith('@lid')?jid:null),pn=item?.phoneNumber||item?.pnJid||(String(jid).endsWith('@s.whatsapp.net')?jid:null),phone=pn?phoneFromJid(pn):'';const c=upsertWhatsAppContact({phone,whatsappJid:lid||jid,whatsappJidAlt:pn&&pn!==(lid||jid)?pn:null,name:item.name||item.notify||item.verifiedName||'',nameSource:'addressbook'});const img=String(item?.imgUrl||'').trim();if(img&&validAvatarUrl(img)){c.avatarRemoteHint=img;c.avatarCheckedAt=0}else if(img){c.avatarCheckedAt=0;if(/remove|removed|none|null/i.test(img)&&c.avatarSource==='whatsapp')c.avatar=null}return c};
  sock.ev.on('contacts.upsert',items=>{const list=items||[],bulk=list.length>20;let touched=0,avatarQueued=0;for(const item of list){try{const contact=applyContactEvent(item);if(contact){touched++;if(!bulk&&avatarQueued<8&&!contact.avatar){avatarQueued++;scheduleContactAvatar(sock,contact,1800)}}}catch(e){pushLog('CONTACT_UPSERT_ERROR',{instanceId,error:e.message})}}if(bulk)pushLog('CONTACT_AVATAR_BULK_DEFERRED',{instanceId,count:list.length,reason:'Atendimento priorizado; use Sincronizar fotos para a varredura completa.'});if(touched)save();if(conn.syncRequested&&conn.sync?.mode!=='HISTORY'&&touched){updateSyncState(conn,{contacts:Number(conn.sync?.contacts||0)+touched})}emit('contacts.updated',{});if(touched)emit('conversation.updated',{contactsUpdated:true})});
  sock.ev.on('contacts.update',items=>{const list=items||[],bulk=list.length>20;let touched=0,avatarQueued=0;for(const item of list){try{const contact=applyContactEvent(item);if(contact){touched++;const img=String(item?.imgUrl||'').trim();if(img&&!bulk&&avatarQueued<8){avatarQueued++;scheduleContactAvatar(sock,contact,1600,{force:true})}}}catch(e){pushLog('CONTACT_UPDATE_ERROR',{instanceId,error:e.message})}}if(bulk)pushLog('CONTACT_AVATAR_UPDATE_BULK_DEFERRED',{instanceId,count:list.length});if(touched)save();emit('contacts.updated',{});if(touched)emit('conversation.updated',{contactsUpdated:true})});
  sock.ev.on('lid-mapping.update',mapping=>{try{const lid=mapping?.lid,pn=mapping?.pn;if(!lid||!pn)return;const c=upsertWhatsAppContact({phone:phoneFromJid(pn),whatsappJid:lid,whatsappJidAlt:pn,name:'',nameSource:'fallback'});save();emit('contacts.updated',{contactId:c?.id,lidMapping:true});emit('conversation.updated',{contactId:c?.id,contactsUpdated:true,lidMapping:true});pushLog('LID_MAPPING_UPDATED',{instanceId,lid,pn,contactId:c?.id||null})}catch(e){pushLog('LID_MAPPING_ERROR',{instanceId,error:e.message})}});
  sock.ev.on('messages.update',updates=>{let changed=false;for(const item of updates||[]){const id=item?.key?.id;if(!id)continue;const update=item?.update||{};const editPayload=updateEditPayload(update,item?.key);if(editPayload){const editResult=applyMessageEdit(instanceId,editPayload,'WHATSAPP_UPDATE');if(editResult?.updated)changed=true}const rec=findMessageForInstance(all(),id,instanceId);if(!rec)continue;const st=Number(update?.status);const next=st>=4?'READ':st===3?'DELIVERED':st>=2?'SENT':rec.status;const ackAt=toMillis(update?.messageTimestamp)||Date.now();if(next!==rec.status||((next==='READ'&&!rec.readAt)||(next==='DELIVERED'&&!rec.deliveredAt))){rec.status=next;if(next==='SENT'&&!rec.sentAt)rec.sentAt=ackAt;if(next==='DELIVERED'){if(!rec.sentAt)rec.sentAt=rec.createdAt||ackAt;if(!rec.deliveredAt)rec.deliveredAt=ackAt}if(next==='READ'){if(!rec.sentAt)rec.sentAt=rec.createdAt||ackAt;if(!rec.deliveredAt)rec.deliveredAt=ackAt;if(!rec.readAt)rec.readAt=ackAt}changed=true;pushLog('MESSAGE_STATUS_UPDATED',{conversationId:rec.conversationId,messageId:rec.id,externalId:id,status:next,sentAt:rec.sentAt||null,deliveredAt:rec.deliveredAt||null,readAt:rec.readAt||null});emit('message.status',{conversationId:rec.conversationId,message:rec})}
    // Algumas compilações do WhatsApp/Baileys entregam o contexto da resposta em
    // messages.update depois do messages.upsert inicial. Antes a atualização era
    // usada apenas para ticks de entrega/leitura e essa citação era perdida.
    if(!rec.quoted){
      const candidateMessage=update?.message||update?.editedMessage?.message||update?.editedMessage||update;
      const envelope={key:item.key,message:candidateMessage,pushName:update.pushName||null,participant:update.participant||item?.key?.participant||null,contextInfo:update?.contextInfo||null,messageContextInfo:update?.messageContextInfo||null};
      const isGroup=String(rec.remoteJid||item?.key?.remoteJid||'').endsWith('@g.us');
      const recovered=quotedReference(envelope,{conversationId:rec.conversationId,isGroup});
      if(recovered){rec.quoted=recovered;markMessagesDirty([rec]);changed=true;emit('message.status',{conversationId:rec.conversationId,message:rec});pushLog('QUOTED_MESSAGE_BACKFILLED_UPDATE',{instanceId,externalId:id,messageId:rec.id,quotedExternalId:recovered.externalId||null})}
    }
    if(!rec.file&&['STICKER','IMAGE','VIDEO','AUDIO','DOCUMENT'].includes(rec.type)&&update?.message){
      recoverMissingInboundMedia(baileys,sock,instanceId,rec,{key:item.key,message:update.message,pushName:update.pushName||null},'MESSAGES_UPDATE');
    }
  }if(changed)save()});
  sock.ev.on('message-receipt.update',items=>{let changed=false;for(const item of items||[]){const id=item?.key?.id;if(!id)continue;const rec=findMessageForInstance(all(),id,instanceId,m=>m.direction==='OUT');if(!rec)continue;const receipt=item?.receipt||{};const readAt=toMillis(receipt.readTimestamp||receipt.playedTimestamp);const deliveredAt=toMillis(receipt.receiptTimestamp);if(readAt){rec.status='READ';rec.readAt=rec.readAt||readAt;rec.deliveredAt=rec.deliveredAt||deliveredAt||readAt;rec.sentAt=rec.sentAt||rec.createdAt;changed=true}else if(deliveredAt){if(rec.status!=='READ')rec.status='DELIVERED';rec.deliveredAt=rec.deliveredAt||deliveredAt;rec.sentAt=rec.sentAt||rec.createdAt;changed=true}if(changed){pushLog('MESSAGE_RECEIPT_UPDATED',{conversationId:rec.conversationId,messageId:rec.id,externalId:id,status:rec.status,deliveredAt:rec.deliveredAt||null,readAt:rec.readAt||null});emit('message.status',{conversationId:rec.conversationId,message:rec})}}if(changed)save()});
  sock.ev.on('messages.reaction',items=>{let changed=false;for(const r of items||[]){const id=r?.key?.id;const rec=findMessageForInstance(all(),id,instanceId);if(!rec)continue;const actor=r?.reaction?.key?.participant||r?.key?.participant||r?.key?.remoteJid||'whatsapp',emoji=r?.reaction?.text||'';rec.reactions=(rec.reactions||[]).filter(x=>x.from!==actor);if(emoji)rec.reactions.push({emoji,from:actor,at:Date.now()});changed=true;emit('message.status',{conversationId:rec.conversationId,message:rec})}if(changed)save()});
  sock.ev.on('presence.update',event=>{try{const presences=event?.presences||{};const typing=Object.entries(presences).filter(([,p])=>['composing','recording'].includes(p?.lastKnownPresence)).map(([jid,p])=>({jid,presence:p?.lastKnownPresence||'composing'}));emit('presence.update',{instanceId,jid:event?.id||null,typing:typing.length>0,participants:typing})}catch{}});
  sock.ev.on('messages.upsert',async({messages,type})=>{
    const batch=Array.isArray(messages)?messages:[];
    pushLog('MESSAGES_UPSERT_EVENT',{instanceId,type,count:batch.length,state:conn.state,runtimeConnected:runtimeSocketReady(instanceId)});
    if(!['notify','append'].includes(type))return;
    if(type==='notify')noteWhatsAppActivity(instanceId);
    for(const msg of batch){
      const externalId=msg?.key?.id||null;
      const rawJid=msg?.key?.remoteJid||null;
      const rawAltJid=msg?.key?.remoteJidAlt||null;
      try{
        pushLog('RAW_MESSAGE_RECEIVED',{instanceId,upsertType:type,externalId,remoteJid:rawJid,remoteJidAlt:rawAltJid,fromMe:Boolean(msg?.key?.fromMe),hasMessage:Boolean(msg?.message),timestamp:toMillis(msg?.messageTimestamp)||null});
        if(!msg?.message){
          const stubType=msg?.messageStubType??null,stubParameters=msg?.messageStubParameters||null;
          pushLog('MESSAGE_DECRYPT_PENDING',{instanceId,externalId,remoteJid:rawJid,remoteJidAlt:rawAltJid,stubType,stubParameters,reason:'NO_MESSAGE_YET'});
          // No Baileys 7, falhas Signal/LID podem disparar retry automático e a mesma mensagem
          // reaparece depois já descriptografada. Não criamos mensagem vazia no CRM.
          continue
        }
        if(rawJid==='status@broadcast'){pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'STATUS_BROADCAST'});continue}
        const directEdit=protocolEditPayload(msg);
        if(directEdit){applyMessageEdit(instanceId,directEdit,'WHATSAPP_UPSERT');pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'MESSAGE_EDIT_PROTOCOL'});continue}
        if(isReactionEnvelope(msg)){applyReactionEnvelope(instanceId,msg);continue}
        if(extractType(msg)==='POLL_UPDATE'){await consumePollUpdateEnvelope(baileys,sock,instanceId,msg);pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'POLL_UPDATE_ENVELOPE'});continue}
        if(isProtocolOnly(msg)){pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'PROTOCOL_ONLY'});continue}
        if(type==='append'){
          const ts=toMillis(msg.messageTimestamp);
          // Append também pode carregar mensagens perdidas durante uma reconexão 428.
          // Aceitamos até 60 minutos para recuperar o intervalo sem importar histórico antigo inteiro.
          if(!ts||Date.now()-ts>60*60*1000){pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'APPEND_TOO_OLD',timestamp:ts||null});continue}
        }
        if(externalId){
          const duplicate=findMessageForInstance(all(),externalId,instanceId);
          if(duplicate){
            const duplicateEdit=editEnvelopePayload(msg,msg?.key||null);
            if(duplicateEdit){
              const editResult=applyMessageEdit(instanceId,duplicateEdit,'WHATSAPP_DUPLICATE_UPSERT');
              pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'DUPLICATE_EDIT_APPLIED',updated:Boolean(editResult?.updated),format:duplicateEdit?.format||null});
              continue
            }
            if(!duplicate.quoted){
              const duplicateJid=rawJid||rawAltJid||'';
              const recoveredQuote=quotedReference(msg,{conversationId:duplicate.conversationId,isGroup:String(duplicateJid).endsWith('@g.us')});
              if(recoveredQuote){duplicate.quoted=recoveredQuote;markMessagesDirty([duplicate]);emit('message.status',{conversationId:duplicate.conversationId,message:duplicate});pushLog('QUOTED_MESSAGE_BACKFILLED_DUPLICATE',{instanceId,externalId,messageId:duplicate.id,quotedExternalId:recoveredQuote.externalId||null})}
            }
            const mediaRetry=recoverMissingInboundMedia(baileys,sock,instanceId,duplicate,msg,'DUPLICATE_UPSERT');
            pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'DUPLICATE',mediaRetry});continue
          }
        }
        const jid=rawJid||rawAltJid;
        if(!jid||String(jid).endsWith('@broadcast')){pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'INVALID_JID',remoteJid:rawJid,remoteJidAlt:rawAltJid});continue}
        const isGroup=String(jid).endsWith('@g.us'),isChannel=String(jid).endsWith('@newsletter'),fromMe=Boolean(msg.key?.fromMe);if(fromMe&&msg.pushName)registerConnectionSelfIdentity(instanceId,{profileName:msg.pushName,phone:conn.phone||'',source:'from-me-message'});
        let contact=null,group=null,channel=null,altJid=rawAltJid||null;
        if(isGroup){
          group=getGroupByJid(jid,instanceId);
          if(!group){try{const meta=await withTimeout(sock.groupMetadata(jid),2500,'Metadados do grupo');group=upsertWhatsAppGroup(meta,instanceId)}catch{group=ensureGroupFromJid(jid,instanceId,{subject:'Grupo WhatsApp'})}}
          contact=all().contacts.find(c=>c.id===group?.contactId)||null;if(group&&!contact?.avatar)scheduleGroupAvatar(sock,group,1200);
        }else if(isChannel){
          channel=getChannelByJid(jid,instanceId)||ensureChannelFromJid(jid,instanceId,{name:'Canal WhatsApp'});
          contact=all().contacts.find(c=>c.id===channel?.contactId)||null;
        }else{
          // LID nunca pode bloquear o recebimento. Tentamos resolver por no máximo 1,2 s;
          // se o WhatsApp ainda não forneceu o mapa, salvamos pelo próprio LID e completamos depois.
          if(!altJid&&String(jid).endsWith('@lid')){
            try{altJid=await withTimeout(Promise.resolve(sock?.signalRepository?.lidMapping?.getPNForLID?.(jid)),1200,'Mapeamento LID→telefone')||null;pushLog('LID_MAPPING_RESOLVED_ON_MESSAGE',{instanceId,externalId,lid:jid,pn:altJid||null})}
            catch(e){pushLog('LID_MAPPING_PENDING_ON_MESSAGE',{instanceId,externalId,lid:jid,error:String(e?.message||e)})}
          }
          const phoneJid=[jid,altJid].find(x=>String(x||'').endsWith('@s.whatsapp.net'))||null;
          const phone=phoneJid?phoneFromJid(phoneJid):'';
          contact=upsertWhatsAppContact({phone,whatsappJid:jid,whatsappJidAlt:altJid,name:fromMe?'':(msg.pushName||phone||'Contato WhatsApp'),nameSource:(!fromMe&&msg.pushName)?'profile':'fallback',instanceId,fromMe});
        }
        if(!contact){throw new Error('Contato não pôde ser criado/resolvido')}
        if(!isGroup&&!isChannel&&!contact.avatar)scheduleContactAvatar(sock,contact,4500);
        const body=extractText(msg),msgType=extractType(msg),direction=fromMe?'OUT':'IN';
        if(msgType==='TEXT'&&!body){pushLog('MESSAGE_SKIPPED',{instanceId,externalId,reason:'EMPTY_TEXT',remoteJid:jid});continue}
        let cv,pendingCsat=null;
        if(!isGroup&&!isChannel&&!fromMe)pendingCsat=[...all().conversations].reverse().find(c=>c.contactId===contact.id&&c.status==='CLOSED'&&c.csatRequestedAt&&!c.csat&&Date.now()-c.csatRequestedAt<7*86400000);
        if(pendingCsat&&/^[1-5]$/.test(body.trim())){cv=pendingCsat;cv.csat=Number(body.trim());cv.csatAt=Date.now();save();pushLog('CSAT_RECEIVED',{conversationId:cv.id,rating:cv.csat})}
        else if(isChannel){cv=ensureConversation(contact.id,instanceId,{isGroup:false,isChannel:true,channelId:channel?.id||null,status:'HISTORY',ownerId:null,unread:0,importedHistory:true})}
        else cv=ensureConversation(contact.id,instanceId,isGroup?{isGroup:true,isChannel:false,groupId:group?.id||null}:{isGroup:false,isChannel:false,peerJid:jid,peerJidAlt:altJid||null});if(isGroup&&!cv.ownerId&&cv.status==='WAITING'){cv.status='OPEN';delete cv.queuedAt;save()}
        const special=specialPayload(msg,msgType);
        const initialBody=body||defaultMessageLabel(msgType)||'Mensagem';
        const mediaMeta=msgType!=='TEXT'?{...(special||{}),mediaPending:true,mediaStartedAt:Date.now()}:special;
        const payload={conversationId:cv.id,instanceId,direction,type:msgType,body:initialBody,status:fromMe?'SENT':'DELIVERED',externalId:externalId||uid('wa'),remoteJid:jid,remoteJidAlt:altJid,file:null,meta:mediaMeta,quoted:quotedReference(msg,{conversationId:cv.id,isGroup}),isGroup,isChannel,groupId:group?.id||null,channelId:channel?.id||null,participantJid:isGroup?groupParticipantId(msg):null,senderName:isGroup?groupParticipantName(msg):null,createdAt:toMillis(msg.messageTimestamp)||Date.now()};
        // Ponto crítico da v0.5.20: salva e publica ANTES de baixar mídia ou executar automações.
        if(!fromMe&&!isGroup&&!isChannel)handleInboundConversationState(cv,{source:'WHATSAPP_WEB'});
        const record=isChannel?addHistoricalMessage({...payload,historical:true}):addMessage(payload);
        if(fromMe&&!record.sentAt)record.sentAt=record.createdAt;
        if(isChannel){cv.unread=0;cv.status='HISTORY';cv.archivedAt=cv.updatedAt;delete cv.closedAt;delete cv.closeReason;save()}
        pushLog('MESSAGE_SAVED_IMMEDIATELY',{instanceId,conversationId:cv.id,messageId:record.id,externalId:record.externalId,type:record.type,remoteJid:jid,remoteJidAlt:altJid,isGroup,isChannel,fromMe,contactId:contact.id,hasQuoted:Boolean(record.quoted),quotedExternalId:record.quoted?.externalId||null});
        emit('message.received',{conversationId:cv.id,message:record,isGroup,isChannel});emit('conversation.updated',{conversationId:cv.id,isGroup,isChannel});
        if(isGroup){try{const matricula=processMatriculaMessage(record);if(matricula)emit('matriculas.updated',{matriculaId:matricula.id,status:matricula.status,groupId:matricula.groupId})}catch(e){pushLog('MATRICULA_PROCESSING_ERROR',{instanceId,messageId:record.id,error:String(e?.message||e)})}}

        if(msgType!=='TEXT'){
          Promise.resolve().then(async()=>{
            const file=await saveInboundMedia(baileys,sock,msg,msgType);
            if(file){record.file=file;record.meta={...(record.meta||{}),mediaPending:false,mediaReadyAt:Date.now()};delete record.meta.mediaError;if(!body)record.body=file.name||record.body;markMessagesDirty([record]);emit('message.status',{conversationId:cv.id,message:record});emit('conversation.updated',{conversationId:cv.id,mediaReady:true});pushLog('MESSAGE_MEDIA_READY',{instanceId,conversationId:cv.id,messageId:record.id,externalId:record.externalId,type:msgType,isAnimated:Boolean(file.isAnimated),thumbnailOnly:Boolean(file.thumbnailOnly)})}
            else if(msgType==='STICKER'){record.meta={...(record.meta||{}),mediaPending:true};delete record.meta.mediaError;markMessagesDirty([record]);save();emit('message.status',{conversationId:cv.id,message:record});pushLog('MESSAGE_MEDIA_RETRY_SCHEDULED',{instanceId,conversationId:cv.id,messageId:record.id,externalId:record.externalId,type:msgType});scheduleStickerRecovery(baileys,sock,instanceId,record,msg);}
            else {record.meta={...(record.meta||{}),mediaPending:false,mediaError:'Mídia indisponível'};markMessagesDirty([record]);save();emit('message.status',{conversationId:cv.id,message:record});pushLog('MESSAGE_MEDIA_UNAVAILABLE',{instanceId,conversationId:cv.id,messageId:record.id,externalId:record.externalId,type:msgType});}
          }).catch(e=>pushLog('MESSAGE_MEDIA_ASYNC_ERROR',{instanceId,conversationId:cv.id,messageId:record.id,externalId:record.externalId,type:msgType,error:String(e?.message||e)}));
        }
        if(!fromMe&&!isGroup&&!isChannel&&!(pendingCsat&&/^[1-5]$/.test(body.trim()))){
          Promise.resolve().then(async()=>{
            const replyJid=await resolveReplyDestination(sock,msg,contact),interaction=interactionSelection(msg);pushLog('AUTOMATION_REPLY_DESTINATION',{instanceId,conversationId:cv.id,incomingJid:jid,incomingAltJid:altJid||null,replyJid});
            await processIncoming({contact,conversation:cv,text:body,interaction,sendReply:async text=>{noteWhatsAppActivity(instanceId);return sock.sendMessage(replyJid,{text})},sendChoice:async config=>{noteWhatsAppActivity(instanceId);return sendChoiceOnSocket(sock,replyJid,config,baileys,conn)}});
            emit('conversation.updated',{conversationId:cv.id,triageStatus:cv.triageStatus||null,departmentId:cv.departmentId||null});
          }).catch(e=>pushLog('AUTOMATION_ASYNC_ERROR',{instanceId,conversationId:cv.id,error:String(e?.message||e)}));
        }
        if(isChannel)refreshChannelMetadata(sock,jid,instanceId).then(updated=>{if(updated)emit('conversation.updated',{conversationId:cv.id,isChannel:true,metadata:true})}).catch(()=>{});
      }catch(e){
        pushLog('MESSAGE_PROCESSING_ERROR',{instanceId,upsertType:type,externalId,remoteJid:rawJid,remoteJidAlt:rawAltJid,error:String(e?.message||e),stack:String(e?.stack||'').slice(0,2000)});
        console.error('[Balbino Chat] Falha isolada ao processar mensagem:',externalId||'(sem id)',e?.message||e);
      }
    }
  });
  sock.ev.on('messages.update',async updates=>{
    for(const item of updates||[]){
      try{
        const key=item?.key,update=item?.update||{};if(!key?.id||!Array.isArray(update.pollUpdates)||!update.pollUpdates.length)continue;
        const rec=findMessageForInstance(all(),key.id,instanceId,m=>m.type==='POLL');if(!rec){pushLog('POLL_UPDATE_SKIPPED',{instanceId,pollId:key.id,reason:'POLL_NOT_FOUND_IN_UPDATE'});continue}
        if(applyDecodedPollUpdates(baileys,sock,instanceId,rec,update.pollUpdates))continue;
        let results=[];
        try{
          if(typeof baileys.getAggregateVotesInPollMessage==='function'){
            const meta=rec.meta||{},secret=meta.messageSecret?Buffer.from(String(meta.messageSecret),'base64'):null;
            const original={...(secret?{messageContextInfo:{messageSecret:secret}}:{}),pollCreationMessageV3:{name:String(meta.name||rec.body||'Enquete'),options:(meta.options||[]).map(optionName=>({optionName:String(optionName)})),selectableOptionsCount:Number(meta.selectableCount||1)}};
            results=baileys.getAggregateVotesInPollMessage({message:original,pollUpdates:update.pollUpdates})||[];
          }
        }catch(e){pushLog('POLL_AGGREGATE_ERROR',{instanceId,messageId:rec.id,error:String(e?.message||e)})}
        if(results.length){
          const previous={...(rec.meta?.pollResults||[]).reduce((a,r)=>{a[r.name]={name:r.name,voters:[...(r.voters||[])],count:Number(r.count||0)};return a},{})};
          for(const r of results){const row=previous[r.name]||{name:r.name||'',voters:[],count:0};for(const v of Array.isArray(r.voters)?r.voters:[])if(!row.voters.includes(v))row.voters.push(v);row.count=row.voters.length||Number(r.count||0);previous[r.name]=row}
          rec.meta={...(rec.meta||{}),pollResults:Object.values(previous),pollUpdatedAt:Date.now()};markMessagesDirty([rec]);save();emit('message.status',{conversationId:rec.conversationId,message:rec});emit('conversation.updated',{conversationId:rec.conversationId,pollUpdated:true});
        }
      }catch(e){pushLog('POLL_UPDATE_ERROR',{instanceId,error:String(e?.message||e)})}
    }
  });
  return sock;
}

function flowTextFallback(config){
  const title=String(config?.title||'Escolha uma opção:').trim();
  const options=(config?.options||[]).map(o=>String(o?.label||'').trim()).filter(Boolean);
  return `${title}\n\n${options.map((label,i)=>`${i+1}. ${label}`).join('\n')}`.trim();
}
function capabilityState(conn){
  conn.interactiveCapabilities={quickReply:'UNKNOWN',singleSelect:'UNKNOWN',lastTestAt:null,...(conn.interactiveCapabilities||{})};
  return conn.interactiveCapabilities;
}
function setCapability(conn,key,status,error=null){
  const caps=capabilityState(conn);caps[key]=status;caps.lastTestAt=Date.now();if(error)caps[`${key}Error`]=String(error).slice(0,240);else delete caps[`${key}Error`];save();emit('connection.update',conn);
}
async function sendLegacyList(sock,jid,config){
  const options=(config?.options||[]).filter(o=>o?.id&&o?.label);
  if(!options.length)throw new Error('Etapa de lista sem opções');
  const rows=options.map(o=>({
    title:String(o.label||'').trim().slice(0,72),
    description:String(o.description||'').trim().slice(0,72),
    rowId:String(o.id)
  }));
  const content={
    text:String(config?.title||'Escolha uma opção:').trim().slice(0,1024),
    footer:String(config?.footer||'Balbino Chat').trim().slice(0,60),
    buttonText:String(config?.listButtonText||`VER OPÇÕES (${rows.length})`).trim().slice(0,24),
    sections:[{title:String(config?.listSectionTitle||'Opções disponíveis').trim().slice(0,60),rows}]
  };
  const result=await sock.sendMessage(jid,content);
  pushLog('WHATSAPP_LEGACY_LIST_SENT',{jid,messageId:result?.key?.id||null,count:rows.length});
  return result;
}

async function relayInteractive(sock,jid,config,mode,baileys){
  const {generateWAMessageFromContent,proto}=baileys||{};
  if(typeof generateWAMessageFromContent!=='function'||!proto?.Message?.InteractiveMessage)throw new Error('Esta versão do conector não expõe Native Flow interativo');
  const options=(config.options||[]).filter(o=>o?.id&&o?.label);
  if(!options.length)throw new Error('Etapa interativa sem opções');
  const buttons=mode==='BUTTONS'
    ?options.slice(0,3).map(o=>({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:o.label,id:o.id})}))
    :[{name:'single_select',buttonParamsJson:JSON.stringify({title:config.listButtonText||`VER OPÇÕES (${options.length})`,sections:[{title:config.listSectionTitle||'Opções disponíveis',rows:options.map(o=>({title:o.label,description:o.description||'',id:o.id}))}]})}];
  const payload={header:{title:String(config.header||'').slice(0,60),hasMediaAttachment:false},body:{text:String(config.title||'Escolha uma opção:').slice(0,1024)},footer:{text:String(config.footer||'Balbino Chat').slice(0,60)},nativeFlowMessage:{buttons,messageParamsJson:''}};
  const factory=proto.Message.InteractiveMessage.fromObject||proto.Message.InteractiveMessage.create;
  const interactiveMessage=factory.call(proto.Message.InteractiveMessage,payload);
  const content={viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},interactiveMessage}}};
  const userJid=sock.authState?.creds?.me?.id||sock.user?.id;
  const generated=await generateWAMessageFromContent(jid,content,{userJid});
  // WhiskeySockets 6.x gera o protobuf do Native Flow, mas nao injeta sozinho
  // os nós binários que o WhatsApp exige para renderizar botões/listas.
  // Sem estes nós, relayMessage pode resolver normalmente e a mensagem aparecer
  // localmente no Balbino Chat, enquanto o destinatário não recebe nada.
  const additionalNodes=[
    {tag:'biz',attrs:{},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]},
    {tag:'bot',attrs:{biz_bot:'1'}}
  ];
  await sock.relayMessage(jid,generated.message,{messageId:generated.key.id,additionalNodes});
  pushLog('WHATSAPP_INTERACTIVE_RELAYED',{jid,messageId:generated?.key?.id||null,mode,nodes:['biz/interactive/native_flow','bot']});
  return generated;
}
async function sendChoiceOnSocket(sock,jid,config,baileys,conn){
  const requested=String(config?.interaction||'AUTO').toUpperCase(),fallback=String(config?.fallback||'TEXT_LABELS').toUpperCase(),count=(config?.options||[]).length,caps=capabilityState(conn);
  const text=flowTextFallback(config);
  if(requested==='TEXT')return{result:await sock.sendMessage(jid,{text}),modeUsed:'TEXT',displayText:text};
  // Quick Reply do WhatsApp comporta no máximo 3 opções visíveis de forma confiável.
  // Nunca truncamos uma etapa: se houver 4+ opções, inclusive quando o administrador
  // escolheu "Botões rápidos", o Balbino Chat promove automaticamente para Lista.
  const effectiveRequested=(requested==='BUTTONS'&&count>3)?'LIST':requested;
  if(effectiveRequested!==requested)pushLog('WHATSAPP_INTERACTIVE_BUTTON_OVERFLOW_TO_LIST',{instanceId:conn.id,jid,nodeId:config.nodeId||null,count});
  const preferred=effectiveRequested==='AUTO'?(count<=3?'BUTTONS':'LIST'):effectiveRequested;
  const attempts=[];
  if(preferred==='BUTTONS'&&count<=3&&caps.quickReply!=='ERROR')attempts.push('BUTTONS');
  if(preferred==='LIST'&&caps.singleSelect!=='ERROR')attempts.push('LIST');
  if(effectiveRequested==='AUTO'){
    if(!attempts.includes('BUTTONS')&&count<=3&&caps.quickReply!=='ERROR')attempts.push('BUTTONS');
    if(!attempts.includes('LIST')&&caps.singleSelect!=='ERROR')attempts.push('LIST');
  }
  for(const mode of attempts){
    try{
      let result;
      if(mode==='LIST'){
        // Listas interativas com 4+ opções podem receber ACK e não renderizar
        // no aplicativo do WhatsApp. Para não deixar o contato sem opções,
        // usamos texto numerado de forma determinística.
        result=await sock.sendMessage(jid,{text});
        pushLog('WHATSAPP_NUMBERED_LIST_SENT',{instanceId:conn.id,jid,nodeId:config.nodeId||null,messageId:result?.key?.id||null,count});
        return{result,modeUsed:'TEXT',displayText:text};
      }else{
        result=await relayInteractive(sock,jid,config,mode,baileys);
      }
      setCapability(conn,'quickReply','SENT');
      pushLog('WHATSAPP_INTERACTIVE_SENT',{instanceId:conn.id,jid,mode,nodeId:config.nodeId||null,messageId:result?.key?.id||null});
      return{result,modeUsed:mode,displayText:text};
    }catch(e){
      setCapability(conn,mode==='BUTTONS'?'quickReply':'singleSelect','ERROR',e.message);
      pushLog('WHATSAPP_INTERACTIVE_FAILED',{instanceId:conn.id,jid,mode,nodeId:config.nodeId||null,error:e.message});
    }
  }
  if(fallback==='HUMAN_QUEUE'){
    const humanText='Não foi possível abrir as opções interativas neste momento. Seu atendimento foi encaminhado para a fila para que um atendente continue.';
    const result=await sock.sendMessage(jid,{text:humanText});return{result,modeUsed:'TEXT',displayText:humanText,requiresHuman:true};
  }
  const result=await sock.sendMessage(jid,{text});pushLog('WHATSAPP_INTERACTIVE_TEXT_FALLBACK',{instanceId:conn.id,jid,nodeId:config.nodeId||null});return{result,modeUsed:'TEXT',displayText:text};
}
export async function testInteractiveCapabilities(instanceId='principal'){
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');const sock=await readySocket(instanceId,{waitMs:1200});
  const jid=await resolveDestination(sock,sock.user?.id||conn.phone);const baileys=await import('@whiskeysockets/baileys');const results={quickReply:'ERROR',singleSelect:'ERROR'};
  const base={title:'Teste de recursos do Balbino Chat',footer:'Balbino Chat',options:[{id:'teste_sim',label:'BOTÃO DE TESTE'},{id:'teste_nao',label:'SEGUNDA OPÇÃO'}]};
  try{const r=await relayInteractive(sock,jid,base,'BUTTONS',baileys);results.quickReply='SENT';setCapability(conn,'quickReply','SENT');pushLog('INTERACTIVE_CAPABILITY_TEST',{instanceId,mode:'BUTTONS',messageId:r?.key?.id||null,status:'SENT'})}catch(e){results.quickReply='ERROR';results.quickReplyError=e.message;setCapability(conn,'quickReply','ERROR',e.message)}
  try{const r=await relayInteractive(sock,jid,{...base,options:[...base.options,{id:'teste_3',label:'TERCEIRA OPÇÃO'},{id:'teste_4',label:'QUARTA OPÇÃO'}]},'LIST',baileys);results.singleSelect='SENT';setCapability(conn,'singleSelect','SENT');pushLog('INTERACTIVE_CAPABILITY_TEST',{instanceId,mode:'LIST',messageId:r?.key?.id||null,status:'SENT'})}catch(e){results.singleSelect='ERROR';results.singleSelectError=e.message;setCapability(conn,'singleSelect','ERROR',e.message)}
  conn.interactiveCapabilities={...capabilityState(conn),...results,lastTestAt:Date.now()};save();emit('connection.update',conn);return conn.interactiveCapabilities;
}

export async function disconnectInstance(instanceId='principal',logout=false){const sock=sockets.get(instanceId),conn=all().connections.find(c=>c.id===instanceId);openSockets.delete(instanceId);if(sock){try{if(logout)await sock.logout();else sock.end?.(new Error('Disconnected by Balbino Chat'))}catch{}sockets.delete(instanceId)}if(conn){conn.state='DISCONNECTED';conn.qr=null;conn.lastEventAt=Date.now();save();emit('connection.update',conn)}pushLog('CONNECTION_DISCONNECTED',{instanceId,logout})}

export async function deleteInstance(instanceId='principal'){
  const db=all(),conn=db.connections.find(c=>c.id===instanceId);
  if(!conn)throw new Error('Instância não encontrada');
  const snapshot={id:conn.id,name:conn.name,phone:conn.phone||'',state:conn.state};
  // Tenta desvincular o dispositivo quando a sessão está ativa. A remoção local
  // continua mesmo se o WhatsApp já estiver offline/expirado.
  try{await disconnectInstance(instanceId,true)}catch{}
  sockets.delete(instanceId);syncRuntime.delete(instanceId);
  try{fs.rmSync(path.join(sessionsDir,instanceId),{recursive:true,force:true})}
  catch(e){pushLog('CONNECTION_SESSION_DELETE_ERROR',{instanceId,error:e.message});throw new Error('Não foi possível remover os arquivos da sessão desta conexão')}
  db.connections=db.connections.filter(c=>c.id!==instanceId);
  save();emit('connection.deleted',{instanceId,name:snapshot.name,phone:snapshot.phone});
  pushLog('CONNECTION_REMOVED',{instanceId,name:snapshot.name,phone:snapshot.phone});
  return snapshot;
}
export async function sendText(instanceId,destination,text,options={}){const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);const jid=await resolveDestination(sock,destination);let quoted;if(options.quoted?.externalId){const key={remoteJid:jid,id:options.quoted.externalId,fromMe:options.quoted.direction==='OUT'};if(String(jid).endsWith('@g.us')&&options.quoted.participantJid)key.participant=options.quoted.participantJid;quoted={key,message:{conversation:options.quoted.body||defaultMessageLabel(options.quoted.type)||'Mensagem'}}}const result=await sock.sendMessage(jid,{text},quoted?{quoted}:undefined);pushLog('WHATSAPP_SEND_TEXT',{instanceId,jid,messageId:result?.key?.id||null,quotedId:options.quoted?.externalId||null});return result}
export async function sendChannelUpdate(instanceId,channelJid,{text='',media=null,mimetype='image/png',fileName='arte.png'}={}){
  const jid=String(channelJid||'').trim();if(!jid.endsWith('@newsletter'))throw new Error('Canal WhatsApp inválido.');
  const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);
  if(media){const data=Buffer.isBuffer(media)?media:Buffer.from(media);if(!data.length)throw new Error('A arte está vazia.');if(data.length>20*1024*1024)throw new Error('A arte excede o limite de 20 MB.');
    let result;if(String(mimetype).startsWith('image/'))result=await sock.sendMessage(jid,{image:data,mimetype,caption:String(text||'').slice(0,4096)});else if(String(mimetype).startsWith('video/'))result=await sock.sendMessage(jid,{video:data,mimetype,caption:String(text||'').slice(0,4096)});else result=await sock.sendMessage(jid,{document:data,mimetype,fileName:String(fileName||'arquivo').slice(0,120),caption:String(text||'').slice(0,4096)});
    pushLog('WHATSAPP_CHANNEL_PUBLISHED',{instanceId,jid,type:mimetype.startsWith('image/')?'IMAGE':mimetype.startsWith('video/')?'VIDEO':'DOCUMENT',messageId:result?.key?.id||null,bytes:data.length});return result;
  }
  const body=String(text||'').trim();if(!body)throw new Error('Informe o texto da atualização.');const result=await sock.sendMessage(jid,{text:body.slice(0,4096)});pushLog('WHATSAPP_CHANNEL_PUBLISHED',{instanceId,jid,type:'TEXT',messageId:result?.key?.id||null});return result;
}
export async function checkWhatsAppNumber(instanceId,phone){
  const sock=await readySocket(instanceId),digits=String(phone||'').replace(/\D/g,'');
  if(!/^55\d{10,11}$/.test(digits))throw new Error('Telefone inválido para consulta no WhatsApp');
  if(typeof sock.onWhatsApp!=='function')throw new Error('Esta conexão não permite verificar se o número possui WhatsApp');
  const result=await sock.onWhatsApp(digits);
  return Array.isArray(result)&&result.some(x=>x?.exists===true);
}
export async function editText(instanceId,destination,message,text){const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);const jid=await resolveDestination(sock,destination);if(!message?.externalId)throw new Error('Mensagem ainda não possui ID do WhatsApp');const key={remoteJid:jid,id:message.externalId,fromMe:true};if(String(jid).endsWith('@g.us')&&message.participantJid)key.participant=message.participantJid;const result=await sock.sendMessage(jid,{text:String(text||''),edit:key});pushLog('WHATSAPP_EDIT_TEXT',{instanceId,jid,messageId:message.id||null,externalId:message.externalId,resultId:result?.key?.id||null});return result}
export async function sendPoll(instanceId,destination,name,values=[],selectableCount=1){const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);const jid=await resolveDestination(sock,destination),clean=[...new Set((values||[]).map(v=>String(v||'').trim()).filter(Boolean))].slice(0,12);if(clean.length<2)throw new Error('A enquete precisa ter pelo menos duas opções');const count=Math.max(1,Math.min(clean.length,Number(selectableCount)||1));const result=await sock.sendMessage(jid,{poll:{name:String(name||'').trim(),values:clean,selectableCount:count}});pushLog('WHATSAPP_SEND_POLL',{instanceId,jid,messageId:result?.key?.id||null,options:clean.length,selectableCount:count});return result}
export async function sendContact(instanceId,destination,contact={}){const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);const jid=await resolveDestination(sock,destination);const displayName=String(contact.displayName||contact.name||contact.phone||'Contato').trim();const phone=String(contact.phone||'').replace(/\D/g,'');if(!phone)throw new Error('Contato sem telefone');const waid=phone;const safeName=displayName.replace(/[\r\n]+/g,' ').replace(/;/g,'\\;').replace(/,/g,'\\,');const vcard=`BEGIN:VCARD\nVERSION:3.0\nN:;${safeName};;;;\nFN:${safeName}\nTEL;type=CELL;type=VOICE;waid=${waid}:+${phone}\nEND:VCARD`;const payload={contacts:{displayName,contacts:[{vcard}]}};const result=await sock.sendMessage(jid,payload);pushLog('WHATSAPP_SEND_CONTACT',{instanceId,jid,messageId:result?.key?.id||null,contactPhone:phone});return{...result,__contactMeta:{displayName,phone,vcard}}}
export async function sendMedia(instanceId,destination,filePath,mimetype,originalname,caption='',ptt=false){const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);const jid=await resolveDestination(sock,destination),data=fs.readFileSync(filePath);let r;if(mimetype.startsWith('image/'))r=await sock.sendMessage(jid,{image:data,caption});else if(mimetype.startsWith('video/'))r=await sock.sendMessage(jid,{video:data,caption});else if(mimetype.startsWith('audio/'))r=await sock.sendMessage(jid,{audio:data,mimetype,ptt});else r=await sock.sendMessage(jid,{document:data,mimetype,fileName:originalname,caption});pushLog('WHATSAPP_SEND_MEDIA',{instanceId,jid,messageId:r?.key?.id||null,mimetype});return r}
export async function sendReaction(instanceId,destination,message,emoji){const sock=await readySocket(instanceId);noteWhatsAppActivity(instanceId);const jid=await resolveDestination(sock,destination);if(!message?.externalId)throw new Error('Mensagem ainda não possui ID do WhatsApp');return sock.sendMessage(jid,{react:{text:emoji,key:{remoteJid:jid,id:message.externalId,fromMe:message.direction==='OUT'}}})}
export async function markRead(instanceId,messages=[]){const sock=sockets.get(instanceId);if(!sock)return;const keys=messages.filter(m=>m.externalId&&m.remoteJid).map(m=>({remoteJid:m.remoteJid,id:m.externalId,fromMe:false}));if(keys.length)try{await sock.readMessages(keys)}catch{}}
export async function setTyping(instanceId,destination,on=true){let sock;try{sock=await readySocket(instanceId,{waitMs:800})}catch{return}try{const jid=await resolveDestination(sock,destination);await sock.sendPresenceUpdate(on?'composing':'paused',jid)}catch{}}

export async function requestWhatsAppSync(instanceId='principal',mode='ALL'){
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');
  const normalized=['CONTACTS','HISTORY','ALL'].includes(String(mode).toUpperCase())?String(mode).toUpperCase():'ALL';
  if(conn.syncRequested&&['STARTING','WAITING_PHONE','RECEIVING','RETRYING'].includes(conn.sync?.status))throw new Error('Já existe uma sincronização em andamento. Aguarde ou cancele antes de iniciar outra.');
  updateSyncState(conn,{mode:normalized,status:'STARTING',contacts:0,conversations:0,messages:0,duplicates:0,chunks:0,progress:0,seenContactIds:[],seenConversationIds:[],error:null,note:'Preparando sincronização em segundo plano...',startedAt:Date.now(),completedAt:null});
  conn.syncRequested=true;syncRuntime.delete(instanceId);save();
  const current=sockets.get(instanceId);
  if(current){
    // Não fazemos dezenas de fetchMessageHistory em série aqui: isso bloqueava o servidor.
    // Reabrimos apenas uma vez com syncFullHistory e deixamos o WhatsApp enviar os lotes disponíveis.
    sockets.delete(instanceId);try{current.end?.(new Error('Balbino Chat: history sync requested'))}catch{}
  }
  conn.state='RECONNECTING';save();emit('connection.update',conn);
  setTimeout(()=>connectInstance(instanceId).catch(e=>{conn.state='ERROR';updateSyncState(conn,{status:'ERROR',error:e.message,note:'Falha ao iniciar sincronização.'})}),700);
  return conn.sync;
}
export async function cancelWhatsAppSync(instanceId='principal'){
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');
  conn.syncRequested=false;conn.sync428Attempts=0;syncRuntime.delete(instanceId);
  updateSyncState(conn,{status:'CANCELLED',completedAt:Date.now(),error:null,note:'Sincronização cancelada pelo usuário. Restaurando a conexão normal...'});
  const current=sockets.get(instanceId);
  if(current){openSockets.delete(instanceId);sockets.delete(instanceId);try{current.end?.(new Error('Balbino Chat: sync cancelled'))}catch{}}
  conn.state='RECONNECTING';save();emit('connection.update',conn);
  setTimeout(()=>connectInstance(instanceId).catch(e=>{conn.state='ERROR';conn.lastError={status:null,message:e.message,at:Date.now()};save();emit('connection.update',conn)}),700);
  pushLog('WHATSAPP_SYNC_CANCELLED',{instanceId});
  return conn.sync;
}
export function getWhatsAppSyncState(instanceId='principal'){const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');return conn.sync||{mode:null,status:'IDLE',contacts:0,conversations:0,messages:0,duplicates:0,chunks:0,progress:0}}

export async function syncWhatsAppContactPhotos(instanceId='principal',{force=false,background=false}={}){
  const sock=await readySocket(instanceId,{waitMs:1200});
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');
  const existing=avatarSyncRuntime.get(instanceId);
  if(existing&&!existing.finished)return conn.avatarSync||existing.state;
  const db=all();
  const conversations=db.conversations.filter(c=>c.instanceId===instanceId&&!c.isGroup&&!c.isChannel);
  const activity=new Map();for(const c of conversations){activity.set(c.contactId,Math.max(Number(activity.get(c.contactId)||0),Number(c.lastMessageAt||c.updatedAt||c.createdAt||0)))}
  const contactIds=new Set(conversations.map(c=>c.contactId));
  let contacts=db.contacts.filter(c=>!c.isGroup&&!c.isChannel&&(contactIds.has(c.id)||c.whatsappJid||c.whatsappJidAlt||c.phone));
  contacts=contacts.filter(c=>c.source==='WhatsApp'||c.whatsappJid||c.whatsappJidAlt||contactIds.has(c.id));
  contacts.sort((a,b)=>{const aa=Number(activity.get(a.id)||0),bb=Number(activity.get(b.id)||0);const ap=a.avatar?1:0,bp=b.avatar?1:0;if(ap!==bp)return ap-bp;return bb-aa});
  const state={status:'RUNNING',total:contacts.length,processed:0,updated:0,noPhoto:0,skipped:0,errors:0,startedAt:Date.now(),completedAt:null,lastProgressAt:Date.now(),currentContact:null,note:'Modo seguro: atendimento e mensagens têm prioridade sobre a sincronização de fotos.'};
  const runtime={state,cancelRequested:false,finished:false};avatarSyncRuntime.set(instanceId,runtime);
  conn.avatarSync=state;save();emit('connection.avatar-sync',{instanceId,avatarSync:{...state}});pushLog('CONTACT_AVATAR_SYNC_STARTED',{instanceId,total:contacts.length,background,force,mode:'SAFE'});
  let consecutiveErrors=0,lastPersistAt=Date.now(),lastUiAt=Date.now(),updatedSinceUi=0;
  try{
    for(const contact of contacts){
      if(runtime.cancelRequested){if(state.status!=='INTERRUPTED')state.status='CANCELLED';state.note=state.status==='INTERRUPTED'?state.note:'Sincronização pausada. Clique em Sincronizar fotos para retomar.';break}
      if(sockets.get(instanceId)!==sock||conn.state!=='CONNECTED'){state.status='INTERRUPTED';state.note='Sincronização pausada automaticamente porque o WhatsApp não está estável. O atendimento foi priorizado.';break}
      const lastTraffic=Number(whatsappActivityAt.get(instanceId)||0),quietFor=Date.now()-lastTraffic;
      if(lastTraffic&&quietFor<4500){state.note='Mensagens em andamento: aguardando alguns segundos antes de consultar a próxima foto.';emit('connection.avatar-sync',{instanceId,avatarSync:{...state}});await sleep(Math.max(600,4500-quietFor));if(runtime.cancelRequested)continue}
      state.currentContact=contact.name||contact.phone||contact.id;state.lastProgressAt=Date.now();
      let r;
      try{r=await withTimeout(cacheContactAvatar(sock,contact,{force}),12000,'Sincronização deste contato')}
      catch(e){contact.avatarErrorAt=Date.now();contact.avatarLastError=String(e?.message||e);r={status:'ERROR',error:contact.avatarLastError};pushLog('CONTACT_AVATAR_ITEM_TIMEOUT',{instanceId,contactId:contact.id,error:contact.avatarLastError})}
      state.processed++;state.lastProgressAt=Date.now();
      if(r.status==='UPDATED'){state.updated++;updatedSinceUi++;consecutiveErrors=0}
      else if(r.status==='NO_PHOTO'){state.noPhoto++;consecutiveErrors=0}
      else if(r.status==='ERROR'){state.errors++;consecutiveErrors++}
      else {state.skipped++;consecutiveErrors=Math.max(0,consecutiveErrors-1)}
      const now=Date.now();
      // Persistência e eventos são deliberadamente espaçados: serializar milhares de contatos
      // a cada poucos itens fazia o SSE cair e atrasava mensagens recebidas.
      if(state.processed%25===0||now-lastUiAt>=6000){lastUiAt=now;emit('connection.avatar-sync',{instanceId,avatarSync:{...state}})}
      if(state.processed%75===0||now-lastPersistAt>=20000){lastPersistAt=now;save()}
      if(updatedSinceUi>=25){updatedSinceUi=0;emit('contacts.updated',{avatarSync:true,incremental:true})}
      if(consecutiveErrors>=6){state.note='Muitos erros seguidos: pausa de segurança por 20 segundos. As mensagens continuam funcionando normalmente.';emit('connection.avatar-sync',{instanceId,avatarSync:{...state}});await sleep(20000);consecutiveErrors=0;state.note='Sincronização retomada em modo seguro.'}
      else if(r.status==='ERROR')await sleep(1800);
      else if(r.status==='SKIPPED')await yieldToEventLoop();
      else await sleep(750);
      if(state.processed>0&&state.processed%30===0)await sleep(2500);
      await yieldToEventLoop();
    }
    if(state.status==='RUNNING'){state.status='COMPLETED';state.note='Sincronização concluída.'}
  }catch(e){state.status='ERROR';state.error=String(e?.message||e);state.note='A sincronização foi interrompida por um erro. O atendimento continua ativo e o progresso foi preservado.';pushLog('CONTACT_AVATAR_SYNC_FATAL',{instanceId,error:state.error})}
  finally{
    state.currentContact=null;state.completedAt=Date.now();state.lastProgressAt=Date.now();runtime.finished=true;conn.avatarSync={...state};avatarSyncRuntime.delete(instanceId);save();emit('connection.avatar-sync',{instanceId,avatarSync:conn.avatarSync});emit('contacts.updated',{avatarSync:true});emit('conversation.updated',{avatarSync:true});pushLog('CONTACT_AVATAR_SYNC_FINISHED',{instanceId,...state});
  }
  return conn.avatarSync;
}
export function cancelWhatsAppContactPhotoSync(instanceId='principal'){
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');
  const runtime=avatarSyncRuntime.get(instanceId);
  if(runtime&&!runtime.finished){runtime.cancelRequested=true;runtime.state.status='CANCEL_REQUESTED';runtime.state.note='Pausando após o contato atual...';conn.avatarSync={...runtime.state};save();emit('connection.avatar-sync',{instanceId,avatarSync:conn.avatarSync});return conn.avatarSync}
  if(conn.avatarSync?.status==='RUNNING'||conn.avatarSync?.status==='CANCEL_REQUESTED'){conn.avatarSync={...conn.avatarSync,status:'INTERRUPTED',note:'A sincronização anterior não está mais em execução. Clique em Sincronizar fotos para retomar.'};save()}
  return conn.avatarSync||{status:'IDLE',total:0,processed:0,updated:0,noPhoto:0,skipped:0,errors:0};
}
export function getWhatsAppContactPhotoSyncState(instanceId='principal'){
  const conn=all().connections.find(c=>c.id===instanceId);if(!conn)throw new Error('Instância não encontrada');
  const runtime=avatarSyncRuntime.get(instanceId);
  if(!runtime&&(conn.avatarSync?.status==='RUNNING'||conn.avatarSync?.status==='CANCEL_REQUESTED')){conn.avatarSync={...conn.avatarSync,status:'INTERRUPTED',note:'A sincronização foi interrompida. Clique em Sincronizar fotos para retomar sem refazer contatos recentes.',currentContact:null};save()}
  return conn.avatarSync||{status:'IDLE',total:0,processed:0,updated:0,noPhoto:0,skipped:0,errors:0}
}

export async function syncWhatsAppGroups(instanceId='principal'){const sock=await readySocket(instanceId,{waitMs:1200});return refreshGroupsFromSocket(sock,instanceId,{force:true})}
export async function syncWhatsAppChannels(instanceId='principal'){const sock=await readySocket(instanceId,{waitMs:1200});return refreshKnownChannels(sock,instanceId)}
export async function refreshWhatsAppChannel(instanceId='principal',jid=''){const sock=await readySocket(instanceId,{waitMs:1200});return refreshChannelMetadata(sock,jid,instanceId,{force:true})}
export function getRuntimeConnectionState(instanceId='principal'){const conn=all().connections.find(c=>c.id===instanceId);return{instanceId,state:conn?.state||'DISCONNECTED',runtimeConnected:runtimeSocketReady(instanceId)}}
export function getSocket(instanceId){return sockets.get(instanceId)}
