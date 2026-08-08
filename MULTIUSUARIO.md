# Gestão de Metas — Multiusuário

## Arquitetura

- GitHub Pages: frontend e versionamento.
- Supabase Auth: login por e-mail e senha.
- Supabase Postgres: lojas, metas, resultados e vínculos.
- Row Level Security (RLS): autorização no banco, não apenas na interface.

## Perfis

### Administrador
- acesso total;
- cadastra usuários;
- cadastra lojas;
- vincula Gerente Comercial a Supervisores;
- vincula Supervisores a Lojas;
- gerencia metas e visualiza resultados.

### Gerente Comercial
- consulta as lojas pertencentes aos Supervisores vinculados ao seu usuário;
- visualiza metas e resultados consolidados;
- não altera metas por padrão.

### Supervisor
- visualiza somente as lojas vinculadas ao seu usuário;
- cadastra e altera metas apenas dessas lojas;
- acompanha os respectivos resultados.

## Arquivos do frontend

- `login.html`: autenticação.
- `portal.html`: portal por perfil.
- `supabase-client.js`: cliente Supabase usando somente a chave publishable.

## Primeiro administrador

Novos usuários gerados por signup entram como `pendente` e `ativo=false`. O primeiro Administrador deve ser promovido uma única vez no banco. Depois disso, o cadastro de usuários é feito pelo portal do Administrador através da Edge Function `admin-create-user`.

## Segurança

Nunca coloque `service_role` no GitHub ou no browser. A função `admin-create-user` roda no Supabase, valida o JWT do usuário e confirma no banco que ele possui o perfil `administrador` antes de criar outra conta.
