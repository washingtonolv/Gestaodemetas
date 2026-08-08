begin;

create table if not exists public.competencias (
  competencia date primary key,
  dias_uteis int not null check (dias_uteis between 1 and 27),
  fator_meta2 numeric(5,3) not null default 1.120,
  fator_meta3 numeric(5,3) not null default 1.300,
  fechado boolean not null default false,
  fechado_em timestamptz,
  fechado_por uuid references public.profiles(id),
  check (date_trunc('month', competencia)::date = competencia)
);

-- Seed de 2026 calculado: todos os dias menos domingos.
insert into public.competencias (competencia, dias_uteis)
select mes::date,
       count(*) filter (where extract(dow from dia) <> 0)::int as dias_uteis
from generate_series(date '2026-01-01', date '2026-12-01', interval '1 month') mes
cross join lateral generate_series(
  mes,
  (mes + interval '1 month - 1 day')::date,
  interval '1 day'
) dia
group by mes
on conflict (competencia) do nothing;

alter table public.competencias enable row level security;

drop policy if exists competencias_select_authenticated on public.competencias;
create policy competencias_select_authenticated
on public.competencias for select to authenticated
using (true);

drop policy if exists competencias_admin_insert on public.competencias;
create policy competencias_admin_insert
on public.competencias for insert to authenticated
with check (private.current_role() = 'administrador');

drop policy if exists competencias_admin_update on public.competencias;
create policy competencias_admin_update
on public.competencias for update to authenticated
using (private.current_role() = 'administrador')
with check (private.current_role() = 'administrador');

drop policy if exists competencias_admin_delete on public.competencias;
create policy competencias_admin_delete
on public.competencias for delete to authenticated
using (private.current_role() = 'administrador');

grant select on public.competencias to authenticated;
grant insert, update, delete on public.competencias to authenticated;

commit;
