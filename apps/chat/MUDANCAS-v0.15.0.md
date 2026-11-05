# Balbino Chat v0.15.0 — sistema mais leve + Pendências

## Removido
- **Central de Leads** (bases, importação de planilha, Google Sheets, distribuição, retornos de lead)
- **Funil de atendimento** (oportunidades/deals)
- **Campanhas** e **Listas de disparo**
- **API Oficial da Meta** (painel, conexões oficiais, modelos, webhook `/webhooks/meta/whatsapp` → responde 410)
- **Matrículas dentro do Chat** (leitura de posts nos grupos). O sistema **Matrículas** separado e a integração
  de boas-vindas (`/api/integracao/...`) **continuam funcionando**.

Menu: de 26 para 19 telas. Código da tela (app.js + index.html): de ~565 KB para ~490 KB.

## Dados dos módulos removidos
Na primeira inicialização da v0.15.0, tudo o que existir desses módulos é **exportado** para
`backups/modulos-removidos-v0.15.0-<data>.json` (na pasta persistente) e **só depois** retirado do banco.
Se a exportação falhar, nada é apagado. Também saem do banco a chave/segredo do app Meta.

## Mais rápido
- Busca de mensagem pelo ID do WhatsApp agora usa índice (antes varria todas as mensagens a cada recibo
  de entrega/leitura, reação, edição e citação — 12 pontos do código).
- A triagem não percorre mais todas as mensagens para saber se é o primeiro contato.
- O banco principal (regravado a cada alteração) não carrega mais os dados de leads/campanhas.

## Pendências (substitui "Tarefas")
- Quadro: Nova → Em andamento → Aguardando aluno → Concluída, com busca e filtros (responsável, setor, atrasadas).
- Protocolo automático `PEND-0001`, prazo calculado pelo tipo de pedido, destaque de atrasadas.
- Botão **☷ Pendência** na conversa: lista e cria pendências do contato (responsável = atendente logado).
- Ao marcar **Concluída**, o aluno recebe o aviso **pela mesma conexão da conversa**; a mensagem fica no
  histórico. Se o WhatsApp estiver desconectado, o motivo aparece no card.
- **Tipos de pedido** editáveis (nome, setor, prazo, mensagem de conclusão com `{nome}`, `{protocolo}`, `{titulo}`).
- Permissões: supervisor/admin veem todas; atendente vê as dele, as que criou e as dos setores que acessa.
- As Tarefas antigas são convertidas em pendências automaticamente (nada se perde).
- Contador no menu: abertas · atrasadas.

## Não mudou
Atendimentos, filas, triagem, conexões QR, grupos/canais, usuários e acessos, respostas rápidas,
agendamentos, automações, IA/conhecimento, API/integrações, relatórios, mídia e auditoria.

## Pendências automáticas pela triagem
- Em **Automação → Fluxos de atendimento** (duplo clique no bloco do menu), cada opção tem o campo
  **Abrir pendência**. Opções que abrem pendência aparecem com ☷ no desenho do fluxo.
- Quando o contato escolhe essa opção, o bot pede a descrição; a próxima mensagem cria a pendência
  sozinha (protocolo, tipo, prazo, setor), responde com o protocolo e o prazo e coloca a conversa na fila
  do setor da opção (ou do tipo). No quadro, essas pendências aparecem com 🤖.
- Textos do bot (pedido de descrição e confirmação) editáveis em **Pendências → Tipos de pedido**.

## Responsável automático por tipo
- Cada tipo de pedido pode ter um **responsável padrão**. Pendências criadas pelo bot vão direto para ele;
  na criação manual, escolher o tipo já preenche o responsável (pode ser trocado).

## FAQ automático (resposta pelo bot)
- Em **Fluxos**, o campo **Automático** de cada opção agora aceita **💬 Responder pelo FAQ**.
- O bot pede a dúvida, procura a melhor resposta em **Balbino IA → IA / Conhecimento** e pergunta
  "Isso resolveu? 1 – Sim · 2 – Falar com um atendente".
  - Sim → agradece e finaliza o atendimento ("Resolvido pelo FAQ").
  - Atendente (ou 3 tentativas) → vai para a fila do setor da opção.
  - Não encontrou → avisa e vai para a fila; a pergunta entra em **Perguntas sem resposta**.
- Cada resposta tem **palavras-chave** (separadas por vírgula) e pode ser marcada como "só sugestão".
- A busca entende acentos, plural e frases; o mesmo motor melhora o botão **Sugerir resposta**.
- Tela **IA / Conhecimento**: testar uma pergunta, ver quantas vezes cada resposta foi usada/resolveu,
  editar as mensagens do bot e transformar perguntas sem resposta em novas respostas.

## Histórico contínuo
- Ao abrir uma conversa: **↑ Ver atendimentos anteriores (N)** mostra as mensagens dos atendimentos
  anteriores do mesmo contato acima das atuais, com divisória (protocolo, data, setor, responsável).
  Os atendimentos continuam separados para relatórios e protocolos.

## Visual v2
- Camada própria `public/ui-v2.css` (não altera portal/Matrículas), mesma paleta e fonte da Rede Balbino,
  temas claro e escuro.
- Ícones de linha consistentes no menu; menu mais leve, item ativo destacado; rótulos encurtados
  (Supervisor, Filas, Auditoria, Fluxos, Conexões (QR)).
- Barra superior mais discreta; cartões, botões e campos padronizados; foco visível.
- Conversa: ações da mensagem só aparecem ao passar o mouse; avisos da caixa de envio compactos;
  filtros sem texto cortado ("Em atendimento" → "Meus").
- Painel: "Acompanhamentos" → "Pendências abertas".
- Correção: mensagens enviadas em sequência pelo bot nunca trocam de ordem.

## Passada visual tela a tela (19 telas revisadas)
- Relatórios: removida a seção "Leads e conversão" (resto da Central de Leads).
- Usuários e acessos: removida a lista duplicada de filas (fica só em Filas).
- Conexões (QR): só Conectar e QR à vista; demais ações em "⋯ Mais".
- Conversa vazia: some o botão voltar e o avatar "--".
- Tabelas com cabeçalho e linhas padronizados.

## Conversa v2 + ficha do aluno
- Cabeçalho limpo (sem sobreposição), balões estilo WhatsApp (recebidas neutras, enviadas em azul da marca),
  "Enviada · Entregue · Lida" só ao passar o mouse, campo de mensagem arredondado e envio redondo.
- **Clicar no nome ou na foto do contato** abre o painel com a **Ficha do aluno**: Polo, Curso, RA (editáveis),
  Perfil (da triagem), pendências do contato com situação, e atendimentos anteriores (com atalho para ver na conversa).
- Com o painel aberto, as três colunas ficam lado a lado sem sobrepor; botões ajustam o tamanho.

## Aparência: 3 modos + cores da marca
- Modos **Claro**, **Escuro** e **Híbrido** (menu navy + conteúdo claro). Cada pessoa troca no botão ☀/🌙/🌗 do topo; a escolha fica salva no usuário.
- **Configurações › Aparência** (admin): modo padrão para quem ainda não escolheu, cor principal e cor de destaque, com prévia e "Restaurar cores da Rede Balbino".
- Nova rota `GET/PUT /api/appearance`; preferências aceitam `theme: hybrid`.
