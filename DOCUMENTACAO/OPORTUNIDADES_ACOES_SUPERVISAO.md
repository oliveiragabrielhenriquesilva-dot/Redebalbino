# Ações da supervisão

## Regra vigente: uma linha = uma participação

A distribuição deve reproduzir as abas da planilha. O mesmo lead e curso podem
aparecer duas vezes, em tutoras diferentes ou em linhas distintas da mesma aba.
Cada linha gera sua própria participação, contando na carteira da tutora indicada
naquela aba. Não se escolhe uma única tutora nem se descarta a repetição.

Isso não duplica o cadastro geral do candidato. O responsável geral da ficha
permanece independente das carteiras das ações. O vínculo guarda ação, lead,
tutora, aba, linha original e situação inicial do RA. A confirmação repetida do
mesmo arquivo/nome/período abre a ação existente.

## Importação e revisão

A importação lê todas as abas do XLSX e mostra prévia antes da gravação. Nome ou
apelido cadastrado identifica a tutora; também é possível mapear cada aba para um
cadastro ativo. Códigos de curso antigos guardados no campo nome são recuperados.
CPFs numéricos em notação científica são expandidos como inteiros seguros e seus
dígitos verificadores continuam validados.

A busca usa CPF e curso. Sem CPF, pode usar nome completo normalizado, telefone
e curso para uma correspondência única em cadastro igualmente sem CPF. Sem
telefone, a revisão oferece inscrições do mesmo nome e curso para escolha
explícita. Não se inventa CPF. Mais de uma inscrição correspondente permanece
para revisão; selecionar a inscrição resolve todas as linhas daquele grupo,
criando uma participação por linha e mantendo as tutoras das respectivas abas.

Permissões, polo da inscrição e atuação da tutora são verificados no servidor.
Uma versão das pendências impede revisão concorrente desatualizada (409).
As operações de vínculo, revisão e eventos são transacionais. Etapa, observações,
dados de origem e histórico geral não são sobrescritos pela distribuição.

## Indicadores

Cards mostram ações; a mais recente abre automaticamente. Cards por tutora
filtram os indicadores e a lista para sua carteira. Ver toda a ação retorna ao
consolidado. A conferência mostra linhas recebidas, participações vinculadas e
pendências por aba. Totais de participações e inscrições distintas são separados.

Atendimento vale no período da ação, por participação. Ao abrir um lead pela
carteira da ação, o formulário envia a participação e o contato fica vinculado a
ela. Um contato da carteira de Bia não marca a participação de Tainara atendida.
Contatos antigos digitados no sistema, sem participação, só entram automaticamente quando há uma única
participação daquele lead na ação. Em repetição, não se atribui o contato genérico
às duas carteiras.

Taxa de atendimento = participações atendidas / participações vinculadas.
Conversão = participações com nova confirmação de RA / participações sem RA na
distribuição. RA inicial já confirmado não é nova conversão. Os resultados seguem
o motor oficial de conciliação e são mostrados por participação; os cadastros e
as matrículas do sistema geral não são duplicados. Denominador zero é indisponível.

## Exclusão e acesso

Excluir retira a ação do painel por marcação, mantendo vínculos, leads,
responsáveis gerais e atendimentos. Ações excluídas permite restaurar a mesma ação.
Quem distribui pode revisar, excluir e restaurar. Leitura respeita o polo; tutores
não acessam pendências administrativas nem a lista de ações excluídas.

## Estrutura e API

ma_op_acoes guarda metadados e exclusão. ma_op_acao_leads tem ID por participação
e chave única por ação/aba/linha original; não há unicidade por lead. A migração
copia os vínculos antigos em transação e mantém IDs de ações e os dados anteriores.
ma_oportunidade_atendimentos.acao_lead_id identifica a participação atendida.
ma_op_acao_eventos e o histórico do lead registram revisão, exclusão e restauração.

- GET /api/ma/oportunidades/acoes?ciclo=ID
- POST /api/ma/oportunidades/acoes/previa
- POST /api/ma/oportunidades/acoes (confirmado=true)
- GET /api/ma/oportunidades/acoes/ID
- POST /api/ma/oportunidades/acoes/ID/resolver
- DELETE /api/ma/oportunidades/acoes/ID
- POST /api/ma/oportunidades/acoes/ID/restaurar

## Fonte conferida em 17/11/2026

O XLSX originalmente enviado tem 37 linhas por aba (148 ao todo). Agnales aparece
em Bia, linha 37, e Tainara, linha 28; não aparece na aba Marcelly desse arquivo,
que termina na linha 38. Um print posterior mostra Agnales em Marcelly, linha 99.
É necessário o arquivo correspondente à versão atual para reconciliar a
operacionalização. Não se substitui a planilha atual pelo conteúdo do XLSX antigo.



## Atualização automática pelo acompanhamento

A importação do relatório de atendimento atualiza as ações existentes sem nova
importação da distribuição. Status da inscrição e dados de origem continuam
sendo atualizados no lead. A taxa de atendimento passa a combinar contatos do
sistema e observações do relatório, dentro do período da ação.

A data deve ser válida, não futura e estar entre início e fim da ação (ou hoje).
A responsável do relatório é reconhecida por nome/apelido cadastrado ou prefixo
único do nome completo, respeitando polos. Correspondência ambígua não é escolhida
pela primeira ocorrência: aparece aviso e não se atribui o contato àquela carteira.
Nome ou apelido exato tem precedência sobre prefixos. Um contato importado de Bia
conta na participação de Bia; não na participação repetida de Emilly.

ma_op_contatos_fonte guarda oportunidade, data, responsável original normalizada,
primeira/última importação e contador de interações informado. A chave de
observação é lead/data/responsável. Reimportar atualiza a referência sem repetir
o fato. Importações seguintes não apagam os contatos já observados. Não se usa o
contador cumulativo de interações como quantidade de novos contatos da ação.

Na primeira atualização, as observações já existentes nos leads são preservadas
na nova tabela. A migração e as importações são transacionais. As leituras da ação
reconhecem o novo estado automaticamente; as escritas invalidam o cache SQLite.

A API mostra atendido_sistema, atendido_planilha e último contato da planilha em
cada participação. A taxa conta cada participação no máximo uma vez, mesmo com
contatos nas duas fontes. A tela informa a última importação, a origem/data do
atendimento e o status de inscrição atualizado. A importação retorna quantas
ações tiveram dados sincronizados. Conversão continua dependendo do RA oficial.

Validação cobre importação e reimportação por HTTP autenticado, atualização do
status, taxa por tutora e cards, contato anterior ao início, fim da ação, data
futura, responsável ausente/desconhecida/ambígua, repetição entre carteiras,
preservação de contatos anteriores e união com atendimento manual. Há ainda
verificação da migração com observação já existente.
