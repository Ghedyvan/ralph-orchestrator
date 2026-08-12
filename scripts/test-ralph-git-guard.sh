#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/ralph-git-guard.sh"
REAL_GIT="${RALPH_REAL_GIT:-/usr/bin/git}"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/bin" "$TMP_ROOT/repo"
ln -s "$GUARD" "$TMP_ROOT/bin/git"
export PATH="$TMP_ROOT/bin:$PATH"
export RALPH_REAL_GIT="$REAL_GIT"

cd "$TMP_ROOT/repo"
"$REAL_GIT" init -b main >/dev/null
"$REAL_GIT" -c user.name=Test -c user.email=test@example.invalid commit --allow-empty -m init >/dev/null

assert_branch_main() {
  [[ "$(git branch --show-current)" == "main" ]]
}

assert_blocked() {
  local expected_status="$1"
  shift
  set +e
  "$@" >/dev/null 2>&1
  local status=$?
  set -e
  [[ "$status" -eq "$expected_status" ]]
}

# Criação/troca de branch deve ser no-op, inclusive com opções globais.
git checkout -B ralph/test >/dev/null 2>&1
assert_branch_main
git -c advice.detachedHead=false checkout -b ralph/other >/dev/null 2>&1
assert_branch_main
git -C "$TMP_ROOT/repo" switch -c ralph/third >/dev/null 2>&1
assert_branch_main
assert_blocked 2 git branch ralph/fourth
assert_branch_main

# Push precisa ser bloqueado antes de alcançar o remoto, inclusive com -c.
assert_blocked 2 git push origin main
assert_blocked 2 git -c http.fake.example.extraheader=test push origin main

# Operações de leitura e commits locais continuam funcionando.
[[ "$(git -c color.ui=false branch --show-current)" == "main" ]]
printf 'conteudo\n' > arquivo.txt
git add arquivo.txt
git -c user.name=Test -c user.email=test@example.invalid commit -m local >/dev/null
[[ "$(git log -1 --format=%s)" == "local" ]]

# Reset destrutivo vira no-op e não apaga a alteração.
printf 'alterado\n' >> arquivo.txt
git -c advice.detachedHead=false reset --hard HEAD >/dev/null 2>&1
grep -q '^alterado$' arquivo.txt

printf 'Ralph Git guard: todos os testes passaram. Branch=%s\n' "$(git branch --show-current)"
