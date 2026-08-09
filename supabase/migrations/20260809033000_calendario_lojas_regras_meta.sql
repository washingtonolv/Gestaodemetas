-- Calendário operacional por loja e regras centrais de metas.
create table if not exists public.configuracoes_meta (
  id boolean primary key default true check (id),
  dias_semana_uteis smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  fator_meta2 numeric(6,3) not null default 1.120,
  fator_meta3 numeric(6,3) not null default 1.300,
  crescimento_sugestao numeric(6,3) not null default 1.060,
  arredondamento_meta numeric(12,2) not null default 1000,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null,
  constraint configuracoes_meta_dias_validos check (
    cardinality(dias_semana_uteis) between 1 and 7
    and dias_semana_uteis <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint configuracoes_meta_fatores_validos check (
    fator_meta2 between 1 and 3 and fator_meta3 between fator_meta2 and 4
  ),
  constraint configuracoes_meta_crescimento_valido check (crescimento_sugestao between 0.5 and 3),
  constraint configuracoes_meta_arredondamento_valido check (arredondamento_meta > 0)
);

insert into public.configuracoes_meta (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.calendario_loja_excecoes (
  id bigint generated always as identity primary key,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  data date not null,
  tipo text not null,
  descricao text,
  origem text not null default 'manual',
  criado_em timestamptz not null default now(),
  criado_por uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  constraint calendario_loja_excecoes_unica unique (loja_id, data),
  constraint calendario_loja_excecoes_tipo check (tipo in ('fechado','aberto')),
  constraint calendario_loja_excecoes_origem check (origem in ('manual','feriados_api','google_calendar')),
  constraint calendario_loja_excecoes_descricao check (descricao is null or length(btrim(descricao)) between 2 and 180)
);

create index if not exists calendario_loja_excecoes_data_loja_idx
  on public.calendario_loja_excecoes (data, loja_id);
create index if not exists calendario_loja_excecoes_criado_por_idx
  on public.calendario_loja_excecoes (criado_por);
create index if not exists calendario_loja_excecoes_atualizado_por_idx
  on public.calendario_loja_excecoes (atualizado_por);
create index if not exists configuracoes_meta_atualizado_por_idx
  on public.configuracoes_meta (atualizado_por);

alter table public.configuracoes_meta enable row level security;
alter table public.calendario_loja_excecoes enable row level security;

drop policy if exists configuracoes_meta_select on public.configuracoes_meta;
create policy configuracoes_meta_select on public.configuracoes_meta
  for select to authenticated
  using ((select private.current_role()) in ('administrador','supervisor','gerente_comercial'));

drop policy if exists configuracoes_meta_admin_insert on public.configuracoes_meta;
create policy configuracoes_meta_admin_insert on public.configuracoes_meta
  for insert to authenticated
  with check (
    (select private.current_role()) = 'administrador'
    and atualizado_por = (select auth.uid())
  );

drop policy if exists configuracoes_meta_admin_update on public.configuracoes_meta;
create policy configuracoes_meta_admin_update on public.configuracoes_meta
  for update to authenticated
  using ((select private.current_role()) = 'administrador')
  with check (
    (select private.current_role()) = 'administrador'
    and atualizado_por = (select auth.uid())
  );

drop policy if exists calendario_loja_excecoes_select on public.calendario_loja_excecoes;
create policy calendario_loja_excecoes_select on public.calendario_loja_excecoes
  for select to authenticated
  using (loja_id in (select private.lojas_do_usuario()));

drop policy if exists calendario_loja_excecoes_insert on public.calendario_loja_excecoes;
create policy calendario_loja_excecoes_insert on public.calendario_loja_excecoes
  for insert to authenticated
  with check (
    (select private.current_role()) in ('administrador','supervisor')
    and loja_id in (select private.lojas_do_usuario())
    and criado_por = (select auth.uid())
    and atualizado_por = (select auth.uid())
  );

drop policy if exists calendario_loja_excecoes_update on public.calendario_loja_excecoes;
create policy calendario_loja_excecoes_update on public.calendario_loja_excecoes
  for update to authenticated
  using (
    (select private.current_role()) in ('administrador','supervisor')
    and loja_id in (select private.lojas_do_usuario())
  )
  with check (
    (select private.current_role()) in ('administrador','supervisor')
    and loja_id in (select private.lojas_do_usuario())
    and atualizado_por = (select auth.uid())
  );

drop policy if exists calendario_loja_excecoes_delete on public.calendario_loja_excecoes;
create policy calendario_loja_excecoes_delete on public.calendario_loja_excecoes
  for delete to authenticated
  using (
    (select private.current_role()) in ('administrador','supervisor')
    and loja_id in (select private.lojas_do_usuario())
  );

grant select on public.configuracoes_meta to authenticated;
grant insert, update on public.configuracoes_meta to authenticated;
grant select, insert, update, delete on public.calendario_loja_excecoes to authenticated;
grant usage, select on sequence public.calendario_loja_excecoes_id_seq to authenticated;

create or replace function private.registrar_auditoria_calendario_metas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entidade text;
  v_acao text;
  v_id text;
  v_detalhes jsonb;
begin
  if tg_table_name = 'configuracoes_meta' then
    v_entidade := 'configuracoes_meta';
    v_acao := 'regras_meta_atualizadas';
    v_id := 'rede';
  else
    v_entidade := 'calendario_loja_excecoes';
    v_acao := case tg_op when 'INSERT' then 'excecao_calendario_criada' when 'UPDATE' then 'excecao_calendario_atualizada' else 'excecao_calendario_removida' end;
    v_id := coalesce(new.id, old.id)::text;
  end if;

  v_detalhes := jsonb_build_object(
    'antes', case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    'depois', case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  insert into public.audit_log (user_id, acao, entidade, entidade_id, detalhes)
  values (auth.uid(), v_acao, v_entidade, v_id, v_detalhes);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.registrar_auditoria_calendario_metas() from public, anon, authenticated;

drop trigger if exists configuracoes_meta_auditoria on public.configuracoes_meta;
create trigger configuracoes_meta_auditoria
after insert or update on public.configuracoes_meta
for each row execute function private.registrar_auditoria_calendario_metas();

drop trigger if exists calendario_loja_excecoes_auditoria on public.calendario_loja_excecoes;
create trigger calendario_loja_excecoes_auditoria
after insert or update or delete on public.calendario_loja_excecoes
for each row execute function private.registrar_auditoria_calendario_metas();

alter table public.configuracoes_meta replica identity full;
alter table public.calendario_loja_excecoes replica identity full;

