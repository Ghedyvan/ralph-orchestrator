# Security Policy

## Ambiente

Rode worker com usuario Linux sem privilegio:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin ralph
```

Use volume dedicado para `data/`. Nao rode como `root` em VPS.

## Execucao Real

Default seguro:

```text
RALPH_RUNNER_ENABLED=0
RALPH_GIT_ENABLED=0
```

Habilite por etapa, depois de backup e repos allowlist.

Git write fica bloqueado por flags separadas:

```text
RALPH_GIT_WRITE_ENABLED=0
RALPH_GIT_PUSH_ENABLED=0
RALPH_GIT_PR_ENABLED=0
```

Use `RALPH_GIT_WRITE_ENABLED=1` somente depois de revisar diff. Use `RALPH_GIT_PUSH_ENABLED=1` somente em repos allowlist. Use `RALPH_GIT_PR_ENABLED=1` somente com `gh` autenticado por secret externo da VPS.

## Allowlist

Repos permitidos:

```text
RALPH_ALLOWED_REPOS=github.com/org/repo,git@github.com:org/repo.git
```

Comandos permitidos para fase futura:

```text
RALPH_ALLOWED_COMMANDS=yarn lint,yarn typecheck,yarn build,yarn test
```

Paths proibidos:

```text
RALPH_FORBIDDEN_PATHS=.env,.env.local,.ssh,id_rsa,id_ed25519
```

## Sandbox

Recomendado:

- container por task;
- usuario sem privilegio;
- sem mount de home inteira;
- rede limitada para providers necessarios;
- workspace descartavel;
- review humano antes de commit/push/PR;
- nenhum merge automatico.
