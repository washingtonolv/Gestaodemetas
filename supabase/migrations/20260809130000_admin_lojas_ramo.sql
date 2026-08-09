-- Campos usados pelo painel administrativo para classificar e localizar lojas.
alter table public.lojas
  add column if not exists ramo text not null default 'Franquias',
  add column if not exists localizacao text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.lojas'::regclass
       and conname = 'lojas_ramo_check'
  ) then
    alter table public.lojas
      add constraint lojas_ramo_check
      check (ramo in ('Franquias', 'Multimarcas'));
  end if;
end
$$;

comment on column public.lojas.ramo is 'Ramo comercial exibido no painel administrativo.';
comment on column public.lojas.localizacao is 'Cidade, bairro ou referência da loja.';
