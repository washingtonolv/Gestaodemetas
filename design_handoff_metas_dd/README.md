# Handoff: Painel de Metas & Faturamento — D&D Cosméticos

## Visão geral
Sistema web para gestão de metas e faturamento de uma rede de 9–10 franquias de cosméticos (Rio de Janeiro e região). A supervisora define metas mensais por loja, as gerentes lançam a venda de cada dia, e o sistema calcula ritmo, projeção, ranking de vendedoras e faixas de comissão.

Usuários previstos: **até 10 simultâneos** (1 supervisora + gerentes de loja). Requisito declarado: **sistema real multiusuário**, dados centralizados, login por usuário.

## Sobre os arquivos deste pacote
Os arquivos HTML aqui são **referências de design** — protótipos que mostram aparência e comportamento pretendidos, **não são código de produção**. A tarefa é **recriar estas telas no ambiente do codebase alvo** (React/Next, Vue, Laravel Blade, etc.), usando os padrões e bibliotecas já estabelecidos ali. Se ainda não existir codebase, escolher a stack (sugestão abaixo) e implementar as telas nela.

- `painel-metas-dd.dc.html` — fonte do protótipo (template + lógica). Abre direto no navegador junto com `support.js`.
- `index-standalone.html` — mesma tela, arquivo único autocontido (é o que está publicado no GitHub Pages).
- `base/METAS_2026*.xlsx` — planilhas reais que o sistema substitui. **Fonte da verdade das regras de negócio e dos números.**

Repositório atual: `washingtonolv/Gestaodemetas` (branch `main`, publicado em GitHub Pages).

## Fidelidade
**Alta fidelidade (hi-fi).** Cores, tipografia, espaçamentos e estados são finais. Recriar pixel-a-pixel usando os componentes do codebase.

---

## Stack sugerida (se não houver codebase)
- **Front**: Next.js (App Router) + TypeScript + Tailwind. As telas são densas em tabela e grid — Tailwind mapeia bem os valores abaixo.
- **Back/DB**: Postgres (Supabase ou Neon). Supabase resolve também Auth e Row Level Security, que atendem "login por usuário" e o escopo por loja.
- **Auth**: e-mail + senha com convite (o protótipo já tem "Convidar gerente"). Papéis: `supervisor`, `gerente`.
- **Exportação**: PDF via impressão do navegador; Excel via SheetJS.
- **Integração Microvix**: job agendado (cron) chamando a API do Microvix; enquanto não houver credencial, usar importação de planilha (mesmo endpoint de ingestão).

---

## Modelo de dados (mínimo)

```
usuario        (id, nome, email, papel['supervisor'|'gerente'], ativo, criado_em)
loja           (id, nome, codigo_microvix, ativa, gerente_id -> usuario, criada_em)
usuario_loja   (usuario_id, loja_id)                      -- gerente pode ter N lojas
vendedora      (id, loja_id, nome, cpf, admissao, meta_individual, ativa)
mes            (id, ano, mes, dias_uteis, fator_meta2, fator_meta3, fechado bool, fechado_em)
meta_loja      (id, mes_id, loja_id, meta1)               -- meta2/meta3 são derivadas
venda_dia      (id, loja_id, data, valor, atendimentos, origem['manual'|'planilha'|'microvix'],
                lancado_por -> usuario, lancado_em)       -- UNIQUE (loja_id, data)
venda_vendedora(id, vendedora_id, data, valor, atendimentos)
faixa_comissao (id, nivel[1,2,3], percentual)
```

Regras derivadas (não persistir, calcular):
- `meta2 = meta1 * fator_meta2` (padrão **1,12**), `meta3 = meta1 * fator_meta3` (padrão **1,30**)
- `meta_dia = meta1 / dias_uteis`
- `ritmo_esperado = dias_trabalhados / dias_uteis`
- `projeção = realizado / dias_trabalhados * dias_uteis`
- `vender_por_dia = (meta1 - realizado) / dias_uteis_restantes`
- Situação da loja: `pct >= ritmo - 0,02` → **No ritmo**; `>= ritmo - 0,09` → **Atenção**; senão **Crítico**
- Faixa da vendedora: `>= 100%` → 3ª meta (1,2%); `>= 90%` → 2ª meta (1,0%); `>= 75%` → 1ª meta (0,8%); abaixo → sem comissão
- Domingo não é dia útil (loja fechada); dias sem lançamento não entram na média

---

## API (sugestão REST)

```
POST   /auth/login                      /auth/invite         /auth/accept-invite
GET    /lojas            POST /lojas            PATCH /lojas/:id
GET    /vendedoras?loja  POST /vendedoras       PATCH /vendedoras/:id
GET    /usuarios         POST /usuarios (convite gerente)    PATCH /usuarios/:id
GET    /meses/:ano-:mes  PATCH /meses/:id (dias úteis, fatores)
GET    /metas?mes        PUT   /metas (lote: [{loja_id, meta1}])   POST /metas/publicar
GET    /vendas?mes&loja  POST  /vendas (lançamento do dia)    POST /vendas/importar (planilha/Microvix)
GET    /painel?mes                        -- agregados prontos p/ dashboard
GET    /ranking?mes
POST   /meses/:id/fechar                  -- congela o mês
GET    /relatorios/mensal.pdf | .xlsx
```

Permissões: gerente só lê/escreve as lojas em `usuario_loja`; supervisora vê tudo, é a única que define metas e fecha o mês.

---

## Telas

### 1. Painel do mês (dashboard)
**Objetivo**: a supervisora entende em 5 segundos se a rede bate a meta.
**Layout**: shell branco arredondado (26px) sobre fundo `#DCE9E7`, grid `252px | 1fr` (sidebar + conteúdo).
Conteúdo: header → linha de KPIs → grid de 2 colunas (`minmax(430px,1fr)` auto-fit).

Componentes:
- **Cartão herói** `#D8EFEA`, radius 20, min-height 216: ícone 52×52 radius 16 `#0A5F5C`; % da rede em 38px/800 `#0A5F5C`; pílula branca com delta em pontos vs ritmo (verde `#05918C` se ≥0, rosa `#CD4664` se <0); legenda 12,5px `#4E6663`.
- **2 KPIs** `#F6FAF9` radius 20: chip de ícone 44×44 radius 14 (`#E7F4F2` ou `#FDF1F3`), rótulo 11,5px `#8D9997`, valor 21px/800, pílula à direita com contagem de dias.
- **Gráfico Vendas por dia**: card branco, borda `#EFF4F3`, radius 20. SVG viewBox `0 0 900 210`, linha teal 3px com suavização cúbica, área com gradiente teal 22%→0, linha tracejada rosa na meta diária. Eixo X: 5 rótulos de dia.
- **Escada de metas**: 3 anéis (r=38, stroke 10) — Meta 1 `#0A5F5C` em fundo `#E7F4F2`, Meta 2 `#05918C` em `#F4FAF9`, Meta 3 `#CD4664` em `#FDF1F3`. Centro: % atingido + % de comissão. Rodapé: valor em BRL.
- **Tabela de lojas**: chips de filtro (Todas/No ritmo/Atenção/Crítico), colunas `1.5fr 1.6fr .9fr .9fr .85fr` — código (chip 32×32 radius 10), nome (truncado com ellipsis), barra de progresso 8px radius 5, vendido, vender/dia, pílula de situação.
- **Calendário**: cabeçalho D S T Q Q S S; células 38px radius 11 — dia batido `#0A5F5C` com texto branco, perto `#9FD8D3`, abaixo `#F5C3CE`, domingo `#F1F5F4`, hoje com borda rosa. Legenda embaixo.
- **Rosca de situação**: r=64, stroke 19, segmentos teal / rosa claro `#E890A2` / rosa; centro com total de lojas.
- **Alertas "Para olhar hoje"**: cards radius 15 com bolinha colorida, título 12,5px/700 e texto 11,5px/500.

### 2. Lançar vendas
Tabela do dia: colunas `1.5fr 90px 116px .8fr .9fr` — loja, meta do dia, **campo de venda** (input radius 11, borda `#D8E6E4` / rosa `#F5C3CE` quando pendente, `box-sizing:border-box`, `width:100%`), atendimentos, status (Lançado `#E7F4F2`/teal, Pendente `#FDE9ED`/rosa).
Coluna lateral: total lançado (cartão `#D8EFEA` com barra de progresso vs meta do dia), "Faltam lançar" (lista rosa com ação Cobrar) e "Últimos lançamentos" (timeline com autor e horário).
Ações do topo: **Importar Microvix** e **Salvar lançamentos**.
Validação: valor ≥ 0; um lançamento por loja/dia (upsert); bloquear se o mês estiver fechado; alerta às 21h para pendentes; corte automático às 22h (configurável).

### 3. Definir metas
Tabela com **Meta 1 editável** por loja e Meta 2/3 calculadas em cinza; coluna "vs mês anterior" com delta colorido; linha TOTAL.
Lateral: fatores (1,12 / 1,30) e dias úteis editáveis; explicação da sugestão automática (média dos 3 últimos meses + 6%); botões **Copiar de maio**, **Preencher com sugestão** e **Publicar metas**.
Publicar grava `meta_loja` do mês e trava edição para gerentes.

### 4. Lojas
4 KPIs de situação + grade de cards (`minmax(260px,1fr)`): código, nome, Meta 1 em BRL, pílula de situação, barra de progresso, vender/dia e ticket médio.
Topo: **+ Adicionar loja** → formulário com nome, código Microvix, Meta 1, dias úteis, situação, e a seção **Gerente responsável** — chips selecionáveis das gerentes + **+ Novo gerente** (nome, e-mail de acesso, celular, permissão → dispara convite).

### 5. Ranking
Pódio com as 3 primeiras (cards `#D8EFEA` / `#E7F4F2` / `#FDF1F3`), tabela completa (posição, vendedora + loja, % da meta com barra, vendido, ticket, faixa) e cartão de faixas de comissão com a contagem por nível.
Topo: **+ Adicionar vendedora** → formulário com nome, loja, meta individual, admissão, CPF e nível de acesso.

### 6. Ano 2026
4 KPIs do acumulado (meta, realizado, meses batidos, gap), gráfico de barras meta × realizado por mês (barras 11px, meta `#E1EBE9`, realizado colorido por desempenho) e tabela de fechamento mês a mês.

### 7. Configurações
Regras de meta (fator 2, fator 3, dias úteis padrão, horário de corte), notificações com toggles (46×26, trilho teal quando ligado), lista de acessos com papel, e a ação destrutiva **Fechar o mês** em cartão rosa.

---

## Interações e comportamento
- Navegação por estado (SPA); item ativo em teal com texto branco.
- Formulários abrem inline (não modal), com Cancelar / Salvar à direita.
- Toggles alternam imediatamente.
- Hover: itens de nav `#F4F8F7`; botão rosa escurece para `#B23A55`.
- Sem animações além de transições curtas de cor.

## Responsivo (breakpoints usados no protótipo)
- **≥1180px**: sidebar fixa (252px) com card promo; tabelas completas.
- **760–1180px**: sidebar vira barra horizontal rolável no topo; conteúdo em coluna única; ocultar "vender/dia", "atendimentos", "ticket", "faixa"; chip de código some; herói ocupa a linha inteira.
- **<760px**: tudo em coluna única; busca e nome do usuário ocultos (só avatar); gráfico 120px; tabelas com 3 colunas essenciais.

## Estado necessário
`paginaAtual`, `mesSelecionado`, `formLojaAberto`, `formVendedoraAberto`, `formGerenteAberto`, `gerenteSelecionado`, `notificacoes{}`, `larguraJanela` (listener de resize), além dos dados vindos da API.

## Design tokens

**Cores**
| Token | Hex | Uso |
|---|---|---|
| Teal primário | `#05918C` | ações, "no ritmo", nav ativa |
| Teal escuro | `#0A5F5C` | números de destaque, dia batido |
| Teal claro | `#E7F4F2` | fundos de apoio, chips |
| Teal fundo | `#D8EFEA` | cartão herói |
| Rosa primário | `#CD4664` | alerta, crítico, botões de cadastro |
| Rosa claro | `#E890A2` / `#F5C3CE` | atenção, dia abaixo |
| Rosa fundo | `#FDF1F3` / `#FDE9ED` | cartões e pílulas de alerta |
| Texto | `#16211F` | principal |
| Texto médio | `#5A6664` | secundário |
| Texto fraco | `#8D9997` / `#A8B7B5` | rótulos e placeholders |
| Bordas | `#EFF4F3` / `#F1F5F4` / `#D8E6E4` | cards, divisórias, inputs |
| Fundo da página | `#DCE9E7` | fora do shell |
| Superfícies | `#fff` / `#F6FAF9` / `#F4F8F7` / `#F9FCFB` | cards e campos |

**Tipografia** — Manrope (400/500/600/700/800) para tudo; JetBrains Mono (400/500/700) para números tabulares.
Escala: h1 clamp(21–27px)/800 letter-spacing -.025em · h2 15,5px/700 · KPI 21–38px/800 · corpo 12,5px/500 · rótulo 11,5px/500 · micro 10,5px/600 uppercase letter-spacing .07em.

**Raios**: shell 26 (18 no mobile) · cards 20 · campos/nav 11–14 · pílulas 100px.
**Espaçamento**: 4 · 6 · 9 · 12 · 14 · 16 · 20 · 24 · 26 · 30.
**Sombra**: `0 18px 50px rgba(20,60,55,.08)` (apenas o shell).

## Marca
Logo: quadrado teal radius 11–13 com "D&D" 800 branco e a flor de 5 pétalas rosa `#CD4664` com miolo branco no canto superior direito. Manual de marca: teal e rosa são primárias; roxo `#463273`, pêssego e turquesa apenas como apoio. Substituir o marcador por logo oficial em SVG quando disponível.

## Assets
Nenhuma imagem — todos os ícones são formas CSS/SVG inline. Fontes via Google Fonts (Manrope, JetBrains Mono).

## Dados reais usados no protótipo (MAIO/2026)
9 lojas: Rodo 3 (1017), Tijuca 3 (157), Itaboraí 2 (257), Rio Branco (363), Copa 2 (165), Rodrigo Silva (997), Conceição (109), Center IV (117), São José (236). Meta 1 total R$ 1.828.435, realizado R$ 1.145.895 (62,7%) no 18º de 26 dias úteis. Histórico jan–mai na planilha `base/METAS_2026.xlsx`.

## Arquivos
- `painel-metas-dd.dc.html` + `support.js` — protótipo editável
- `index-standalone.html` — versão publicada, arquivo único
- `base/METAS_2026_base_painel.xlsx`, `base/METAS_2026.xlsx` — planilhas de origem
