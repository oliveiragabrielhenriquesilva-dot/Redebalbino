// Uso: npm run migrar            -> aplica migrações pendentes
//      npm run migrar -- down    -> reverte a última migração (pede GO_NEGOCIA_CONFIRMAR_REVERSAO=1)
//      npm run migrar -- status  -> lista migrações aplicadas
import fs from 'node:fs';
import { config, env } from '../src/config.js';
import { abrirBanco, migrar, reverterUltima, migracoesAplicadas, fecharBanco } from '../src/db.js';

const acao = process.argv[2] || 'up';
const c = config();
abrirBanco(c.dbFile);
if (acao === 'status') console.log('Aplicadas:', migracoesAplicadas().join(', ') || '(nenhuma)', '\nBanco:', c.dbFile);
else if (acao === 'down') {
  if (env('CONFIRMAR_REVERSAO') !== '1') { console.error('Reversão apaga as tabelas da migração. Faça backup e rode com GO_NEGOCIA_CONFIRMAR_REVERSAO=1.'); process.exit(1); }
  const copia = `${c.dbFile}.antes-reversao-${Date.now()}`;
  fecharBanco();
  if (fs.existsSync(c.dbFile)) fs.copyFileSync(c.dbFile, copia);
  abrirBanco(c.dbFile);
  console.log('Backup:', copia, '\nRevertida:', reverterUltima() || '(nada a reverter)');
} else console.log('Novas migrações:', migrar().join(', ') || '(nenhuma)', '\nBanco:', c.dbFile);
fecharBanco();
