begin;

create or replace function public.relatorio_mensal(p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_comp date := date_trunc('month',p_competencia)::date;
  v_f2 numeric := 1.120;
  v_f3 numeric := 1.300;
  v_dias int;
  v_decorridos int;
  v_lojas jsonb;
  v_vendedoras jsonb;
begin
  select c.fator_meta2,c.fator_meta3,c.dias_uteis
    into v_f2,v_f3,v_dias
  from public.competencias c where c.competencia=v_comp;
  v_f2:=coalesce(v_f2,1.120); v_f3:=coalesce(v_f3,1.300);
  if v_dias is null then
    select count(*)::int into v_dias
    from generate_series(v_comp,(v_comp+interval '1 month - 1 day')::date,interval '1 day') d
    where extract(dow from d)<>0;
  end if;

  if v_comp < date_trunc('month',current_date)::date then
    v_decorridos:=v_dias;
  elsif v_comp > date_trunc('month',current_date)::date then
    v_decorridos:=0;
  else
    select count(*)::int into v_decorridos
    from generate_series(v_comp,current_date,interval '1 day') d
    where extract(dow from d)<>0;
  end if;

  with base as (
    select l.id,l.codigo,l.nome,
           coalesce(m.valor_meta,0)::numeric as meta1,
           coalesce(sum(r.valor_realizado),0)::numeric as realizado
    from public.lojas l
    left join public.metas m on m.loja_id=l.id and m.competencia=v_comp
    left join public.resultados r on r.loja_id=l.id and r.data>=v_comp and r.data<(v_comp+interval '1 month')::date
    where l.ativa=true and l.id in (select private.lojas_do_usuario())
    group by l.id,l.codigo,l.nome,m.valor_meta
  ), calc as (
    select *,meta1*v_f2 as meta2,meta1*v_f3 as meta3,
           case when meta1>0 then realizado/meta1 else 0 end as pct,
           greatest(meta1-realizado,0) as falta,
           case when v_decorridos>0 then realizado/v_decorridos*v_dias else 0 end as projecao
    from base
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'loja_id',id,'codigo',codigo,'loja',nome,
    'meta1',meta1,'meta2',meta2,'meta3',meta3,
    'realizado',realizado,'pct',pct,'falta',falta,'projecao',projecao,
    'situacao',case when meta1=0 then 'Sem meta' when pct>=1 then 'No ritmo' when pct>=0.8 then 'Atenção' else 'Crítico' end
  ) order by nome),'[]'::jsonb) into v_lojas from calc;

  select coalesce(jsonb_agg(to_jsonb(rv) order by rv.pct desc,rv.realizado desc),'[]'::jsonb)
    into v_vendedoras
  from public.ranking_vendedoras(v_comp) rv;

  return jsonb_build_object(
    'competencia',v_comp,
    'dias_uteis',v_dias,
    'fator_meta2',v_f2,
    'fator_meta3',v_f3,
    'lojas',v_lojas,
    'vendedoras',v_vendedoras
  );
end;
$$;

revoke all on function public.relatorio_mensal(date) from public, anon;
grant execute on function public.relatorio_mensal(date) to authenticated;

commit;
