import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lê .env da pasta do app (mesmo padrão do Balbino Chat), sem sobrescrever variáveis já definidas.
try {
  const envFile = path.join(appDir, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[k] == null) process.env[k] = v;
    }
  }
} catch { /* .env opcional */ }

export const VERSAO = '0.2.0';
export const NOME_PRODUTO = 'GO Negocia';

// Variáveis de ambiente: o nome novo é GO_NEGOCIA_*. O prefixo antigo OLIVELO_* continua aceito como
// alias de transição (ver docs/TRANSICAO-GO-NEGOCIA.md) para não quebrar .env e ambientes já configurados.
export function env(nome) {
  const novo = process.env[`GO_NEGOCIA_${nome}`];
  if (novo != null && novo !== '') return novo;
  return process.env[`OLIVELO_${nome}`];
}

// Banco: go-negocia.sqlite. Se só existir o arquivo do nome anterior na mesma pasta, ele continua sendo usado.
function arquivoBanco(runtime) {
  if (env('DB_FILE')) return env('DB_FILE');
  const novo = path.join(runtime, 'go-negocia.sqlite');
  const anterior = path.join(runtime, 'olivelo.sqlite');
  if (!fs.existsSync(novo) && fs.existsSync(anterior)) return anterior;
  return novo;
}

export function config() {
  const runtime = path.resolve(appDir, env('RUNTIME_DIR') || 'runtime');
  return {
    porta: Number(process.env.PORT || 3101),
    host: process.env.HOST || '127.0.0.1',
    runtimeDir: runtime,
    dbFile: arquivoBanco(runtime),
    cookieSeguro: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
    adminLogin: env('ADMIN_LOGIN') || 'admin',
    adminSenha: env('ADMIN_SENHA') || '',
    envioReal: env('ENVIO_REAL') === '1',
    metaAppSecret: process.env.META_APP_SECRET || '',
    webhookVerifyToken: env('WEBHOOK_VERIFY_TOKEN') || '',
    sessaoHoras: Number(env('SESSAO_HORAS') || 12),
    travaMinutos: Number(env('TRAVA_MINUTOS') || 30),
  };
}
