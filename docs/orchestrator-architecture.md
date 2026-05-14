# Ralph Orchestrator

Ralph Orchestrator transforma o Kanban atual em uma plataforma 24/7 para delegar trabalho em varios repositorios.

## Objetivo

- Manter um dashboard web sempre ligado na VPS.
- Cadastrar repositorios/projetos.
- Criar tasks para um projeto.
- Colocar tasks em fila.
- Executar um worker separado do frontend.
- Preparar workspace isolado por task.
- Rodar agente escolhido com politica segura.
- Registrar status, logs, arquivos Ralph e resultado.

## Componentes

```text
Next.js Dashboard
  -> API local
  -> datastore local
  -> fila de tasks
  -> worker 24/7
  -> workspaces isolados
  -> providers de agente
```

## Fluxo

1. Usuario cria projeto no dashboard.
2. Usuario cria task vinculada ao projeto.
3. API pode decompor a task em story tasks quando `decompose` estiver ativo.
4. Cada story task e salva como `queued` e aparece como card individual no Kanban.
5. Worker pega proxima story task.
6. Worker cria run e workspace isolado.
7. Worker registra plano, progresso, trabalho atual, pensamento operacional, logs e status.
8. Quando execucao real estiver habilitada, worker chama provider configurado.
9. Dashboard mostra fila, runs, logs, diff e metadados Git.
10. Usuario revisa e aprova commit/push/PR.

## Story Tasks

Uma task Ralph de implementacao pode virar microprocessos rastreaveis:

```text
Task original
  -> Story 1/4 escopo
  -> Story 2/4 backend
  -> Story 3/4 frontend
  -> Story 4/4 validacao
```

Cada story task reutiliza a fila existente e possui metadados opcionais:

- `storyGroupId`
- `storyParentTitle`
- `storyIndex`
- `storyCount`
- `storyArea`
- `modelHint`
- `progressPercent`
- `currentWork`
- `aiThought`

`aiThought` guarda resumo operacional exibivel para usuario; nao deve conter raciocinio oculto bruto. Quando o prompt atribui uma area para um modelo, por exemplo `mimo v2.5 pro deve ser responsavel pelo frontend`, a story de frontend recebe provider `mimo` e `modelHint` `mimo v2.5 pro`.

## Workspaces

Cada run deve ficar isolada:

```text
data/workspaces/<project-id>/<task-id>/
```

Execucao real de comandos fica desativada por padrao. Para VPS, habilitar somente depois de configurar repos, usuario do sistema, permissao de escrita e backups.

## Providers

Providers implementados por configuracao:

- `codex`: execucao local via `CODEX_COMMAND`, usando login do Codex CLI.
- `opencode-go`: execucao local via `OPENCODE_GO_COMMAND`.
- `mimo`: chamada HTTP compativel com chat completions via `MIMO_API_URL` e `MIMO_MODEL`.
- `minimax`: chamada HTTP compativel com chat completions via `MINIMAX_API_URL` e `MINIMAX_MODEL`.
- `zai`: chamada HTTP compativel com chat completions via `ZAI_API_KEY`.
- `deepseek`: chamada HTTP compativel com chat completions via `DEEPSEEK_API_KEY`.
- `manual`: dry-run/registro sem execucao.

Chaves nunca entram em arquivo versionado. Usar apenas variaveis:

```text
MIMO_API_KEY
MINIMAX_API_KEY
OPENCODE_GO_API_KEY
CODEX_COMMAND
OPENCODE_GO_COMMAND
MIMO_API_URL
MIMO_MODEL
MINIMAX_API_URL
MINIMAX_MODEL
ZAI_API_KEY
ZAI_API_URL
ZAI_MODEL
DEEPSEEK_API_KEY
DEEPSEEK_API_URL
DEEPSEEK_MODEL
```

## Politica Segura Inicial

- Sem execucao real por padrao.
- Sem leitura/escrita de `.env`.
- Sem comandos destrutivos automaticos.
- Uma task por projeto por vez no MVP.
- Logs persistidos para auditoria.
- Workspace separado por task.

## Funcionalidades Atuais

- Git clone/fetch real.
- Branch por task.
- Commit, push e PR por aprovacao humana.
- Autenticacao admin opcional por token.
- Fila com lock por projeto.
- Logs em tempo real por SSE.
- Review humano antes de push/PR.
- Providers reais por CLI/HTTP configuravel.
