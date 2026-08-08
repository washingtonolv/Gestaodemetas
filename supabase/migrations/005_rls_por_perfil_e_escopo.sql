begin;

create or replace function private.lojas_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id
  from public.lojas l
  where exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.ativo=true and p.role='administrador'
  )
  union
  select sl.loja_id
  from public.supervisor_lojas sl
  join public.profiles p on p.id=sl.supervisor_id and p.ativo=true
  where sl.supervisor_id=auth.uid()
  union
  select sl.loja_id
  from public.gerente_supervisores gs
  join public.supervisor_lojas sl on sl.supervisor_id=gs.supervisor_id
  where gs.gerente_id=auth.uid();
$$;

revoke all on function private.lojas_do_usuario() from public, anon;
grant execute on function private.lojas_do_usuario() to authenticated;

do $$
declare p record;
begin
  for p in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename in ('lojas','metas','resultados','vendedoras','meta_vendedora','resultado_vendedora','profiles','competencias','gerente_supervisores','supervisor_lojas')
  loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

create policy profiles_select on public.profiles for select to authenticated
using (private.current_role()='administrador' or id=auth.uid());
create policy profiles_admin_insert on public.profiles for insert to authenticated
with check (private.current_role()='administrador');
create policy profiles_admin_update on public.profiles for update to authenticated
using (private.current_role()='administrador') with check (private.current_role()='administrador');
create policy profiles_admin_delete on public.profiles for delete to authenticated
using (private.current_role()='administrador');

create policy lojas_select on public.lojas for select to authenticated
using (id in (select private.lojas_do_usuario()));
create policy lojas_admin_insert on public.lojas for insert to authenticated
with check (private.current_role()='administrador');
create policy lojas_admin_update on public.lojas for update to authenticated
using (private.current_role()='administrador') with check (private.current_role()='administrador');
create policy lojas_admin_delete on public.lojas for delete to authenticated
using (private.current_role()='administrador');

create policy competencias_select on public.competencias for select to authenticated using (true);
create policy competencias_admin_insert on public.competencias for insert to authenticated with check (private.current_role()='administrador');
create policy competencias_admin_update on public.competencias for update to authenticated using (private.current_role()='administrador') with check (private.current_role()='administrador');
create policy competencias_admin_delete on public.competencias for delete to authenticated using (private.current_role()='administrador');

create policy metas_select on public.metas for select to authenticated
using (loja_id in (select private.lojas_do_usuario()));
create policy metas_insert on public.metas for insert to authenticated
with check (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(competencia) and criado_por=auth.uid());
create policy metas_update on public.metas for update to authenticated
using (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(competencia))
with check (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(competencia));
create policy metas_delete on public.metas for delete to authenticated
using (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(competencia));

create policy resultados_select on public.resultados for select to authenticated
using (loja_id in (select private.lojas_do_usuario()));
create policy resultados_insert on public.resultados for insert to authenticated
with check (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(data) and criado_por=auth.uid());
create policy resultados_update on public.resultados for update to authenticated
using (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(data))
with check (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(data));
create policy resultados_delete on public.resultados for delete to authenticated
using (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()) and private.competencia_aberta(data));

create policy vendedoras_select on public.vendedoras for select to authenticated
using (loja_id in (select private.lojas_do_usuario()));
create policy vendedoras_insert on public.vendedoras for insert to authenticated
with check (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()));
create policy vendedoras_update on public.vendedoras for update to authenticated
using (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()))
with check (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()));
create policy vendedoras_delete on public.vendedoras for delete to authenticated
using (private.current_role() in ('administrador','supervisor') and loja_id in (select private.lojas_do_usuario()));

create policy meta_vendedora_select on public.meta_vendedora for select to authenticated
using (exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));
create policy meta_vendedora_insert on public.meta_vendedora for insert to authenticated
with check (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(competencia) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));
create policy meta_vendedora_update on public.meta_vendedora for update to authenticated
using (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(competencia) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())))
with check (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(competencia) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));
create policy meta_vendedora_delete on public.meta_vendedora for delete to authenticated
using (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(competencia) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));

create policy resultado_vendedora_select on public.resultado_vendedora for select to authenticated
using (exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));
create policy resultado_vendedora_insert on public.resultado_vendedora for insert to authenticated
with check (private.current_role() in ('administrador','supervisor') and criado_por=auth.uid() and private.competencia_aberta(data) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));
create policy resultado_vendedora_update on public.resultado_vendedora for update to authenticated
using (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(data) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())))
with check (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(data) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));
create policy resultado_vendedora_delete on public.resultado_vendedora for delete to authenticated
using (private.current_role() in ('administrador','supervisor') and private.competencia_aberta(data) and exists(select 1 from public.vendedoras v where v.id=vendedora_id and v.loja_id in (select private.lojas_do_usuario())));

create policy gs_select on public.gerente_supervisores for select to authenticated
using (private.current_role()='administrador' or gerente_id=auth.uid() or supervisor_id=auth.uid());
create policy gs_admin_insert on public.gerente_supervisores for insert to authenticated with check (private.current_role()='administrador');
create policy gs_admin_update on public.gerente_supervisores for update to authenticated using (private.current_role()='administrador') with check (private.current_role()='administrador');
create policy gs_admin_delete on public.gerente_supervisores for delete to authenticated using (private.current_role()='administrador');

create policy sl_select on public.supervisor_lojas for select to authenticated
using (private.current_role()='administrador' or supervisor_id=auth.uid() or exists(select 1 from public.gerente_supervisores gs where gs.gerente_id=auth.uid() and gs.supervisor_id=supervisor_lojas.supervisor_id));
create policy sl_admin_insert on public.supervisor_lojas for insert to authenticated with check (private.current_role()='administrador');
create policy sl_admin_update on public.supervisor_lojas for update to authenticated using (private.current_role()='administrador') with check (private.current_role()='administrador');
create policy sl_admin_delete on public.supervisor_lojas for delete to authenticated using (private.current_role()='administrador');

commit;
