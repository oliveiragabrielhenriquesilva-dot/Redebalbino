# Emissor automático de boas-vindas

Este processo conecta o WhatsApp Web em um computador da equipe e consulta, por HTTPS, a fila do sistema de Matrículas. Ele não abre portas de entrada no computador. O envio é automático, sem aprovação por mensagem.

## Preparação

1. Instale Node.js 24.
2. Crie um token longo e aleatório e configure o mesmo valor em `BALBINO_WELCOME_WORKER_TOKEN` no ambiente do sistema de Matrículas (Hostinger) e no `.env` deste aplicativo.
3. Configure no `.env` deste aplicativo:
   - `MATRICULAS_API_URL=https://redebalbino.com.br/matriculas`
   - `BALBINO_WELCOME_WORKER_TOKEN=mesmo-token-do-servidor`
   - opcionalmente `BALBINO_WELCOME_DAILY_LIMIT=25`, `BALBINO_WELCOME_MIN_INTERVAL_SECONDS=60`, `BALBINO_WELCOME_TIMEZONE=America/Sao_Paulo`
4. Execute `npm install` e `npm start`.
5. Na primeira execução, vincule a sessão pelo QR exibido no terminal. A sessão é salva localmente em `~/.central-balbino/boas-vindas`.

O processo só envia entre 08:00 e 18:00 no fuso configurado, limitado à quantidade diária. Se o computador ou a conexão estiverem desligados, as mensagens ficam pendentes e o envio automático continua quando o processo voltar.

## Migração segura

Este emissor usa a API autenticada do sistema de Matrículas. Ao configurar o token no servidor, o envio direto pelo Balbino Chat é suspenso para evitar mensagens duplicadas. Faça isso somente quando o worker estiver instalado, vinculado e conectado. Mantenha o Balbino Chat ativo durante a validação; o desligamento definitivo do Chat e a migração das publicações do Gerador de Artes são etapas separadas.

## Observação

O envio usa uma conexão WhatsApp Web. Ele não substitui a API oficial e está sujeito às regras e limitações aplicáveis ao WhatsApp. Não há garantia de entrega caso a conta ou a conexão sejam desconectadas.
