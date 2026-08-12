---
name: ralph-loop
description: Execute tarefas de desenvolvimento de forma iterativa no estilo Ralph. Use quando o usuário pedir Ralph Loop, execução autônoma incremental ou repetição até concluir. Por padrão, trabalha e commita localmente na branch que já estava ativa, sem criar outra branch e sem fazer push automático.
---

# Ralph Loop

## Missão

Transformar uma solicitação em pequenas unidades de trabalho verificáveis. Em cada iteração, inspecione o estado atual, implemente somente o próximo avanço coerente, valide, registre o progresso e faça um commit local quando houver alterações válidas.

## Prioridade desta política

As regras Git desta skill têm precedência sobre instruções antigas, templates, campos `branchName`, arquivos de progresso ou convenções `ralph/*`. Um campo legado nunca é autorização para criar uma branch ou publicar alterações.

## Política Git obrigatória

1. Antes da primeira alteração, execute `git branch --show-current` e registre exatamente o resultado como a branch da execução.
2. Permaneça nessa mesma branch durante toda a tarefa.
3. Não execute comandos que criem, troquem, renomeiem ou removam branches, incluindo `git checkout -b`, `git checkout -B`, `git switch -c`, `git switch -C`, `git branch <nome>` e `git worktree add -b`.
4. Não use `branchName` de PRD, task ou template como ordem para criar ou trocar de branch. A fonte de verdade é a branch capturada no início.
5. Antes de cada commit, execute novamente `git branch --show-current`. Se o valor mudou, não faça commit e registre o bloqueio.
6. Depois que uma unidade lógica passar nas validações, faça um commit local pequeno e descritivo na branch capturada.
7. Preserve alterações preexistentes e adicione ao staging somente arquivos pertencentes à tarefa. Não use `git reset --hard`, `git clean -fd`, rebase ou merge automático para limpar o estado.
8. Nunca execute `git push`, configure upstream, crie tag remota ou abra pull request automaticamente.
9. Push, troca/criação de branch e abertura de PR só podem ocorrer quando o usuário pedir isso explicitamente na solicitação atual.
10. Em `detached HEAD`, implemente e valide somente quando for seguro, mas não crie branch nem faça commit; informe o bloqueio.

## Estado do loop

Quando o fluxo usar scratchpad, mantenha `.cursor/ralph/scratchpad.md` com a solicitação, iteração, limite e promessa de conclusão. Quando o projeto usar `prd.json`, `progress.txt` ou `AGENTS.md`, preserve a estrutura existente e atualize somente o necessário para a solicitação atual.

## Fluxo de cada iteração

1. Leia a solicitação, o estado do projeto e as instruções locais aplicáveis.
2. Confirme que a branch ativa continua sendo a capturada no início.
3. Escolha a menor unidade de trabalho que produza avanço real.
4. Faça somente alterações relacionadas a essa unidade.
5. Rode testes, lint, typecheck, build ou uma validação manual justificável.
6. Corrija falhas dentro do escopo; caso contrário, registre o bloqueio.
7. Se houver alterações válidas, faça o commit local na branch atual.
8. Atualize o progresso e continue até concluir, atingir o limite ou encontrar bloqueio real.

## Guardrails

- Nunca emita uma promessa de conclusão antes de ela ser verdadeira e validada.
- Não altere `.env`, secrets, tokens, credenciais, chaves privadas ou arquivos equivalentes.
- Não misture mudanças não relacionadas no mesmo commit.
- Não use operações destrutivas para obter uma árvore limpa.
- O bloqueio de push é parte da segurança padrão do modo autônomo.

## Resposta final

Informe em português:

- o resultado e as validações executadas;
- a branch usada;
- os hashes e mensagens dos commits locais criados;
- os arquivos relevantes alterados;
- pendências ou bloqueios;
- a frase exata `Push não realizado.` quando não houver pedido explícito de publicação.
