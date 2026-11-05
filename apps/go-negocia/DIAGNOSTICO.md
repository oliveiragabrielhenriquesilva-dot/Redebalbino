# GO Negocia — diagnóstico da base e plano

> Este diagnóstico foi escrito quando o projeto se chamava **Olivelo** (05/11/2026). O texto abaixo usa o nome atual;
> a troca está registrada em [docs/TRANSICAO-GO-NEGOCIA.md](docs/TRANSICAO-GO-NEGOCIA.md).

**Base examinada:** `Rede_Balbino_Chat_v0.15.0_GitHub_3modos.zip` (recebido em 05/11/2026). O pacote traz só
`apps/chat` + `package-lock.json` da raiz do monorepo `Redebalbino`; `server.js`, `portal-auth.js` da raiz e os
outros apps (Matrículas, Oportunidades etc.) **não vieram**. Não há hash de commit no pacote: neste repositório
local a base foi registrada como o commit `e2c4bf6` ("Base: Rede Balbino Chat v0.15.0") e o incremento 1 foi feito
na branch `olivelo/incremento-1` (nome histórico; a identidade nova está em `go-negocia/identidade`). "3 modos" no nome do zip são os modos de aparência (claro/escuro/híbrido), não modos de WhatsApp.

## O que existe e funciona (lido no código)

| Área | Situação real | Arquivos |
|---|---|---|
| Stack | Node ≥ 24, `node:http` puro, sem framework; front em JS puro (`app.js` 286 KB, `index.html` 235 KB) | `server.js`, `public/` |
| Persistência | SQLite (`node:sqlite`), mas o estado inteiro (usuários, contatos, conversas, pendências, configurações) é **um JSON único** na tabela `app_state`, regravado a cada alteração; só mensagens têm tabela própria | `src/store.js` (l. 235-245) |
| Autenticação | Sessão em memória (`Map`, perde no reinício), cookie `gochat.sid`, senha com scrypt. Modo embutido no portal confia no cabeçalho `x-balbino-portal` | `server.js` l. 49, 286 |
| Permissões | Papéis SUPER_ADMIN/SUPERVISOR/atendente + acesso por conexão, setor e grupo. **Padrão permissivo**: sem configuração, o usuário vê todas as conexões e setores | `server.js` l. 68 |
| Contatos | Únicos por telefone, globais — o mesmo telefone não pode existir em duas carteiras | `src/store.js` l. 350 |
| WhatsApp | **Só QR (Baileys 7.0.0-rc14)** está ligado. A API oficial foi removida na v0.15.0: o webhook `/webhooks/meta/whatsapp` responde 410, mas `src/providers/whatsapp-cloud.js` ainda existe sem uso | `src/providers/whatsapp-web.js`, `whatsapp-cloud.js` |
| Envio/recebimento | Recebimento por evento `messages.upsert` do Baileys → `processIncoming` (triagem/automação) → `addMessage`. Envio por `sendText` na conexão da conversa | `whatsapp-web.js`, `automation-engine.js` |
| Pendências | Funciona: protocolo `PEND-0001`, tipos, prazo, setor, responsável, aviso de conclusão pela mesma conexão, criação pelo bot | `server.js` (`/api/pendencias`), `store.js` (`createPendencia`) |
| Filas, triagem, histórico, auditoria | Funcionam no contexto de um único cliente (filas = setores) | `automation-engine.js`, `server.js` |

### Pontos de atenção encontrados na base

1. **Login de administrador com senha vazia.** Em `server.js` l. 286, se o usuário `admin` ainda não tem senha gravada
   e `GOCHAT_ADMIN_PASSWORD` está vazio (como no `.env.example`), `POST /api/auth/login` com `password: ""` entra como
   SUPER_ADMIN e grava a senha vazia. Recomendo corrigir no Balbino Chat independentemente da GO Negocia.
2. `x-balbino-portal`: seguro só se o servidor da raiz (não enviado) remover esse cabeçalho de requisições externas. Não deu para verificar.
3. Sem conceito de cliente/instituição: contatos, conversas, conexões e relatórios são de uma única operação.

## Decisão: app separado `apps/go-negocia` (menor risco)

Adaptar o Balbino Chat para várias instituições exigiria mudar contatos globais por telefone, o JSON único e o
padrão permissivo de acesso — mexendo num sistema em produção. A GO Negocia nasce como **app próprio no mesmo
monorepo**: mesmo estilo (Node puro, `node:sqlite`, scrypt, sem dependências), mas com banco, pasta de runtime,
porta, cookie, sessões e conexões próprios. Nada em `apps/chat` foi alterado.

| Reaproveitado | Adaptado | Criado |
|---|---|---|
| Padrão de servidor sem framework, leitura de `.env`, scrypt | Cliente da API oficial (`whatsapp-cloud.js` → `src/canais/oficial.js`: token por variável de ambiente, assinatura do webhook, extração de mensagens) | Modelo relacional com `organizacao_id` em todas as tabelas, sessões persistidas |
| Conceito de Pendências (protocolo, responsável, prazo) — entra no incremento 2 | Ideia de travar conversa (`lockConversation`) → trava de caso com expiração | Importação CSV/XLSX com prévia e lotes, fila de hoje, verificação de identidade |

QR (Baileys) não foi trazido: para cobrança ativa o risco de bloqueio do número é alto, e a API oficial voltou como canal principal.
O modo **TESTE** substitui o envio durante o piloto.

## Incrementos

| # | Escopo | Situação |
|---|---|---|
| 1 | Instituições/unidades, usuários e permissões, importação de carteira, consulta no atendimento, fila manual com próxima ação, conexões (oficial + teste) | **Implementado e testado** |
| 2 | Regras de negociação por instituição, propostas, acordos (estados separados), Pendências por título (contestação, comprovante, divergência), pausa por título | A fazer — tabela `titulos.bloqueio` já existe |
| 3 | Retorno financeiro (parcial, integral, direto, duplicidade, estorno, reprocessamento), relatório da instituição e exportação | A fazer — `lotes.tipo='RETORNO'` reservado (hoje responde 501) |

## Dados necessários antes da operação real

- De cada escola: layout real do arquivo de carteira, códigos de unidade, regra de verificação de identidade aprovada,
  texto do primeiro contato, horários/periodicidade permitidos e política de retenção.
- Da Meta: app, WABA, Phone Number ID por instituição, token permanente, modelo de primeiro contato aprovado.
- Da marca: SVG do logo/símbolo, versão negativa e fonte.
