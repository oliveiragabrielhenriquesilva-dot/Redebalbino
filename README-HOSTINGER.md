# Central Balbino — implantação na Hostinger

O domínio `redebalbino.com.br` usará os caminhos `/chat`, `/matriculas`, `/artes` e `/informa`.
O projeto raiz é uma aplicação Node.js 24 que encaminha cada caminho ao respectivo sistema.

## Requisitos de implantação

- Node.js 24 ou superior.
- Diretório gravável e persistente. Por padrão, os dados ficam em `~/central-balbino-runtime`; se necessário, ajuste `BALBINO_RUNTIME_DIR` para uma pasta persistente da sua hospedagem.
- Definir `GOCHAT_ADMIN_USER`, `GOCHAT_ADMIN_PASSWORD` e `ARTES_ADMIN_PASSWORD` nas variáveis de ambiente do aplicativo.
- Use uma senha forte e exclusiva para o Portal (12 caracteres ou mais). Renomeie o usuário administrador `admin` em **Usuários e acessos** quando a instalação já estiver configurada; o sistema não altera esse nome automaticamente.
- Comando de inicialização: `npm start`.

Não publique sem configurar as duas senhas. Não coloque credenciais no repositório.

## Dados

Os bancos locais, sessões do WhatsApp, arquivos de alunos e catálogo comercial foram deixados fora do GitHub. A primeira inicialização cria bancos novos. Para manter os dados atuais, copie os bancos SQLite pelo gerenciador de arquivos da hospedagem para `~/central-balbino-runtime/matriculas/matriculas.db` e `~/central-balbino-runtime/artes/sistema.db` antes de iniciar o app; copie também os arquivos de mídia necessários para as pastas persistentes. Pare o app antes da cópia e reinicie depois.

Matrículas e Gerador de Artes usam SQLite nesta versão. O phpMyAdmin administra MySQL e não abre SQLite. Migrar o Gerador de Artes para MySQL exige uma alteração separada no acesso ao banco; não é feita por este roteador. O catálogo comercial não acompanha o código: cadastre os cursos na interface após o primeiro acesso.

## Renderização de artes

O Gerador de Artes precisa de Chromium no ambiente Linux. Configure `CHROME_PATH` se o plano fornecer um binário Chromium/Chrome. O pacote local procura Edge/Chrome instalado, que não é garantido na hospedagem.

## Rotas

- `/chat/` — Balbino Chat
- `/matriculas/` — Acompanhamento de Matrículas
- `/artes/` — Gerador de Artes
- `/oportunidades/` — Balbino Oportunidades (banco e acessos do Matrículas; ver `DOCUMENTACAO/BALBINO_OPORTUNIDADES.md`)
- `/informa/` — Balbino Informa, consulta do Calendário Administrativo Unicesumar para todas as contas ativas do portal
- `/healthz` — saúde do roteador

Cada banco fica em seu diretório próprio sob `runtime/`.

O Balbino Informa usa a sessão central do portal e não exige login separado. Os dados vêm somente do Calendário Administrativo Unicesumar (https://secretaria-unicesumar.github.io/calendariounicesumar/): o servidor lê a planilha Google publicada por aquele site no máximo a cada 30 minutos e guarda uma cópia em `informa/calendario-unicesumar-cache.json`. Se a planilha não responder, usa a última cópia; sem cópia, mostra os dados base do código do site, com aviso na tela. O servidor precisa de acesso de saída a `docs.google.com`.

A área **Marco Regulatório – 51/2027** do Informa lê `apps/informa/marco-regulatorio-51-2027.json` (resumo dos slides da Conexão Especial de Início de Processo 51/2027 – Pedagógico). Para corrigir ou acrescentar conteúdo, edite esse arquivo: destaques, seções, quadro de atividades por curso, portfólio e perguntas que alimentam a busca.

## Chat suspenso na hospedagem — 16/11/2026

O gateway não carrega o Balbino Chat, suas conexões WhatsApp ou suas rotinas. `/chat` e seus subcaminhos retornam HTTP 410, o atalho deixa de aparecer no portal e `/healthz` informa `chat: disabled`. As tentativas automáticas de envio e consulta de boas-vindas ao Chat também ficam suspensas, sem criar o temporizador de consulta. Os dados, sessões e pendências são preservados. Matrículas, Oportunidades e Informa continuam com a inicialização existente. Esta suspensão é definida no código do gateway (`BALBINO_CHAT_DISABLED=1`).
