import crypto from 'node:crypto';
import { all, save, uid, pushLog } from './store.js';

function clean(v=''){return String(v||'').trim().replace(/\s+/g,' ')}
function norm(v=''){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function stripEmoji(v=''){return clean(String(v||'').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,' '))}
function digits(v=''){return String(v||'').replace(/\D/g,'')}
function cpfHash(v=''){const d=digits(v);return d.length===11?crypto.createHash('sha256').update(d).digest('hex'):''}
function cpfMask(v=''){const d=digits(v);return d.length===11?`***.***.***-${d.slice(-2)}`:''}
function canonicalProduct(v=''){
  const n=norm(v).replace(/[._-]+/g,' ');
  if(/^graduacao\b/.test(n))return 'Graduação';
  if(/^(pos graduacao|posgraduacao|pos)\b/.test(n))return 'Pós-graduação';
  if(/^tecnico\b/.test(n))return 'Técnico';
  if(/^profissionalizante\b/.test(n))return 'Profissionalizante';
  if(/^segunda graduacao\b/.test(n))return 'Segunda Graduação';
  return '';
}
function lineMatch(lines,re){for(const raw of lines){const line=clean(raw),m=line.match(re);if(m&&clean(m[1]))return clean(m[1])}return ''}
function settings(){
  const db=all(),base=db.settings.matriculas||{};
  return {
    enabled:base.enabled!==false,
    monitorAllGroups:base.monitorAllGroups!==false,
    groupIds:Array.isArray(base.groupIds)?base.groupIds:[],
    polos:Array.isArray(base.polos)&&base.polos.length?base.polos:['Franca','Batatais','Ituverava','Itapira','Mogi Guaçu','Ribeirão Preto','Mogi Mirim','Monte Sião','SJB'],
    courseProductMap:base.courseProductMap&&typeof base.courseProductMap==='object'?base.courseProductMap:{}
  };
}
export function matriculaSettings(){return settings()}
export function updateMatriculaSettings(patch={}){
  const db=all(),current=settings(),next={...current};
  if('enabled' in patch)next.enabled=Boolean(patch.enabled);
  if('monitorAllGroups' in patch)next.monitorAllGroups=Boolean(patch.monitorAllGroups);
  if(Array.isArray(patch.groupIds))next.groupIds=[...new Set(patch.groupIds.map(String).filter(Boolean))];
  if(Array.isArray(patch.polos))next.polos=[...new Set(patch.polos.map(clean).filter(Boolean))];
  if(patch.courseProductMap&&typeof patch.courseProductMap==='object')next.courseProductMap={...current.courseProductMap,...patch.courseProductMap};
  db.settings.matriculas=next;save();return next;
}
function canonicalPolo(raw,polos){
  let v=stripEmoji(raw).replace(/^polo\s*/i,'').replace(/^polo/i,'').replace(/\s*-\s*sp\s*$/i,'').replace(/\s+sp\s*$/i,'').trim();
  const nv=norm(v).replace(/\s*[-/]\s*/g,' ');
  for(const p of [...polos].sort((a,b)=>b.length-a.length)){
    const np=norm(p);
    if(nv===np||nv.endsWith(' '+np)||nv===np+' sp')return p;
  }
  return clean(v);
}
function sellerPolo(lines,polos){
  const skip=/^(nome|cpf|curso|primeira|demais|valor da primeira|bolsa solicitada|veio por meio|de onde veio|cupom|cod|codigo|código)\b/i;
  for(let i=lines.length-1;i>=0;i--){
    let line=stripEmoji(lines[i]);if(!line||skip.test(norm(line))||/^parab[eé]ns\b/i.test(line))continue;
    let m=line.match(/^(.+?)\s*\/\s*(?:polo\s*)?(.+)$/i);
    if(m){const seller=clean(m[1]),polo=canonicalPolo(m[2],polos);if(seller&&polo)return{seller,polo}}
    m=line.match(/^(.+?)\s*-\s*polo\s*(.+)$/i);
    if(m){const seller=clean(m[1]),polo=canonicalPolo(m[2],polos);if(seller&&polo)return{seller,polo}}
    m=line.match(/^(.+?)\s+polo\s+(.+)$/i);
    if(m){const seller=clean(m[1]),polo=canonicalPolo(m[2],polos);if(seller&&polo)return{seller,polo}}
    const nl=norm(line).replace(/\s*-\s*sp\s*$/,'');
    for(const p of [...polos].sort((a,b)=>b.length-a.length)){
      const np=norm(p);if(nl===np)continue;
      if(nl.endsWith(' '+np)){
        const pos=norm(line).lastIndexOf(np);let seller=clean(line.slice(0,pos)).replace(/[\/-]\s*$/,'').replace(/polo\s*$/i,'').trim();
        if(seller)return{seller,polo:p};
      }
    }
  }
  return{seller:'',polo:''};
}
export function parseMatriculaBody(body='',customSettings=null){
  const cfg=customSettings||settings(),text=String(body||''),lines=text.split(/\r?\n/).map(clean).filter(Boolean);
  const cpf=lineMatch(lines,/^cpf\s*:?\s*(.+)$/i);
  const courseRaw=lineMatch(lines,/^curso\s*:?\s*(.+)$/i);
  // Candidato somente se possuir CPF + Curso. Isso evita falsos positivos como "90 leads com CPF".
  if(digits(cpf).length!==11||!courseRaw)return null;
  const name=lineMatch(lines,/^nome\s*:?\s*(.+)$/i);
  const first=lineMatch(lines,/^(?:valor\s+da\s+)?primeira\s*:?\s*(.+)$/i);
  const others=lineMatch(lines,/^(?:demais|bolsa\s+solicitada)\s*:?\s*(.+)$/i);
  const origin=lineMatch(lines,/^(?:veio\s+por\s+meio(?:\s+de)?|de\s+onde\s+veio)\s*:?\s*(.+)$/i);
  const coupon=lineMatch(lines,/^(?:cupom|cod|codigo|código)\s*:?\s*(.+)$/i);
  let product='',course=courseRaw;
  if(courseRaw.includes('/')){
    const [head,...rest]=courseRaw.split('/');const p=canonicalProduct(head);
    if(p){product=p;course=clean(rest.join('/'))||clean(head)}
  }
  if(!product){product=canonicalProduct((cfg.courseProductMap||{})[norm(course)]||'')}
  const sp=sellerPolo(lines,cfg.polos||[]);
  const missing=[];if(!name)missing.push('nome');if(!course)missing.push('curso');if(!product)missing.push('produto');if(!sp.seller)missing.push('vendedor');if(!sp.polo)missing.push('polo');
  return {name,cpf,course,product,origin,first,others,coupon,seller:sp.seller,polo:sp.polo,missing};
}
function groupInfo(message){
  const db=all(),g=db.groups.find(x=>x.id===message.groupId)||null,cv=db.conversations.find(x=>x.id===message.conversationId)||null,ct=cv?db.contacts.find(x=>x.id===cv.contactId):null;
  return {group:g,groupName:g?.subject||ct?.name||'Grupo WhatsApp',groupJid:g?.jid||ct?.whatsappJid||message.remoteJid||null};
}
function allowedGroup(message,cfg){if(!message?.isGroup)return false;if(cfg.monitorAllGroups)return true;return cfg.groupIds.includes(String(message.groupId||''))}
function duplicateKey(hash,course){return `${hash}|${norm(course)}`}
export function processMatriculaMessage(message,{force=false}={}){
  if(!message?.isGroup||!message?.body)return null;
  const db=all(),cfg=settings();if(!force&&(!cfg.enabled||!allowedGroup(message,cfg)))return null;
  const sourceExisting=(db.matriculas||[]).find(x=>x.sourceMessageId===message.id||(message.externalId&&x.sourceExternalId===message.externalId));
  if(sourceExisting){const cv=db.conversations.find(x=>x.id===message.conversationId),connId=message.instanceId||cv?.instanceId||null;if(connId){sourceExisting.capturedByConnectionIds=[...new Set([...(sourceExisting.capturedByConnectionIds||[]),connId])];sourceExisting.updatedAt=Date.now();save();}return sourceExisting;}
  const parsed=parseMatriculaBody(message.body,cfg);if(!parsed)return null;
  const hash=cpfHash(parsed.cpf);if(!hash)return null;
  const key=duplicateKey(hash,parsed.course),existing=(db.matriculas||[]).find(x=>x.duplicateKey===key&&x.status!=='IGNORED');
  const gi=groupInfo(message),status=existing?'DUPLICATE':(parsed.missing.length?'REVIEW':'VALIDATED');
  const cv=db.conversations.find(x=>x.id===message.conversationId)||null,connectionId=message.instanceId||cv?.instanceId||null;
  const row={id:uid('mat'),sourceMessageId:message.id,sourceExternalId:message.externalId||null,sourceConnectionId:connectionId,capturedByConnectionIds:connectionId?[connectionId]:[],conversationId:message.conversationId,groupId:message.groupId||gi.group?.id||null,groupName:gi.groupName,groupJid:gi.groupJid,postedBy:message.senderName||null,participantJid:message.participantJid||null,messageDirection:message.direction||null,messageType:message.type||null,messageAt:Number(message.createdAt||Date.now()),detectedAt:Date.now(),name:parsed.name,cpfMasked:cpfMask(parsed.cpf),cpfHash:hash,duplicateKey:key,seller:parsed.seller,polo:parsed.polo,product:parsed.product,course:parsed.course,origin:parsed.origin,firstPayment:parsed.first,otherPayments:parsed.others,coupon:parsed.coupon,status,missing:parsed.missing,duplicateOf:existing?.id||null};
  if(!Array.isArray(db.matriculas))db.matriculas=[];db.matriculas.push(row);save();pushLog('MATRICULA_DETECTED',{matriculaId:row.id,messageId:message.id,externalId:message.externalId||null,groupId:row.groupId,status:row.status,seller:row.seller||null,polo:row.polo||null,product:row.product||null,duplicateOf:row.duplicateOf||null});return row;
}
export function reprocessMatriculas({reset=false}={}){
  const db=all(),cfg=settings();if(reset)db.matriculas=[];
  const before=db.matriculas.length;let candidates=0;
  for(const m of [...db.messages].sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0))){if(!m?.isGroup||!m?.body||!allowedGroup(m,cfg))continue;const parsed=parseMatriculaBody(m.body,cfg);if(!parsed)continue;candidates++;processMatriculaMessage(m,{force:true})}
  save();return {before,after:db.matriculas.length,created:Math.max(0,db.matriculas.length-before),candidates};
}
export function updateMatricula(id,patch={}){
  const db=all(),row=(db.matriculas||[]).find(x=>x.id===id);if(!row)return null;
  for(const k of ['name','seller','polo','product','course','origin','firstPayment','otherPayments','coupon'])if(k in patch)row[k]=clean(patch[k]);
  if(patch.learnCourse&&row.course&&row.product){const cfg=settings();cfg.courseProductMap[norm(row.course)]=row.product;db.settings.matriculas=cfg}
  const missing=[];if(!row.name)missing.push('nome');if(!row.course)missing.push('curso');if(!row.product)missing.push('produto');if(!row.seller)missing.push('vendedor');if(!row.polo)missing.push('polo');row.missing=missing;
  row.duplicateKey=`${row.cpfHash}|${norm(row.course)}`;const existing=(db.matriculas||[]).find(x=>x.id!==row.id&&x.duplicateKey===row.duplicateKey&&x.status!=='IGNORED');row.status=existing?'DUPLICATE':(missing.length?'REVIEW':'VALIDATED');row.duplicateOf=existing?.id||null;row.updatedAt=Date.now();save();pushLog('MATRICULA_UPDATED',{matriculaId:id,status:row.status});return row;
}
export function deleteMatricula(id){const db=all(),i=(db.matriculas||[]).findIndex(x=>x.id===id);if(i<0)return false;db.matriculas.splice(i,1);save();pushLog('MATRICULA_DELETED',{matriculaId:id});return true}
export function matriculaPublic(row={}){const {cpfHash,...safe}=row;return safe}
