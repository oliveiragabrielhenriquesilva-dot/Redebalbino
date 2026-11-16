# Auditoria de temas do Matrículas — 16/11/2026

## Problemas confirmados no código

| Área | Causa | Correção |
| --- | --- | --- |
| Relatórios no tema escuro | style.css muda a folha para fundo escuro, mas as regras de .rel .rel-pagina continuam com texto escuro de impressão | Paleta local de papel claro para toda a folha, incluindo tabelas dinâmicas e impressão |
| Barra dos relatórios no tema claro | Fundo herda --side branco e mantém texto fixo branco | Fundo e texto passam a usar o mesmo conjunto de variáveis do tema |
| Datas e filtros dos relatórios | Fundo branco fixo com cor de texto herdada do tema escuro | Campos usam --field e --text juntos |
| Marca no menu claro | .logo-txt b fixa branco sobre --side branco | Texto da marca acompanha o tema na navegação e na prévia |
| Checkbox do relatório de metas | style inline fixa color:#fff | Removida a cor inline; herda a cor legível da barra |
| Etiquetas, alertas e notificações | Cores de fundo e texto de origens diferentes; toast de erro branco sobre rosa claro no escuro | Pares semânticos de informação, sucesso, aviso, erro e origem Sede/Digital |
| Indicadores e importações | Legendas com cinza fixo, faixa de necessidade com laranja fixo, opacidade nas linhas concluídas | Legendas e estados usam as variáveis do tema, preservando legibilidade |
| Tabelas e campos | Hover, agrupamentos, opções de select e placeholders dependem de cores fixas | Pares de superfície, texto, foco e borda para cada tema |

## Alcance

Revisados style.css, contraste.css, os estilos embutidos de relatórios em app.js e as interfaces de Gestão e Conciliação. A correção central fica em contraste.css, carregado depois da folha-base e da marca. As paletas de outros sistemas não são alteradas.

Os relatórios mantêm aparência de papel claro nos dois temas. A marca sobre o bloco navy do timbre continua clara de propósito. Não foram alterados dados, cálculos, permissões ou autenticação.

## Validação

Foram calculadas 57 combinações de texto e fundo nas paletas clara, escura e de papel: o menor contraste foi 5.36:1. Os pares avaliados incluem textos principal/secundário/auxiliar, links, botão principal e mensagens semânticas. As bordas dos campos foram verificadas com mínimo de 3:1. Esses cálculos não equivalem a uma certificação visual de todas as telas.

O teste tests/matriculas-contrast.test.js verifica as cores reais declaradas na folha, para evitar regressões. A sintaxe do JavaScript alterado e do teste foi conferida. O ambiente de execução e o navegador desta sessão estão indisponíveis; não foi possível rodar o comando Node completo nem inspecionar as telas renderizadas. A conferência visual continua pendente em Painel, Gestão, Matrículas, importações, Cadastros, Conciliação, modais e relatórios, nos dois temas.

## Consulta do Conecta

A atualização também reúne os três caminhos repetidos em Cursos e Argumentário Comercial. O simulador continua dentro da ficha de cada curso, e os 119 cursos permanecem acessíveis. A home e o menu passam a oferecer a consulta de cursos e Marco Regulatório, além do retorno ao início.
