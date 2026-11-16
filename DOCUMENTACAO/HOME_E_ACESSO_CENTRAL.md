# Rede Balbino: home, Conecta e identidade

A home reúne nove atalhos: Balbino Conecta, Matrículas e Metas, Oportunidades, Portal Vitru, Sydle One, Negociação, Calendário Acadêmico, Valorizza e Studeo. WhatsApp, Relatórios por Polo, Artes e Manuais foram retirados da grade. Os relatórios continuam disponíveis dentro do Matrículas. Chat e Artes permanecem desativados no servidor.

## Login central

Matrículas e Oportunidades preservam as permissões atuais de Matrículas e o vínculo com a conta existente. Conecta usa a mesma sessão central, exige conta ativa e bloqueia acesso enquanto a troca de senha obrigatória estiver pendente. Todas as rotas do Conecta, incluindo scripts e dados, validam a sessão. A rota antiga /informa/ continua disponível para compatibilidade. Não são alteradas senhas, perfis ou restrições por polo. Os portais externos continuam com seus próprios logins.

## Organização manual

Organizar atalhos habilita arrastar e soltar e os botões Mover antes/Mover depois, que funcionam por toque e teclado. Salvar ordem persiste a preferência individual na tabela user_preferences do banco central; não exige perfil de administrador. Cada usuário vê sua própria organização em outros navegadores após entrar. Visitantes guardam a ordem apenas no navegador. Cancelar descarta a edição e Ordem padrão prepara a restauração da sequência original. Atalhos removidos são descartados e novos atalhos são acrescentados à ordem salva.

A grade usa três colunas no desktop e duas nas telas menores. A altura acompanha o espaço disponível para caber em uma tela nos tamanhos usuais; telas muito baixas preservam a rolagem e o tamanho mínimo legível dos cards.

## Balbino Conecta

Conteúdo importado do arquivo Balbino_Conecta (3).html enviado pelo usuário: 119 cursos, 115 argumentários e as informações de modelo acadêmico e simulação de mensalidades. O conteúdo e as fórmulas recebidas são preservados. A home do Conecta mantém os cards de Argumentário Comercial, Marco Regulatório, Simulador e Catálogo.

Para publicação, CSS e JavaScript ficam em arquivos locais, sem scripts inline. O conjunto de dados está comprimido com gzip e codificado em base64 em apps/conecta/data; o manifesto informa os fragmentos e o SHA-256 do JSON original. O servidor recompõe os dados em memória e entrega JSON somente após autenticação. Esses arquivos não têm rotas públicas. A origem dos conteúdos continua identificada no Conecta.

## Identidade visual

O novo símbolo usa um B modular em azul com uma ligação diagonal turquesa. A marca vetorial tem versões clara e branca, além do símbolo isolado. Foi aplicada no Portal, Conecta, Matrículas, Oportunidades, Informa, login, favicons e relatórios. Os arquivos legados WebP/PNG/SVG da Rede Balbino também foram atualizados, e os cabeçalhos dos sistemas suspensos receberam a mesma marca sem reativação. Logos institucionais de outras organizações são preservados. A imagem de logo antiga da configuração é preservada no banco, mas a interface usa a identidade oficial.

## Verificação e publicação

Node.js 24. Executar node --check nos scripts alterados e node --test tests/portal-home.test.js tests/portal-gateway.test.js tests/conecta-data.test.js. O teste de integração usa autenticação e roteador reais, com adaptadores mínimos dos aplicativos, e verifica sessão, restrições, logout, proteção dos dados e preferências isoladas por usuário. Validar visualmente a prévia e depois a publicação na Hostinger. O aplicativo segue Node.js e não deve ser convertido para GitHub Pages. Preservar diretório persistente e variáveis da hospedagem.
