# Navegação, aparência e gráficos — 17/11/2026

O Conecta passa a ter uma barra superior com Portal, Meus sistemas e seleção de aparência. O menu oferece Matrículas e Oportunidades apenas após verificar a permissão na sessão central. A marca lateral do Conecta usa uma assinatura tipográfica compacta.

Todos os módulos carregam o mesmo gerenciador de aparência. A seleção claro/escuro migra as preferências anteriores, persiste entre páginas e sincroniza abas do mesmo navegador. O Conecta recebeu estilos claros para início, catálogo, ficha de curso, argumentários e simulador. Relatórios impressos mantêm a paleta de papel.

O Painel de Matrículas ganhou a aba Gráficos, com meta × realizado por polo, resultado por produto e matrículas confirmadas por dia. Os três gráficos usam o recorte já autorizado de /api/painel, sem novas consultas ou dependências. Recortes sem comparação não exibem metas. O diário informa que não inclui Sede/Digital por não haver detalhamento por dia nessa fonte; os comparativos de polo/produto preservam a composição do painel. Valores diários também estão disponíveis em tabela.

Validação: 13 testes automatizados passaram, incluindo permissões e autenticação do gateway, contraste das paletas de Matrículas, migração/persistência de tema e renderização dos gráficos. Verificação HTTP com sessão temporária confirmou os quatro módulos ativos e os novos recursos. A validação visual em navegador não foi concluída porque o ambiente impediu a inicialização do Chromium.

Implantação: atualizar a aplicação Hostinger com este commit e reiniciar o processo Node. Não há migração de banco ou alteração de dados. Conferir após a publicação: menu do Conecta, temas no celular e computador, navegação entre módulos e aba Painel → Gráficos com os filtros reais.
