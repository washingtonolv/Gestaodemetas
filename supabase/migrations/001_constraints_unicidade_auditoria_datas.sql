begin;

-- Deduplicação defensiva: mantém a linha mais recente por chave.
with ranked as (
  select id,
         row_number() over (
           partition by loja_id, data
           order by coalesce(updated_at, created_at) desc nulls last, id desc
         ) as rn
  from public.resultados
)
delete from public.resultados r
using ranked x
where r.id = x.id and x.rn > 1;

with ranked as (
  select id,
         row_number() over (
           partition by loja_id, competencia
           order by coalesce(updated_at, created_at) desc nulls last, id desc
         ) as rn
  from public.metas
)
delete from public.metas m
using ranked x
where m.id = x.id and x.rn > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.resultados'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (loja_id, data)'
  ) then
    alter table public.resultados
      add constraint resultados_loja_id_data_key unique (loja_id, data);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.metas'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (loja_id, competencia)'
  ) then
    alter table public.metas
      add constraint metas_loja_id_competencia_key unique (loja_id, competencia);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.resultados'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%valor_realizado >=%'
  ) then
    alter table public.resultados
      add constraint resultados_valor_realizado_check check (valor_realizado >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.metas'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%valor_meta >=%'
  ) then
    alter table public.metas
      add constraint metas_valor_meta_check check (valor_meta >= 0);
  end if;
end $$;

alter table public.resultados
  add column if not exists criado_em timestamptz default now(),
  add column if not exists atualizado_em timestamptz;

alter table public.metas
  add column if not exists criado_em timestamptz default now(),
  add column if not exists atualizado_em timestamptz;

update public.resultados
set criado_em = coalesce(criado_em, created_at, now()),
    atualizado_em = coalesce(atualizado_em, updated_at, created_at, now())
where criado_em is null or atualizado_em is null;

update public.metas
set criado_em = coalesce(criado_em, created_at, now()),
    atualizado_em = coalesce(atualizado_em, updated_at, created_at, now())
where criado_em is null or atualizado_em is null;

create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

revoke all on function public.set_atualizado_em() from public, anon, authenticated;

drop trigger if exists resultados_set_atualizado_em on public.resultados;
create trigger resultados_set_atualizado_em
before update on public.resultados
for each row execute function public.set_atualizado_em();

drop trigger if exists metas_set_atualizado_em on public.metas;
create trigger metas_set_atualizado_em
before update on public.metas
for each row execute function public.set_atualizado_em();

commit;
