# Calendário Acadêmico — Módulo 54/2026

A entrada principal do Portal e a navegação do Conecta abrem Calendário Acadêmico. Essa área apresenta um único card, Módulo 54/2026. O conteúdo do módulo contém abas independentes de disciplinas de 5 e 10 semanas, com filtros de etapa, disciplina e mês. Links diretos e os botões voltar/avançar do navegador conservam os níveis da navegação.

Datas transcritas exclusivamente da coluna Módulo 54 das duas imagens de Calendário Acadêmico Graduação 2026 fornecidas pelo usuário em 17/11/2026. Não foram importadas datas dos módulos 51, 52 ou 53. O período letivo é 28/09/2026–05/12/2026; as avaliações e publicações posteriores pertencem ao mesmo módulo e permanecem na agenda até 16/02/2027. A organização de 5 semanas diferencia 1ª e 2ª disciplina. O calendário de 10 semanas usa seus próprios prazos.

As datas estão em `apps/conecta/public/calendario.js`; o recurso exige a mesma sessão central do Conecta. Os estados próximo/em andamento/encerrado consideram os limites inclusivos e a data de São Paulo. A transcrição inclui o aviso original sobre provas online previstas na matriz e a necessidade de solicitação da substitutiva.

Correções dos prints: a barra compartilhada fica somente no Conecta. Matrículas conserva seu cabeçalho nativo, sem deslocamento de 58px. Os gráficos exibem o percentual de cada meta, quantidade realizada e meta superada quando aplicável. Cada comparação mostra seis itens inicialmente; os demais ficam em Ver mais. A marca improvisada “bc” foi removida e a entrada do Conecta ficou mais compacta.

Validação: 16 testes passaram. Incluem as datas distintas, as transições de estado dos prazos, o percurso área → módulo → duração, autenticação, permissões, persistência de tema e renderização dos gráficos. Verificação HTTP confirmou o novo JavaScript protegido e os quatro módulos ativos. A validação visual em navegador continua pendente; o ambiente impediu a inicialização do Chromium. A publicação na Hostinger deve usar o commit completo, sem migração de banco.
