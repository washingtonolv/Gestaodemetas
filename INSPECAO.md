# Inspeção do sistema — 08/08/2026

Escopo: `login.html`, `app-v3.html`, `app-v3.js`, `supabase-client.js`, redirects e camada Supabase.

---

## CRÍTICO — quebra o dado (banco)

### 1. `upsert` sem constraint de unicidade
`app-v3.js` usa `onConflict:'loja_id,data'` (resultados) e `onConflict:'loja_id,competencia'` (metas). Se essas constraints **não existirem** no Postgres, o Supabase não faz update — ele **insere linha nova a cada salvamento**. Efeito: salvar o mesmo dia duas vezes dobra o realizado da loja, e o painel mostra atingimento inflado sem nenhum erro na tela.

Verificar agora no SQL Editor:
```sql
select conname, contype from pg_constraint
where conrelid in ('resultados'::regclass,'metas'::regclass) and contype='u';
```
Se não retornar as duas, aplicar a Tarefa 1 de `BACKEND-TAREFAS.md` antes de qualquer uso real.

### 2. Sem trava de mês fechado
Não existe `competencias.fechado` nem policy correspondente. Qualquer supervisor pode reescrever hoje um resultado de março. Não há como auditar (sem `log_alteracoes`).

### 3. Loja nova nasce invisível
`#storeForm` faz `insert` em `lojas` e nada mais. Como a visibilidade do supervisor depende de `supervisor_lojas`, a loja cadastrada não aparece para ninguém além do administrador até alguém lembrar de criar o vínculo na outra aba. Deveria ser um passo só (ou um aviso explícito).

---

## CORRIGIDO nesta inspeção (`app-v3.js` — subir no repositório)

### 4. `saveSales()` — nenhum lançamento era salvo
O payload usava o atalho `data`, mas a variável no escopo é `date` → `ReferenceError`, nada gravava.
`{loja_id, data, ...}` → `{loja_id, data:date, ...}`

### 5. Meta do dia calculada no mês errado e contando domingo
`renderSales()` dividia a meta por **dias do calendário de `competence`** (o mês do seletor do topo), não da data escolhida. Dois defeitos somados: incluía domingos (loja fechada) e, ao lançar uma data de outro mês, usava a meta do mês errado. Agora conta apenas dias sem domingo e busca a meta da competência da própria data.

*Ainda pendente do banco*: o certo é ler `competencias.dias_uteis` (feriados não são domingo). O cálculo atual é o melhor fallback possível sem a tabela.

### 6. Lançar fora do mês parecia não salvar
Ao gravar uma data de junho com maio selecionado no topo, o `loadBase()` recarregava maio e o valor "desaparecia". Agora a mensagem avisa: *"Troque o mês no topo para ver no painel."*

### 7. Erro fatal ficava preso na tela
`fatal()` escrevia no `#fatal` e nada nunca limpava — um erro em "Definir metas" continuava visível em todas as outras telas. Agora limpa ao trocar de view.

### 8. Perfil sem registro travava o usuário
`getSessionProfile()` usa `.single()`; se o `profiles` não tem a linha (usuário recém-criado no Auth), lançava erro e o usuário ficava numa tela morta, sem link para sair. Agora volta para o login.

### 9. Gerente Comercial via botão que não podia usar
O card "Feche o dia até as 22h" tem `data-go="lancar"`, mas Gerente Comercial não tem essa tela no menu. Clicava e caía numa view sem permissão. Agora o card só aparece para quem tem a permissão.

### 10. Vínculos duplicados
`gerente_supervisores` e `supervisor_lojas` usavam `upsert` **sem** `onConflict` — mesmo problema do item 1, em escala menor: vincular duas vezes criava linhas repetidas e a lista "Estrutura atual" mostrava o vínculo em duplicidade. Agora com `onConflict` + `ignoreDuplicates`. **Precisa da PK/unique composta no banco para valer.**

---

## PENDÊNCIAS de produto (não são bugs, são lacunas)

- **Não há como desvincular.** Os formulários de Estrutura só criam. Um supervisor que trocou de região continua vendo a loja antiga para sempre.
- **Ranking é de lojas, não de vendedoras.** Vendedora, meta individual e comissão não existem no banco — a tela do protótipo não tem como ser alimentada.
- **`renderYear()` baixa todos os resultados do ano** para somar no navegador. Com 10 lojas × 300 dias já são ~3.000 linhas por carregamento.
- **Sem exportação** PDF/Excel.
- **`login.html` usa fonte Inter e não tem a flor rosa da marca**; o app usa Manrope. A primeira tela do sistema é a que menos parece a D&D.
- **Views `usuarios` e `estrutura` estão no DOM de todos os perfis** (escondidas por CSS). A RLS protege os dados, mas o ideal é remover do HTML quem não tem o papel.

---

## Verificado e OK

- `parseBRL()` trata corretamente `8.212,14`, `8212`, `1,12` e `R$ 1.000`.
- `esc()` aplicado em todo texto vindo do banco — sem XSS nas listagens.
- Apenas a chave `publishable` no repositório; `service_role` não aparece em lugar nenhum.
- `localDate()` usa fuso local (não `toISOString()`), então não há erro de dia virado.
- `timeout()` de 12s em todas as consultas, com handlers globais de `error` e `unhandledrejection`.
- Responsivo com breakpoints em 1180px e 680px, coerentes com o protótipo.
- Redirects `index.html → login.html` e `dashboard.html → app-v3.html` funcionam.

---

## Ordem recomendada

1. Rodar a query do item 1 e criar as constraints (**antes de qualquer uso real**).
2. Subir o `app-v3.js` corrigido desta inspeção.
3. Tabela `competencias` (dias úteis + fatores + fechamento) — Tarefa 2 e 3.
4. Desvincular (item das pendências) — é o que mais dói no dia a dia.
5. Vendedoras e comissão — Tarefa 4.
