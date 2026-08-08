# Instruções de back-end — Gestão de Metas D&D

Repositório: `washingtonolv/Gestaodemetas` (branch `main`, GitHub Pages)
Front-end atual: `login.html`, `app-v3.html`, `app-v3.js`, `supabase-client.js`
Back-end: Supabase (Postgres + Auth + RLS + Edge Functions)
Projeto Supabase: `szphqhiqblnkcuwusswe`

Execute as tarefas **na ordem**. Cada uma é independente e testável. Não altere o layout nem as cores do front — apenas a camada de dados e os pontos de integração indicados.

---

## Contexto do domínio

Rede de 9–10 franquias de cosméticos. A supervisora define a **Meta 1** de cada loja por mês; **Meta 2 = Meta 1 × 1,12** e **Meta 3 = Meta 1 × 1,30**. As gerentes lançam a venda de cada dia. Domingo a loja não abre (não é dia útil). Vendedoras têm meta individual e recebem comissão por faixa atingida: 1ª meta 0,8%, 2ª meta 1,0%, 3ª meta 1,2%.

Perfis (já existentes em `profiles.role`): `administrador`, `gerente_comercial`, `supervisor`, `pendente`.
Vínculos existentes: `gerente_supervisores (gerente_id, supervisor_id)`, `supervisor_lojas (supervisor_id, loja_id)`.
Tabelas existentes: `profiles`, `lojas (id, codigo, nome, ativa)`, `metas (loja_id, competencia, valor_meta, criado_por)`, `resultados (loja_id, data, valor_realizado, criado_por)`.

`competencia` é sempre o **primeiro dia do mês** (`YYYY-MM-01`).

---

## Tarefa 1 — Constraints de unicidade (CRÍTICO, fazer antes de tudo)

`app-v3.js` já usa `upsert` com `onConflict:'loja_id,data'` e `onConflict:'loja_id,competencia'`. Se essas constraints não existirem, cada salvamento **insere linha duplicada** e o realizado infla silenciosamente.

1. Deduplicar o que já existe (manter a linha mais recente por chave).
2. Criar `UNIQUE (loja_id, data)` em `resultados` e `UNIQUE (loja_id, competencia)` em `metas`.
3. Adicionar `CHECK (valor_realizado >= 0)` e `CHECK (valor_meta >= 0)`.
4. Adicionar `criado_em timestamptz default now()` e `atualizado_em timestamptz` nas duas tabelas, com trigger que atualiza `atualizado_em`.

Critério de aceite: rodar o "Salvar lançamentos" duas vezes na mesma data não muda o total do painel.

---

## Tarefa 2 — Tabela `competencias` (dias úteis, fatores e fechamento)

Hoje `renderSales()` calcula a meta do dia dividindo pelos **dias do calendário** (`new Date(y,m,0).getDate()`), o que inclui domingos e produz meta diária errada. Os fatores 1,12/1,30 existem apenas como texto nos inputs — não são persistidos.

Criar:

```sql
competencias (
  competencia   date primary key,      -- YYYY-MM-01
  dias_uteis    int  not null check (dias_uteis between 1 and 27),
  fator_meta2   numeric(5,3) not null default 1.120,
  fator_meta3   numeric(5,3) not null default 1.300,
  fechado       boolean not null default false,
  fechado_em    timestamptz,
  fechado_por   uuid references profiles(id)
)
```

- Seed de jan/2026 a dez/2026 com `dias_uteis` = dias do mês menos os domingos (calcular, não chutar).
- Se `dias_uteis` não estiver preenchido para um mês, o front deve usar esse cálculo como fallback.

**Alterações no front (`app-v3.js`)**
- Carregar a competência selecionada junto com `loadBase()` e usar `competencias.dias_uteis` em `renderSales()` no lugar do cálculo por calendário.
- Inicializar `#factor2` / `#factor3` com os valores da competência e **persistir** ao publicar metas.

Critério de aceite: com Meta 1 de R$ 260.000 e 26 dias úteis, a "Meta do dia" mostra R$ 10.000,00.

---

## Tarefa 3 — Fechamento do mês

Adicionar RPC `fechar_competencia(p_competencia date)`:
- só `administrador` pode executar;
- marca `fechado=true`, grava `fechado_em` e `fechado_por`.

Policies de RLS em `metas` e `resultados`: bloquear `insert`/`update`/`delete` quando a competência correspondente estiver fechada (para `resultados`, derivar a competência de `date_trunc('month', data)`).

**Front**: na tela Configurações, botão "Fechar mês" (apenas administrador) e, quando fechado, desabilitar "Salvar lançamentos" e "Publicar metas" com aviso.

Critério de aceite: após fechar maio, tentar salvar um lançamento de 20/05 retorna erro de permissão e o front mostra a mensagem.

---

## Tarefa 4 — Vendedoras, resultados individuais e comissão

O ranking atual é de lojas; vendedora não existe no banco. Criar:

```sql
vendedoras (
  id uuid pk default gen_random_uuid(),
  loja_id uuid not null references lojas(id),
  nome text not null,
  cpf text,
  admissao date,
  ativa boolean not null default true,
  criado_em timestamptz default now()
)

meta_vendedora (
  vendedora_id uuid references vendedoras(id),
  competencia date references competencias(competencia),
  valor_meta numeric(12,2) not null check (valor_meta >= 0),
  primary key (vendedora_id, competencia)
)

resultado_vendedora (
  vendedora_id uuid references vendedoras(id),
  data date not null,
  valor_realizado numeric(12,2) not null check (valor_realizado >= 0),
  atendimentos int check (atendimentos >= 0),
  criado_por uuid references profiles(id),
  primary key (vendedora_id, data)
)

faixas_comissao (
  nivel int primary key check (nivel between 1 and 3),
  percentual numeric(5,3) not null
)
-- seed: (1, 0.800), (2, 1.000), (3, 1.200)
```

RPC `ranking_vendedoras(p_competencia date)` devolvendo, respeitando o escopo de lojas do usuário:
`vendedora_id, nome, loja_nome, meta, realizado, pct, ticket_medio, nivel_atingido, percentual_comissao, valor_comissao`.

Regra do nível: `pct >= 1.00` → 3; `>= 0.90` → 2; `>= 0.75` → 1; abaixo → 0 (sem comissão).
`ticket_medio = realizado / atendimentos` (nulo quando não houver atendimentos).

**Front**: trocar o ranking de lojas por ranking de vendedoras consumindo essa RPC, com pódio das 3 primeiras e cartão de faixas com a contagem por nível. Adicionar formulário de cadastro de vendedora (nome, loja, meta individual, CPF, admissão).

---

## Tarefa 5 — RLS revisada por perfil

Auditar e reescrever as policies com estas regras explícitas:

| Tabela | administrador | supervisor | gerente_comercial |
|---|---|---|---|
| `lojas` | CRUD | leitura das lojas vinculadas | leitura das lojas dos supervisores vinculados |
| `metas` | CRUD | CRUD apenas das lojas vinculadas e mês aberto | somente leitura |
| `resultados` | CRUD | CRUD apenas das lojas vinculadas e mês aberto | somente leitura |
| `vendedoras`, `meta_vendedora`, `resultado_vendedora` | CRUD | CRUD das suas lojas | leitura |
| `profiles` | CRUD | leitura do próprio registro | leitura do próprio registro |
| `competencias` | CRUD | leitura | leitura |
| `gerente_supervisores`, `supervisor_lojas` | CRUD | leitura | leitura |

Criar funções auxiliares `SECURITY DEFINER` para reuso nas policies: `lojas_do_usuario()` (retorna set de `loja_id` conforme o perfil) e `competencia_aberta(date)`.

Testar com três usuários reais (um de cada perfil) e registrar o resultado no PR.

---

## Tarefa 6 — Gestão completa de usuários e vínculos

Hoje só existe a Edge Function `admin-create-user`, e os formulários de Estrutura apenas fazem `upsert` — **não há como desvincular**.

1. Edge Functions novas (todas validando no banco que o chamador é `administrador`; nunca usar `service_role` no browser):
   - `admin-update-user` — alterar nome, papel e `ativo`;
   - `admin-reset-password` — disparar redefinição de senha.
2. RPCs `desvincular_gerente_supervisor(gerente_id, supervisor_id)` e `desvincular_supervisor_loja(supervisor_id, loja_id)`.
3. **Front**: na tela Estrutura comercial, cada vínculo listado ganha ação de remover; na lista de usuários, ações de editar papel, ativar/desativar e reenviar senha.

---

## Tarefa 7 — Agregação no banco (desempenho)

`renderYear()` baixa **todos** os resultados do ano para somar no navegador. Substituir por:

- view `v_desempenho_mensal (competencia, loja_id, meta, realizado, pct)`;
- RPC `resumo_ano(p_ano int)` devolvendo meta, realizado, `pct` e `bateu` por mês, já filtrada pelo escopo do usuário.

Front passa a consumir a RPC. Mesmos números, uma requisição.

---

## Tarefa 8 — Auditoria

```sql
log_alteracoes (
  id bigserial pk,
  tabela text, registro_id text, acao text,   -- insert|update|delete
  valor_anterior jsonb, valor_novo jsonb,
  usuario_id uuid references profiles(id),
  em timestamptz default now()
)
```

Trigger `AFTER INSERT/UPDATE/DELETE` em `metas`, `resultados`, `meta_vendedora` e `lojas`. Nas Configurações, mostrar os 20 eventos mais recentes (apenas administrador).

Motivo: hoje não há como saber quem alterou uma meta de R$ 269.314 para R$ 180.000 nem quando.

---

## Tarefa 9 — Importação de vendas (planilha e Microvix)

1. Tabela `importacao_staging (id, competencia, origem, payload jsonb, criado_por, criado_em, processado_em, erro text)`.
2. RPC `processar_importacao(p_id bigint)` que valida e faz `upsert` em `resultados`, casando a loja por `codigo` (Microvix) e reportando linhas rejeitadas.
3. **Front**: em Lançar vendas, botão "Importar planilha" com colar de TSV/CSV (colunas: código da loja, data, valor, atendimentos), pré-visualização com erros por linha antes de confirmar.
4. Deixar preparado para um job agendado (`pg_cron`) chamar a API do Microvix quando a credencial existir — não implementar a chamada externa agora.

---

## Tarefa 10 — Exportação de relatório

RPC `relatorio_mensal(p_competencia date)` devolvendo, por loja: meta 1/2/3, realizado, %, falta, projeção e situação; e por vendedora: meta, realizado, faixa e comissão.
**Front**: botões "Exportar Excel" (SheetJS via CDN) e "Exportar PDF" (impressão do navegador com CSS de impressão).

---

## Bug já corrigido — aplicar no repositório

`app-v3.js`, função `saveSales()`: o payload usava o atalho `data`, mas a variável no escopo é `date`. Isso lança `ReferenceError` e **nenhum lançamento é salvo**.

```js
// errado
.map(i=>({loja_id:i.dataset.id, data, valor_realizado:parseBRL(i.value), criado_por:profile.id}))
// correto
.map(i=>({loja_id:i.dataset.id, data:date, valor_realizado:parseBRL(i.value), criado_por:profile.id}))
```

---

## Regras gerais

- Cada tarefa em um commit próprio, com o SQL em `supabase/migrations/NNN_descricao.sql` (migrações versionadas, idempotentes quando possível).
- Nenhuma chave `service_role` no repositório ou no browser — só a `publishable` que já está em `supabase-client.js`.
- Valores monetários em `numeric(12,2)`; nunca `float`.
- Datas sempre no fuso local do Brasil; não usar `new Date().toISOString()` para gerar dia (o front já tem `localDate()` correto).
- Toda RPC nova precisa respeitar o escopo de lojas do usuário — não confiar em filtro do front.
- Não introduzir framework nem build step: o front é HTML + ES modules servido pelo GitHub Pages.
- Ao final de cada tarefa, descrever no PR o que foi testado e com qual perfil de usuário.
