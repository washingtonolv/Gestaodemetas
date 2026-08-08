begin;

create or replace function private.competencia_aberta(p_data date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select not c.fechado
      from public.competencias c
      where c.competencia = date_trunc('month', p_data)::date
    ),
    true
  );
$$;

revoke all on function private.competencia_aberta(date) from public, anon;
grant execute on function private.competencia_aberta(date) to authenticated;

create or replace function public.fechar_competencia(p_competencia date)
returns public.competencias
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_result public.competencias;
begin
  if auth.uid() is null or private.current_role() <> 'administrador' then
    raise exception 'Apenas administrador pode fechar competência' using errcode = '42501';
  end if;

  update public.competencias
     set fechado = true,
         fechado_em = now(),
         fechado_por = auth.uid()
   where competencia = v_competencia
   returning * into v_result;

  if v_result.competencia is null then
    raise exception 'Competência % não cadastrada', v_competencia using errcode = '22023';
  end if;

  return v_result;
end;
$$;

revoke all on function public.fechar_competencia(date) from public, anon;
grant execute on function public.fechar_competencia(date) to authenticated;

drop policy if exists metas_insert on public.metas;
create policy metas_insert on public.metas
for insert to authenticated
with check (
  private.can_manage_goals(loja_id)
  and criado_por = auth.uid()
  and private.competencia_aberta(competencia)
);

drop policy if exists metas_update on public.metas;
create policy metas_update on public.metas
for update to authenticated
using (
  private.can_manage_goals(loja_id)
  and private.competencia_aberta(competencia)
)
with check (
  private.can_manage_goals(loja_id)
  and private.competencia_aberta(competencia)
);

drop policy if exists metas_delete on public.metas;
create policy metas_delete on public.metas
for delete to authenticated
using (
  private.can_manage_goals(loja_id)
  and private.competencia_aberta(competencia)
);

drop policy if exists resultados_insert_managed_store on public.resultados;
create policy resultados_insert_managed_store on public.resultados
for insert to authenticated
with check (
  private.can_manage_goals(loja_id)
  and criado_por = auth.uid()
  and private.competencia_aberta(data)
);

drop policy if exists resultados_update_managed_store on public.resultados;
create policy resultados_update_managed_store on public.resultados
for update to authenticated
using (
  private.can_manage_goals(loja_id)
  and private.competencia_aberta(data)
)
with check (
  private.can_manage_goals(loja_id)
  and private.competencia_aberta(data)
);

drop policy if exists resultados_admin_delete on public.resultados;
create policy resultados_admin_delete on public.resultados
for delete to authenticated
using (
  private.current_role() = 'administrador'
  and private.competencia_aberta(data)
);

commit;
