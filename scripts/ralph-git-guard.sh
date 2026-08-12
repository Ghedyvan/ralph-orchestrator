#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="${RALPH_REAL_GIT:-/usr/bin/git}"
ORIGINAL_ARGS=("$@")

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

branch_is_read_only() {
  local args=("$@")
  local index=0
  local has_list=0
  local arg

  [[ ${#args[@]} -eq 0 ]] && return 0

  while (( index < ${#args[@]} )); do
    arg="${args[$index]}"
    case "$arg" in
      --show-current|-a|--all|-r|--remotes|-v|-vv|--verbose|--no-color|--no-column|--ignore-case|-i)
        ;;
      --list|-l)
        has_list=1
        ;;
      --sort|--format|--points-at|--contains|--no-contains|--merged|--no-merged|--color|--column)
        ((index += 1))
        (( index < ${#args[@]} )) || return 1
        ;;
      --sort=*|--format=*|--points-at=*|--contains=*|--no-contains=*|--merged=*|--no-merged=*|--color=*|--column=*)
        ;;
      --)
        has_list=1
        ;;
      -*)
        return 1
        ;;
      *)
        (( has_list == 1 )) || return 1
        ;;
    esac
    ((index += 1))
  done

  return 0
}

if [[ $# -eq 0 ]]; then
  exec "$REAL_GIT"
fi

# Git aceita opções globais antes do subcomando. Precisamos preservá-las para a
# execução real, mas identificar corretamente checkout/switch/branch/push mesmo
# em chamadas como `git -c chave=valor push` ou `git -C repo checkout -B nova`.
command_name=""
command_args=()
index=0
while (( index < ${#ORIGINAL_ARGS[@]} )); do
  arg="${ORIGINAL_ARGS[$index]}"
  case "$arg" in
    -c|-C|--git-dir|--work-tree|--namespace|--config-env|--exec-path|--super-prefix)
      ((index += 2))
      ;;
    --git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--exec-path=*|--super-prefix=*)
      ((index += 1))
      ;;
    --no-pager|--paginate|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs)
      ((index += 1))
      ;;
    --version|--help)
      exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
      ;;
    -*)
      ((index += 1))
      ;;
    *)
      command_name="$arg"
      command_args=("${ORIGINAL_ARGS[@]:$((index + 1))}")
      break
      ;;
  esac
done

if [[ -z "$command_name" ]]; then
  exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
fi

case "$command_name" in
  checkout)
    log_block "git checkout bloqueado; mantendo a branch atual e as alterações existentes."
    exit 0
    ;;
  switch)
    log_block "git switch bloqueado; a execução deve permanecer na branch atual."
    exit 0
    ;;
  branch)
    if branch_is_read_only "${command_args[@]}"; then
      exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
    fi
    log_block "mutação ou criação de branch bloqueada."
    exit 2
    ;;
  worktree)
    if [[ "${command_args[0]:-}" == "list" ]]; then
      exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
    fi
    log_block "mutação de worktree bloqueada no modo Ralph."
    exit 2
    ;;
  reset)
    if has_arg "--hard" "${command_args[@]}" || has_arg "--merge" "${command_args[@]}" || has_arg "--keep" "${command_args[@]}"; then
      # O worker legado pode tentar resetar um workspace em uma repetição. A
      # operação vira no-op para preservar a branch e as alterações atuais.
      log_block "reset destrutivo ignorado para preservar a branch e as alterações atuais."
      exit 0
    fi
    exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
    ;;
  clean)
    log_block "git clean bloqueado para preservar arquivos existentes."
    exit 2
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
    exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
    ;;
  *)
    exec "$REAL_GIT" "${ORIGINAL_ARGS[@]}"
    ;;
esac
