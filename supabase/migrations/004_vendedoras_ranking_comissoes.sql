begin;

create table if not exists public.vendedoras (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  nome text not null,
  cpf text,
  admissao date,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.meta_vendedora (
  vendedora_id uuid not null references public.vendedoras(id) on delete cascade,
  competencia date not null references public.competencias(competencia),
  valor_meta numeric(12,2) not null check (valor_meta >= 0),
  primary key (vendedora_id, competencia)
);

create table if not exists public.resultado_vendedora (
  vendedora_id uuid not null references public.vendedoras(id) on delete cascade,
  data date not null,
  valor_realizado numeric(12,2) not null check (valor_realizado >= 0),
  atendimentos int check (atendimentos >= 0),
  criado_por uuid references public.profiles(id),
  primary key (vendedora_id, data)
);

create table if not exists public.faixas_comissao (
  nivel int primary key check (nivel between 1 and 3),
  percentual numeric(5,3) not null
);

insert into public.faixas_comissao (nivel, percentual)
values (1,0.800),(2,1.000),(3,1.200)
on conflict (nivel) do update set percentual = excluded.percentual;

alter table public.vendedoras enable row level security;
alter table public.meta_vendedora enable row level security;
alter table public.resultado_vendedora enable row level security;
alter table public.faixas_comissao enable row level security;

grant select, insert, update, delete on public.vendedoras, public.meta_vendedora, public.resultado_vendedora to authenticated;
grant select on public.faixas_comissao to authenticated;

drop policy if exists vendedoras_select on public.vendedoras;
create policy vendedoras_select on public.vendedoras for select to authenticated
using (private.can_access_store(loja_id));

drop policy if exists vendedoras_insert on public.vendedoras;
create policy vendedoras_insert on public.vendedoras for insert to authenticated
with check (private.can_manage_goals(loja_id));

drop policy if exists vendedoras_update on public.vendedoras;
create policy vendedoras_update on public.vendedoras for update to authenticated
using (private.can_manage_goals(loja_id)) with check (private.can_manage_goals(loja_id));

drop policy if exists vendedoras_delete on public.vendedoras;
create policy vendedoras_delete on public.vendedoras for delete to authenticated
using (private.can_manage_goals(loja_id));

drop policy if exists meta_vendedora_select on public.meta_vendedora;
create policy meta_vendedora_select on public.meta_vendedora for select to authenticated
using (exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_access_store(v.loja_id)));

drop policy if exists meta_vendedora_insert on public.meta_vendedora;
create policy meta_vendedora_insert on public.meta_vendedora for insert to authenticated
with check (
  private.competencia_aberta(competencia)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
);

drop policy if exists meta_vendedora_update on public.meta_vendedora;
create policy meta_vendedora_update on public.meta_vendedora for update to authenticated
using (
  private.competencia_aberta(competencia)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
)
with check (
  private.competencia_aberta(competencia)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
);

drop policy if exists meta_vendedora_delete on public.meta_vendedora;
create policy meta_vendedora_delete on public.meta_vendedora for delete to authenticated
using (
  private.competencia_aberta(competencia)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
);

drop policy if exists resultado_vendedora_select on public.resultado_vendedora;
create policy resultado_vendedora_select on public.resultado_vendedora for select to authenticated
using (exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_access_store(v.loja_id)));

drop policy if exists resultado_vendedora_insert on public.resultado_vendedora;
create policy resultado_vendedora_insert on public.resultado_vendedora for insert to authenticated
with check (
  criado_por = auth.uid()
  and private.competencia_aberta(data)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
);

drop policy if exists resultado_vendedora_update on public.resultado_vendedora;
create policy resultado_vendedora_update on public.resultado_vendedora for update to authenticated
using (
  private.competencia_aberta(data)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
)
with check (
  private.competencia_aberta(data)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
);

drop policy if exists resultado_vendedora_delete on public.resultado_vendedora;
create policy resultado_vendedora_delete on public.resultado_vendedora for delete to authenticated
using (
  private.competencia_aberta(data)
  and exists (select 1 from public.vendedoras v where v.id=vendedora_id and private.can_manage_goals(v.loja_id))
);

drop policy if exists faixas_comissao_select on public.faixas_comissao;
create policy faixas_comissao_select on public.faixas_comissao for select to authenticated using (true);

create or replace function public.ranking_vendedoras(p_competencia date)
returns table (
  vendedora_id uuid,
  nome text,
  loja_nome text,
  meta numeric,
  realizado numeric,
  pct numeric,
  ticket_medio numeric,
  nivel_atingido int,
  percentual_comissao numeric,
  valor_comissao numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      v.id as vendedora_id,
      v.nome,
      l.nome as loja_nome,
      coalesce(mv.valor_meta,0)::numeric as meta,
      coalesce(sum(rv.valor_realizado),0)::numeric as realizado,
      coalesce(sum(rv.atendimentos),0)::numeric as atendimentos
    from public.vendedoras v
    join public.lojas l on l.id=v.loja_id
    left join public.meta_vendedora mv
      on mv.vendedora_id=v.id
     and mv.competencia=date_trunc('month',p_competencia)::date
    left join public.resultado_vendedora rv
      on rv.vendedora_id=v.id
     and rv.data >= date_trunc('month',p_competencia)::date
     and rv.data < (date_trunc('month',p_competencia)+interval '1 month')::date
    where v.ativa=true
      and private.can_access_store(v.loja_id)
    group by v.id,v.nome,l.nome,mv.valor_meta
  ), calc as (
    select b.*,
           case when b.meta>0 then b.realizado/b.meta else 0 end as pct,
           case when b.atendimentos>0 then b.realizado/b.atendimentos else null end as ticket_medio,
           case
             when b.meta>0 and b.realizado/b.meta >= 1.00 then 3
             when b.meta>0 and b.realizado/b.meta >= 0.90 then 2
             when b.meta>0 and b.realizado/b.meta >= 0.75 then 1
             else 0
           end as nivel_atingido
    from base b
  )
  select
    c.vendedora_id,
    c.nome,
    c.loja_nome,
    c.meta,
    c.realizado,
    c.pct,
    c.ticket_medio,
    c.nivel_atingido,
    coalesce(fc.percentual,0)::numeric as percentual_comissao,
    case when c.nivel_atingido=0 then 0::numeric
         else round(c.realizado * coalesce(fc.percentual,0) / 100, 2)
    end as valor_comissao
  from calc c
  left join public.faixas_comissao fc on fc.nivel=c.nivel_atingido
  order by c.pct desc, c.realizado desc, c.nome;
$$;

revoke all on function public.ranking_vendedoras(date) from public, anon;
grant execute on function public.ranking_vendedoras(date) to authenticated;

commit;
