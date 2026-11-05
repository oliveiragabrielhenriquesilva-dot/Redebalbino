// Popula um banco de DESENVOLVIMENTO com duas instituições fictícias e dados sintéticos.
// Recusa rodar em banco que já tenha instituições (não mistura com dados reais).
// Uso: GO_NEGOCIA_RUNTIME_DIR=./runtime-dev npm run seed
import path from 'node:path';
import { arquivoDemo } from './fixtures-sinteticas.js';
import { config, appDir } from '../src/config.js';
import { abrirBanco, migrar, um, fecharBanco } from '../src/db.js';
import { criarUsuario } from '../src/auth.js';
import { criarOrganizacao, criarUnidade, definirAcesso, criarConexao } from '../src/admin.js';
import { criarPrevia, aplicarLote } from '../src/importacao.js';
import { exigirEscopo } from '../src/escopo.js';
import { hoje } from '../src/util.js';

export const SENHA_DEMO = 'go-negocia-demo-2026';

export function popular() {
  if (um('SELECT 1 FROM organizacoes LIMIT 1')) throw new Error('Este banco já tem instituições. O seed só roda em banco vazio.');
  let adminId = um('SELECT id FROM usuarios WHERE admin=1 LIMIT 1')?.id;
  if (!adminId) adminId = criarUsuario({ nome: 'Admin GO Negocia (demo)', login: 'admin', senha: SENHA_DEMO, admin: true });
  const admin = { id: adminId, admin: true };

  const hz = criarOrganizacao(admin, { nome: 'Colégio Horizonte (fictício)' }).id;
  const cen = criarUnidade(admin, hz, { nome: 'Unidade Centro', codigo: 'CEN' }).id;
  criarUnidade(admin, hz, { nome: 'Unidade Jardim', codigo: 'JAR' });
  const vv = criarOrganizacao(admin, { nome: 'Escola Vale Verde (fictícia)' }).id;

  const cxHz = criarConexao(admin, hz, { nome: 'WhatsApp Horizonte (teste)', modo: 'TESTE', numero_exibicao: '(16) 3000-0001' });
  const cxVv = criarConexao(admin, vv, { nome: 'WhatsApp Vale Verde (teste)', modo: 'TESTE', numero_exibicao: '(16) 3000-0002' });

  const u = (nome, login) => criarUsuario({ nome, login, senha: SENHA_DEMO });
  const sup = u('Sílvia Supervisora', 'supervisora');
  const atA = u('André Atendente', 'atendente.horizonte');
  const atCen = u('Carla Atendente (só Centro)', 'atendente.centro');
  const atB = u('Bruno Atendente', 'atendente.valeverde');
  const repA = u('Rita Representante (Horizonte)', 'representante.horizonte');
  definirAcesso(admin, sup, hz, { papel: 'SUPERVISOR' });
  definirAcesso(admin, sup, vv, { papel: 'SUPERVISOR' });
  definirAcesso(admin, atA, hz, { papel: 'ATENDENTE' });
  definirAcesso(admin, atCen, hz, { papel: 'ATENDENTE', unidades: [cen] });
  definirAcesso(admin, atB, vv, { papel: 'ATENDENTE' });
  definirAcesso(admin, repA, hz, { papel: 'REPRESENTANTE' });

  const importar = (org, arquivo) => {
    const escopo = exigirEscopo(admin, org);
    const p = criarPrevia({ escopo, usuario: admin, arquivoNome: arquivo, conteudo: arquivoDemo(arquivo), dataReferencia: hoje() });
    return aplicarLote({ escopo, usuario: admin, loteId: p.id }).resumo;
  };
  const rHz = importar(hz, 'carteira-colegio-horizonte.csv');
  const rVv = importar(vv, 'carteira-escola-vale-verde.xlsx');
  return { hz, vv, cen, conexoes: { hz: cxHz, vv: cxVv }, usuarios: { admin: adminId, sup, atA, atCen, atB, repA }, resumos: { hz: rHz, vv: rVv } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(appDir, 'scripts', 'seed-sintetico.js')) {
  const c = config();
  abrirBanco(c.dbFile);
  migrar();
  const r = popular();
  fecharBanco();
  console.log('Banco:', c.dbFile);
  console.log('Horizonte:', r.resumos.hz);
  console.log('Vale Verde:', r.resumos.vv);
  console.log(`\nUsuários (senha de demonstração: ${SENHA_DEMO}): admin, supervisora, atendente.horizonte, atendente.centro, atendente.valeverde, representante.horizonte`);
}
