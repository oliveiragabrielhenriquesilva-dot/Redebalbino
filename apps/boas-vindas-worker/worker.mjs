import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const item=line.trim();
      if(!item||item.startsWith('#'))continue;
      const i=item.indexOf('=');
      if(i>0&&process.env[item.slice(0,i).trim()]==null)process.env[item.slice(0,i).trim()]=item.slice(i+1).trim().replace(/^['"]|['"]$/g,'');
    }
  } catch {}
}
const DIR=path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(DIR,'.env'));
const BASE=String(process.env.MATRICULAS_API_URL||'https://redebalbino.com.br/matriculas').replace(/\/$/,'');
const TOKEN=String(process.env.BALBINO_WELCOME_WORKER_TOKEN||'').trim();
const DATA=path.resolve(process.env.BALBINO_WELCOME_DATA_DIR||path.join(os.homedir(),'.central-balbino','boas-vindas'));
const SESSION=path.join(DATA,'whatsapp-session');
const STATE_FILE=path.join(DATA,'state.json');
const DAILY_LIMIT=Math.max(1,Number(process.env.BALBINO_WELCOME_DAILY_LIMIT)||25);
const MIN_INTERVAL=Math.max(30,Number(process.env.BALBINO_WELCOME_MIN_INTERVAL_SECONDS)||60)*1000;
const TIMEZONE=process.env.BALBINO_WELCOME_TIMEZONE||'America/Sao_Paulo';
if(!TOKEN)throw new Error('Configure BALBINO_WELCOME_WORKER_TOKEN no arquivo .env.');
fs.mkdirSync(SESSION,{recursive:true});
let state={day:'',sentToday:0,lastSentAt:0,sentIds:{}};
try{state={...state,...JSON.parse(fs.readFileSync(STATE_FILE,'utf8'))}}catch{}
const persist=()=>fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2),{mode:0o600});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const logger={level:'silent',child(){return this},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}};
let socket=null,connected=false,stopping=false,polling=false;
let qrModule=null,DisconnectReason=null;

function horaLocal(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  return Number(parts.find(x=>x.type==='hour')?.value||0)*60+Number(parts.find(x=>x.type==='minute')?.value||0);
}
function diaLocal(){return new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function autorizadoHorario(){const m=horaLocal();return m>=8*60&&m<18*60}
async function api(route,options={}){
  const response=await fetch(BASE+route,{...options,headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||`Servidor respondeu HTTP ${response.status}`);
  return body;
}
function jidFor(phone){
  const digits=String(phone||'').replace(/\D/g,'');
  if(digits.length===10||digits.length===11)return '55'+digits+'@s.whatsapp.net';
  if(digits.length>=12&&digits.length<=13&&digits.startsWith('55'))return digits+'@s.whatsapp.net';
  throw new Error('Telefone inválido ou sem DDD.');
}
async function registrarResultado(id,status,error=''){
  await api('/api/worker/boas-vindas/status',{method:'POST',body:JSON.stringify({id_externo:id,status,erro:error})});
}
async function processarFila(){
  if(polling||!connected||stopping||!autorizadoHorario())return;
  const today=diaLocal();
  if(state.day!==today){state.day=today;state.sentToday=0;persist()}
  if(state.sentToday>=DAILY_LIMIT)return;
  polling=true;
  try{
    const {itens=[]}=await api('/api/worker/boas-vindas?limite=5');
    for(const item of itens){
      if(stopping||!connected||!autorizadoHorario()||state.sentToday>=DAILY_LIMIT)break;
      const now=Date.now(),wait=Math.max(0,(Number(state.lastSentAt)||0)+MIN_INTERVAL-now);
      if(wait)await sleep(wait);
      if(stopping||!connected||!autorizadoHorario())break;
      const id=String(item.id_externo||'');
      if(state.sentIds?.[id]){
        try{await registrarResultado(id,'ENVIADA');delete state.sentIds[id];persist();continue}
        catch(error){console.error(`Mensagem ${id} já enviada; aguardando confirmação do servidor:`,error.message);break}
      }
      try{
        const jid=jidFor(item.telefone);
        await socket.sendMessage(jid,{text:String(item.mensagem||'')});
        state.sentToday++;state.lastSentAt=Date.now();state.sentIds??={};state.sentIds[id]=Date.now();
        const ids=Object.keys(state.sentIds);for(const oldId of ids.slice(0,Math.max(0,ids.length-5000)))delete state.sentIds[oldId];
        persist();
        await registrarResultado(id,'ENVIADA');
        delete state.sentIds[id];persist();
        console.log(`Boas-vindas enviada automaticamente para ${item.nome||jid}.`);
      }catch(error){
        console.error(`Falha no envio ${id}:`,error.message);
        if(state.sentIds?.[id]){console.error('A mensagem foi enviada; vou tentar apenas confirmar o status na próxima consulta.');break}
        try{await registrarResultado(id,'ERRO',error.message)}catch(reportError){console.error('Não foi possível registrar o erro:',reportError.message)}
      }
    }
  }catch(error){console.error('Falha ao consultar a fila:',error.message)}
  finally{polling=false}
}
async function connect(){
  const baileys=await import('@whiskeysockets/baileys');
  qrModule=(await import('qrcode')).default;
  DisconnectReason=baileys.DisconnectReason;
  const {state:authState,saveCreds}=await baileys.useMultiFileAuthState(SESSION);
  socket=baileys.default({auth:authState,browser:baileys.Browsers?.macOS?baileys.Browsers.macOS('Chrome'):['Mac OS','Chrome','14.4.1'],logger,markOnlineOnConnect:false,syncFullHistory:false});
  socket.ev.on('creds.update',saveCreds);
  socket.ev.on('connection.update',async update=>{
    if(update.qr){
      const qr=await qrModule.toString(update.qr,{type:'terminal',small:true}).catch(()=>update.qr);
      console.log('Leia este QR Code no WhatsApp > Aparelhos conectados:\n'+qr);
    }
    if(update.connection==='open'){connected=true;console.log('WhatsApp conectado. O envio automático está ativo.');processarFila()}
    if(update.connection==='close'){
      connected=false;
      const code=update.lastDisconnect?.error?.output?.statusCode;
      if(code===DisconnectReason.loggedOut){console.error('A sessão do WhatsApp foi encerrada. Remova a sessão local e vincule novamente.');return}
      if(!stopping){console.warn('WhatsApp desconectado; tentando reconectar em 5 segundos.');setTimeout(()=>connect().catch(e=>console.error('Falha ao reconectar:',e.message)),5000).unref?.()}
    }
  });
}
async function start(){
  console.log('Emissor automático de boas-vindas iniciado.');
  console.log('Fila:',BASE,' | Horário:',TIMEZONE,'08:00–18:00 | Limite diário:',DAILY_LIMIT);
  await connect();
  const timer=setInterval(()=>{if(!connected) return;processarFila()},30000);
  const stop=async()=>{if(stopping)return;stopping=true;clearInterval(timer);try{socket?.end(undefined)}catch{};process.exit(0)};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
start().catch(error=>{console.error(error.stack||error);process.exit(1)});
