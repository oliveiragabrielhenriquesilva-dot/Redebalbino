# Central Balbino — Hostinger

Uma aplicação Node.js única encaminha os três sistemas, mantendo cada código e banco separados:

- `https://redebalbino.com.br/chat/`
- `https://redebalbino.com.br/matriculas/`
- `https://redebalbino.com.br/artes/`
- `https://redebalbino.com.br/informa/` — Balbino Informa (Calendário Administrativo Unicesumar)
- `https://redebalbino.com.br/oportunidades/` — Balbino Oportunidades (usa o banco e os acessos do Matrículas; ver `DOCUMENTACAO/BALBINO_OPORTUNIDADES.md`)

## Implantação

1. Use Node.js 24 ou superior.
2. No hPanel, importe este repositório GitHub como aplicativo Node.js na raiz de `redebalbino.com.br`.
3. Comando de inicialização: `npm start`.
4. Cadastre estas variáveis de ambiente no hPanel. Use senhas próprias com pelo menos 12 caracteres:
   - `GOCHAT_ADMIN_USER` (ex.: `admin`)
   - `GOCHAT_ADMIN_PASSWORD`
   - `ARTES_ADMIN_PASSWORD`
   - `NODE_ENV=production`
5. Confirme que a pasta persistente `~/central-balbino-runtime` pode ser gravada. Ela guardará bancos, arquivos enviados, artes e sessão do WhatsApp.

Não coloque `.env`, bancos SQLite, sessão do WhatsApp ou arquivos de alunos no GitHub.

## Dados e requisitos do Gerador de Artes

O código preserva SQLite. O phpMyAdmin administra MySQL e não abre os bancos SQLite; usar MySQL no Gerador de Artes exige uma migração separada do módulo de banco. Os bancos e arquivos do usuário devem ser transferidos à pasta persistente fora do GitHub.

O Gerador de Artes agora usa Chromium headless por pacote Node para renderizar imagens no servidor. Se a hospedagem não permitir a extração/execução do Chromium, a geração de artes precisará de outro ambiente compatível.

O Balbino Chat inicia sem sessão do WhatsApp nesta cópia. Após a publicação, conecte o número pelo QR Code; a sessão será guardada no armazenamento persistente.

Consulte `README-HOSTINGER.md` para detalhes técnicos do roteador e das rotas.
