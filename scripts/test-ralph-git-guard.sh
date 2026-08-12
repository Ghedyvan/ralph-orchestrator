#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD="$SCRIPT_DIR/ralph-git-guard.sh"
WRAPPER="$SCRIPT_DIR/codex-ralph-wrapper.mjs"
INSTALLER="$SCRIPT_DIR/install-ralph-skill.sh"
REAL_GIT="${RALPH_REAL_GIT:-}"
if [[ -z "$REAL_GIT" ]]; then
  if [[ -x /usr/local/libexec/ralph-git-real ]]; then
    REAL_GIT=/usr/local/libexec/ralph-git-real
  else
    REAL_GIT=/usr/bin/git
  fi
fi
NODE_BIN="${NODE_BIN:-node}"
if [[ -n "${RALPH_SMOKE_SKILL_SOURCE:-}" ]]; then
  SOURCE_DIR="$RALPH_SMOKE_SKILL_SOURCE"
elif [[ -d /opt/ralph-skills ]]; then
  SOURCE_DIR=/opt/ralph-skills
else
  SOURCE_DIR="$REPO_ROOT/.agents/skills"
fi

bash -n "$GUARD" "$INSTALLER"
"$NODE_BIN" --check "$WRAPPER"
[[ -x "$REAL_GIT" ]]

# Dentro da imagem, o Git real fica fora do PATH e os caminhos usuais apontam
# para o guard. Isso evita que o agente ignore a política chamando /usr/bin/git.
if [[ "$REAL_GIT" == /usr/local/libexec/ralph-git-real ]]; then
  [[ "$(readlink -f /usr/bin/git)" == "$(readlink -f "$GUARD")" ]]
  [[ "$(readlink -f /usr/local/bin/git)" == "$(readlink -f "$GUARD")" ]]
fi

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/repo" "$TEST_ROOT/bin" "$TEST_ROOT/home"
ln -s "$GUARD" "$TEST_ROOT/bin/git"

"$REAL_GIT" -C "$TEST_ROOT/repo" init -b main -q
printf 'base\n' > "$TEST_ROOT/repo/base.txt"
"$REAL_GIT" -C "$TEST_ROOT/repo" add base.txt
"$REAL_GIT" -C "$TEST_ROOT/repo" -c user.name=Test -c user.email=test@example.invalid commit -qm initial

run_guard() {
  PATH="$TEST_ROOT/bin:$PATH" RALPH_REAL_GIT="$REAL_GIT" "$GUARD" "$@"
}

# Opções globais antes do subcomando não podem contornar a política. Checkout e
# switch viram no-op com sucesso para manter compatibilidade com o worker legado.
run_guard -C "$TEST_ROOT/repo" checkout -B ralph/forbidden >/dev/null 2>"$TEST_ROOT/checkout.err"
run_guard -C "$TEST_ROOT/repo" switch -c ralph/switch-bypass >/dev/null 2>"$TEST_ROOT/switch.err"
[[ "$("$REAL_GIT" -C "$TEST_ROOT/repo" branch --show-current)" == main ]]
! "$REAL_GIT" -C "$TEST_ROOT/repo" show-ref --verify --quiet refs/heads/ralph/forbidden
! "$REAL_GIT" -C "$TEST_ROOT/repo" show-ref --verify --quiet refs/heads/ralph/switch-bypass

# Alias injetado por -c não pode esconder checkout, update-ref ou push.
set +e
run_guard -C "$TEST_ROOT/repo" -c alias.evil='checkout -B ralph/alias-bypass' evil >/dev/null 2>"$TEST_ROOT/alias.err"
alias_status=$?
set -e
[[ "$alias_status" -eq 2 ]]
! "$REAL_GIT" -C "$TEST_ROOT/repo" show-ref --verify --quiet refs/heads/ralph/alias-bypass

# Mutações diretas de refs e variantes de publicação também ficam bloqueadas.
for forbidden_command in \
  "branch ralph/direct" \
  "update-ref refs/heads/ralph/ref-bypass HEAD" \
  "symbolic-ref HEAD refs/heads/ralph/symbolic-bypass" \
  "send-pack origin HEAD" \
  "http-push origin HEAD"; do
  read -r -a args <<< "$forbidden_command"
  set +e
  run_guard -C "$TEST_ROOT/repo" "${args[@]}" >/dev/null 2>"$TEST_ROOT/forbidden.err"
  status=$?
  set -e
  [[ "$status" -eq 2 ]]
done
[[ "$("$REAL_GIT" -C "$TEST_ROOT/repo" branch --show-current)" == main ]]

printf 'preserve\n' >> "$TEST_ROOT/repo/base.txt"
run_guard -C "$TEST_ROOT/repo" reset --hard HEAD >/dev/null 2>"$TEST_ROOT/reset.err"
! "$REAL_GIT" -C "$TEST_ROOT/repo" diff --quiet -- base.txt
"$REAL_GIT" -C "$TEST_ROOT/repo" checkout -- base.txt

for publish_command in push send-pack http-push; do
  set +e
  PATH="$TEST_ROOT/bin:$PATH" \
    RALPH_REAL_GIT="$REAL_GIT" \
    RALPH_GIT_PUSH_ENABLED=0 \
    RALPH_EXPLICIT_PUSH=0 \
    "$GUARD" -C "$TEST_ROOT/repo" "$publish_command" origin main >/dev/null 2>"$TEST_ROOT/$publish_command.err"
  publish_status=$?
  set -e
  [[ "$publish_status" -eq 2 ]]
done

cat > "$TEST_ROOT/fake-codex.sh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
prompt="$(cat)"
printf '%s' "$prompt" > "$FAKE_PROMPT_CAPTURE"
[[ -z "${RALPH_REAL_GIT:-}" ]]
[[ -z "${RALPH_GITHUB_TOKEN:-}" ]]
[[ -z "${GITHUB_TOKEN:-}" ]]
[[ -z "${GH_TOKEN:-}" ]]
[[ "${GIT_TERMINAL_PROMPT:-}" == 0 ]]
[[ "${GCM_INTERACTIVE:-}" == never ]]
git -C "$PWD" checkout -B ralph/agent-bypass >/dev/null 2>"$FAKE_CHECKOUT_CAPTURE"
printf '%s' "$?" > "$FAKE_CHECKOUT_STATUS"
set +e
git -C "$PWD" push origin HEAD >/dev/null 2>"$FAKE_PUSH_CAPTURE"
printf '%s' "$?" > "$FAKE_PUSH_STATUS"
set -e
printf 'implemented\n' > implemented.txt
FAKE
chmod +x "$TEST_ROOT/fake-codex.sh"

(
  cd "$TEST_ROOT/repo"
  PATH="$TEST_ROOT/bin:$PATH" \
    RALPH_REAL_GIT="$REAL_GIT" \
    RALPH_CODEX_BIN="$TEST_ROOT/fake-codex.sh" \
    RALPH_GITHUB_TOKEN=secret-a \
    GITHUB_TOKEN=secret-b \
    GH_TOKEN=secret-c \
    FAKE_PROMPT_CAPTURE="$TEST_ROOT/prompt.txt" \
    FAKE_CHECKOUT_CAPTURE="$TEST_ROOT/fake-checkout.err" \
    FAKE_CHECKOUT_STATUS="$TEST_ROOT/fake-checkout.status" \
    FAKE_PUSH_CAPTURE="$TEST_ROOT/fake-push.err" \
    FAKE_PUSH_STATUS="$TEST_ROOT/fake-push.status" \
    "$NODE_BIN" "$WRAPPER" exec <<< 'Implemente a tarefa de teste' 2>"$TEST_ROOT/wrapper.err"
)

[[ "$(cat "$TEST_ROOT/fake-checkout.status")" -eq 0 ]]
[[ "$(cat "$TEST_ROOT/fake-push.status")" -eq 2 ]]
[[ "$("$REAL_GIT" -C "$TEST_ROOT/repo" branch --show-current)" == main ]]
! "$REAL_GIT" -C "$TEST_ROOT/repo" show-ref --verify --quiet refs/heads/ralph/agent-bypass
grep -q 'A branch capturada no início é: main' "$TEST_ROOT/prompt.txt"
grep -q 'Push não realizado' "$TEST_ROOT/wrapper.err"
[[ "$("$REAL_GIT" -C "$TEST_ROOT/repo" log -1 --pretty=%s)" == 'ralph: Implemente a tarefa de teste' ]]
"$REAL_GIT" -C "$TEST_ROOT/repo" show --name-only --pretty='' HEAD | grep -q '^implemented.txt$'

# A skill ativa e o alias ralph-codex devem ser instalados de forma idempotente.
[[ -f "$SOURCE_DIR/ralph-loop/SKILL.md" ]]
[[ -f "$SOURCE_DIR/ralph-codex/SKILL.md" ]]
HOME="$TEST_ROOT/home" RALPH_SKILL_SOURCE_DIR="$SOURCE_DIR" bash "$INSTALLER" >/dev/null
HOME="$TEST_ROOT/home" RALPH_SKILL_SOURCE_DIR="$SOURCE_DIR" bash "$INSTALLER" >/dev/null
[[ -f "$TEST_ROOT/home/.agents/skills/ralph-loop/SKILL.md" ]]
[[ -f "$TEST_ROOT/home/.agents/skills/ralph-codex/SKILL.md" ]]
[[ "$(grep -c '<!-- RALPH_GIT_POLICY_START -->' "$TEST_ROOT/home/.codex/AGENTS.md")" -eq 1 ]]
[[ "$(grep -c '<!-- RALPH_GIT_POLICY_END -->' "$TEST_ROOT/home/.codex/AGENTS.md")" -eq 1 ]]

echo 'Ralph Git policy tests passed: current branch preserved, local commit created, push blocked, skills installed.'
