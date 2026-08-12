#!/usr/bin/env node

import {spawn, spawnSync} from "node:child_process";
import process from "node:process";

const REAL_CODEX = process.env.RALPH_CODEX_BIN || "/usr/local/bin/codex";
const REAL_GIT = process.env.RALPH_REAL_GIT || "/usr/bin/git";
const FORBIDDEN_PATHS = (process.env.RALPH_FORBIDDEN_PATHS || ".env,.env.local,.ssh,id_rsa,id_ed25519")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function git(args, options = {}) {
  return spawnSync(REAL_GIT, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    ...options,
  });
}

function gitText(args) {
  const result = git(args);
  if (result.status !== 0) return "";
  return (result.stdout || "").trim();
}

function currentBranch() {
  return gitText(["branch", "--show-current"]);
}

function insideGitRepository() {
  return git(["rev-parse", "--is-inside-work-tree"]).status === 0;
}

function statusEntries() {
  const result = git(["status", "--porcelain=v1", "-z"]);
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout.split("\0").filter(Boolean);
}

function pathFromStatus(entry) {
  const raw = entry.length > 3 ? entry.slice(3) : entry;
  const arrowIndex = raw.lastIndexOf(" -> ");
  return arrowIndex >= 0 ? raw.slice(arrowIndex + 4) : raw;
}

function isForbidden(filePath) {
  return FORBIDDEN_PATHS.some(
    (forbidden) => filePath === forbidden || filePath.endsWith(`/${forbidden}`) || filePath.includes(`/${forbidden}/`),
  );
}

function commitMessage(prompt) {
  const candidate = prompt
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.startsWith("[POLÍTICA"));
  const normalized = (candidate || "aplicar alterações da tarefa").replace(/\s+/g, " ").slice(0, 130);
  return `ralph: ${normalized}`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function runCodex(args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(REAL_CODEX, args, {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({code: code ?? 1, signal}));
    child.stdin.end(input);
  });
}

const originalPrompt = await readStdin();
const inRepository = insideGitRepository();
const initialBranch = inRepository ? currentBranch() : "";
const initialStatus = inRepository ? statusEntries() : [];

const policy = [
  "[POLÍTICA GIT RALPH OBRIGATÓRIA]",
  initialBranch
    ? `A branch capturada no início é: ${initialBranch}`
    : "Não há branch Git ativa; não crie uma branch automaticamente e não faça commit em detached HEAD.",
  "Permaneça na branch capturada durante toda a execução.",
  "Não crie, troque, renomeie ou remova branches. Ignore branchName legado.",
  "Depois de validar uma unidade lógica, faça commit local pequeno na branch atual.",
  "Nunca execute git push, configure upstream ou abra PR automaticamente.",
  "Preserve alterações preexistentes e não use reset --hard, clean -fd, merge ou rebase automático.",
  "Ao finalizar, informe os commits e declare: Push não realizado.",
  "[/POLÍTICA GIT RALPH OBRIGATÓRIA]",
  "",
].join("\n");

const childEnv = {
  ...process.env,
  RALPH_ACTIVE: "1",
  RALPH_CURRENT_BRANCH: initialBranch,
  RALPH_EXPLICIT_PUSH: "0",
};

const result = await runCodex(process.argv.slice(2), `${policy}${originalPrompt}`, childEnv);
if (result.code !== 0) process.exit(result.code);

if (!inRepository) {
  console.error("Ralph: execução concluída fora de um repositório Git; nenhum commit automático foi criado.");
  process.exit(0);
}

const finalBranch = currentBranch();
if (!initialBranch) {
  console.error("Ralph: detached HEAD ou branch ausente; nenhum commit automático foi criado.");
  process.exit(0);
}
if (finalBranch !== initialBranch) {
  console.error(`Ralph: branch alterada de ${initialBranch} para ${finalBranch}; commit automático bloqueado.`);
  process.exit(3);
}

const finalEntries = statusEntries();
if (finalEntries.length === 0) {
  const head = gitText(["rev-parse", "HEAD"]);
  console.error(`Ralph: árvore limpa na branch ${finalBranch}. HEAD=${head || "desconhecido"}. Push não realizado.`);
  process.exit(0);
}

if (initialStatus.length > 0) {
  console.error(
    "Ralph: havia alterações preexistentes antes da execução; o wrapper não fará staging amplo. " +
      "A skill deve ter commitado somente os arquivos da tarefa. Push não realizado.",
  );
  process.exit(0);
}

const changedFiles = finalEntries.map(pathFromStatus);
const forbidden = changedFiles.filter(isForbidden);
if (forbidden.length > 0) {
  console.error(`Ralph: commit bloqueado por arquivos proibidos: ${forbidden.join(", ")}`);
  process.exit(4);
}

let command = git(["add", "-A", "--", "."]);
if (command.status !== 0) {
  process.stderr.write(command.stderr || "Ralph: falha ao adicionar arquivos ao staging.\n");
  process.exit(command.status || 5);
}

command = git([
  "-c",
  "user.name=Ralph Codex",
  "-c",
  "user.email=ralph-codex@example.invalid",
  "commit",
  "-m",
  commitMessage(originalPrompt),
]);
if (command.status !== 0) {
  process.stderr.write(command.stderr || command.stdout || "Ralph: falha ao criar commit local.\n");
  process.exit(command.status || 6);
}

const commitSha = gitText(["rev-parse", "HEAD"]);
console.error(`Ralph: commit local criado em ${finalBranch}: ${commitSha}. Push não realizado.`);
