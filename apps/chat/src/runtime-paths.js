import fs from 'node:fs';
import path from 'node:path';

// Este módulo é carregado antes de server.js; por isso lê o .env cedo o bastante
// para que diretórios persistentes também funcionem fora do Docker.
try{
  const envFile=path.resolve(process.cwd(),'.env');
  if(fs.existsSync(envFile)){
    for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
      const t=line.trim();if(!t||t.startsWith('#'))continue;
      const i=t.indexOf('=');if(i<1)continue;
      const k=t.slice(0,i).trim(),v=t.slice(i+1).trim().replace(/^['"]|['"]$/g,'');
      if(process.env[k]==null)process.env[k]=v;
    }
  }
}catch{}

const root=path.resolve(process.env.BALBINO_RUNTIME_DIR||process.cwd());
export const runtimeRoot=root;
export const dataDir=path.resolve(process.env.BALBINO_DATA_DIR||path.join(root,'data'));
export const uploadsDir=path.resolve(process.env.BALBINO_UPLOADS_DIR||path.join(root,'uploads'));
export const sessionsDir=path.resolve(process.env.BALBINO_SESSIONS_DIR||path.join(root,'sessions'));
export const backupsDir=path.resolve(process.env.BALBINO_BACKUPS_DIR||path.join(root,'backups'));
export function uploadDiskPath(publicPath=''){
  const rel=String(publicPath||'').replace(/^\/?uploads\/?/i,'').replace(/^[/\\]+/,'');
  return path.join(uploadsDir,rel);
}
