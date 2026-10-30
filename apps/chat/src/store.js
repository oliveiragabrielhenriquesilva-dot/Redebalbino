import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './runtime-paths.js';

const base=dataDir;
const legacyFile=path.join(base,'store.json');
const sqliteFile=path.join(base,'balbino-chat.sqlite');
fs.mkdirSync(base,{recursive:true});

const now=Date.now();
const seed={
  version:'0.14.0',
  settings:{
    businessHours:{start:'08:00',end:'18:00'},
    welcomeMessage:'Olá! Recebemos sua mensagem. Em instantes nossa equipe dará continuidade ao atendimento por aqui.',
    awayMessage:'Olá! Nosso atendimento está encerrado no momento. Sua mensagem foi recebida e retornaremos no próximo período de atendimento.',
    csatMessage:'Antes de encerrar: como você avalia nosso atendimento de 1 a 5?',
    farewellMessage:'Agradecemos o contato! Este atendimento foi finalizado. Se precisar de algo mais, é só nos chamar novamente.',
    requireCloseReason:false,
    lockConversation:true,
    autoAssign:true,
    sharedQueueFirstContact:true,
    queueRoutingEnabled:true,
    queueRoutingMode:'FLOW',
    queueInteractivePreference:'AUTO',
    queueInteractiveFallback:'TEXT_LABELS',
    queueRoutingFooter:'Balbino Chat',
    queueRoutingGreeting:'Olá! Para direcionarmos seu atendimento, escolha uma opção:',
    queueRoutingConfirmation:'Perfeito! Seu atendimento foi direcionado para {setor}. Aguarde um atendente.',
    queueRoutingInvalid:'Não consegui identificar sua escolha. Selecione uma das opções disponíveis:',
    queueAutoAssignAfterRouting:false,
    queueSlaWarningMinutes:15,
    queueSlaCriticalMinutes:30,
    maxConcurrentConversations:0,
    reopenWindowHours:8,
    queueStudentRoutingVersion:1,
    queueFlowStartNodeId:'triagem_aluno',
    queueFlowNodes:[
      {id:'triagem_aluno',title:'Olá! Para direcionarmos seu atendimento, escolha uma opção:',interaction:'BUTTONS',captureKey:'perfil',options:[
        {id:'ja_sou_aluno',label:'Já sou aluno',value:'ALUNO',departmentId:'d-suporte'},
        {id:'quero_ser_aluno',label:'Quero ser aluno',value:'QUERO_SER_ALUNO',departmentId:'d-comercial'}
      ]}
    ],
    queueRoutingOptions:[
      {key:'1',label:'Comercial',departmentId:'d-comercial'},
      {key:'2',label:'Financeiro',departmentId:'d-financeiro'},
      {key:'3',label:'Pedagógico',departmentId:'d-suporte'}
    ],
    autoRepliesEnabled:true,
    autoConnectWhatsApp:true,
    syncGroupsOnConnect:true,
    syncChannelsOnConnect:true,
    preserveManualContactName:true,
    mediaRetentionDays:180,
    maxUploadMB:55,
    desktopNotifications:true,
    networkMode:true,
    operationalResetAt:0,
    metaEmbeddedSignup:{appId:'',appSecret:'',configId:'',graphVersion:'v23.0'},
    matriculas:{enabled:true,monitorAllGroups:true,groupIds:[],polos:[],courseProductMap:{}}
  },
  users:[{id:'u-admin',name:'Administrador',username:'admin',role:'SUPER_ADMIN',status:'OFFLINE',departmentId:'d-comercial',email:'',active:true}],
  departments:[
    {id:'d-comercial',name:'Comercial',distribution:'ROUND_ROBIN',active:true},
    {id:'d-financeiro',name:'Financeiro',distribution:'LEAST_BUSY',active:true},
    {id:'d-suporte',name:'Pedagógico',distribution:'ROUND_ROBIN',active:true}
  ],
  contacts:[],conversations:[],messages:[],groups:[],channels:[],deals:[],followups:[],scheduledMessages:[],
  automations:[
    {id:'a1',name:'Boas-vindas automáticas',trigger:'FIRST_CONTACT',action:'SEND_WELCOME',enabled:true},
    {id:'a2',name:'Fora do horário',trigger:'OUT_OF_HOURS',action:'SEND_AWAY',enabled:true},
    {id:'a4',name:'Pesquisa de satisfação',trigger:'CONVERSATION_CLOSED',action:'SEND_CSAT',enabled:true}
  ],
  quickReplies:[
    {id:'q1',shortcut:'/horario',text:'Nosso horário de atendimento é de segunda a sexta-feira, das 8h às 18h.'},
    {id:'q2',shortcut:'/obrigado',text:'Obrigado pelo contato! Ficamos à disposição.'}
  ],
  knowledge:[],webhooks:[],apiKeys:[],officialConnections:[],messageTemplates:[],contactLists:[],campaigns:[],leadBases:[],leadEntries:[],leadEvents:[],leadSheets:[],matriculas:[],
  connections:[{id:'principal',name:'WhatsApp principal',phone:'',state:'DISCONNECTED',qr:null,lastEventAt:null,connectedAt:null}],
  logs:[]
};

const sql=new DatabaseSync(sqliteFile,{timeout:5000});
sql.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS app_state(
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS messages(
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    external_id TEXT,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id);
`);
const getCoreStmt=sql.prepare("SELECT payload FROM app_state WHERE key='core'");
const upsertCoreStmt=sql.prepare("INSERT INTO app_state(key,payload,updated_at) VALUES('core',?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at");
const loadMessagesStmt=sql.prepare('SELECT payload FROM messages ORDER BY created_at,id');
const upsertMessageStmt=sql.prepare('INSERT INTO messages(id,conversation_id,external_id,created_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,external_id=excluded.external_id,created_at=excluded.created_at,payload=excluded.payload');
const deleteMessageStmt=sql.prepare('DELETE FROM messages WHERE id=?');
const deleteAllMessagesStmt=sql.prepare('DELETE FROM messages');

let saveTimer=null,dirtyCore=false;
const dirtyMessageIds=new Set(),deletedMessageIds=new Set();
const messageById=new Map(),messageBuckets=new Map(),bucketDirty=new Set();
const wrappedTargets=new WeakSet();

function uidInternal(prefix='id'){return `${prefix}_${randomUUID()}`}
function parseJson(text,fallback){try{return JSON.parse(text)}catch{return fallback}}
function normalizeState(input={}){
  const db={...structuredClone(seed),...(input||{})};
  const arrays=['users','departments','contacts','conversations','messages','groups','channels','deals','followups','scheduledMessages','automations','quickReplies','knowledge','webhooks','apiKeys','officialConnections','messageTemplates','contactLists','campaigns','leadBases','leadEntries','leadEvents','leadSheets','matriculas','connections','logs'];
  for(const k of arrays)if(!Array.isArray(db[k]))db[k]=[];
  db.settings={...seed.settings,...(db.settings||{}),businessHours:{...seed.settings.businessHours,...(db.settings?.businessHours||{})},metaEmbeddedSignup:{...seed.settings.metaEmbeddedSignup,...(db.settings?.metaEmbeddedSignup||{})},matriculas:{...seed.settings.matriculas,...(db.settings?.matriculas||{}),courseProductMap:{...seed.settings.matriculas.courseProductMap,...(db.settings?.matriculas?.courseProductMap||{})}}};
  const queuePalette=['#2563eb','#16a34a','#eab308','#8b5cf6','#06b6d4','#e11d48'];
  db.departments=db.departments.map((d,i)=>({...d,active:d.active!==false,distribution:d.distribution||'LEAST_BUSY',order:Number.isFinite(Number(d.order))?Number(d.order):i+1,color:/^#[0-9a-f]{6}$/i.test(String(d.color||''))?String(d.color):queuePalette[i%queuePalette.length],greeting:String(d.greeting||''),closeTicket:Boolean(d.closeTicket)}));
  db.version='0.14.0';
  // v0.8.8: triagem inicial simples para operação educacional.
  // Primeira mensagem entra sem fila e o próprio contato escolhe Pedagógico ou Comercial.
  const normalizeDeptName=value=>String(value||'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  let comercial=db.departments.find(d=>normalizeDeptName(d.name)==='comercial')||db.departments.find(d=>d.id==='d-comercial')||null;
  if(!comercial){comercial={id:'d-comercial',name:'Comercial',distribution:'ROUND_ROBIN',active:true};db.departments.push(comercial)}
  let pedagogico=db.departments.find(d=>normalizeDeptName(d.name)==='pedagogico')||null;
  if(!pedagogico){
    const legacySuporte=db.departments.find(d=>d.id==='d-suporte'&&['suporte','pedagogico'].includes(normalizeDeptName(d.name)));
    if(legacySuporte){legacySuporte.name='Pedagógico';pedagogico=legacySuporte}
    else{pedagogico={id:'d-pedagogico',name:'Pedagógico',distribution:'ROUND_ROBIN',active:true};db.departments.push(pedagogico)}
  }
  if(Number(db.settings.queueStudentRoutingVersion||0)<1){
    db.settings.queueRoutingEnabled=true;
    db.settings.queueRoutingMode='FLOW';
    db.settings.queueRoutingGreeting='Olá! Para direcionarmos seu atendimento, escolha uma opção:';
    db.settings.queueRoutingConfirmation='Perfeito! Seu atendimento foi direcionado para {setor}. Aguarde um atendente.';
    db.settings.queueRoutingInvalid='Não consegui identificar sua escolha. Selecione uma das opções disponíveis:';
    db.settings.queueAutoAssignAfterRouting=false;
    db.settings.queueFlowStartNodeId='triagem_aluno';
    db.settings.queueFlowNodes=[{id:'triagem_aluno',title:db.settings.queueRoutingGreeting,interaction:'BUTTONS',captureKey:'perfil',options:[
      {id:'ja_sou_aluno',label:'Já sou aluno',value:'ALUNO',departmentId:pedagogico.id},
      {id:'quero_ser_aluno',label:'Quero ser aluno',value:'QUERO_SER_ALUNO',departmentId:comercial.id}
    ]}];
    db.settings.queueStudentRoutingVersion=1;
  }
  if(!Array.isArray(db.settings.queueRoutingOptions)||!db.settings.queueRoutingOptions.length){
    db.settings.queueRoutingOptions=db.departments.filter(d=>d.active!==false).slice(0,9).map((d,i)=>({key:String(i+1),label:d.name,departmentId:d.id}));
  }
  db.settings.queueRoutingOptions=db.settings.queueRoutingOptions.map((o,i)=>({key:String(o?.key||i+1).trim(),label:String(o?.label||db.departments.find(d=>d.id===o?.departmentId)?.name||`Opção ${i+1}`).trim(),departmentId:o?.departmentId||null})).filter(o=>o.key&&o.departmentId&&db.departments.some(d=>d.id===o.departmentId));
  // v0.5.14: fluxo de triagem em árvore. O menu numérico antigo é mantido apenas para migração, nunca como fallback visual.
  if(!Array.isArray(db.settings.queueFlowNodes)||!db.settings.queueFlowNodes.length){
    const legacy=db.settings.queueRoutingOptions||[];
    const looksLikeDefault=legacy.length===3&&legacy.map(o=>String(o.label||'').toLocaleLowerCase('pt-BR')).join('|')==='comercial|financeiro|suporte';
    db.settings.queueFlowNodes=looksLikeDefault?structuredClone(seed.settings.queueFlowNodes):[{id:'inicio',title:db.settings.queueRoutingGreeting||'Escolha uma opção:',interaction:'AUTO',captureKey:'assunto',options:legacy.map((o,i)=>({id:`opcao_${i+1}`,label:o.label,value:o.label,departmentId:o.departmentId}))}];
    db.settings.queueFlowStartNodeId=db.settings.queueFlowNodes[0]?.id||'inicio';
  }
  const cleanId=(value,fallback)=>String(value||fallback).trim().replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,64)||fallback;
  const allowedInteraction=new Set(['AUTO','BUTTONS','LIST','TEXT']);
  db.settings.queueFlowNodes=db.settings.queueFlowNodes.slice(0,30).map((node,ni)=>{
    const id=cleanId(node?.id,`etapa_${ni+1}`);
    return {id,title:String(node?.title||`Etapa ${ni+1}`).trim().slice(0,500),interaction:allowedInteraction.has(String(node?.interaction||'AUTO').toUpperCase())?String(node.interaction||'AUTO').toUpperCase():'AUTO',captureKey:cleanId(node?.captureKey||'', '').slice(0,40),options:(Array.isArray(node?.options)?node.options:[]).slice(0,20).map((o,oi)=>({id:cleanId(o?.id,`${id}_opcao_${oi+1}`),label:String(o?.label||'').trim().slice(0,80),value:String(o?.value||o?.label||'').trim().slice(0,120),afterMessage:String(o?.afterMessage||'').trim().slice(0,1000),nextNodeId:o?.nextNodeId?cleanId(o.nextNodeId,''):null,departmentId:o?.departmentId||null})).filter(o=>o.label)};
  }).filter(n=>n.id&&n.title&&n.options.length);
  const flowIds=new Set(db.settings.queueFlowNodes.map(n=>n.id));
  for(const node of db.settings.queueFlowNodes)for(const option of node.options){if(option.nextNodeId&&!flowIds.has(option.nextNodeId))option.nextNodeId=null;if(option.departmentId&&!db.departments.some(d=>d.id===option.departmentId&&d.active!==false))option.departmentId=null}
  if(!flowIds.has(db.settings.queueFlowStartNodeId))db.settings.queueFlowStartNodeId=db.settings.queueFlowNodes[0]?.id||null;
  if(!['AUTO','BUTTONS','LIST','TEXT'].includes(String(db.settings.queueInteractivePreference||'AUTO').toUpperCase()))db.settings.queueInteractivePreference='AUTO';
  if(!['TEXT_LABELS','HUMAN_QUEUE'].includes(String(db.settings.queueInteractiveFallback||'TEXT_LABELS').toUpperCase()))db.settings.queueInteractiveFallback='TEXT_LABELS';
  if(!db.users.some(u=>u.id==='u-admin'))db.users.unshift(structuredClone(seed.users[0]));
  // v0.5.15: uma instalação já configurada pode ficar sem conexões após o administrador excluir a última.
  // O seed continua criando a conexão principal em instalações novas, mas não recriamos conexões apagadas.
  if(!Array.isArray(db.connections))db.connections=structuredClone(seed.connections);
  for(const u of db.users){if(u.department&&!u.departmentId){const d=db.departments.find(x=>x.name===u.department);u.departmentId=d?.id||null}if(u.active==null)u.active=true;if(!u.status)u.status='OFFLINE'}
  for(const d of db.departments)if(d.active==null)d.active=true;
  for(const c of db.contacts){if(!Array.isArray(c.tags))c.tags=[];if(c.whatsappJid===undefined)c.whatsappJid=null;if(c.whatsappJidAlt===undefined)c.whatsappJidAlt=null;if(c.isGroup==null)c.isGroup=String(c.whatsappJid||'').endsWith('@g.us');if(c.isChannel==null)c.isChannel=String(c.whatsappJid||'').endsWith('@newsletter');if(c.nameSource==null)c.nameSource=(c.source&&c.source!=='WhatsApp'&&c.source!=='WhatsApp Grupo'&&c.source!=='WhatsApp Canal')?'manual':(/^\+?\d+$/.test(String(c.name||''))?'fallback':'profile');if(c.manualName==null)c.manualName=c.nameSource==='manual';if(c.whatsappName==null)c.whatsappName='';if(c.pushName==null)c.pushName='';if(c.isChannel)c.isGroup=false;if(c.isChannel&&String(c.whatsappJid||'').endsWith('@newsletter')){let ch=db.channels.find(x=>x.jid===c.whatsappJid);if(!ch){const safeName=c.name&&!/^\+?\d+$/.test(c.name)?c.name:'Canal WhatsApp';ch={id:uidInternal('chn'),jid:c.whatsappJid,instanceId:'principal',name:safeName,description:'',subscribers:0,verification:null,kind:'CHANNEL',contactId:c.id,updatedAt:Date.now()};db.channels.push(ch)}else if(!ch.contactId)ch.contactId=c.id;c.channelJid=c.whatsappJid;c.stage='CANAL';c.source='WhatsApp Canal'}}
  for(const c of db.conversations){if(c.priority==null)c.priority='NORMAL';if(c.unread==null)c.unread=0;if(!c.protocol){const d=new Date(Number(c.createdAt||Date.now()));const stamp=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;c.protocol=`ATD-${stamp}-${String(c.id||uidInternal('cv')).replace(/[^a-zA-Z0-9]/g,'').slice(-6).toUpperCase()}`}const ct=db.contacts.find(x=>x.id===c.contactId);if(c.isGroup==null)c.isGroup=Boolean(ct?.isGroup);if(c.isChannel==null)c.isChannel=Boolean(ct?.isChannel);if(c.isChannel){c.status='HISTORY';c.unread=0;c.archivedAt=c.archivedAt||c.closedAt||c.updatedAt||Date.now();delete c.closedAt;delete c.closeReason;if(!c.channelId)c.channelId=db.channels.find(ch=>ch.contactId===c.contactId&&ch.instanceId===c.instanceId)?.id||null}if(c.importedHistory&&c.status==='CLOSED'&&(c.closeReason==='Histórico importado'||c.closeReason==='Historico importado'||!c.closedByUser)){c.status='HISTORY';c.archivedAt=c.archivedAt||c.closedAt||c.updatedAt||Date.now();delete c.closedAt;delete c.closeReason;c.unread=0}if(c.isGroup&&!c.ownerId&&c.status==='WAITING'){c.status='OPEN';delete c.queuedAt}if(!c.ownerId&&c.status==='OPEN'&&!c.isGroup&&!c.isChannel){c.status='WAITING';c.queuedAt=c.queuedAt||c.createdAt||Date.now()}}
  for(const g of db.groups){if(!Array.isArray(g.participants))g.participants=[];g.size=Number(g.size||g.participants.length||0)}
  for(const ch of db.channels){ch.subscribers=Number(ch.subscribers||0);ch.kind='CHANNEL'}
  for(const c of db.officialConnections){c.provider='CLOUD_API';c.active=c.active!==false;c.state=c.state||'CONFIGURED';c.graphVersion=c.graphVersion||'v23.0';c.createdAt=Number(c.createdAt||Date.now());}
  for(const t of db.messageTemplates){t.provider='CLOUD_API';t.status=t.status||'RASCUNHO';t.language=t.language||'pt_BR';t.components=Array.isArray(t.components)?t.components:[];}
  for(const l of db.contactLists){l.contacts=Array.isArray(l.contacts)?l.contacts:[];l.createdAt=Number(l.createdAt||Date.now());}
  for(const c of db.campaigns){c.status=c.status||'RASCUNHO';c.createdAt=Number(c.createdAt||Date.now());c.variables=c.variables&&typeof c.variables==='object'?c.variables:{};}
  return db;
}
function wrapMessage(raw){
  if(!raw||typeof raw!=='object')return raw;
  const target=raw;
  if(wrappedTargets.has(target))return target;
  const proxy=new Proxy(target,{
    set(t,p,v){const old=t[p];t[p]=v;if(old!==v&&t.id){dirtyMessageIds.add(t.id);dirtyCore=false;schedulePersist(450)}return true},
    deleteProperty(t,p){if(p in t){delete t[p];if(t.id){dirtyMessageIds.add(t.id);schedulePersist(450)}}return true}
  });
  wrappedTargets.add(proxy);
  return proxy;
}
function rebuildMessageIndexes(){
  messageById.clear();messageBuckets.clear();bucketDirty.clear();
  for(let i=0;i<db.messages.length;i++){
    const m=wrapMessage(db.messages[i]);db.messages[i]=m;messageById.set(m.id,m);
    if(!messageBuckets.has(m.conversationId))messageBuckets.set(m.conversationId,[]);
    messageBuckets.get(m.conversationId).push(m);bucketDirty.add(m.conversationId);
  }
}
function indexMessage(m){messageById.set(m.id,m);if(!messageBuckets.has(m.conversationId))messageBuckets.set(m.conversationId,[]);messageBuckets.get(m.conversationId).push(m);bucketDirty.add(m.conversationId)}
function sortedBucket(conversationId){const b=messageBuckets.get(conversationId)||[];if(bucketDirty.has(conversationId)){b.sort((a,z)=>Number(a.createdAt||0)-Number(z.createdAt||0)||String(a.id).localeCompare(String(z.id)));bucketDirty.delete(conversationId)}return b}
function coreSnapshot(){const out={...db,messages:undefined};delete out.messages;return out}
function writeFull(){
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null}dirtyCore=false;dirtyMessageIds.clear();deletedMessageIds.clear();
  sql.exec('BEGIN IMMEDIATE');
  try{
    upsertCoreStmt.run(JSON.stringify(coreSnapshot()),Date.now());deleteAllMessagesStmt.run();
    for(const m of db.messages)upsertMessageStmt.run(String(m.id),String(m.conversationId||''),m.externalId||null,Number(m.createdAt||0),JSON.stringify(m));
    sql.exec('COMMIT');
  }catch(e){try{sql.exec('ROLLBACK')}catch{}throw e}
}
function persistNow(){
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null}
  if(!dirtyCore&&!dirtyMessageIds.size&&!deletedMessageIds.size)return;
  sql.exec('BEGIN IMMEDIATE');
  try{
    if(dirtyCore)upsertCoreStmt.run(JSON.stringify(coreSnapshot()),Date.now());
    for(const id of deletedMessageIds)deleteMessageStmt.run(id);
    for(const id of dirtyMessageIds){const m=messageById.get(id);if(m)upsertMessageStmt.run(String(m.id),String(m.conversationId||''),m.externalId||null,Number(m.createdAt||0),JSON.stringify(m))}
    sql.exec('COMMIT');dirtyCore=false;dirtyMessageIds.clear();deletedMessageIds.clear();
  }catch(e){try{sql.exec('ROLLBACK')}catch{}throw e}
}
function schedulePersist(delay=650){dirtyCore=true;if(saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=null;try{persistNow()}catch(e){console.error('SQLite persist error',e)}},delay);saveTimer.unref?.()}

let db;
const coreRow=getCoreStmt.get();
if(coreRow?.payload){
  const core=parseJson(coreRow.payload,{});const messages=loadMessagesStmt.all().map(r=>parseJson(r.payload,null)).filter(Boolean);db=normalizeState({...core,messages});rebuildMessageIndexes();
}else{
  let legacy=null;
  if(fs.existsSync(legacyFile))legacy=parseJson(fs.readFileSync(legacyFile,'utf8'),null);
  db=normalizeState(legacy||structuredClone(seed));rebuildMessageIndexes();writeFull();
  if(legacy){const backup=path.join(base,`store.pre-sqlite-${Date.now()}.json`);try{fs.copyFileSync(legacyFile,backup)}catch{}}
}
// v0.13.2: toda mensagem passa a carregar a conexão proprietária. Isso permite que
// o mesmo ID do WhatsApp exista simultaneamente em duas conexões (A→B e B←A).
{
  let changed=0;
  const byConversation=new Map((db.conversations||[]).map(c=>[c.id,c]));
  for(const m of db.messages||[]){
    if(!m.instanceId){const cv=byConversation.get(m.conversationId);if(cv?.instanceId){m.instanceId=cv.instanceId;changed++;}}
  }
  if(changed)dirtyCore=true;
}
// Repara nomes genéricos criados por eventos fromMe de versões anteriores.
{
  const generic=new Set(['meu numero','meu número','voce','você','my number']);let changed=0;
  const digits=v=>String(v||'').replace(/\D/g,'');
  for(const conn of db.connections||[]){
    const phone=digits(conn.phone);if(!phone)continue;
    const ct=(db.contacts||[]).find(c=>!c.isGroup&&!c.isChannel&&digits(c.phone)===phone);
    if(!ct)continue;
    const n=String(ct.name||'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    if(generic.has(n)||!ct.name||digits(ct.name)===phone){ct.name=conn.name||ct.name||phone;ct.whatsappName=conn.name||ct.whatsappName||'';ct.nameSource='connection';changed++;}
  }
  if(changed)dirtyCore=true;
}
// Remove placeholders técnicos criados por versões antigas para eventos sem conteúdo (ex.: reação/protocolo como [text]).
{
  const phantom=db.messages.filter(m=>m?.type==='TEXT'&&!m?.file&&!m?.meta&&['[text]','[text do histórico]','[text do historico]'].includes(String(m?.body||'').trim().toLowerCase()));
  if(phantom.length){const ids=new Set(phantom.map(m=>m.id));for(const id of ids)deletedMessageIds.add(id);db.messages=db.messages.filter(m=>!ids.has(m.id));rebuildMessageIndexes();for(const c of db.conversations){const last=messagesForConversation(c.id).at(-1);if(last)c.updatedAt=Number(last.createdAt||c.updatedAt||Date.now())}dirtyCore=true;}
}
// v0.6.4: votos de enquete não são mensagens de chat. Versões anteriores podiam salvar cada pollUpdateMessage como "Atualização de enquete".
{
  const ghosts=db.messages.filter(m=>m?.type==='POLL_UPDATE');
  if(ghosts.length){
    const ids=new Set(ghosts.map(m=>m.id)),removedByConversation=new Map();
    for(const m of ghosts){deletedMessageIds.add(m.id);if(m.direction==='IN')removedByConversation.set(m.conversationId,(removedByConversation.get(m.conversationId)||0)+1)}
    db.messages=db.messages.filter(m=>!ids.has(m.id));rebuildMessageIndexes();
    for(const c of db.conversations){const last=messagesForConversation(c.id).at(-1);if(last)c.updatedAt=Number(last.createdAt||c.updatedAt||Date.now());const removed=removedByConversation.get(c.id)||0;if(removed&&Number(c.unread||0)>0)c.unread=Math.max(0,Number(c.unread||0)-removed)}
    dirtyCore=true;
  }
}
// v0.14.0: reparo seguro de identidade/conversas para instalações que vieram das versões multiconexão anteriores.
try{repairMultiConnectionData({reason:'startup-v0.14.0'})}catch(e){console.error('Falha no reparo multiconexão de inicialização:',e)}
// Migrações de esquema/configuração são persistidas no SQLite sem bloquear a inicialização.
dirtyCore=true;schedulePersist(100);

export function all(){return db}
export function save(){schedulePersist()}
export function flush(){persistNow()}
export function databaseInfo(){return{engine:'SQLite',file:sqliteFile,wal:true,messages:db.messages.length,contacts:db.contacts.length,conversations:db.conversations.length,groups:db.groups.length,channels:db.channels.length}}
export function reset(){db=normalizeState(structuredClone(seed));rebuildMessageIndexes();writeFull();return db}
export function replaceAll(next){db=normalizeState(next);rebuildMessageIndexes();writeFull();return db}
export function uid(prefix='id'){return uidInternal(prefix)}
export function pushLog(event,data={}){const entry={id:uidInternal('log'),event,data,createdAt:Date.now()};db.logs.unshift(entry);db.logs=db.logs.slice(0,3000);schedulePersist();return entry}
export function getContactByPhone(phone){const clean=String(phone||'').replace(/\D/g,'');return db.contacts.find(c=>!c.isGroup&&!c.isChannel&&String(c.phone||'').replace(/\D/g,'')===clean)}
export function getContactByWhatsAppJid(jid){const v=String(jid||'').trim();if(!v)return null;return db.contacts.find(c=>c.whatsappJid===v||c.whatsappJidAlt===v)||null}
function displayNameScore(contact={}){
  if(contact.manualName||contact.nameSource==='manual')return db.settings.preserveManualContactName!==false?40:12;
  if(contact.nameSource==='addressbook'||contact.whatsappName)return 30;
  if(contact.nameSource==='profile'||contact.pushName)return 20;
  return /^\+?\d+$/.test(String(contact.name||''))?0:10;
}
function applyContactName(contact,name,origin='profile'){
  const value=String(name||'').trim();if(!contact||!value)return false;
  if(/^\+?\d+$/.test(value)&&!/^\+?\d+$/.test(String(contact.name||'')))return false;
  if(origin==='manual'){contact.name=value;contact.nameSource='manual';contact.manualName=true;return true}
  if(origin==='addressbook')contact.whatsappName=value;
  if(origin==='profile')contact.pushName=value;
  if(db.settings.preserveManualContactName!==false&&(contact.manualName||contact.nameSource==='manual'))return false;
  const rank={fallback:0,profile:20,addressbook:30,manual:40};const current=rank[contact.nameSource]??(/^\+?\d+$/.test(String(contact.name||''))?0:10),incoming=rank[origin]??10;
  if(incoming>=current||!contact.name||/^\+?\d+$/.test(String(contact.name||''))){contact.name=value;contact.nameSource=origin;contact.manualName=false;return true}return false;
}
function mergeContacts(primary,duplicate,{mergeConversations=false,report=null}={}){
  if(!primary||!duplicate||primary.id===duplicate.id)return primary;
  const primaryScore=displayNameScore(primary),duplicateScore=displayNameScore(duplicate);
  if(duplicate.name&&duplicateScore>primaryScore){primary.name=duplicate.name;primary.nameSource=duplicate.nameSource||'profile';primary.manualName=Boolean(duplicate.manualName)}
  if(!primary.whatsappName&&duplicate.whatsappName)primary.whatsappName=duplicate.whatsappName;if(!primary.pushName&&duplicate.pushName)primary.pushName=duplicate.pushName;
  if(duplicate.avatar&&(!primary.avatar||Number(duplicate.avatarUpdatedAt||0)>Number(primary.avatarUpdatedAt||0))){primary.avatar=duplicate.avatar;primary.avatarSource=duplicate.avatarSource||primary.avatarSource;primary.avatarUpdatedAt=duplicate.avatarUpdatedAt||primary.avatarUpdatedAt;primary.avatarCheckedAt=duplicate.avatarCheckedAt||primary.avatarCheckedAt;if(duplicate.avatarResolvedJid)primary.avatarResolvedJid=duplicate.avatarResolvedJid}
  if(!primary.avatarUnavailableAt&&duplicate.avatarUnavailableAt)primary.avatarUnavailableAt=duplicate.avatarUnavailableAt;
  if(!primary.phone&&duplicate.phone)primary.phone=duplicate.phone;if(!primary.email&&duplicate.email)primary.email=duplicate.email;if(!primary.company&&duplicate.company)primary.company=duplicate.company;
  if(!primary.whatsappJid&&duplicate.whatsappJid)primary.whatsappJid=duplicate.whatsappJid;if(!primary.whatsappJidAlt&&duplicate.whatsappJidAlt)primary.whatsappJidAlt=duplicate.whatsappJidAlt;
  primary.tags=[...new Set([...(primary.tags||[]),...(duplicate.tags||[])])];if(!primary.notes&&duplicate.notes)primary.notes=duplicate.notes;
  const duplicateConvs=db.conversations.filter(c=>c.contactId===duplicate.id);
  for(const dc of duplicateConvs){
    const tc=db.conversations.find(c=>c.id!==dc.id&&c.contactId===primary.id&&c.instanceId===dc.instanceId&&c.status===dc.status);
    if(tc&&mergeConversations){
      // Preserva a conversa mais recentemente usada, evitando invalidar uma tela que acabou de ser aberta.
      const keep=Number(dc.updatedAt||0)>=Number(tc.updatedAt||0)?dc:tc,drop=keep===dc?tc:dc;
      if(keep===dc)keep.contactId=primary.id;
      mergeConversationInto(keep,drop,report);
    }else dc.contactId=primary.id;
  }
  for(const d of db.deals)if(d.contactId===duplicate.id)d.contactId=primary.id;for(const f of db.followups)if(f.contactId===duplicate.id)f.contactId=primary.id;
  db.contacts=db.contacts.filter(c=>c.id!==duplicate.id);rebuildMessageIndexes();schedulePersist();pushLog('CONTACTS_MERGED',{primaryId:primary.id,duplicateId:duplicate.id,mergeConversations:Boolean(mergeConversations)});return primary
}
export function upsertContactByPhone(phone,patch={}){const clean=String(phone||'').replace(/\D/g,'');let c=getContactByPhone(clean)||getContactByWhatsAppJid(patch.whatsappJid)||getContactByWhatsAppJid(patch.whatsappJidAlt);if(!c){c={id:uidInternal('c'),name:patch.name||clean||'Contato',phone:clean,email:'',company:'',ownerId:null,stage:'NOVO_LEAD',tags:[],source:'Manual',notes:'',whatsappJid:null,whatsappJidAlt:null,isGroup:false,nameSource:'manual',manualName:true,whatsappName:'',pushName:''};db.contacts.push(c)}Object.assign(c,patch);if(clean)c.phone=clean;if(patch.name)applyContactName(c,patch.name,patch.nameSource||'manual');schedulePersist();return c}
export function upsertWhatsAppContact({phone='',whatsappJid=null,whatsappJidAlt=null,name='',avatar=null,nameSource='profile',instanceId=null,fromMe=false}){
  if(String(whatsappJid||'').endsWith('@g.us')||String(whatsappJid||'').endsWith('@newsletter'))return getContactByWhatsAppJid(whatsappJid);
  const clean=String(phone||'').replace(/\D/g,''),isLid=String(whatsappJid||'').endsWith('@lid'),jidDigits=isLid?'':String(whatsappJid||'').split('@')[0].replace(/\D/g,'');
  const normalizeName=v=>String(v||'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const genericSelfNames=new Set(['meu numero','voce','você','my number']);
  let safeName=fromMe?'':String(name||'').trim(),safeNameSource=fromMe?'fallback':nameSource;
  if(genericSelfNames.has(normalizeName(safeName)))safeName='';
  const identityDigits=clean||jidDigits;
  const ownConnection=(db.connections||[]).find(x=>String(x.phone||'').replace(/\D/g,'')===identityDigits);
  // Um número que também é conexão do Balbino deve ser exibido pelo nome DAQUELA conexão,
  // nunca pelo pushName da conexão que enviou a mensagem.
  if(ownConnection){safeName=ownConnection.name||safeName||identityDigits;safeNameSource='connection'}
  const byJid=getContactByWhatsAppJid(whatsappJid)||getContactByWhatsAppJid(whatsappJidAlt),byPhone=clean?getContactByPhone(clean):jidDigits?getContactByPhone(jidDigits):null;let c=byJid||byPhone;
  if(byJid&&byPhone&&byJid.id!==byPhone.id){const phoneLooksManual=byPhone.manualName||byPhone.nameSource==='manual'||(byPhone.source&&byPhone.source!=='WhatsApp'&&byPhone.source!=='WhatsApp Grupo');c=phoneLooksManual?mergeContacts(byPhone,byJid):mergeContacts(byJid,byPhone)}
  if(!c){c={id:uidInternal('c'),name:clean||jidDigits||safeName||'Contato WhatsApp',phone:clean||jidDigits,email:'',company:'',ownerId:null,stage:'NOVO_LEAD',tags:[],source:'WhatsApp',notes:'',whatsappJid:null,whatsappJidAlt:null,avatar:null,isGroup:false,nameSource:'fallback',manualName:false,whatsappName:'',pushName:''};db.contacts.push(c)}
  if(ownConnection){c.name=ownConnection.name||safeName||c.name||identityDigits;c.nameSource='connection';c.manualName=false;c.connectionContactId=ownConnection.id;if(c.pushName&&genericSelfNames.has(normalizeName(c.pushName)))c.pushName=''}
  else if(safeName)applyContactName(c,safeName,safeNameSource||'profile');
  if(clean)c.phone=clean;if(whatsappJid)c.whatsappJid=whatsappJid;if(whatsappJidAlt)c.whatsappJidAlt=whatsappJidAlt;if(avatar)c.avatar=avatar;schedulePersist();return c
}

function simplifyParticipant(p){if(typeof p==='string')return{id:p,phoneNumber:null,admin:null};return{id:p?.id||p?.jid||'',phoneNumber:p?.phoneNumber||p?.pn||null,admin:p?.admin||null}}
export function upsertWhatsAppGroup(meta={},instanceId='principal'){
  const jid=String(meta.id||meta.jid||'');if(!jid.endsWith('@g.us'))return null;
  let g=db.groups.find(x=>x.jid===jid&&x.instanceId===instanceId);
  const participants=(meta.participants||g?.participants||[]).map(simplifyParticipant).filter(p=>p.id);
  const patch={jid,instanceId,subject:meta.subject||g?.subject||'Grupo WhatsApp',owner:meta.owner||g?.owner||null,desc:meta.desc??g?.desc??'',announce:meta.announce??g?.announce??false,restrict:meta.restrict??g?.restrict??false,creation:Number(meta.creation||g?.creation||0),participants,size:Number(meta.size||participants.length||g?.size||0),avatar:meta.avatar||g?.avatar||null,updatedAt:Date.now()};
  if(!g){g={id:uidInternal('grp'),...patch,contactId:null};db.groups.push(g)}else Object.assign(g,patch);
  let contact=g.contactId?db.contacts.find(c=>c.id===g.contactId):getContactByWhatsAppJid(jid);
  if(!contact){contact={id:uidInternal('c'),name:g.subject,phone:'',email:'',company:'',ownerId:null,stage:'GRUPO',tags:['Grupo WhatsApp'],source:'WhatsApp Grupo',notes:'',whatsappJid:jid,whatsappJidAlt:null,avatar:null,isGroup:true,groupJid:jid,nameSource:'addressbook',manualName:false,whatsappName:g.subject,pushName:''};db.contacts.push(contact)}
  contact.isGroup=true;contact.groupJid=jid;contact.whatsappJid=jid;contact.name=g.subject;contact.stage='GRUPO';if(g.avatar)contact.avatar=g.avatar;g.contactId=contact.id;schedulePersist();return g
}
export function getGroupByJid(jid,instanceId=null){return db.groups.find(g=>g.jid===jid&&(!instanceId||g.instanceId===instanceId))||null}

export function upsertWhatsAppChannel(meta={},instanceId='principal'){
  const jid=String(meta.id||meta.jid||'');if(!jid.endsWith('@newsletter'))return null;
  const tm=meta.thread_metadata||{};
  const metaName=typeof tm.name==='string'?tm.name:tm.name?.text;
  const metaDesc=typeof tm.description==='string'?tm.description:tm.description?.text;
  const name=meta.name||metaName||meta.subject||'Canal WhatsApp';
  const description=meta.description??metaDesc??'';
  const subscribers=Number(meta.subscribers??tm.subscribers_count??meta.subscribers_count??0)||0;
  let ch=db.channels.find(x=>x.jid===jid&&x.instanceId===instanceId);
  const patch={jid,instanceId,name,description,subscribers,verification:meta.verification||tm.verification||null,invite:meta.invite||tm.invite||null,picture:meta.picture||tm.picture||null,muteState:meta.mute_state||meta.viewer_metadata?.mute||null,role:meta.viewer_metadata?.role||meta.role||null,kind:'CHANNEL',updatedAt:Date.now()};
  if(!ch){ch={id:uidInternal('chn'),...patch,contactId:null};db.channels.push(ch)}else Object.assign(ch,patch);
  let contact=ch.contactId?db.contacts.find(c=>c.id===ch.contactId):getContactByWhatsAppJid(jid);
  if(!contact){contact={id:uidInternal('c'),name:ch.name,phone:'',email:'',company:'',ownerId:null,stage:'CANAL',tags:['Canal WhatsApp'],source:'WhatsApp Canal',notes:'',whatsappJid:jid,whatsappJidAlt:null,avatar:null,isGroup:false,isChannel:true,channelJid:jid,nameSource:'addressbook',manualName:false,whatsappName:ch.name,pushName:''};db.contacts.push(contact)}
  contact.isGroup=false;contact.isChannel=true;contact.channelJid=jid;contact.whatsappJid=jid;contact.name=ch.name||contact.name;contact.stage='CANAL';contact.source='WhatsApp Canal';ch.contactId=contact.id;schedulePersist();return ch
}
export function getChannelByJid(jid,instanceId=null){return db.channels.find(ch=>ch.jid===jid&&(!instanceId||ch.instanceId===instanceId))||null}
function operationalResetCutoff(){return Math.max(0,Number(db.settings?.operationalResetAt||0))}
export function isOperationalConversation(c){const cutoff=operationalResetCutoff();return !cutoff||Number(c?.createdAt||0)>=cutoff}
export function getOpenConversation(contactId,instanceId){
  const active=c=>c&&c.instanceId===instanceId&&isOperationalConversation(c)&&['OPEN','WAITING','WAITING_CUSTOMER','WAITING_INTERNAL'].includes(c.status);
  const newest=rows=>[...rows].sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)||Number(b.createdAt||0)-Number(a.createdAt||0))[0]||null;
  const exact=newest(db.conversations.filter(c=>c.contactId===contactId&&active(c)));
  if(exact)return exact;
  const contact=db.contacts.find(c=>c.id===contactId);
  if(!contact||contact.isGroup||contact.isChannel)return null;
  const peer=contactPeerIdentity(contact);
  if(!peer)return null;
  return newest(db.conversations.filter(c=>active(c)&&!c.isGroup&&!c.isChannel&&conversationPeerIdentity(c)===peer));
}
export function ensureConversation(contactId,instanceId='principal',patch={}){
  const ct=db.contacts.find(x=>x.id===contactId),desiredStatus=patch?.status||null,cutoff=operationalResetCutoff();
  let c=getOpenConversation(contactId,instanceId);
  if(!c&&desiredStatus==='HISTORY')c=db.conversations.find(x=>x.contactId===contactId&&x.instanceId===instanceId&&(!cutoff||Number(x.createdAt||0)>=cutoff)&&x.status==='HISTORY');
  if(!c&&desiredStatus!=='HISTORY'&&!ct?.isChannel){
    c=db.conversations.find(x=>x.contactId===contactId&&x.instanceId===instanceId&&(!cutoff||Number(x.createdAt||0)>=cutoff)&&x.status==='HISTORY');
    if(c){c.status=desiredStatus||'OPEN';c.importedHistory=false;c.reopenedFromHistoryAt=Date.now();delete c.archivedAt;delete c.closedAt;delete c.closeReason;}
  }
  if(!c){const createdAt=Date.now(),id=uidInternal('cv'),d=new Date(createdAt),stamp=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;c={id,protocol:`ATD-${stamp}-${String(id).replace(/[^a-zA-Z0-9]/g,'').slice(-6).toUpperCase()}`,contactId,instanceId,departmentId:null,ownerId:null,status:desiredStatus||'OPEN',priority:'NORMAL',unread:0,isGroup:Boolean(ct?.isGroup),groupId:ct?.isGroup?getGroupByJid(ct.whatsappJid,instanceId)?.id||null:null,isChannel:Boolean(ct?.isChannel),channelId:ct?.isChannel?getChannelByJid(ct.whatsappJid,instanceId)?.id||null:null,createdAt,updatedAt:createdAt,...patch};db.conversations.push(c);schedulePersist()}else Object.assign(c,patch||{});
  return c
}

export function handleInboundConversationState(conversation,{source='WHATSAPP'}={}){
  if(!conversation||conversation.isGroup||conversation.isChannel)return {changed:false};
  const before=conversation.status,now=Date.now();
  if(['WAITING_CUSTOMER','WAITING_INTERNAL'].includes(before)){
    const owner=conversation.ownerId?db.users.find(u=>u.id===conversation.ownerId&&u.active!==false&&u.status==='ONLINE'):null;
    if(owner){conversation.status='OPEN';conversation.attentionAt=now;conversation.lastInboundReactivatedAt=now;}
    else{conversation.ownerId=null;conversation.status='WAITING';conversation.queuedAt=now;conversation.attentionAt=now;}
    conversation.updatedAt=now;schedulePersist();pushLog('CONVERSATION_REACTIVATED_BY_CUSTOMER',{conversationId:conversation.id,fromStatus:before,toStatus:conversation.status,ownerId:conversation.ownerId||null,source});return {changed:true,fromStatus:before,toStatus:conversation.status};
  }
  return {changed:false};
}

export function addMessage(message,{historical=false}={}){const cv=db.conversations.find(x=>x.id===message?.conversationId);const raw={id:uidInternal('m'),status:'SENT',createdAt:Date.now(),favorite:false,reactions:[],instanceId:message?.instanceId||cv?.instanceId||null,...message};const m=wrapMessage(raw);db.messages.push(m);indexMessage(m);dirtyMessageIds.add(m.id);const c=db.conversations.find(x=>x.id===m.conversationId);if(c){c.updatedAt=Math.max(Number(c.updatedAt||0),Number(m.createdAt||0));if(!historical&&m.direction==='IN')c.unread=(c.unread||0)+1;else if(historical)c.unread=0;const humanOutbound=!historical&&m.direction==='OUT'&&String(m.type||'').toUpperCase()!=='NOTE'&&!m.auto&&!m.scheduledId&&db.users.some(u=>u.id===m.authorId);if(humanOutbound&&(db.leadEntries||[]).some(e=>e.contactId===c.contactId)){const ct=db.contacts.find(x=>x.id===c.contactId);if(ct&&(!ct.leadStatus||ct.leadStatus==='NOVO'))ct.leadStatus='EM_ATENDIMENTO'}}schedulePersist(historical?900:250);return m}
export function addHistoricalMessage(message){return addMessage({...message,historical:true},{historical:true})}
export function findMessageById(id){return messageById.get(id)||null}
export function messageExistsExternalId(externalId,instanceId=null){if(!externalId)return false;return db.messages.some(m=>m.externalId===externalId&&(!instanceId||String(m.instanceId||db.conversations.find(c=>c.id===m.conversationId)?.instanceId||'')===String(instanceId)))}
export function messagesForConversation(conversationId){return sortedBucket(conversationId)}
export function pagedMessages(conversationId,{limit=120,before=0}={}){const bucket=sortedBucket(conversationId);let end=bucket.length;if(before){let i=end-1;while(i>=0&&Number(bucket[i].createdAt||0)>=Number(before))i--;end=i+1}const start=Math.max(0,end-limit);return{messages:bucket.slice(start,end),hasMore:start>0,oldestAt:bucket[start]?.createdAt||null,count:bucket.length,lastMessage:bucket.at(-1)||null}}
export function conversationMessageSummary(conversationId){const b=sortedBucket(conversationId),visible=b.filter(m=>!(m?.type==='TEXT'&&!m?.file&&['[text]','[text do histórico]','[text do historico]'].includes(String(m?.body||'').trim().toLowerCase())));return{count:visible.length,lastMessage:visible.at(-1)||null}}
export function markMessagesDirty(messages=[]){for(const m of messages){if(m?.id)dirtyMessageIds.add(m.id)}schedulePersist(250)}


function normIdentityName(value=''){return String(value||'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()}
function digitsOnly(value=''){return String(value||'').replace(/\D/g,'')}
function jidDigits(value=''){const v=String(value||'').trim();if(!v)return'';if(v.endsWith('@s.whatsapp.net'))return digitsOnly(v.split('@')[0]);if(/^\+?\d+$/.test(v))return digitsOnly(v);return''}
function contactFallbackName(contact={},blockedNames=new Set()){
  const candidates=[contact.whatsappName,contact.phone,jidDigits(contact.whatsappJidAlt),jidDigits(contact.whatsappJid),contact.id];
  for(const value of candidates){const v=String(value||'').trim();if(v&&!blockedNames.has(normIdentityName(v)))return v}
  return 'Contato WhatsApp';
}
function contactPeerIdentity(contact={}){
  const candidates=[contact.whatsappJidAlt,contact.whatsappJid,contact.phone].filter(Boolean);
  for(const value of candidates){const d=jidDigits(value);if(d)return`phone:${d}`}
  for(const value of candidates){const v=String(value||'').trim().toLowerCase();if(v)return`jid:${v}`}
  return contact.id?`contact:${contact.id}`:'';
}
function conversationPeerIdentity(conversation){
  if(!conversation||conversation.isGroup||conversation.isChannel)return'';
  const contact=db.contacts.find(c=>c.id===conversation.contactId)||{};
  const recent=[...messagesForConversation(conversation.id)].reverse().find(m=>m&&(m.remoteJid||m.remoteJidAlt));
  const candidates=[conversation.peerJid,conversation.peerJidAlt,recent?.remoteJid,recent?.remoteJidAlt,contact.whatsappJidAlt,contact.whatsappJid,contact.phone].filter(Boolean);
  for(const value of candidates){const d=jidDigits(value);if(d)return`phone:${d}`}
  for(const value of candidates){const v=String(value||'').trim().toLowerCase();if(v)return`jid:${v}`}
  return contactPeerIdentity(contact);
}
function backfillConversationPeer(conversation){
  if(!conversation||conversation.isGroup||conversation.isChannel)return false;
  let changed=false;const contact=db.contacts.find(c=>c.id===conversation.contactId)||{};
  const recent=[...messagesForConversation(conversation.id)].reverse().find(m=>m&&(m.remoteJid||m.remoteJidAlt));
  if(!conversation.peerJid){const v=recent?.remoteJid||contact.whatsappJid||contact.whatsappJidAlt||(contact.phone?`${digitsOnly(contact.phone)}@s.whatsapp.net`:null);if(v){conversation.peerJid=v;changed=true}}
  if(!conversation.peerJidAlt){const v=recent?.remoteJidAlt||((contact.whatsappJidAlt&&contact.whatsappJidAlt!==conversation.peerJid)?contact.whatsappJidAlt:null);if(v){conversation.peerJidAlt=v;changed=true}}
  return changed;
}
function mergeConversationInto(primary,duplicate,report){
  if(!primary||!duplicate||primary.id===duplicate.id)return primary;
  if(report?.conversationRedirects)report.conversationRedirects[duplicate.id]=primary.id;
  const existingKeys=new Set(messagesForConversation(primary.id).map(m=>m.externalId?`${String(m.instanceId||primary.instanceId||'')}::${m.externalId}`:`id::${m.id}`));
  for(const m of [...messagesForConversation(duplicate.id)]){
    const key=m.externalId?`${String(m.instanceId||duplicate.instanceId||'')}::${m.externalId}`:`id::${m.id}`;
    if(existingKeys.has(key)&&m.externalId){deletedMessageIds.add(m.id);db.messages=db.messages.filter(x=>x.id!==m.id);report.duplicateMessagesRemoved++;continue}
    m.conversationId=primary.id;if(!m.instanceId)m.instanceId=primary.instanceId;dirtyMessageIds.add(m.id);existingKeys.add(key);report.messagesMoved++;
  }
  primary.createdAt=Math.min(Number(primary.createdAt||Date.now()),Number(duplicate.createdAt||Date.now()));
  primary.updatedAt=Math.max(Number(primary.updatedAt||0),Number(duplicate.updatedAt||0));
  primary.unread=Math.max(Number(primary.unread||0),Number(duplicate.unread||0));
  if(!primary.ownerId&&duplicate.ownerId)primary.ownerId=duplicate.ownerId;if(!primary.departmentId&&duplicate.departmentId)primary.departmentId=duplicate.departmentId;
  if(!primary.peerJid&&duplicate.peerJid)primary.peerJid=duplicate.peerJid;if(!primary.peerJidAlt&&duplicate.peerJidAlt)primary.peerJidAlt=duplicate.peerJidAlt;
  if(primary.priority==='NORMAL'&&duplicate.priority&&duplicate.priority!=='NORMAL')primary.priority=duplicate.priority;
  db.conversations=db.conversations.filter(c=>c.id!==duplicate.id);report.conversationsMerged++;return primary;
}
export function registerConnectionSelfIdentity(instanceId,{profileName='',phone='',source='runtime'}={}){
  const conn=(db.connections||[]).find(c=>c.id===instanceId);if(!conn)return{changed:0,cleanedContacts:0};
  let changed=0,cleanedContacts=0;const p=digitsOnly(phone||conn.phone);if(p&&digitsOnly(conn.phone)!==p){conn.phone=p;changed++}
  const selfName=String(profileName||'').trim();conn.selfProfileNames=Array.isArray(conn.selfProfileNames)?conn.selfProfileNames:[];
  if(selfName&&!conn.selfProfileNames.some(x=>normIdentityName(x)===normIdentityName(selfName))){conn.selfProfileNames.push(selfName);conn.selfProfileNames=conn.selfProfileNames.slice(-8);changed++}
  if(selfName&&conn.profileName!==selfName){conn.profileName=selfName;changed++}
  // O contato cujo telefone é uma conexão cadastrada usa sempre o nome administrativo da conexão.
  for(const c of db.contacts||[]){if(c.isGroup||c.isChannel)continue;const owner=(db.connections||[]).find(x=>digitsOnly(x.phone)&&digitsOnly(x.phone)===digitsOnly(c.phone));if(owner&&c.name!==owner.name){c.name=owner.name||c.phone;c.nameSource='connection';c.manualName=false;c.connectionContactId=owner.id;changed++}}
  const blocked=new Set((conn.selfProfileNames||[]).map(normIdentityName).filter(Boolean));
  if(blocked.size){
    const contactIds=new Set((db.conversations||[]).filter(cv=>cv.instanceId===instanceId&&!cv.isGroup&&!cv.isChannel).map(cv=>cv.contactId));
    const suspect=[...contactIds].map(id=>db.contacts.find(c=>c.id===id)).filter(c=>c&&!c.manualName&&['profile','fallback'].includes(String(c.nameSource||'fallback'))&&blocked.has(normIdentityName(c.name))&&digitsOnly(c.phone)!==digitsOnly(conn.phone));
    // Repetição do nome da própria conta em contatos distintos é sinal inequívoco da corrupção antiga.
    const counts=new Map();for(const c of suspect)counts.set(normIdentityName(c.name),(counts.get(normIdentityName(c.name))||0)+1);
    for(const c of suspect){const key=normIdentityName(c.name);if((counts.get(key)||0)<2)continue;const next=contactFallbackName(c,blocked);if(next&&c.name!==next){c.name=next;c.nameSource=(c.whatsappName&&normIdentityName(c.whatsappName)!==key)?'addressbook':'fallback';if(blocked.has(normIdentityName(c.pushName)))c.pushName='';cleanedContacts++;changed++}}
  }
  if(changed){schedulePersist(50);pushLog('CONNECTION_SELF_IDENTITY_REGISTERED',{instanceId,source,profileName:selfName||null,phone:p||null,cleanedContacts});}
  return{changed,cleanedContacts};
}
export function repairMultiConnectionData({reason='startup',mergeConversations=true}={}){
  const report={reason,mergeConversations:Boolean(mergeConversations),contactsMerged:0,connectedContactsRenamed:0,peerBackfilled:0,conversationsMerged:0,conversationRedirects:{},messagesMoved:0,duplicateMessagesRemoved:0,messageInstanceBackfilled:0,selfNameContactsCleaned:0};
  const byConversation=new Map((db.conversations||[]).map(c=>[c.id,c]));
  for(const m of db.messages||[]){if(!m.instanceId){const cv=byConversation.get(m.conversationId);if(cv?.instanceId){m.instanceId=cv.instanceId;dirtyMessageIds.add(m.id);report.messageInstanceBackfilled++}}}
  // Une contatos não-grupo com o mesmo telefone exato. Prioriza nomes manuais/endereço.
  const phoneGroups=new Map();for(const c of db.contacts||[]){if(c.isGroup||c.isChannel)continue;const p=digitsOnly(c.phone);if(!p)continue;if(!phoneGroups.has(p))phoneGroups.set(p,[]);phoneGroups.get(p).push(c)}
  for(const [phone,rows] of phoneGroups){if(rows.length<2)continue;rows.sort((a,b)=>displayNameScore(b)-displayNameScore(a));let primary=rows[0];for(const duplicate of rows.slice(1)){if(!db.contacts.some(c=>c.id===duplicate.id))continue;primary=mergeContacts(primary,duplicate,{mergeConversations,report});report.contactsMerged++}}
  // Números cadastrados como conexões têm nome autoritativo e não podem herdar o pushName da outra conexão.
  for(const conn of db.connections||[]){const p=digitsOnly(conn.phone);if(!p)continue;const c=getContactByPhone(p);if(c&&(c.name!==conn.name||c.nameSource!=='connection')){c.name=conn.name||c.name||p;c.nameSource='connection';c.manualName=false;c.connectionContactId=conn.id;report.connectedContactsRenamed++}}
  for(const c of db.conversations||[])if(backfillConversationPeer(c))report.peerBackfilled++;
  // Consolida duplicatas somente em reparos explícitos/inicialização.
  // Durante reconexão do WhatsApp não removemos IDs de conversas que podem estar abertas no navegador.
  if(mergeConversations){
    const groups=new Map();
    const classOf=c=>['OPEN','WAITING','WAITING_CUSTOMER','WAITING_INTERNAL'].includes(c.status)?'ACTIVE':c.status==='HISTORY'?'HISTORY':null;
    for(const c of db.conversations||[]){if(c.isGroup||c.isChannel)continue;const cls=classOf(c);if(!cls)continue;const peer=conversationPeerIdentity(c);if(!peer)continue;const key=`${String(c.instanceId||'')}::${peer}::${cls}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c)}
    for(const rows of groups.values()){
      if(rows.length<2)continue;
      // Mantém o ID da conversa mais recentemente usada para evitar que uma tela aberta "feche sozinha".
      rows.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)||Number(Boolean(b.ownerId))-Number(Boolean(a.ownerId)));
      let primary=rows[0];
      for(const dup of rows.slice(1)){
        if(!db.conversations.some(c=>c.id===dup.id))continue;
        primary=mergeConversationInto(primary,dup,report);
      }
    }
  }
  rebuildMessageIndexes();
  for(const conn of db.connections||[]){
    let profileName=conn.profileName||'';
    if(!profileName){
      const connName=normIdentityName(conn.name),ids=new Set((db.conversations||[]).filter(cv=>cv.instanceId===conn.id&&!cv.isGroup&&!cv.isChannel).map(cv=>cv.contactId)),counts=new Map();
      for(const id of ids){const c=db.contacts.find(x=>x.id===id);if(!c||c.manualName||c.nameSource!=='profile')continue;const n=normIdentityName(c.name);if(!n)continue;counts.set(n,{count:(counts.get(n)?.count||0)+1,raw:c.name})}
      const sharedIdentityToken=(a,b)=>{const ta=new Set(normIdentityName(a).split(/[^a-z0-9]+/).filter(x=>x.length>=4)),tb=new Set(normIdentityName(b).split(/[^a-z0-9]+/).filter(x=>x.length>=4));return [...ta].some(x=>tb.has(x))};
      const inferred=[...counts.values()].filter(x=>x.count>=3&&connName&&(normIdentityName(x.raw).includes(connName)||connName.includes(normIdentityName(x.raw))||sharedIdentityToken(x.raw,conn.name))).sort((a,b)=>b.count-a.count)[0];
      if(inferred)profileName=inferred.raw;
    }
    const r=registerConnectionSelfIdentity(conn.id,{profileName,phone:conn.phone||'',source:`repair:${reason}`});report.selfNameContactsCleaned+=Number(r.cleanedContacts||0)
  }
  db.settings.lastMultiConnectionRepair={at:Date.now(),reason,report:{...report}};dirtyCore=true;schedulePersist(50);pushLog('MULTICONNECTION_REPAIR_COMPLETED',report);
  return report;
}

export function createOperationalReset({by=null}={}){
  const at=Date.now();
  let archived=0;
  for(const c of db.conversations){
    if(Number(c.createdAt||0)>=at)continue;
    if(['OPEN','WAITING','WAITING_CUSTOMER','WAITING_INTERNAL'].includes(c.status)){
      c.status='HISTORY';c.unread=0;c.archivedAt=at;c.operationalResetAt=at;c.operationalResetBy=by||null;archived++;
    }
  }
  db.settings.operationalResetAt=at;
  pushLog('OPERATIONAL_RESET_CREATED',{at,by,archived,conversations:db.conversations.length,messages:db.messages.length});
  writeFull();
  return {at,archived,conversations:db.conversations.length,messages:db.messages.length};
}

export function removeConversation(id){
  const c=db.conversations.find(x=>x.id===id);if(!c)return null;
  const removedMessages=db.messages.filter(m=>m.conversationId===id);
  for(const m of removedMessages){deletedMessageIds.add(m.id);messageById.delete(m.id)}
  db.messages=db.messages.filter(m=>m.conversationId!==id);messageBuckets.delete(id);bucketDirty.delete(id);
  db.conversations=db.conversations.filter(x=>x.id!==id);
  db.followups=db.followups.filter(f=>f.conversationId!==id);
  db.scheduledMessages=db.scheduledMessages.filter(m=>m.conversationId!==id);
  schedulePersist();
  return {conversation:c,messages:removedMessages};
}
export function removeContact(id){db.contacts=db.contacts.filter(c=>c.id!==id);const cvs=db.conversations.filter(c=>c.contactId===id).map(c=>c.id),cvSet=new Set(cvs);db.conversations=db.conversations.filter(c=>c.contactId!==id);const removed=db.messages.filter(m=>cvSet.has(m.conversationId));for(const m of removed){deletedMessageIds.add(m.id);messageById.delete(m.id)}db.messages=db.messages.filter(m=>!cvSet.has(m.conversationId));for(const cid of cvs){messageBuckets.delete(cid);bucketDirty.delete(cid)}db.deals=db.deals.filter(d=>d.contactId!==id);db.followups=db.followups.filter(f=>f.contactId!==id);schedulePersist()}

// O servidor HTTP coordena SIGINT/SIGTERM para permitir desligamento gracioso das sessões WhatsApp.
// Aqui apenas garantimos persistência em saídas naturais do processo; não chamamos process.exit().
process.once('beforeExit',()=>{try{flush()}catch{}});
