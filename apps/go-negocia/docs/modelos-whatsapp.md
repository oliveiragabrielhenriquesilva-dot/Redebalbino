# Modelos de mensagem — GO Negocia (para revisão)

**Situação:** redação nova preparada para revisão. Nada foi enviado à Meta nem aprovado nesta tarefa.
A instituição precisa validar o texto antes da operação real.

## Primeiro contato (ativo)

Usado no início de um contato ativo. Na API oficial, a mensagem fora da janela de 24 h precisa ser um **modelo aprovado**;
no modo de teste, o sistema registra exatamente o texto abaixo com as variáveis preenchidas.

- **Nome sugerido do modelo na Meta:** `go_negocia_primeiro_contato`
- **Categoria sugerida:** Utilidade
- **Idioma:** pt_BR

**Texto do modelo:**

> Olá, {{1}}! Aqui é {{2}}, da GO Negocia. Somos a equipe de atendimento financeiro {{3}}. Podemos falar com você por aqui sobre um assunto administrativo?

| Variável | Conteúdo | Exemplo |
|---|---|---|
| `{{1}}` | Primeiro nome do responsável financeiro | Mariana |
| `{{2}}` | Primeiro nome do atendente que iniciou o contato | André |
| `{{3}}` | Preposição + nome da instituição (calculado pelo sistema) | do Colégio Horizonte · da Escola Vale Verde |

**Exemplo preenchido:** "Olá, Mariana! Aqui é André, da GO Negocia. Somos a equipe de atendimento financeiro do Colégio Horizonte. Podemos falar com você por aqui sobre um assunto administrativo?"

Regras mantidas: não cita valores, títulos nem débito (isso só depois da confirmação de identidade);
identifica a GO Negocia e a instituição; o nome da instituição vem sempre da instituição dona do caso.

A preposição é escolhida pela primeira palavra do nome cadastrado (Colégio/Instituto/Centro → "do";
Escola/Faculdade/Creche → "da"; outros → "de"). Se algum nome real ficar estranho, cadastre a instituição
com o nome como deve aparecer na mensagem.

## Depois de aprovado

1. Cadastre o nome do modelo aprovado no campo **Modelo de primeiro contato** da conexão (Administração › Instituições).
2. Se o modelo antigo (`olivelo_primeiro_contato`) tiver sido cadastrado em alguma conexão, troque pelo novo.
