repo: washingtonolv/Gestaodemetas
branch: main

## Last sync
date: 2026-08-08T19:02:38Z
tree: 760925b735dc

### Updated in this project
- Upstream reorganizado: `dashboard.html`, `index.html` e `portal.html` viraram redirects; o app real agora é `app-v3.html` + `app-v3.js` (Supabase Auth + Postgres + RLS).
- Importados `app-v3.html`, `app-v3.js`, `login.html`, `supabase-client.js`, `MULTIUSUARIO.md`, `dashboard.html`.
- **Bug corrigido em `app-v3.js`**: em `saveSales()` o payload usava o shorthand `data` (variável inexistente — a data está em `date`), causando ReferenceError e impedindo qualquer lançamento de venda. Agora `data:date`. Suba este arquivo no repositório.
- `dashboard.html` local antigo (com o fix do `forEach`) foi substituído pelo redirect atual do upstream — aquele fix já não se aplica, o arquivo virou stub.
- Protótipo `Painel de Metas D&D.dc.html` mantido como referência de design — não sobrescrito.

## Sync history
- 2026-08-08T14:02Z — importado `dashboard.html` (v1) com correção de `)` faltando em `loadBase()`.
- 2026-08-07 — repositório ainda vazio, nada a importar.
- 2026-08-05 — associação registrada.

## Screen map
| Tela do projeto | Arquivos do repositório |
| --- | --- |
| app-v3.html (app real: 9 telas por perfil) | app-v3.html, app-v3.js, supabase-client.js |
| login.html | login.html |
| dashboard.html (redirect → app-v3) | dashboard.html |
| Painel de Metas D&D.dc.html (protótipo de referência) | Painel de Metas D&D.dc.html, support.js |
| design_handoff_metas_dd/README.md (especificação) | MULTIUSUARIO.md, design_handoff_metas_dd/ |
