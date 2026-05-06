# Supabase Setup

1. Crie projeto Supabase.
2. Abra SQL editor.
3. Execute `supabase/schema.sql`.
4. Configure variaveis na VPS:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RALPH_ADMIN_TOKEN
```

`SUPABASE_SERVICE_ROLE_KEY` deve ficar somente no servidor. Nunca expor no browser.

## Tabelas

- `ralph_projects`
- `ralph_tasks`
- `ralph_runs`
- `ralph_logs`

## RLS

Schema habilita RLS. MVP usa service role server-side. Antes de cliente Supabase direto no browser, criar policies por usuario.
