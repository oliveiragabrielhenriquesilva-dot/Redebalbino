# Balbino Oportunidades — desempenho, 17/11/2026

## Gargalo reproduzido

A classificação por produto normalizava novamente todos os cursos, apelidos e restrições por polo para cada candidato. Opções, painel, lista e detalhe reconstruíam a base completa a cada leitura. Como o servidor usa SQLite síncrono e os aplicativos são incorporados ao mesmo processo Node, esse trabalho bloqueava também o atendimento de outras rotas.

O benchmark é local e sintético: 3.173 oportunidades, 160 cursos e dez polos, sem dados de produção nem tempo de rede. Antes da alteração, cada operação ficava próxima de um segundo. Não foi atribuída ao banco ou ao limite NPROC uma causa que não foi medida.

| Operação | Antes | Depois |
|---|---:|---:|
| Primeira carga de opções | 989 ms | 108 ms |
| Painel após a carga de opções | 931–1.069 ms | 4–10 ms |
| Filtro de polo | 919–943 ms | 0,8–1,3 ms |
| Lista de candidatos | 926–932 ms | 2,8–7,1 ms |
| Detalhe de candidato | 885–935 ms | 0,1–0,3 ms |

Uma segunda execução da versão otimizada registrou 63 ms na primeira carga e valores semelhantes nas leituras seguintes. Os números são evidência do teste local; não equivalem ao tempo total na Hostinger.

## Correção

- Normalização dos cursos e apelidos uma vez por contexto, com memoização de classificação por código/nome/polo.
- Snapshot em memória por processo e polo permitido, limitado a seis entradas e cinco segundos. A revisão combina `total_changes()` da própria conexão, `PRAGMA data_version` para outras conexões e a data atual. Escritas, mudanças de cadastro e conciliações invalidam o snapshot na próxima consulta. Permissões e mascaramento continuam aplicados ao usuário atual; respostas HTTP autenticadas não são armazenadas em cache público.
- Lista copia e serializa somente a página escolhida. A tela usa páginas de 50 candidatos.
- Requisições GET idênticas em andamento são compartilhadas. Trocas de filtro ou candidato abortam leituras substituídas; respostas antigas não redesenham o painel. Mudanças de aba/processo cancelam leituras pendentes. Não foi acrescentado polling.
- Limite de espera de 20 segundos somente nas leituras. Gravações não são repetidas automaticamente.
- `Server-Timing: oportunidades;dur=...` nas leituras principais. Operações acima de 500 ms geram log com data UTC e rota normalizada, sem busca, CPF, telefone ou conteúdo de candidatos. O cabeçalho mede o processamento da função; rede, espera pelo event loop e autenticação podem acrescentar tempo ao total observado.

## Verificação e implantação

33 testes passaram, incluindo regras de Pós/produtos, permissões, preservação na reimportação, invalidação por outra conexão SQLite, deduplicação, cancelamento, timeout e ordem dos scripts. Teste HTTP autenticado confirmou opções, painel e lista, o novo script e o cabeçalho de tempo.

Para repetir o teste local, a partir da raiz: `node apps/matriculas/tests/oportunidades.bench.cjs`. O script cria um banco temporário e o remove ao terminar. Testes: `node --test tests/*.test.js apps/matriculas/tests/*.test.js`.

Publicar este commit completo no aplicativo Node da Hostinger, mantendo a pasta persistente dos bancos e as variáveis atuais. Não exige nova dependência ou migração. Após a publicação, medir opções, painel, filtro de Pós e detalhe de candidato no navegador; comparar duração total e Server-Timing com os logs e o gráfico de recursos. A velocidade e os alertas de produção ainda precisam dessa validação.
