# Rede Balbino — Coletor de negociação v0.1.0

## Instalação no Chrome
1. Extraia este ZIP para uma pasta permanente no computador.
2. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Selecione a pasta que contém `manifest.json`.
4. Abra o portal oficial, faça login normalmente e recarregue a página após a instalação.
5. Na lista de **Atendimentos**, aplique os filtros desejados. Clique no ícone da extensão para abrir o coletor.
6. Escolha a aba do portal e inicie com **10 consultas**, sem percorrer próximas páginas.
7. Compare os valores da prévia com o portal e exporte CSV ou JSON.

## Funcionamento
O coletor lê RA, ação, curso, saldo devedor, desconto, valor à vista, quantidade de cobranças e horário. Não captura nomes, senhas, e-mails ou telefones. Usa a sessão já aberta; não armazena credenciais. Os resultados ficam no armazenamento local da extensão neste perfil do Chrome, até serem substituídos ou a extensão ser removida. Os arquivos exportados ficam sob seu controle.

Não altera registros nem clica em Gerar negociação ou Salvar sem negociação. A navegação abre somente as telas de consulta e, quando autorizado, a próxima página da lista. A emissão dos acordos continua exclusivamente no portal oficial.

O valor à vista é lido da tela, sem aplicar um desconto fixo. O coletor verifica RA, ação, consistência dos valores e estabilidade da tela antes de registrar o resultado. Se não conseguir conferir, marca erro em vez de inventar valor. Valores são uma fotografia da consulta e podem mudar.

Mantenha a aba escolhida aberta e sem navegação manual durante a coleta. É possível trabalhar em outras abas. **Pausar** preserva os resultados; **Retomar** continua os pendentes. Se houver encerramento de sessão ou verificação de segurança, faça o acesso manualmente e retome. Se a página for recarregada, a coleta pausa. Tentar erros novamente repete apenas registros com erro. Não execute o mesmo lote em duas abas do portal.

Para vários alunos, marque **Percorrer próximas páginas** e escolha o limite (máximo 500). O lote começa na página atualmente visível, respeitando seus filtros. Registros repetidos com o mesmo RA e ação são consultados uma vez. Um novo lote substitui a prévia anterior: exporte antes.

Esta versão não integra automaticamente com a Rede Balbino na nuvem. O primeiro uso precisa ser validado no Chrome instalado no seu computador. Os testes automatizados cobrem leitura e controle do lote; não substituem essa validação. Mudanças no portal podem exigir atualização do coletor.
