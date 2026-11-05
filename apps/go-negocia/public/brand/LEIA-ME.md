# Marca GO Negocia — arquivos

Ponto único da identidade. A interface só usa estes nomes (constante `MARCA` em `public/app.js`, tokens `--marca-*` em `public/estilo.css`).

| Arquivo | Uso | Superfície |
|---|---|---|
| `logo-go-negocia.png` | Logo horizontal (GO + Negocia) — login e página de erro | Clara |
| `logo-go-negocia-negativo.png` | Logo horizontal — barra lateral | Azul-petróleo |
| `monograma-go.png` | Monograma GO, sem assinatura | Clara |
| `monograma-go-negativo.png` | Monograma GO — barra lateral no celular | Azul-petróleo |
| `favicon-32.png`, `favicon-64.png` | Aba do navegador | Ícone com fundo azul-petróleo |
| `apple-touch-icon.png` (180), `icone-192.png`, `icone-512.png` | Atalho no celular / manifesto | Ícone com fundo azul-petróleo |

**Origem:** recortados do arquivo oficial transparente enviado por Gabriel em 05/11/2026 (2172×724). O monograma é o
trecho "GO" do mesmo arquivo, sem redesenho. As versões negativas trocam só o azul-petróleo por branco quente
(`#FAF7F2`); o quadrado coral é mantido. Proporção preservada em todos.

**A assinatura** *Atendimento financeiro para escolas* é texto separado do logo (login).

**Pendente:** arquivo vetorial (SVG/PDF) e o nome da fonte. Para trocar, substitua os arquivos mantendo os nomes; para a
fonte, coloque os `.woff2` em `public/brand/fontes/`, declare o `@font-face` no início do CSS e ajuste `--fonte-marca`.
