# Balbino Oportunidades — filtros por produto

O filtro principal Produto agora usa os produtos reais cadastrados, incluindo os produtos de semipresencial, Pós e o agrupamento de Saúde quando configurado como subgrupo. A seleção geral Graduação/Pós-graduação/Técnico/Profissionalizante continua em Mais filtros, com o nome Nível de ensino. Curso permanece um refinamento independente.

Classificação de Pós-graduação: códigos EPOS_, HPOS_ e POS_, nomes com Pós-graduação e nomes iniciados por MBA ou Especialização. O nível explícito tem prioridade sobre palavras como Saúde ou Engenharia presentes no título. Essa regra permite reconhecer os candidatos existentes sem reimportação. Se não houver um único produto Pós cadastrado, o filtro utiliza a classificação virtual Pós-graduação, sem criar produtos ou alterar registros.

Os demais produtos reutilizam o dicionário de códigos, os nomes mapeados do Mundo Azul e os cursos ativos do cadastro de Matrículas, incluindo apelidos e restrições por polo. EGRAD_ permanece graduação EAD; um candidato de um polo não autorizado para um curso semipresencial não recebe automaticamente o produto desse curso. Ambiguidades ficam sem produto identificado. Oportunidades não altera a classificação de matrículas já lançadas.

O mesmo recorte se aplica ao painel, aos candidatos e às exportações. O parâmetro Produto permanece na URL ao atualizar ou compartilhar o link. A lista também exibe o produto reconhecido junto do curso. Foi removido o caractere > que sobrava após a área de filtros.

Validação: 25 testes passaram, incluindo nove de Oportunidades. Casos novos cobrem Pós por código e por sufixo, Bem-estar com apelido, Saúde agrupada, Engenharia, proteção do EAD, restrição por polo e exportação no mesmo recorte. Não houve migração de banco. Atualizar o aplicativo Node completo na Hostinger para aplicar backend e frontend juntos.

## Educação Física — equivalência de nomes e grau

A planilha de catálogo `planilha_leads_preenchida.xlsx` fornecida pelo usuário contém Educação Física — Bacharelado (ESPRE_BEDU/EGRAD_BEDU) e Educação Física — Licenciatura (ESPRE_EDU/EGRAD_EDU), com modalidade explícita no nome. O classificador passa a reconhecer grau no início ou no final do nome e a abreviação Ed. Física, preservando a distinção de grau no produto cadastrado. A prioridade do EAD continua válida; nomes genéricos ambíguos não são atribuídos a um produto arbitrário. Restrições de polo continuam aplicadas.

Um produto filtrado sem resultado agora alerta quando existem oportunidades ainda sem produto identificado nos demais filtros. Esse aviso não altera contagens nem presume que o filtro deveria ter candidatos.

Validação complementar: 34 testes passaram. O benchmark sintético continua em aproximadamente 65 ms na primeira carga e 4–10 ms nas leituras seguintes de painel. A correção é de reconhecimento no código; a quantidade efetiva de candidatos em produção depende da fonte e dos vínculos cadastrados.

## Correção da coluna Curso no acompanhamento (17/11/2026)

Reprodução com `listagem-acompanhar-atendimentos.xlsx`: 157 linhas; a coluna
`Curso` contém códigos (ESPRE_PED, ESPRE_BEDU, ESPRE_FAR, EGRAD_ADM etc.).
O importador os guardava somente em `curso_nome`, enquanto a classificação
procurava os códigos em `curso_cod`. Assim, até Pós/EAD não eram reconhecidos.

A importação agora preenche também `curso_cod` quando Curso é um código conhecido
pelo formato. A leitura do servidor reconhece igualmente os registros antigos:
não há migração destrutiva, reimportação obrigatória ou alteração do atendimento.
`cursos-fonte.json` contém somente código→nome dos 58 cursos ESPRE do catálogo
`planilha_leads_preenchida.xlsx` enviado pelo usuário. Não contém dados pessoais,
IDs locais de produto ou novas regras comerciais. O produto continua vindo do
mapeamento explícito do Mundo Azul ou do cadastro de cursos, respeitando polo.
Códigos desconhecidos permanecem sem classificação; não recebem um produto por
suposição. EPOS/HPOS, EGRAD e ETEC seguem o nível explícito da fonte.

Validação: teste que reproduziu zero em Semi-Licenciatura antes da correção e
passou depois, usando código na coluna nome e código vazio; verifica painel e
candidatos, Pós, Graduação, Farmácia, Educação Física e código desconhecido.
Teste do próprio mapSheet com o cabeçalho real do acompanhamento.
