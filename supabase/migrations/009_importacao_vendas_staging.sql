begin;

create table if not exists public.importacao_staging (
  id bigserial primary key,
  competencia date not null,
  origem text not null,
  payload jsonb not null,
  criado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text,
  check (date_trunc('month', competencia)::date = competencia)
);

alter table public.importacao_staging enable row level security;
revoke all on public.importacao_staging from anon;
grant select,insert on public.importacao_staging to authenticated;
grant usage,select on sequence public.importacao_staging_id_seq to authenticated;

drop policy if exists importacao_select on public.importacao_staging;
create policy importacao_select on public.importacao_staging for select to authenticated
using (criado_por=auth.uid() or private.current_role()='administrador');

drop policy if exists importacao_insert on public.importacao_staging;
create policy importacao_insert on public.importacao_staging for insert to authenticated
with check (criado_por=auth.uid() and private.current_role() in ('administrador','supervisor'));

create or replace function public.processar_importacao(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  st public.importacao_staging;
  item jsonb;
  v_codigo text;
  v_data date;
  v_valor numeric(14,2);
  v_loja uuid;
  v_ok int := 0;
  v_linha int := 0;
  v_rejeitados jsonb := '[]'::jsonb;
  v_texto text;
begin
  if auth.uid() is null or private.current_role() not in ('administrador','supervisor') then
    raise exception 'Usuário sem permissão para importar vendas' using errcode='42501';
  end if;

  select * into st from public.importacao_staging
   where id=p_id and (criado_por=auth.uid() or private.current_role()='administrador');
  if st.id is null then raise exception 'Importação não encontrada' using errcode='22023'; end if;
  if st.processado_em is not null then raise exception 'Importação já processada' using errcode='22023'; end if;
  if jsonb_typeof(st.payload) <> 'array' then raise exception 'Payload deve ser uma lista de linhas' using errcode='22023'; end if;
  if not private.competencia_aberta(st.competencia) then raise exception 'Competência fechada' using errcode='42501'; end if;

  for item in select value from jsonb_array_elements(st.payload)
  loop
    v_linha := v_linha + 1;
    begin
      v_codigo := trim(coalesce(item->>'codigo',item->>'codigo_loja',''));
      if v_codigo='' then raise exception 'Código da loja ausente'; end if;
      v_data := (item->>'data')::date;
      if date_trunc('month',v_data)::date <> st.competencia then raise exception 'Data fora da competência'; end if;

      v_texto := trim(coalesce(item->>'valor',''));
      if jsonb_typeof(item->'valor')='number' then
        v_valor := (item->>'valor')::numeric;
      elsif position(',' in v_texto)>0 then
        v_valor := replace(replace(v_texto,'.',''),',','.')::numeric;
      else
        v_valor := v_texto::numeric;
      end if;
      if v_valor < 0 then raise exception 'Valor negativo'; end if;

      select l.id into v_loja
      from public.lojas l
      where l.codigo=v_codigo and l.ativa=true
        and l.id in (select private.lojas_do_usuario())
      limit 1;
      if v_loja is null then raise exception 'Loja não encontrada ou fora do seu escopo'; end if;

      insert into public.resultados(loja_id,data,valor_realizado,criado_por)
      values(v_loja,v_data,v_valor,auth.uid())
      on conflict (loja_id,data) do update
        set valor_realizado=excluded.valor_realizado,
            criado_por=excluded.criado_por;
      v_ok := v_ok + 1;
    exception when others then
      v_rejeitados := v_rejeitados || jsonb_build_array(jsonb_build_object('linha',v_linha,'codigo',v_codigo,'erro',sqlerrm));
    end;
  end loop;

  update public.importacao_staging
     set processado_em=now(),
         erro=case when jsonb_array_length(v_rejeitados)>0 then v_rejeitados::text else null end
   where id=p_id;

  return jsonb_build_object('processadas',v_ok,'rejeitadas',jsonb_array_length(v_rejeitados),'erros',v_rejeitados);
end;
$$;

revoke all on function public.processar_importacao(bigint) from public, anon;
grant execute on function public.processar_importacao(bigint) to authenticated;

commit;
