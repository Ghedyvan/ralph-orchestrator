#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${RALPH_APP_ROOT:-/app}"
REAL_GIT="${RALPH_REAL_GIT:-/usr/bin/git}"
GUARD="$APP_ROOT/scripts/ralph-git-guard.sh"
WRAPPER="$APP_ROOT/scripts/codex-ralph-wrapper.mjs"
ENTRYPOINT="$APP_ROOT/scripts/docker-entrypoint.sh"
INSTALLER="$APP_ROOT/scripts/install-ralph-skill.sh"
SKILLS_SOURCE="${RALPH_SKILL_SOURCE_DIR:-/opt/ralph-skills}"

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

fail() {
  printf 'Ralph policy test failed: %s\n' "$1" >&2
  exit 1
}

[[ -x "$REAL_GIT" ]] || fail "real git not found at $REAL_GIT"
[[ -f "$GUARD" ]] || fail "guard not found"
[[ -f "$WRAPPER" ]] || fail "Codex wrapper not found"
[[ -f "$ENTRYPOINT" ]] || fail "entrypoint not found"
[[ -f "$INSTALLER" ]] || fail "skill installer not found"

bash -n "$GUARD" "$ENTRYPOINT" "$INSTALLER"
node --check "$WRAPPER"

grep -q 'name: ralph-loop' "$SKILLS_SOURCE/ralph-loop/SKILL.md"
grep -q 'name: ralph-codex' "$SKILLS_SOURCE/ralph-codex/SKILL.md"
grep -qi 'não crie' "$SKILLS_SOURCE/ralph-loop/SKILL.md"
grep -q 'Nunca execute `git push`' "$SKILLS_SOURCE/ralph-loop/SKILL.md"

repo="$temp_dir/repo"
home="$temp_dir/home"
shim="$temp_dir/bin"
fake_codex="$temp_dir/fake-codex"
mkdir -p "$repo" "$home" "$shim"
ln -s "$GUARD" "$shim/git"

"$REAL_GIT" init -q -b main "$repo"
"$REAL_GIT" -C "$repo" config user.name "Ralph Policy Test"
"$REAL_GIT" -C "$repo" config user.email "ralph-policy@example.invalid"
printf 'base\n' > "$repo/app.txt"
"$REAL_GIT" -C "$repo" add app.txt
"$REAL_GIT" -C "$repo" commit -q -m base
"$REAL_GIT" -C "$repo" switch -q -c feature/current

# Mesmo com opções globais antes do subcomando, criação/troca de branch continua bloqueada.
RALPH_REAL_GIT="$REAL_GIT" "$GUARD" -C "$repo" checkout -B ralph/forbidden
[[ "$("$REAL_GIT" -C "$repo" branch --show-current)" == "feature/current" ]] || fail "guard changed branch"

printf 'pending\n' >> "$repo/app.txt"
RALPH_REAL_GIT="$REAL_GIT" "$GUARD" -C "$repo" reset --hard HEAD
grep -q 'pending' "$repo/app.txt" || fail "reset --hard discarded changes"
"$REAL_GIT" -C "$repo" restore app.txt

# Push com opção global também precisa ser bloqueado antes de qualquer acesso remoto.
if RALPH_REAL_GIT="$REAL_GIT" "$GUARD" -c user.name=test -C "$repo" push origin HEAD 2>/dev/null; then
  fail "push was allowed without explicit authorization"
fi

cat > "$fake_codex" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
prompt="$(cat)"
grep -q 'A branch capturada no início é: feature/current' <<<"$prompt"
grep -q 'Push não realizado' <<<"$prompt"
[[ -z "${RALPH_GITHUB_TOKEN:-}" ]]
[[ -z "${GITHUB_TOKEN:-}" ]]
[[ -z "${GH_TOKEN:-}" ]]
[[ "${GIT_TERMINAL_PROMPT:-}" == "0" ]]
[[ "${GCM_INTERACTIVE:-}" == "never" ]]
printf 'changed by fake Codex\n' >> app.txt
# O agente pode tentar instruções antigas; o guard deve manter a branch e bloquear o push.
git checkout -B ralph/generated
git reset --hard HEAD
if git -c user.name=test push origin HEAD >/dev/null 2>&1; then
  exit 91
fi
FAKE
chmod +x "$fake_codex"

before_branch="$("$REAL_GIT" -C "$repo" branch --show-current)"
(
  cd "$repo"
  printf 'Implemente a alteração de teste\n' |
    env \
      -u RALPH_GITHUB_TOKEN \
      -u GITHUB_TOKEN \
      -u GH_TOKEN \
      -u GIT_ASKPASS \
      -u SSH_ASKPASS \
      PATH="$shim:$PATH" \
      RALPH_REAL_GIT="$REAL_GIT" \
      RALPH_CODEX_BIN="$fake_codex" \
      GIT_TERMINAL_PROMPT=0 \
      GCM_INTERACTIVE=never \
      node "$WRAPPER" exec -
)
after_branch="$("$REAL_GIT" -C "$repo" branch --show-current)"
[[ "$before_branch" == "feature/current" && "$after_branch" == "$before_branch" ]] || fail "wrapper did not preserve current branch"
[[ -z "$("$REAL_GIT" -C "$repo" status --porcelain)" ]] || fail "wrapper left uncommitted changes"
[[ "$("$REAL_GIT" -C "$repo" log -1 --format=%s)" == ralph:* ]] || fail "wrapper did not create a Ralph commit"
[[ "$("$REAL_GIT" -C "$repo" rev-list --count main..feature/current)" == "1" ]] || fail "commit was not created on current feature branch"

# A inicialização instala as duas skills e transforma o comando Codex para remover credenciais.
entry_output="$({
  HOME="$home" \
  CODEX_HOME="$home/.codex" \
  RALPH_APP_ROOT="$APP_ROOT" \
  RALPH_SKILL_SOURCE_DIR="$SKILLS_SOURCE" \
  RALPH_SKILL_TARGET_DIR="$home/.agents/skills" \
  CODEX_COMMAND='codex exec -' \
  RALPH_GITHUB_TOKEN=secret-a \
  GITHUB_TOKEN=secret-b \
  GH_TOKEN=secret-c \
  "$ENTRYPOINT" /usr/bin/env
} 2>/dev/null)"

grep -q '^CODEX_COMMAND=codex-ralph exec -$' <<<"$entry_output" || fail "entrypoint did not route Codex through the protected wrapper"
grep -q '^RALPH_EXPLICIT_PUSH=0$' <<<"$entry_output" || fail "explicit push default is not disabled"
[[ -f "$home/.agents/skills/ralph-loop/SKILL.md" ]] || fail "ralph-loop was not installed"
[[ -f "$home/.agents/skills/ralph-codex/SKILL.md" ]] || fail "ralph-codex was not installed"
grep -q 'Push não realizado' "$home/.codex/AGENTS.md" || fail "global Codex policy was not installed"

printf 'Ralph policy validated: current branch preserved, local commit created, push blocked, skills installed.\n'
