# Ações da supervisão

O menu lateral segue a estrutura de Matrículas: Painel gerencial, Candidatos,
Ações da supervisão, Importações e Definições. Os acessos ao Portal, Meus sistemas,
Matrículas, tema e saída permanecem disponíveis. Em telas pequenas, o botão de
menu abre a navegação lateral.

## Distribuição

Em Ações da supervisão, Nova ação por planilha lê todas as abas do XLSX. Cada aba
representa uma tutora. Informe nome da ação, supervisora e período. A associação
com a tutora usa nome ou apelido exato cadastrado, ou a seleção manual na prévia.
A aba Bia pode ser vinculada ao cadastro de Beatriz sem renomear a tutora.

O servidor procura apenas oportunidades existentes no processo selecionado,
usando CPF válido e curso. Não cria leads nem substitui nome, telefone, status
de origem, etapa, anotações ou atendimentos. Ao confirmar a prévia, grava a ação,
vincula os leads e atualiza o responsável atual com evento no histórico.

CPF com mais de uma inscrição no mesmo curso, pessoa não localizada, tutora não
identificada e lead repetido em abas de tutoras diferentes ficam pendentes. Não
há atribuição arbitrária. A prévia mostra essas linhas antes de confirmar e o
relatório mantém as pendências fora dos indicadores. Uma segunda confirmação
da mesma distribuição, nome e período abre a ação existente sem repetir a operação.

A planilha Oportunidades.xlsx enviada em 17/11/2026 tem quatro abas: Bia,
Tainara, Marcelly e Emilly. Há 37 linhas em cada aba, 148 linhas ao todo e 138 CPFs
distintos. Há pessoas em mais de uma aba, incluindo inscrições com o mesmo curso;
esses casos precisam de resolução pela supervisão. A planilha e seus CPFs não são
incluídos no repositório.

## Indicadores

- Leads: inscrições existentes efetivamente vinculadas; uma pessoa pode ter mais
  de uma inscrição em cursos diferentes.
- Atendidos: leads com ao menos um atendimento não anulado registrado no sistema
  entre o início e o fim da ação (ou a data da consulta). Vários atendimentos do
  mesmo lead contam uma vez na taxa. Contatos da planilha antiga não são prova
  de atendimento nesta ação.
- Taxa de atendimento: atendidos / leads vinculados.
- RA inicial: situação salva no momento da distribuição.
- Novas confirmações de RA: leads sem RA confirmado na distribuição e com RA
  confirmado na consulta atual, pelo motor de conciliação oficial de Oportunidades.
- Conversão: novas confirmações / leads sem RA confirmado na distribuição.
  Denominador zero aparece como indisponível. A comparação é desde a distribuição;
  não atribui causalidade à ação e não usa a data de pagamento como corte.

O período filtra os atendimentos. As confirmações de RA seguem o estado atual
da lista oficial, inclusive importações posteriores; esta diferença é explicitada
na tela. O relatório mostra responsáveis da ação separadamente do autor de cada
atendimento e indica quando a própria tutora atribuída registrou o contato.

Acesso a leitura respeita o polo do usuário. Pendências da distribuição e criação
estão limitadas a quem pode distribuir leads. Cada ação tem os seus próprios
vínculos e situação inicial; alterar o responsável global depois não reescreve
quem recebeu o lead naquela ação.

## API e validação

- GET /api/ma/oportunidades/acoes?ciclo=ID
- POST /api/ma/oportunidades/acoes/previa
- POST /api/ma/oportunidades/acoes (confirmado=true)
- GET /api/ma/oportunidades/acoes/ID

Tabelas novas e aditivas: ma_op_acoes e ma_op_acao_leads. Criação, vínculos,
responsáveis e histórico são gravados na mesma transação. A atualização invalida
o cache existente pelas revisões do SQLite.

Testes cobrem prévia sem escrita, CPF e curso, apelido de tutora, seleção manual,
conflitos entre abas, nenhum novo lead, preservação de dados, confirmação repetida,
acesso por polo, atendimentos e RA inicial versus novo. A leitura da planilha é
validada para todas as abas, incluindo CPF numérico ou com sufixo decimal.

## CPFs numéricos do Excel

O XML de Oportunidades.xlsx contém 147 CPFs preenchidos em notação científica.
O leitor agora expande células numéricas que representem inteiros seguros; a API
também aceita esses valores e decimais inteiros, mantendo a validação dos dígitos.
Não descarta o expoente nem considera todo número válido. Valores fracionários,
fora do intervalo seguro ou com dígitos verificadores errados são rejeitados.

Validação do arquivo original em banco temporário com as inscrições correspondentes:
147 CPFs reconhecidos; 137 linhas sem conflito, 10 linhas com o mesmo lead/curso
atribuído a tutoras diferentes e 1 linha sem CPF. Isso verifica a leitura e a
regra de conflito; não representa vínculo ou contagem validada na base de produção.

## Registros da importação antiga

A base enriquecida deve carregar o código recuperado de curso_nome, não apenas
o valor original de curso_cod. A exibição traduzia ESPRE_PED para Pedagogia,
mas entregava curso_cod vazio para a busca de ações; o CPF era localizado e a
comparação de curso descartava o registro. O código resolvido e o nome original
agora seguem na base interna. Teste de regressão reproduz a falha com curso_cod
vazio e curso_nome=ESPRE_PED e verifica o vínculo sem reimportação.
A prévia distingue CPF ausente da base de CPF encontrado com curso divergente.

## Cards, revisão e exclusão recuperável

A lista de seleção foi substituída por cards com leads, tutoras, atendimento e
pendências. A ação mais recente abre automaticamente; cada card abre o seu painel.
O parâmetro `acao` conserva a seleção ao compartilhar/reabrir a página.

Pendências são agrupadas por pessoa, CPF mascarado e curso. O administrador pode
conferir os IDs de inscrição e respectivas datas, escolher uma inscrição e uma
tutora e vincular o lead. O servidor revalida o grupo, a inscrição, o polo e a
permissão, verifica uma versão das pendências para evitar alterações concorrentes,
resolve juntas as linhas repetidas e registra o histórico. Nenhuma inscrição é
apagada; registros antigos duplicados permanecem na base.

DELETE /api/ma/oportunidades/acoes/ID exclui a ação do painel por marcação, sem
apagar vínculos, leads ou atendimentos e sem reatribuir responsáveis. Em Ações
excluídas, POST /api/ma/oportunidades/acoes/ID/restaurar recupera a mesma ação.
Somente quem pode distribuir pode excluir, restaurar ou revisar pendências.
Tutores não consultam a lista excluída. ma_op_acao_eventos guarda o histórico da
revisão/exclusão/restauração; as colunas novas de exclusão são aditivas.

POST /api/ma/oportunidades/acoes/ID/resolver recebe versao, grupo,
oportunidade_id e tutor_id. Uma versão desatualizada retorna 409, sem alterações.
