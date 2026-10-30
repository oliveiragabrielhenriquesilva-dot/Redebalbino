# Central Balbino — implantação na Hostinger

O domínio `redebalbino.com.br` usará os caminhos `/chat`, `/matriculas` e `/artes`.
O projeto raiz é uma aplicação Node.js 24 que encaminha cada caminho ao respectivo sistema.

## Requisitos de implantação

- Node.js 24 ou superior.
- Diretório gravável e persistente. Por padrão, os dados ficam em `~/central-balbino-runtime`; se necessário, ajuste `BALBINO_RUNTIME_DIR` para uma pasta persistente da sua hospedagem.
- Definir `GOCHAT_ADMIN_USER`, `GOCHAT_ADMIN_PASSWORD` e `ARTES_ADMIN_PASSWORD` nas variáveis de ambiente do aplicativo.
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
- `/healthz` — saúde do roteador

Cada banco fica em seu diretório próprio sob `runtime/`.
