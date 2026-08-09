-- Governança dos fatores e dias úteis por competência.
alter table public.competencias
  add column if not exists ajustes_bloqueados boolean not null default false,
  add column if not exists bloqueado_em timestamptz,
  add column if not exists bloqueado_por uuid references public.profiles(id) on delete set null,
  add column if not exists atualizado_em timestamptz not null default now(),
  add column if not exists atualizado_por uuid references public.profiles(id) on delete set null;

comment on column public.competencias.ajustes_bloqueados is
  'Quando true, supervisores não podem alterar fatores e dias úteis; administradores continuam autorizados.';

create index if not exists competencias_bloqueado_por_idx
  on public.competencias (bloqueado_por)
  where bloqueado_por is not null;

create index if not exists competencias_atualizado_por_idx
  on public.competencias (atualizado_por)
  where atualizado_por is not null;

create index if not exists competencias_fechado_por_idx
  on public.competencias (fechado_por)
  where fechado_por is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competencias'::regclass
      and conname = 'competencias_fatores_validos'
  ) then
    alter table public.competencias
      add constraint competencias_fatores_validos check (
        fator_meta2 between 1 and 3
        and fator_meta3 between fator_meta2 and 4
      );
  end if;
end;
$$;

create or replace function private.proteger_governanca_competencia()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text := (select private.current_role());
begin
  if (select auth.uid()) is null then
    if current_user in ('postgres', 'service_role') then
      return new;
    end if;
    raise exception 'Sessão inválida para alterar a competência' using errcode = '42501';
  end if;

  if v_role not in ('administrador', 'supervisor') then
    raise exception 'Perfil sem permissão para alterar a competência' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if v_role = 'supervisor' then
      new.fechado := false;
      new.fechado_em := null;
      new.fechado_por := null;
      new.ajustes_bloqueados := false;
      new.bloqueado_em := null;
      new.bloqueado_por := null;
    end if;
  elsif v_role = 'supervisor' then
    if old.fechado then
      raise exception 'A competência está fechada' using errcode = '42501';
    end if;
    if old.ajustes_bloqueados then
      raise exception 'Fatores e dias bloqueados pelo Administrador' using errcode = '42501';
    end if;
    if new.competencia is distinct from old.competencia
       or new.fechado is distinct from old.fechado
       or new.fechado_em is distinct from old.fechado_em
       or new.fechado_por is distinct from old.fechado_por
       or new.ajustes_bloqueados is distinct from old.ajustes_bloqueados
       or new.bloqueado_em is distinct from old.bloqueado_em
       or new.bloqueado_por is distinct from old.bloqueado_por then
      raise exception 'Supervisores podem alterar somente fatores e dias úteis' using errcode = '42501';
    end if;
  end if;

  if v_role = 'administrador'
     and tg_op = 'UPDATE'
     and new.ajustes_bloqueados is distinct from old.ajustes_bloqueados then
    new.bloqueado_em := case when new.ajustes_bloqueados then now() else null end;
    new.bloqueado_por := case when new.ajustes_bloqueados then (select auth.uid()) else null end;
  elsif v_role = 'supervisor' and tg_op = 'UPDATE' then
    new.bloqueado_em := old.bloqueado_em;
    new.bloqueado_por := old.bloqueado_por;
  end if;

  new.atualizado_em := now();
  new.atualizado_por := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.proteger_governanca_competencia() from public, anon, authenticated;

drop trigger if exists competencias_proteger_governanca on public.competencias;
create trigger competencias_proteger_governanca
before insert or update on public.competencias
for each row execute function private.proteger_governanca_competencia();

drop policy if exists competencias_admin_insert on public.competencias;
drop policy if exists competencias_supervisor_insert on public.competencias;
drop policy if exists competencias_governanca_insert on public.competencias;
create policy competencias_governanca_insert on public.competencias
  for insert to authenticated
  with check (
    (select private.current_role()) = 'administrador'
    or (
      (select private.current_role()) = 'supervisor'
      and not fechado
      and not ajustes_bloqueados
      and atualizado_por = (select auth.uid())
    )
  );

drop policy if exists competencias_admin_update on public.competencias;
drop policy if exists competencias_supervisor_update on public.competencias;
drop policy if exists competencias_governanca_update on public.competencias;
create policy competencias_governanca_update on public.competencias
  for update to authenticated
  using (
    (select private.current_role()) = 'administrador'
    or (
      (select private.current_role()) = 'supervisor'
      and not fechado
      and not ajustes_bloqueados
    )
  )
  with check (
    (select private.current_role()) = 'administrador'
    or (
      (select private.current_role()) = 'supervisor'
      and not fechado
      and not ajustes_bloqueados
      and atualizado_por = (select auth.uid())
    )
  );

grant select, insert, update on public.competencias to authenticated;

create or replace function private.registrar_auditoria_competencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (user_id, acao, entidade, entidade_id, detalhes)
  values (
    (select auth.uid()),
    case
      when tg_op = 'INSERT' then 'competencia_criada'
      when new.ajustes_bloqueados is distinct from old.ajustes_bloqueados
        then case when new.ajustes_bloqueados then 'ajustes_competencia_bloqueados' else 'ajustes_competencia_liberados' end
      else 'fatores_competencia_atualizados'
    end,
    'competencias',
    new.competencia::text,
    jsonb_build_object(
      'antes', case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
      'depois', to_jsonb(new)
    )
  );
  return new;
end;
$$;

revoke all on function private.registrar_auditoria_competencia() from public, anon, authenticated;

drop trigger if exists competencias_auditoria_governanca on public.competencias;
create trigger competencias_auditoria_governanca
after insert or update on public.competencias
for each row execute function private.registrar_auditoria_competencia();
