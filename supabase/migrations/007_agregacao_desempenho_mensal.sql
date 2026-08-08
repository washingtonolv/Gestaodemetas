begin;

create or replace view public.v_desempenho_mensal
with (security_invoker = true)
as
with r as (
  select date_trunc('month', data)::date as competencia,
         loja_id,
         sum(valor_realizado)::numeric(14,2) as realizado
  from public.resultados
  group by 1,2
)
select
  m.competencia,
  m.loja_id,
  m.valor_meta::numeric(14,2) as meta,
  coalesce(r.realizado,0)::numeric(14,2) as realizado,
  case when m.valor_meta>0 then coalesce(r.realizado,0)/m.valor_meta else 0 end as pct
from public.metas m
left join r on r.competencia=m.competencia and r.loja_id=m.loja_id;

grant select on public.v_desempenho_mensal to authenticated;

create or replace function public.resumo_ano(p_ano int)
returns table (
  competencia date,
  meta numeric,
  realizado numeric,
  pct numeric,
  bateu boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with meses as (
    select make_date(p_ano,m,1) as competencia
    from generate_series(1,12) m
  ), metas_agg as (
    select m.competencia, sum(m.valor_meta)::numeric as meta
    from public.metas m
    where extract(year from m.competencia)::int=p_ano
      and m.loja_id in (select private.lojas_do_usuario())
    group by m.competencia
  ), resultados_agg as (
    select date_trunc('month',r.data)::date as competencia,
           sum(r.valor_realizado)::numeric as realizado
    from public.resultados r
    where extract(year from r.data)::int=p_ano
      and r.loja_id in (select private.lojas_do_usuario())
    group by 1
  )
  select
    me.competencia,
    coalesce(ma.meta,0)::numeric as meta,
    coalesce(ra.realizado,0)::numeric as realizado,
    case when coalesce(ma.meta,0)>0 then coalesce(ra.realizado,0)/ma.meta else 0 end as pct,
    coalesce(ma.meta,0)>0 and coalesce(ra.realizado,0)>=ma.meta as bateu
  from meses me
  left join metas_agg ma using (competencia)
  left join resultados_agg ra using (competencia)
  order by me.competencia;
$$;

revoke all on function public.resumo_ano(int) from public, anon;
grant execute on function public.resumo_ano(int) to authenticated;

commit;
