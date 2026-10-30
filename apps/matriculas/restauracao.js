'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const tabelas=['usuarios','sessoes','config','polos','tutores','matriculas','ciclos','produtos','metas'];
function validarBackup(arq){
  let b;
  try{
    b=new DatabaseSync(arq,{readOnly:true});
    if(b.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('O arquivo apresenta falha de integridade.');
    const ts=new Set(b.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
    if(tabelas.some(t=>!ts.has(t)))throw new Error('Este arquivo não é um backup compatível do sistema.');
    const cols=new Set(b.prepare('PRAGMA table_info(matriculas)').all().map(x=>x.name));
    if(['id','ciclo_id','polo_id','tutor_id','produto_id','data','valor'].some(x=>!cols.has(x)))throw new Error('Estrutura de matrículas incompatível.');
    if(b.prepare('PRAGMA foreign_key_check').all().length)throw new Error('O backup possui referências inválidas.');
    return {matriculas:b.prepare('SELECT COUNT(*) n FROM matriculas').get().n};
  }catch(e){throw new Error('Backup inválido: '+e.message);}finally{if(b)b.close();}
}
function preparar(dataDir,base64){
  if(typeof base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||base64.length>57*1024*1024)throw new Error('Conteúdo inválido ou maior que 40 MB.');
  const buf=Buffer.from(base64,'base64');if(buf.length>40*1024*1024||buf.subarray(0,16).toString()!=='SQLite format 3\u0000')throw new Error('Selecione um backup SQLite .db de até 40 MB.');
  const tmp=path.join(dataDir,'restauracao-validacao-'+crypto.randomBytes(8).toString('hex')+'.db');
  try{fs.writeFileSync(tmp,buf,{mode:0o600});const r=validarBackup(tmp);fs.renameSync(tmp,path.join(dataDir,'restauracao-pendente.db'));return r;}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function aplicarPendente(dataDir){
  const pendente=path.join(dataDir,'restauracao-pendente.db');if(!fs.existsSync(pendente))return;
  validarBackup(pendente);
  const destino=path.join(dataDir,'matriculas.db'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),backups=path.join(dataDir,'backups');
  fs.mkdirSync(backups,{recursive:true});
  if(fs.existsSync(destino)){
    const atual=new DatabaseSync(destino);
    try{const copia=path.join(backups,'antes-restauracao-'+stamp+'.db');atual.exec("VACUUM INTO '"+copia.replace(/'/g,"''")+"'");}finally{atual.close();}
  }
  // O servidor anterior já deve estar encerrado: o bloqueio de instância é adquirido antes daqui.
  const novo=path.join(dataDir,'restauracao-pronta.db');fs.copyFileSync(pendente,novo);
  const b=new DatabaseSync(novo);try{b.exec('DELETE FROM sessoes');}finally{b.close();}
  const antigo=path.join(dataDir,'restauracao-anterior.db');
  if(fs.existsSync(antigo))fs.unlinkSync(antigo);
  for(const ext of ['-wal','-shm'])if(fs.existsSync(destino+ext))fs.unlinkSync(destino+ext);
  if(fs.existsSync(destino))fs.renameSync(destino,antigo);
  try{fs.renameSync(novo,destino);}catch(e){if(fs.existsSync(antigo))fs.renameSync(antigo,destino);throw e;}
  fs.unlinkSync(pendente);if(fs.existsSync(antigo))fs.unlinkSync(antigo);
  console.log('Backup restaurado. A base anterior foi preservada em dados/backups. Entre novamente com um usuário do backup.');
}
function bloquearInstancia(dataDir){
  fs.mkdirSync(dataDir,{recursive:true});const arq=path.join(dataDir,'servidor.lock');
  function criar(){fs.writeFileSync(arq,String(process.pid),{flag:'wx'});}
  try{criar();}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(fs.readFileSync(arq,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw new Error('Bloqueio inválido. Confira se há outro servidor aberto antes de remover dados/servidor.lock.');let vivo=true;try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')vivo=false;}if(vivo)throw new Error('O sistema já está aberto. Feche o servidor anterior antes de iniciar outra instância.');fs.unlinkSync(arq);criar();}
  const limpar=()=>{try{if(fs.readFileSync(arq,'utf8')===String(process.pid))fs.unlinkSync(arq);}catch{}};
  process.on('exit',limpar);for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{limpar();process.exit(0);});
}
module.exports={validarBackup,preparar,aplicarPendente,bloquearInstancia};
