begin;

create or replace function public.desvincular_gerente_supervisor(p_gerente_id uuid, p_supervisor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if auth.uid() is null or private.current_role() <> 'administrador' then
    raise exception 'Apenas administrador pode remover vínculos' using errcode='42501';
  end if;
  delete from public.gerente_supervisores
   where gerente_id=p_gerente_id and supervisor_id=p_supervisor_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function public.desvincular_supervisor_loja(p_supervisor_id uuid, p_loja_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if auth.uid() is null or private.current_role() <> 'administrador' then
    raise exception 'Apenas administrador pode remover vínculos' using errcode='42501';
  end if;
  delete from public.supervisor_lojas
   where supervisor_id=p_supervisor_id and loja_id=p_loja_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.desvincular_gerente_supervisor(uuid,uuid) from public, anon;
revoke all on function public.desvincular_supervisor_loja(uuid,uuid) from public, anon;
grant execute on function public.desvincular_gerente_supervisor(uuid,uuid) to authenticated;
grant execute on function public.desvincular_supervisor_loja(uuid,uuid) to authenticated;

commit;
