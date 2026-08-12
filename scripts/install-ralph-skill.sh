#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -n "${RALPH_SKILL_SOURCE_DIR:-}" ]]; then
  SOURCE_ROOT="$RALPH_SKILL_SOURCE_DIR"
elif [[ -d "/opt/ralph-skills" ]]; then
  SOURCE_ROOT="/opt/ralph-skills"
else
  SOURCE_ROOT="$REPO_ROOT/.agents/skills"
fi

TARGET_ROOT="${RALPH_SKILL_TARGET_DIR:-${HOME}/.agents/skills}"
CODEX_ROOT="${CODEX_HOME:-${HOME}/.codex}"
AGENTS_FILE="$CODEX_ROOT/AGENTS.md"

for skill in ralph-loop ralph-codex; do
  source_file="$SOURCE_ROOT/$skill/SKILL.md"
  if [[ ! -f "$source_file" ]]; then
    printf 'Skill source not found: %s\n' "$source_file" >&2
    exit 1
  fi
  mkdir -p "$TARGET_ROOT/$skill"
  temp_file="$TARGET_ROOT/$skill/.SKILL.md.tmp.$$"
  cp "$source_file" "$temp_file"
  mv "$temp_file" "$TARGET_ROOT/$skill/SKILL.md"
done

mkdir -p "$CODEX_ROOT"
touch "$AGENTS_FILE"
temp_agents="$AGENTS_FILE.tmp.$$"

awk '
  /<!-- RALPH_GIT_POLICY_START -->/ { skip=1; next }
  /<!-- RALPH_GIT_POLICY_END -->/ { skip=0; next }
  !skip { print }
' "$AGENTS_FILE" > "$temp_agents"

cat >> "$temp_agents" <<'POLICY'

<!-- RALPH_GIT_POLICY_START -->
## Política Git para execuções Ralph

Quando uma tarefa estiver em modo Ralph, `ralph-loop`, `ralph-codex` ou com `RALPH_ACTIVE=1`:

- capture `git branch --show-current` antes de alterar arquivos e permaneça nessa branch;
- não crie, troque, renomeie ou remova branches automaticamente;
- trate `branchName` como metadado legado, nunca como ordem operacional;
- faça commits locais pequenos na branch capturada depois das validações;
- preserve alterações preexistentes e não use `git reset --hard` ou `git clean -fd`;
- não execute `git push`, não configure upstream e não abra PR automaticamente;
- push ou mudança de branch exige pedido explícito do usuário na solicitação atual;
- encerre informando a branch, os commits e `Push não realizado.`.
<!-- RALPH_GIT_POLICY_END -->
POLICY

mv "$temp_agents" "$AGENTS_FILE"
printf 'Ralph skills installed in %s; Codex policy updated in %s\n' "$TARGET_ROOT" "$AGENTS_FILE"
