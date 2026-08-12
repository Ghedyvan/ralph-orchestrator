# Instruções do Projeto

- Entenda o objetivo antes de alterar código.
- Trabalhe uma story por vez.
- Evite mudanças grandes ou não relacionadas.
- Rode validações disponíveis antes de considerar uma story concluída.
- Não mexa em `.env`, secrets, tokens, credenciais, chaves privadas ou arquivos sensíveis.
- Prefira commits pequenos com mensagens claras quando Git estiver disponível.
- Registre decisões, validações, bloqueios e próximos passos em `progress.txt`.
- Respeite o escopo do `activeRequest` em `prd.json`.

## Política Git do Ralph

- Capture a branch ativa com `git branch --show-current` antes da primeira alteração.
- Trabalhe e faça commits locais nessa mesma branch.
- Não crie nem troque de branch automaticamente; `branchName` é somente metadado legado.
- Não use operações destrutivas para limpar alterações preexistentes.
- Nunca faça push, configure upstream ou abra PR automaticamente.
- Push e mudança de branch exigem pedido explícito na solicitação atual.
