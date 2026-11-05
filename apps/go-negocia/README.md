# GO Negocia

*Atendimento financeiro para escolas* — incremento 1: instituições e permissões, importação de carteira,
consulta no contexto do atendimento e fila manual com próxima ação. WhatsApp pela API oficial (Meta) ou em modo de teste.

Diagnóstico da base e plano: [DIAGNOSTICO.md](DIAGNOSTICO.md). Troca de marca Olivelo → GO Negocia e compatibilidade: [docs/TRANSICAO-GO-NEGOCIA.md](docs/TRANSICAO-GO-NEGOCIA.md). Modelos de mensagem: [docs/modelos-whatsapp.md](docs/modelos-whatsapp.md).

## Rodar localmente

Requer Node 22.5+ (o Balbino Chat pede 24; ambos funcionam). Sem `npm install`: não há dependências.

```bash
cd apps/go-negocia
cp .env.example .env              # ajuste GO_NEGOCIA_ADMIN_SENHA (mín. 10 caracteres) para produção

# Demonstração com dados sintéticos (banco separado):
GO_NEGOCIA_RUNTIME_DIR=./runtime-demo npm run seed
GO_NEGOCIA_RUNTIME_DIR=./runtime-demo npm start      # http://127.0.0.1:3101
```

Usuários da demonstração (senha `go-negocia-demo-2026`): `admin`, `supervisora`, `atendente.horizonte`,
`atendente.centro` (só Unidade Centro), `atendente.valeverde`, `representante.horizonte`.
Duas instituições fictícias; o número sintético 00000000001 existe nas duas, para pessoas diferentes.

## Testes

```bash
npm test     # 13 testes, banco temporário, nenhum envio real
```

Cobrem: importação CSV e XLSX com rejeições e motivos; reimportação sem duplicar; carteira posterior com alteração,
ausência (sem baixa) e arquivo antigo; acesso cruzado por URL/API (instituição, unidade, perfil); mesmo telefone em
duas instituições; fila com próxima ação, retorno combinado e trava; contato ativo pela conexão certa, sem débito antes
da confirmação; webhook oficial com assinatura; envio oficial com Meta simulada; auditoria; migração reversível.

## Migrações

```bash
npm run migrar                                   # aplica pendentes
npm run migrar -- status
GO_NEGOCIA_CONFIRMAR_REVERSAO=1 npm run migrar -- down   # copia o banco e reverte a última
```

O banco é exclusivo da GO Negocia (`go-negocia.sqlite`) (`GO_NEGOCIA_RUNTIME_DIR`). Nunca aponte para a pasta de runtime do Balbino Chat.

## WhatsApp — API oficial

1. Cadastre a conexão em **Administração › Instituições** com modo *API oficial*, Phone Number ID, WABA ID,
   o **nome** da variável de ambiente do token (o token não vai para o banco) e o nome do modelo de primeiro contato aprovado.
2. No servidor: `META_TOKEN_<...>=` (token), `META_APP_SECRET=` (assinatura do webhook), `GO_NEGOCIA_WEBHOOK_VERIFY_TOKEN=`.
3. Webhook na Meta: `https://<domínio>/webhooks/whatsapp`.
4. `GO_NEGOCIA_ENVIO_REAL=1` só depois da aprovação da operação. Enquanto for `0`, mensagens são registradas como
   "não enviada (envio real desligado)".

Regras aplicadas: a instituição de uma mensagem recebida vem do Phone Number ID da conexão; um número só pode
pertencer a uma conexão; fora da janela de 24h, só o modelo aprovado; antes da confirmação de identidade, mensagens
com valores/débito são bloqueadas; no máximo um envio ativo por caso a cada 24h; retorno combinado bloqueia contato ativo.

## Decisões do piloto (ajustáveis)

- **Ausente na carteira** (só em arquivo "carteira completa"): o título continua em aberto, mas fica pausado e sinalizado até conferência.
- **Saldo desatualizado**: acima de 7 dias da data de referência (configurável por instituição), o contato ativo é bloqueado.
- **Verificação de identidade**: matrícula de um aluno vinculado ao responsável.
- **Documento**: só os 4 últimos dígitos são guardados. Telefone mascarado para o representante da instituição.
- **Importação**: só para quem tem acesso a todas as unidades da instituição (supervisor ou admin).

## Deploy automático na Hostinger

Crie um app Node.js separado no hPanel e importe este repositório pela integração GitHub.
Para o deploy isolado, selecione a branch `go-negocia` e a pasta `apps/go-negocia` como diretório raiz.
Use Node.js 24, gerenciador npm, tipo **Other** e `server.js` como arquivo de entrada.
A aplicação é executada diretamente por `npm start` e não gera pasta de build.
Se o hPanel exigir um comando de build, use `npm test` e mantenha a saída na raiz do app.

Configure as variáveis no ambiente do site:

| Variável | Valor |
| --- | --- |
| `HOST` | `0.0.0.0` |
| `COOKIE_SECURE` | `true` no endereço HTTPS do site |
| `GO_NEGOCIA_RUNTIME_DIR` | Caminho absoluto e gravável para uma pasta privada e persistente, fora de `hbuilds/` e `public_html/` |
| `GO_NEGOCIA_ADMIN_LOGIN` | Login escolhido para o primeiro acesso |
| `GO_NEGOCIA_ADMIN_SENHA` | Senha forte e exclusiva, armazenada no ambiente privado do site |
| `GO_NEGOCIA_ENVIO_REAL` | `0` no primeiro deploy |

Deixe a plataforma fornecer `PORT`. A aplicação executa as migrações e inicializa o primeiro
administrador no primeiro start quando as credenciais estão configuradas. A senha de
demonstração e o comando `npm run seed` são exclusivos do ambiente local de teste.

Depois do deploy, verifique `/healthz` e o login por HTTPS. Valide a persistência antes de
importar dados reais: crie um registro de teste, redeploy a mesma branch e confira que o
registro continua no mesmo banco. Use a opção de implantação automática da integração
GitHub para publicar novos commits da branch configurada.
