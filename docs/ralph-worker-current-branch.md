# Ralph: branch atual e commits locais

A execução ativa do worker é gerada por `scripts/build-worker-current-branch.mjs` a partir do worker-base. A geração falha se os trechos esperados mudarem, evitando que uma atualização silenciosa restaure o comportamento legado.

Regras efetivas:

- o clone novo permanece na branch selecionada pelo projeto/remoto;
- um workspace existente permanece exatamente na branch que já está ativa;
- nenhum `checkout -B ralph/task-*`, troca de branch ou reset destrutivo é executado;
- o provider roda com refs Git descartáveis e sem credenciais de publicação;
- alterações válidas são commitadas localmente na branch atual;
- push automático permanece bloqueado;
- push/PR continuam dependendo de uma ação humana explícita e das flags de escrita.

Validação:

```bash
npm run test:ralph-git-policy
```
