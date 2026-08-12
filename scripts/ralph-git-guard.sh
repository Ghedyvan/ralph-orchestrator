#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${RALPH_REAL_GIT:-}" ]]; then
  REAL_GIT="$RALPH_REAL_GIT"
elif [[ -x /usr/local/libexec/ralph-git-real ]]; then
  REAL_GIT="/usr/local/libexec/ralph-git-real"
else
  REAL_GIT="/usr/bin/git"
fi

if [[ ! -x "$REAL_GIT" ]]; then
  printf 'Ralph Git policy: binário Git real indisponível em %s.\n' "$REAL_GIT" >&2
  exit 127
fi

if [[ $# -eq 0 ]]; then
  exec "$REAL_GIT"
fi

original_args=("$@")
global_args=()

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

has_matching_arg() {
  local pattern="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == $pattern ]] && return 0
  done
  return 1
}

# Git aceita opções globais antes do subcomando, por exemplo:
#   git -C repo checkout -B nova-branch
# Elas precisam ser analisadas antes da política; caso contrário, o primeiro
# argumento seria "-C" e o subcomando proibido escaparia do guard.
while [[ $# -gt 0 ]]; do
  case "$1" in
    -C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)
      if [[ $# -lt 2 ]]; then
        log_block "opção global $1 sem valor."
        exit 2
      fi
      global_args+=("$1" "$2")
      shift 2
      ;;
    -C?*|-c?*|--git-dir=*|--work-tree=*|--namespace=*|--super-prefix=*|--config-env=*)
      global_args+=("$1")
      shift
      ;;
    --no-pager|--paginate|-p|--no-replace-objects|--bare|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks)
      global_args+=("$1")
      shift
      ;;
    --version|--exec-path|--html-path|--man-path|--info-path)
      exec "$REAL_GIT" "${original_args[@]}"
      ;;
    --)
      global_args+=("$1")
      shift
      break
      ;;
    -*)
      # Opção global desconhecida: preserva para o Git real, mas continua
      # procurando o primeiro token que representa o subcomando.
      global_args+=("$1")
      shift
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -eq 0 ]]; then
  exec "$REAL_GIT" "${original_args[@]}"
fi

command_name="$1"
shift
command_args=("$@")

run_real() {
  exec "$REAL_GIT" "${global_args[@]}" "$command_name" "${command_args[@]}"
}

current_branch() {
  "$REAL_GIT" "${global_args[@]}" branch --show-current 2>/dev/null || true
}

# Bloqueia aliases Git, inclusive aliases injetados por `git -c alias.x=... x`.
# Sem isso, um alias poderia esconder checkout, switch, update-ref ou push.
if [[ "$command_name" != "config" ]]; then
  alias_value="$("$REAL_GIT" "${global_args[@]}" config --get "alias.$command_name" 2>/dev/null || true)"
  if [[ -n "$alias_value" ]]; then
    log_block "alias Git '$command_name' bloqueado no modo Ralph."
    exit 2
  fi
fi

case "$command_name" in
  checkout)
    if has_matching_arg "-b" "${command_args[@]}" \
      || has_matching_arg "-B" "${command_args[@]}" \
      || has_matching_arg "--orphan" "${command_args[@]}" \
      || has_matching_arg "--detach" "${command_args[@]}" \
      || has_matching_arg "--track" "${command_args[@]}" \
      || has_matching_arg "--no-track" "${command_args[@]}"; then
      log_block "criação, troca ou detached HEAD por git checkout ignorado; permanecendo em $(current_branch)."
      exit 0
    fi
    # Checkout de arquivos com separador -- continua permitido, pois não troca HEAD.
    if has_arg "--" "${command_args[@]}"; then
      run_real
    fi
    log_block "troca de branch ignorada; permanecendo em $(current_branch)."
    exit 0
    ;;
  switch)
    log_block "git switch ignorado; a execução permanece na branch atual."
    exit 0
    ;;
  branch)
    if [[ ${#command_args[@]} -eq 0 ]]; then
      run_real
    fi

    if has_matching_arg "-d" "${command_args[@]}" \
      || has_matching_arg "-D" "${command_args[@]}" \
      || has_matching_arg "-m" "${command_args[@]}" \
      || has_matching_arg "-M" "${command_args[@]}" \
      || has_matching_arg "-c" "${command_args[@]}" \
      || has_matching_arg "-C" "${command_args[@]}" \
      || has_matching_arg "-f" "${command_args[@]}" \
      || has_matching_arg "--delete" "${command_args[@]}" \
      || has_matching_arg "--move" "${command_args[@]}" \
      || has_matching_arg "--copy" "${command_args[@]}" \
      || has_matching_arg "--edit-description" "${command_args[@]}" \
      || has_matching_arg "--set-upstream-to" "${command_args[@]}" \
      || has_matching_arg "--unset-upstream" "${command_args[@]}" \
      || has_matching_arg "--track" "${command_args[@]}" \
      || has_matching_arg "--no-track" "${command_args[@]}"; then
      log_block "mutação, criação ou remoção de branch bloqueada."
      exit 2
    fi

    if has_arg "--show-current" "${command_args[@]}" \
      || has_arg "--list" "${command_args[@]}" \
      || has_arg "-l" "${command_args[@]}" \
      || has_arg "-a" "${command_args[@]}" \
      || has_arg "-r" "${command_args[@]}" \
      || has_arg "-v" "${command_args[@]}" \
      || has_arg "-vv" "${command_args[@]}" \
      || has_matching_arg "--contains*" "${command_args[@]}" \
      || has_matching_arg "--merged*" "${command_args[@]}" \
      || has_matching_arg "--no-merged*" "${command_args[@]}" \
      || has_matching_arg "--points-at*" "${command_args[@]}" \
      || has_matching_arg "--format*" "${command_args[@]}" \
      || has_matching_arg "--sort*" "${command_args[@]}"; then
      run_real
    fi

    log_block "criação de branch bloqueada."
    exit 2
    ;;
  worktree)
    if [[ "${command_args[0]:-}" == "list" ]]; then
      run_real
    fi
    log_block "mutação de worktree bloqueada no modo Ralph."
    exit 2
    ;;
  reset)
    if has_arg "--hard" "${command_args[@]}"; then
      log_block "git reset --hard ignorado para preservar a branch e as alterações atuais."
      exit 0
    fi
    run_real
    ;;
  clean)
    if has_arg "--force" "${command_args[@]}" || has_matching_arg "-*f*" "${command_args[@]}"; then
      log_block "git clean destrutivo bloqueado."
      exit 2
    fi
    run_real
    ;;
  merge|rebase|pull|bisect|update-ref|symbolic-ref|fast-import)
    log_block "$command_name bloqueado para preservar a branch e o histórico atuais."
    exit 2
    ;;
  push|send-pack|http-push)
    if [[ "${RALPH_GIT_PUSH_ENABLED:-0}" != "1" || "${RALPH_EXPLICIT_PUSH:-0}" != "1" ]]; then
      log_block "publicação bloqueada. Exige RALPH_GIT_PUSH_ENABLED=1 e autorização explícita RALPH_EXPLICIT_PUSH=1."
      exit 2
    fi
    run_real
    ;;
  config)
    # Leitura de configuração é permitida. Mutação de aliases é bloqueada para
    # impedir que comandos proibidos sejam escondidos atrás de um nome customizado.
    if has_arg "--get" "${command_args[@]}" \
      || has_arg "--get-all" "${command_args[@]}" \
      || has_arg "--get-regexp" "${command_args[@]}" \
      || has_arg "--list" "${command_args[@]}" \
      || has_arg "-l" "${command_args[@]}"; then
      run_real
    fi
    if has_matching_arg "alias.*" "${command_args[@]}"; then
      log_block "mutação de alias Git bloqueada no modo Ralph."
      exit 2
    fi
    run_real
    ;;
  *)
    run_real
    ;;
esac
