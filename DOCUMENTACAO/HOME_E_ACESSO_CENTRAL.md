# Página inicial e acesso central

A proposta substitui o painel inicial por uma grade de cards, sem banner, busca, indicadores ou rodapé. Mantém a marca, o tema e os controles de conta. Todos os cards e a marca do cabeçalho usam ícones vetoriais SVG incorporados, sem fotos ou imagens remotas.

| Card | Destino | Acesso |
| --- | --- | --- |
| Portal Vitru | https://portal-vitru.sydle.com/ | Login externo |
| Sydle One | http://vitru.sydle.one/ | Login externo |
| Negociação | https://portal.ead.cesumar.br/#!/access/login | Login externo |
| WhatsApp Web | https://web.whatsapp.com/ | Sessão própria |
| Calendário Acadêmico | https://secretaria-unicesumar.github.io/calendariounicesumar/ | Externo |
| Valorizza | https://portalvalorizza.unicesumar.edu.br/logincandidato.aspx | Login externo |
| Studeo | http://studeo.unicesumar.edu.br/ | Login externo |
| Matrículas e Metas | /matriculas/ | Sessão central e permissão Matrículas |
| Oportunidades | /oportunidades/ | Mesma sessão e permissão Matrículas |
| Informa | /informa/ | Conta central ativa, sem troca de senha pendente |
| Relatórios por Polo | /matriculas/#/relatorios | Mesma sessão e permissões do Matrículas |
| Artes e Divulgação | Sem link ativo | Temporariamente desativado no gateway existente |
| Manuais e Procedimentos | Sem link ativo | Aguardando endereço real |

Balbino Chat não aparece na home e permanece desativado no servidor. O trabalho não reativa Artes nem altera bancos, senhas ou permissões existentes. Campos dos sistemas suspensos ficam ocultos na administração, mas os vínculos legados são preservados na edição de usuários.

## Fluxo de autenticação

A página pública mostra os cards. Ao selecionar um sistema interno sem sessão, o mesmo formulário central é apresentado e guarda o destino escolhido, incluindo o fragmento do relatório. Depois do login, o usuário segue ao destino. Troca obrigatória de senha bloqueia a navegação até ser concluída. Usuários já autenticados continuam com a sessão `balbino.sid` e com suas permissões atuais; cards sem permissão ficam indisponíveis. As validações do gateway e do Matrículas continuam obrigatórias, independentemente da apresentação dos cards.

Studeo, Sydle, Valorizza, Negociação e WhatsApp não recebem usuário, senha ou cookie da Rede Balbino. Login único nesses fornecedores exige suporte oficial de federação de identidade; não é implementado por links nem pelo GitHub.

## GitHub e hospedagem

Preparar as alterações em branch e pull request de rascunho. A hospedagem continua Node.js na Hostinger. Não publicar em GitHub Pages: isso não executa o gateway nem o SQLite. A integração e a publicação da branch devem conservar as variáveis de ambiente e o diretório persistente atuais.

Antes de publicar, validar com contas reais de administrador e tutor: login, troca obrigatória de senha, Matrículas, Oportunidades, Informa, Relatórios, restrições por polo e saída. Testes locais não substituem essa validação na hospedagem. Não é necessário recriar usuários.

## Verificação local

`node --check public/catalogo.js`, `node --check public/portal.js`, `node --check server.js` e `node --test tests/portal-home.test.js tests/portal-gateway.test.js`.

O teste do gateway usa a autenticação e o roteador reais com adaptadores mínimos para os aplicativos; não acessa os bancos de produção nem os serviços externos.

A inspeção visual em navegador não foi concluída neste ambiente: o serviço de prévia estava ocupado por outra execução. A revisão visual e o teste com contas reais permanecem pendentes antes da publicação.
