# Ralph Orchestrator

Dashboard Next.js para manter uma fila 24/7 de tasks de desenvolvimento em varios repositorios.

O projeto nasceu como visualizador de `prd.json`, mas agora tem uma base de orquestramento:

- cadastro de projetos/repositorios;
- criacao de tasks;
- fila persistida;
- worker separado;
- workspaces por task;
- Git workspace com clone/branch/diff/commit/push/PR por aprovacao;
- providers planejados para Codex, opencode go, Mimo e Minimax;
- execucao real bloqueada por padrao.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS v4
- HeroUI v3
- HeroUI Pro v3
- Yarn
- Supabase ou datastore JSON local fallback

## Rodar Local

```bash
yarn install
yarn dev
```

Abra `http://localhost:3000` ou porta indicada pelo Next.js.

Em outro terminal:

```bash
yarn worker
```

Para teste unico:

```bash
yarn worker:once
```

Healthcheck:

```bash
curl http://localhost:3000/api/health
```

## Fluxo 24/7

1. Cadastre projeto no dashboard.
2. Crie task com prompt.
3. Task entra como `queued`.
4. Worker pega task.
5. Worker cria `data/workspaces/<project-id>/<task-id>/`.
6. Worker grava `TASK.md` e `RUN.json`.
7. Em modo seguro inicial, task manual vira dry-run concluido.
8. Review humano ve diff/arquivos no dashboard.
9. Usuario aprovado pode acionar Git status, Commit, Push e PR.
10. Providers reais ficam bloqueados ate configuracao explicita.

## Dados Locais

Estado fica em:

```text
data/orchestrator-state.json
```

Workspaces ficam em:

```text
data/workspaces/
```

Ambos sao ignorados pelo Git.

## Providers

Providers existem no modelo:

- `manual`
- `codex`
- `opencode-go`
- `mimo`
- `minimax`

Variaveis esperadas, sem valores no repositorio:

```text
CODEX_API_KEY
OPENCODE_GO_API_KEY
MIMO_API_KEY
MINIMAX_API_KEY
RALPH_RUNNER_ENABLED
RALPH_GIT_ENABLED
RALPH_GIT_WRITE_ENABLED
RALPH_GIT_PUSH_ENABLED
RALPH_GIT_PR_ENABLED
RALPH_WORKER_INTERVAL_MS
```

Execucao real so deve ser habilitada em VPS preparada:

```bash
RALPH_RUNNER_ENABLED=1 yarn worker
```

Chamadas reais ficam bloqueadas salvo:

```text
RALPH_PROVIDER_CALLS_ENABLED=1
```

Providers CLI:

```text
CODEX_COMMAND=codex exec --full-auto --prompt-file {prompt}
OPENCODE_GO_COMMAND=opencode-go run --prompt {prompt}
```

`{prompt}` vira arquivo `PROVIDER_PROMPT.md`. `{workspace}` vira caminho do workspace.

Providers HTTP compativeis com chat completions:

```text
MIMO_API_URL=https://provider.example/v1/chat/completions
MIMO_MODEL=model-name
MINIMAX_API_URL=https://provider.example/v1/chat/completions
MINIMAX_MODEL=model-name
```

Chaves ficam somente em env vars.

## Git Write e PR

Default seguro:

```text
RALPH_GIT_ENABLED=0
RALPH_GIT_WRITE_ENABLED=0
RALPH_GIT_PUSH_ENABLED=0
RALPH_GIT_PR_ENABLED=0
```

Fluxo recomendado em VPS preparada:

1. Configure `RALPH_ALLOWED_REPOS`.
2. Habilite `RALPH_GIT_ENABLED=1` para clone/branch/diff.
3. Revise arquivos e diff no dashboard.
4. Habilite `RALPH_GIT_WRITE_ENABLED=1` para Commit.
5. Habilite `RALPH_GIT_PUSH_ENABLED=1` para Push.
6. Habilite `RALPH_GIT_PR_ENABLED=1` para PR via `gh`.

O container instala `git` e `gh`. Para PR, autentique `gh` no ambiente da VPS usando secret externo, nunca em arquivo versionado.

## VPS

Modo Docker Compose:

```bash
docker compose up -d --build
```

Services:

- `web`: Next.js em `3000`;
- `worker`: fila 24/7;
- `ralph-data`: volume local para fallback JSON/workspaces.

Modo simples com dois processos:

```bash
yarn install
yarn build
yarn start
```

Terminal/processo separado:

```bash
yarn worker
```

Recomendado em producao:

- rodar atras de Nginx/Caddy com HTTPS;
- definir `RALPH_ADMIN_TOKEN` antes de expor publicamente;
- usar usuario Linux sem privilegios;
- montar volume persistente para `data/`;
- fazer backup de `data/orchestrator-state.json`;
- manter `RALPH_RUNNER_ENABLED` desligado ate revisar seguranca;
- usar PR/review humano antes de merge automatico;
- configurar `RALPH_ALLOWED_REPOS`, `RALPH_ALLOWED_COMMANDS` e `RALPH_FORBIDDEN_PATHS`.

Politica detalhada:

```text
docs/security.md
```

## Supabase

Execute schema:

```text
supabase/schema.sql
```

Configure na VPS, sem commitar valores:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RALPH_ADMIN_TOKEN
```

Mais detalhes:

```text
docs/supabase.md
```

## Publicar no GitHub

Helper seguro cria/push em repo GitHub usando token de ambiente:

```bash
GITHUB_TOKEN=... GITHUB_OWNER=seu-usuario GITHUB_REPO=ralph-orchestrator yarn publish:github
```

Repo privado:

```bash
GITHUB_PRIVATE=1 GITHUB_TOKEN=... GITHUB_OWNER=seu-usuario yarn publish:github
```

Token nao deve ser salvo em arquivo versionado. Use secret da VPS, shell temporario ou gerenciador de secrets.

## Validações

```bash
yarn lint
yarn typecheck
yarn build
yarn worker:once
```

## Arquitetura

Leia:

```text
docs/orchestrator-architecture.md
```
