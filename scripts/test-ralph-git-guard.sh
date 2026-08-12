#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/ralph-git-guard.sh"
WRAPPER="$SCRIPT_DIR/codex-ralph-wrapper.mjs"
INSTALLER="$SCRIPT_DIR/install-ralph-skill.sh"
REAL_GIT="${RALPH_REAL_GIT:-/usr/bin/git}"
NODE_BIN="${NODE_BIN:-node}"
SOURCE_DIR="${RALPH_SMOKE_SKILL_SOURCE:-/opt/ralph-skills}"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

BIN_DIR="$TMP_ROOT/bin"
GUARD_REPO="$TMP_ROOT/guard-repo"
WRAPPER_REPO="$TMP_ROOT/wrapper-repo"
HOME_DIR="$TMP_ROOT/home"
mkdir -p "$BIN_DIR" "$GUARD_REPO" "$WRAPPER_REPO" "$HOME_DIR"
ln -s "$GUARD" "$BIN_DIR/git"

assert_status() {
  local expected="$1"
  shift
  set +e
  "$@" >/dev/null 2>&1
  local status=$?
  set -e
  [[ "$status" -eq "$expected" ]]
}

# 1. O guard deve bloquear mutações de branch, reset destrutivo e push,
# inclusive quando o Git recebe opções globais antes do subcomando.
cd "$GUARD_REPO"
"$REAL_GIT" init -q -b main
"$REAL_GIT" -c user.name=Smoke -c user.email=smoke@example.invalid commit --allow-empty -q -m initial
PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git checkout -B ralph/test >/dev/null 2>&1
[[ "$("$REAL_GIT" branch --show-current)" == "main" ]]
PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git -c advice.detachedHead=false checkout -b ralph/other >/dev/null 2>&1
[[ "$("$REAL_GIT" branch --show-current)" == "main" ]]
PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git -C "$GUARD_REPO" switch -c ralph/third >/dev/null 2>&1
[[ "$("$REAL_GIT" branch --show-current)" == "main" ]]
assert_status 2 env PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git branch ralph/fourth
assert_status 2 env PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git push origin main
assert_status 2 env PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git -c http.fake.example.extraheader=test push origin main
printf 'conteudo\n' > guard.txt
"$REAL_GIT" add guard.txt
"$REAL_GIT" -c user.name=Smoke -c user.email=smoke@example.invalid commit -q -m local
printf 'preservado\n' >> guard.txt
PATH="$BIN_DIR:$PATH" RALPH_REAL_GIT="$REAL_GIT" git -c advice.detachedHead=false reset --hard HEAD >/dev/null 2>&1
grep -q '^preservado$' guard.txt

# 2. O wrapper deve capturar a branch atual, bloquear comandos do agente e
# criar o commit local nessa mesma branch, sem push.
cat > "$BIN_DIR/mock-codex" <<'MOCK'
#!/usr/bin/env bash
set -u
cat >/dev/null

git checkout -b should-not-exist >/dev/null 2>"${RALPH_SMOKE_TMP}/checkout.err"
checkout_code=$?
git push origin HEAD >/dev/null 2>"${RALPH_SMOKE_TMP}/push.err"
push_code=$?
printf 'checkout_code=%s\npush_code=%s\n' "$checkout_code" "$push_code" >"${RALPH_SMOKE_TMP}/codes.txt"
printf 'wrapper validated\n' > feature.txt
exit 0
MOCK
chmod +x "$BIN_DIR/mock-codex"

cd "$WRAPPER_REPO"
"$REAL_GIT" init -q
"$REAL_GIT" checkout -q -b feature/current
printf 'base\n' > README.md
"$REAL_GIT" add README.md
"$REAL_GIT" -c user.name=Smoke -c user.email=smoke@example.invalid commit -q -m initial
initial_head="$("$REAL_GIT" rev-parse HEAD)"

printf 'Implemente a alteração do smoke test e valide.\n' | \
  PATH="$BIN_DIR:$PATH" \
  RALPH_REAL_GIT="$REAL_GIT" \
  RALPH_CODEX_BIN="$BIN_DIR/mock-codex" \
  RALPH_GIT_PUSH_ENABLED=0 \
  RALPH_EXPLICIT_PUSH=0 \
  RALPH_SMOKE_TMP="$TMP_ROOT" \
  "$NODE_BIN" "$WRAPPER" exec - \
  >"$TMP_ROOT/wrapper.out" 2>"$TMP_ROOT/wrapper.err"

final_branch="$("$REAL_GIT" branch --show-current)"
final_head="$("$REAL_GIT" rev-parse HEAD)"
[[ "$final_branch" == "feature/current" ]]
[[ "$final_head" != "$initial_head" ]]
[[ -z "$("$REAL_GIT" status --short)" ]]
! "$REAL_GIT" show-ref --verify --quiet refs/heads/should-not-exist
grep -q '^checkout_code=0$' "$TMP_ROOT/codes.txt"
grep -q '^push_code=2$' "$TMP_ROOT/codes.txt"
grep -q 'Push não realizado\.' "$TMP_ROOT/wrapper.err"

# 3. As duas skills e a política global do Codex devem ser instaladas de modo
# idempotente a cada inicialização do container.
[[ -f "$SOURCE_DIR/ralph-loop/SKILL.md" ]]
[[ -f "$SOURCE_DIR/ralph-codex/SKILL.md" ]]
HOME="$HOME_DIR" RALPH_SKILL_SOURCE_DIR="$SOURCE_DIR" "$INSTALLER" >/dev/null
HOME="$HOME_DIR" RALPH_SKILL_SOURCE_DIR="$SOURCE_DIR" "$INSTALLER" >/dev/null
[[ -f "$HOME_DIR/.agents/skills/ralph-loop/SKILL.md" ]]
[[ -f "$HOME_DIR/.agents/skills/ralph-codex/SKILL.md" ]]
[[ "$(grep -c '<!-- RALPH_GIT_POLICY_START -->' "$HOME_DIR/.codex/AGENTS.md")" -eq 1 ]]
[[ "$(grep -c '<!-- RALPH_GIT_POLICY_END -->' "$HOME_DIR/.codex/AGENTS.md")" -eq 1 ]]

printf 'Ralph Git policy smoke test passed: branch=%s commit=%s push=blocked skills=installed\n' "$final_branch" "$final_head"
