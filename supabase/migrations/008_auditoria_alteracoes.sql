begin;

create table if not exists public.log_alteracoes (
  id bigserial primary key,
  tabela text not null,
  registro_id text,
  acao text not null check (acao in ('insert','update','delete')),
  valor_anterior jsonb,
  valor_novo jsonb,
  usuario_id uuid references public.profiles(id),
  em timestamptz not null default now()
);

alter table public.log_alteracoes enable row level security;
revoke all on public.log_alteracoes from anon;
grant select on public.log_alteracoes to authenticated;
grant usage, select on sequence public.log_alteracoes_id_seq to authenticated;

drop policy if exists log_alteracoes_admin_select on public.log_alteracoes;
create policy log_alteracoes_admin_select on public.log_alteracoes
for select to authenticated
using (private.current_role()='administrador');

create or replace function public.registrar_alteracao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_ref jsonb;
  v_registro text;
begin
  if tg_op='INSERT' then
    v_new=to_jsonb(new); v_ref=v_new;
  elsif tg_op='UPDATE' then
    v_old=to_jsonb(old); v_new=to_jsonb(new); v_ref=v_new;
  else
    v_old=to_jsonb(old); v_ref=v_old;
  end if;

  v_registro = coalesce(
    v_ref->>'id',
    case when v_ref ? 'vendedora_id' then (v_ref->>'vendedora_id') || '|' || coalesce(v_ref->>'competencia',v_ref->>'data','') end,
    v_ref->>'loja_id'
  );

  insert into public.log_alteracoes(tabela,registro_id,acao,valor_anterior,valor_novo,usuario_id)
  values (tg_table_name,v_registro,lower(tg_op),v_old,v_new,auth.uid());

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.registrar_alteracao() from public, anon, authenticated;

drop trigger if exists audit_metas on public.metas;
create trigger audit_metas after insert or update or delete on public.metas
for each row execute function public.registrar_alteracao();

drop trigger if exists audit_resultados on public.resultados;
create trigger audit_resultados after insert or update or delete on public.resultados
for each row execute function public.registrar_alteracao();

drop trigger if exists audit_meta_vendedora on public.meta_vendedora;
create trigger audit_meta_vendedora after insert or update or delete on public.meta_vendedora
for each row execute function public.registrar_alteracao();

drop trigger if exists audit_lojas on public.lojas;
create trigger audit_lojas after insert or update or delete on public.lojas
for each row execute function public.registrar_alteracao();

commit;
