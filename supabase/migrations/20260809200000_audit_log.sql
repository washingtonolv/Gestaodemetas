-- Cria a tabela public.audit_log, referenciada pelos triggers de governança
-- (registrar_auditoria_competencia e registrar_auditoria_calendario_metas)
-- desde 20260809033000 e 20260809193000, mas nunca criada. Sem ela, todo
-- insert/update em competencias, configuracoes_meta e calendario_loja_excecoes
-- falha com "relation public.audit_log does not exist".
begin;

create table if not exists public.audit_log (
  id bigserial primary key,
  user_id uuid references public.profiles(id),
  acao text not null,
  entidade text not null,
  entidade_id text,
  detalhes jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
grant select on public.audit_log to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
for select to authenticated
using (private.current_role()='administrador');

commit;
