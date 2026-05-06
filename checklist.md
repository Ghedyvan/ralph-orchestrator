# Checklist Ralph Orchestrator

## Prioridade 1

- [x] Auth obrigatoria: login, sessao, usuario admin.
- [x] Deploy simples: Docker Compose com `web`, `worker`, `supabase` externo e volume `data`.
- [x] Banco Supabase: schema SQL inicial e adapter server-side com fallback JSON.
- [x] Logs em tempo real: stream/SSE por run.
- [x] Worker robusto: lock por projeto, retry, timeout, cancelamento.
- [x] Tela de detalhes de task/run: logs, workspace, branch, commits, erros.

## Prioridade 2

- [x] Git real: cadastrar repo, clone/fetch, branch por task, workspace isolado, commit, PR.
- [x] Seguranca: allowlist de repos, allowlist de comandos, bloquear `.env`, secrets, chaves.
- [x] Worker com usuario Linux sem privilegio e sandbox por task quando possivel.
- [x] Aprovacao humana: task termina em review; usuario aprova push/PR; sem merge automatico.

## Prioridade 3

- [x] Provider `codex` principal.
- [x] Provider `opencode-go` local.
- [x] Providers `mimo` e `minimax` para tasks simples.
- [x] Roteador de modelo por complexidade/custo.
- [x] Config por projeto: modelo padrao, branch, validacoes, autonomia, paths proibidos.

## Prioridade 4

- [x] UX: botao Nova task sempre visivel.
- [x] Templates de task: bug, feature, refactor, docs.
- [x] Status: queued, running, blocked, review, done.
- [x] Diff/arquivos alterados no dashboard.
- [x] Botao rodar validacao de novo.
- [x] Botao continuar task apos falha.

## Validacao Continua

- [x] `yarn lint`
- [x] `yarn typecheck`
- [x] `yarn build`
- [x] `yarn worker:once`
