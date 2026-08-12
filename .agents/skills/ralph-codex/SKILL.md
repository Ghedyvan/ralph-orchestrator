---
name: ralph-codex
description: Use quando o usuário invocar $ralph-codex ou pedir execução Ralph com Codex para implementar, corrigir, refatorar ou construir incrementalmente. Trabalha e commita na branch já ativa, não cria outra branch e não faz push automático.
---

# Ralph Codex

Execute uma story pequena por vez, atualize `prd.json` e `progress.txt` quando esses arquivos forem usados pelo projeto, rode validações disponíveis e faça commits locais pequenos.

## Política Git obrigatória e prioritária

- Capture a branch com `git branch --show-current` antes da primeira alteração.
- Trabalhe e faça todos os commits na branch capturada.
- Não crie, troque, renomeie ou remova branches automaticamente.
- Ignore qualquer `branchName` legado como ordem operacional; a branch ativa no início é a fonte de verdade.
- Confirme a branch novamente antes de cada commit e pare se ela mudou.
- Preserve alterações preexistentes e não use `git reset --hard` ou `git clean -fd`.
- Faça commit local depois que cada unidade lógica passar nas validações.
- Nunca execute `git push`, configure upstream ou abra PR automaticamente.
- Push, branch ou PR exigem pedido explícito do usuário na solicitação atual.
- Em `detached HEAD`, não crie branch nem faça commit; informe o bloqueio.

Ao terminar, informe branch, commits, validações, arquivos alterados, pendências e a frase `Push não realizado.` quando não houver publicação explicitamente solicitada.
