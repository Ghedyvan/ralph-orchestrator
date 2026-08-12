#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="${RALPH_REAL_GIT:-/usr/bin/git}"

if [[ $# -eq 0 ]]; then
  exec "$REAL_GIT"
fi

command_name="$1"
shift

log_block() {
  printf 'Ralph Git policy: %s\n' "$1" >&2
}

has_arg() {
  local expected="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$expected" ]] && return 0
  done
  return 1
}

case "$command_name" in
  checkout)
    # Checkout de arquivos com separador -- continua permitido.
    if has_arg "--" "$@"; then
      exec "$REAL_GIT" checkout "$@"
    fi
    log_block "troca ou criação de branch bloqueada; permanecendo em $("$REAL_GIT" branch --show-current 2>/dev/null || true)."
    exit 0
    ;;
  switch)
    log_block "git switch bloqueado; a execução deve permanecer na branch atual."
    exit 0
    ;;
  branch)
    if [[ $# -eq 0 ]] || has_arg "--show-current" "$@" || has_arg "--list" "$@" || has_arg "-l" "$@" || has_arg "-a" "$@" || has_arg "-r" "$@" || has_arg "-v" "$@" || has_arg "-vv" "$@" || has_arg "--contains" "$@" || has_arg "--merged" "$@" || has_arg "--no-merged" "$@"; then
      exec "$REAL_GIT" branch "$@"
    fi
    log_block "mutação ou criação de branch bloqueada."
    exit 2
    ;;
  worktree)
    if [[ "${1:-}" == "list" ]]; then
      exec "$REAL_GIT" worktree "$@"
    fi
    log_block "mutação de worktree bloqueada no modo Ralph."
    exit 2
    ;;
  reset)
    if has_arg "--hard" "$@"; then
      # O worker antigo usa reset --hard ao reutilizar um workspace. O comando vira
      # no-op para preservar o estado sem interromper a execução ou trocar de branch.
      log_block "git reset --hard ignorado para preservar a branch e as alterações atuais."
      exit 0
    fi
    exec "$REAL_GIT" reset "$@"
    ;;
  clean)
    if has_arg "-f" "$@" || has_arg "-fd" "$@" || has_arg "-df" "$@" || has_arg "-fx" "$@" || has_arg "-fdx" "$@"; then
      log_block "git clean destrutivo bloqueado."
      exit 2
    fi
    exec "$REAL_GIT" clean "$@"
    ;;
  merge|rebase)
    log_block "${command_name} automático bloqueado no modo Ralph."
    exit 2
    ;;
  push)
    if [[ "${RALPH_GIT_PUSH_ENABLED:-0}" != "1" || "${RALPH_EXPLICIT_PUSH:-0}" != "1" ]]; then
      log_block "push bloqueado. Exige RALPH_GIT_PUSH_ENABLED=1 e autorização explícita RALPH_EXPLICIT_PUSH=1."
      exit 2
    fi
    exec "$REAL_GIT" push "$@"
    ;;
  *)
    exec "$REAL_GIT" "$command_name" "$@"
    ;;
esac
