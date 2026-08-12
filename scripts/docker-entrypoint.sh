#!/usr/bin/env bash
set -euo pipefail

export RALPH_ACTIVE="${RALPH_ACTIVE:-1}"
export RALPH_SKILL_SOURCE_DIR="${RALPH_SKILL_SOURCE_DIR:-/opt/ralph-skills}"
export RALPH_GIT_ENABLED="${RALPH_GIT_ENABLED:-1}"
export RALPH_GIT_AUTO_COMMIT_ENABLED="${RALPH_GIT_AUTO_COMMIT_ENABLED:-1}"

APP_ROOT="${RALPH_APP_ROOT:-/app}"
"$APP_ROOT/scripts/install-ralph-skill.sh"

case "${CODEX_COMMAND:-}" in
  "")
    export CODEX_COMMAND="codex-ralph exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -"
    ;;
  codex\ *)
    export CODEX_COMMAND="codex-ralph ${CODEX_COMMAND#codex }"
    ;;
  /usr/local/bin/codex\ *)
    export CODEX_COMMAND="codex-ralph ${CODEX_COMMAND#/usr/local/bin/codex }"
    ;;
esac

# Push permanece bloqueado até duas autorizações explícitas serem fornecidas.
export RALPH_GIT_PUSH_ENABLED="${RALPH_GIT_PUSH_ENABLED:-0}"
export RALPH_EXPLICIT_PUSH="${RALPH_EXPLICIT_PUSH:-0}"

exec "$@"
