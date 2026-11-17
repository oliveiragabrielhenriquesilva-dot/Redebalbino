# Balbino Oportunidades — filtros por produto

O filtro principal Produto agora usa os produtos reais cadastrados, incluindo os produtos de semipresencial, Pós e o agrupamento de Saúde quando configurado como subgrupo. A seleção geral Graduação/Pós-graduação/Técnico/Profissionalizante continua em Mais filtros, com o nome Nível de ensino. Curso permanece um refinamento independente.

Classificação de Pós-graduação: códigos EPOS_, HPOS_ e POS_, nomes com Pós-graduação e nomes iniciados por MBA ou Especialização. O nível explícito tem prioridade sobre palavras como Saúde ou Engenharia presentes no título. Essa regra permite reconhecer os candidatos existentes sem reimportação. Se não houver um único produto Pós cadastrado, o filtro utiliza a classificação virtual Pós-graduação, sem criar produtos ou alterar registros.

Os demais produtos reutilizam o dicionário de códigos, os nomes mapeados do Mundo Azul e os cursos ativos do cadastro de Matrículas, incluindo apelidos e restrições por polo. EGRAD_ permanece graduação EAD; um candidato de um polo não autorizado para um curso semipresencial não recebe automaticamente o produto desse curso. Ambiguidades ficam sem produto identificado. Oportunidades não altera a classificação de matrículas já lançadas.

O mesmo recorte se aplica ao painel, aos candidatos e às exportações. O parâmetro Produto permanece na URL ao atualizar ou compartilhar o link. A lista também exibe o produto reconhecido junto do curso. Foi removido o caractere > que sobrava após a área de filtros.

Validação: 25 testes passaram, incluindo nove de Oportunidades. Casos novos cobrem Pós por código e por sufixo, Bem-estar com apelido, Saúde agrupada, Engenharia, proteção do EAD, restrição por polo e exportação no mesmo recorte. Não houve migração de banco. Atualizar o aplicativo Node completo na Hostinger para aplicar backend e frontend juntos.
