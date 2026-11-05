# Transição de marca: Olivelo → GO Negocia

Data: 05/11/2026 · versão 0.2.0 · branch `go-negocia/identidade` (sobre o commit `c37afdc` do incremento 1).

## O que mudou

| Item | Antes | Agora | Compatibilidade |
|---|---|---|---|
| Nome visível | Olivelo | **GO Negocia** | — |
| Assinatura | Negociação financeira para escolas | **Atendimento financeiro para escolas** (texto separado do logo, só no login) | — |
| Pasta do app | `apps/olivelo` | `apps/go-negocia` | Nunca foi publicada; nenhum consumidor externo. Ao extrair o zip novo, apague a pasta antiga. |
| Pacote npm | `olivelo` | `go-negocia` | Pacote privado, sem dependentes. |
| Variáveis de ambiente | `OLIVELO_*` | `GO_NEGOCIA_*` | **Alias:** `OLIVELO_*` continua aceito quando o nome novo não está definido (`src/config.js`, função `env`). O nome novo tem prioridade. |
| Arquivo do banco | `runtime/olivelo.sqlite` | `runtime/go-negocia.sqlite` | Se só existir `olivelo.sqlite` na pasta de runtime, ele continua sendo usado (sem cópia, sem perda). Para migrar o nome: pare o servidor e renomeie os três arquivos (`.sqlite`, `-wal`, `-shm`). |
| Cookie de sessão | `olivelo.sid` | `go_negocia.sid` | O cookie antigo ainda é lido (sessões abertas continuam válidas); login e logout o expiram. A tabela `sessoes` não mudou. |
| Logs | `[olivelo]` | `[go-negocia]` | — |
| Senha dos usuários de demonstração | `olivelo-demo-2026` | `go-negocia-demo-2026` | Só para bancos criados pelo seed novo; bancos de demo antigos mantêm a senha antiga. |
| Primeiro contato no WhatsApp | "Aqui é a Olivelo, em nome de {escola}" | "Aqui é {atendente}, da GO Negocia. Somos a equipe de atendimento financeiro {do/da/de} {escola}." | Modelo da Meta precisa de nova aprovação — ver `modelos-whatsapp.md`. Mensagens já gravadas não são alteradas (histórico). |
| Assets | `logo-olivelo.png`, `simbolo-olivelo.png`, favicon antigo | `logo-go-negocia*.png`, `monograma-go*.png`, favicons, ícones 180/192/512 | Assets antigos removidos (sem referências). |

Rotas da API, esquema do banco, permissões, separação entre instituições, importação e conexões **não mudaram**.

## Ocorrências de "Olivelo" mantidas de propósito

| Onde | Motivo |
|---|---|
| `src/config.js` (`OLIVELO_${nome}`, `olivelo.sqlite`) | Alias de transição de variáveis e banco. Pode sair quando nenhum ambiente usar mais os nomes antigos. |
| `server.js` (`COOKIE_ANTERIOR = 'olivelo.sid'`) | Aceitar e expirar sessões abertas antes da troca. Pode sair depois de 12 h (duração máxima da sessão) do deploy. |
| `.env.example` (comentário) | Avisa que o prefixo antigo ainda funciona. |
| `test/incremento1.test.js` | Testes do alias, do cookie antigo e da remoção do asset antigo. |
| `DIAGNOSTICO.md`, este arquivo, `README.md` (link) | Registro histórico. |
| Histórico do git (commit `c37afdc`, branch `olivelo/incremento-1`) | Rastreabilidade; não se reescreve histórico. |
