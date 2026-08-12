#!/usr/bin/env node

import {spawn} from "node:child_process";
import {access, chmod, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {fileURLToPath, pathToFileURL} from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_WORKER_PATH = path.join(SCRIPT_DIR, "worker.mjs");
const GIT_GUARD_PATH = path.join(SCRIPT_DIR, "ralph-git-guard.sh");

function changedFilesFromStatus(output) {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => (line.length > 3 ? line.slice(3).trim() : line.trim()))
    .filter(Boolean);
}

async function safePrepareGitWorkspace(state, run, project, task, workspacePath, _legacyBranchName) {
  const repoPath = path.join(workspacePath, "repo");
  if (!GIT_ENABLED) {
    const branchName = task.branchName || project.defaultBranch || "";
    addLog(state, run.id, "info", "Git real desabilitado. Nenhuma branch foi criada ou trocada.");
    return {
      branchName,
      changedFiles: [],
      diffSummary: "Git dry-run: clone/fetch nao executado.",
      initialDirty: false,
      initialHead: null,
    };
  }

  await mkdir(workspacePath, {recursive: true});
  const repoExists = await pathExists(repoPath);
  const gitExists = await pathExists(path.join(repoPath, ".git"));

  if (repoExists && !gitExists) {
    throw new Error(`Workspace existente nao e um repositorio Git: ${repoPath}. Recusando remover ou substituir automaticamente.`);
  }

  if (!repoExists) {
    try {
      await runGit(await cloneArgs(project.repoUrl, repoPath, project.defaultBranch), ROOT);
    } catch (error) {
      if (isGitAuthFailure(error)) {
        throw new Error(`Clone Git falhou por autenticacao/acesso.${gitAuthHint(project.repoUrl)} ${sanitizeGitError(error)}`);
      }
      addLog(
        state,
        run.id,
        "warn",
        `Clone da branch configurada ${project.defaultBranch || "(nao informada)"} falhou; tentando a branch default do repositorio sem criar branch local. ${sanitizeGitError(error)}`,
      );
      try {
        await runGit(await cloneArgs(project.repoUrl, repoPath), ROOT);
      } catch (fallbackError) {
        if (isGitAuthFailure(fallbackError)) {
          throw new Error(
            `Clone Git falhou por autenticacao/acesso.${gitAuthHint(project.repoUrl)} ${sanitizeGitError(fallbackError)}`,
          );
        }
        throw fallbackError;
      }
    }
  }

  const activeBranch = await runGit(["branch", "--show-current"], repoPath);
  if (!activeBranch) {
    throw new Error("Repositorio em detached HEAD. Ralph nao criara uma branch automaticamente e nao fara commit.");
  }

  const initialStatus = await runGit(["status", "--short"], repoPath);
  const initialHead = await runGit(["rev-parse", "HEAD"], repoPath);
  const changedFiles = changedFilesFromStatus(initialStatus);
  const diffSummary = await runGit(["diff", "--stat"], repoPath);

  task.branchName = activeBranch;
  await writeFile(path.join(workspacePath, "DIFF_SUMMARY.txt"), diffSummary || "Sem diff.");
  await writeFile(path.join(workspacePath, "CHANGED_FILES.json"), `${JSON.stringify(changedFiles, null, 2)}\n`);
  addLog(
    state,
    run.id,
    "info",
    `Git workspace pronto em ${repoPath}. Branch preservada: ${activeBranch}. Push automatico desabilitado.`,
  );

  return {
    branchName: activeBranch,
    changedFiles,
    diffSummary: diffSummary || "Sem diff.",
    initialDirty: changedFiles.length > 0,
    initialHead,
  };
}

function ralphIsForbiddenPath(filePath) {
  const candidates = filePath.split(" -> ").map((item) => item.trim());
  return candidates.some((candidate) =>
    FORBIDDEN_PATHS.some(
      (forbidden) =>
        candidate === forbidden ||
        candidate.endsWith(`/${forbidden}`) ||
        candidate.includes(`/${forbidden}/`),
    ),
  );
}

function ralphCommitMessage(task) {
  const normalized = String(task.title || "aplicar alteracoes da tarefa")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `ralph: ${normalized || "aplicar alteracoes da tarefa"}`;
}

function ralphProviderTask(task, branchName) {
  const policy = [
    "[POLITICA GIT RALPH OBRIGATORIA]",
    `A branch ativa capturada pelo worker e: ${branchName}.`,
    "Permaneça nessa branch. Nao crie, troque, renomeie ou remova branches.",
    "Ignore qualquer branchName legado ou convencao ralph/*.",
    "Preserve alteracoes preexistentes e nao use reset --hard, clean, merge ou rebase automatico.",
    "Depois das validacoes, faca commit local pequeno na branch atual.",
    "Nunca execute git push, configure upstream ou abra pull request automaticamente.",
    "Ao finalizar, informe os commits e declare: Push nao realizado.",
    "[/POLITICA GIT RALPH OBRIGATORIA]",
    "",
  ].join("\n");

  return {...task, prompt: `${policy}${task.prompt}`};
}

async function finalizeGitWorkspace(state, run, task, workspacePath, expectedBranch, initialHead, initialDirty) {
  const repoPath = path.join(workspacePath, "repo");
  if (!GIT_ENABLED || !(await pathExists(path.join(repoPath, ".git")))) {
    return {
      changedFiles: [],
      commitSha: null,
      diffSummary: "Git desabilitado; nenhum commit local criado.",
      skippedReason: "Git desabilitado.",
    };
  }

  const activeBranch = await runGit(["branch", "--show-current"], repoPath);
  if (!activeBranch || activeBranch !== expectedBranch) {
    throw new Error(
      `Branch alterada durante a execucao. Esperada: ${expectedBranch || "(ausente)"}; atual: ${activeBranch || "detached HEAD"}. Commit bloqueado.`,
    );
  }

  const statusOutput = await runGit(["status", "--short"], repoPath);
  const changedFiles = changedFilesFromStatus(statusOutput);
  const headBeforeCommit = await runGit(["rev-parse", "HEAD"], repoPath);

  if (changedFiles.length === 0) {
    const providerCommit = initialHead && headBeforeCommit !== initialHead ? headBeforeCommit : null;
    const providerDiff = providerCommit
      ? await runGit(["show", "--stat", "--oneline", "--format=", providerCommit], repoPath)
      : "Sem alteracoes pendentes.";
    return {
      changedFiles: providerCommit
        ? changedFilesFromStatus(await runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", providerCommit], repoPath))
        : [],
      commitSha: providerCommit,
      diffSummary: providerDiff || "Sem alteracoes pendentes.",
      skippedReason: providerCommit ? null : "Nenhuma alteracao nova para commit.",
    };
  }

  const diffSummary = await runGit(["diff", "--stat"], repoPath);
  const forbidden = changedFiles.filter(ralphIsForbiddenPath);
  if (forbidden.length > 0) {
    throw new Error(`Commit bloqueado por arquivos proibidos: ${forbidden.join(", ")}`);
  }

  if (initialDirty) {
    const providerCommit = initialHead && headBeforeCommit !== initialHead ? headBeforeCommit : null;
    addLog(
      state,
      run.id,
      "warn",
      "Commit automatico omitido porque o workspace ja continha alteracoes antes da tarefa. Nenhum staging amplo foi executado.",
    );
    return {
      changedFiles,
      commitSha: providerCommit,
      diffSummary: diffSummary || "Alteracoes mantidas sem staging automatico.",
      skippedReason: "Havia alteracoes preexistentes; commit automatico seguro foi omitido.",
    };
  }

  if (process.env.RALPH_GIT_AUTO_COMMIT_ENABLED === "0") {
    return {
      changedFiles,
      commitSha: null,
      diffSummary: diffSummary || "Alteracoes aguardando commit local.",
      skippedReason: "Commit automatico desabilitado por RALPH_GIT_AUTO_COMMIT_ENABLED=0.",
    };
  }

  await runGit(["add", "-A", "--", "."], repoPath);
  const branchBeforeCommit = await runGit(["branch", "--show-current"], repoPath);
  if (branchBeforeCommit !== expectedBranch) {
    throw new Error(`Branch mudou antes do commit: ${branchBeforeCommit || "detached HEAD"}. Commit bloqueado.`);
  }

  const message = ralphCommitMessage(task);
  await runGit(
    [
      "-c",
      "user.name=Ralph Orchestrator",
      "-c",
      "user.email=ralph-orchestrator@example.invalid",
      "commit",
      "-m",
      message,
    ],
    repoPath,
  );
  const commitSha = await runGit(["rev-parse", "HEAD"], repoPath);
  addLog(state, run.id, "info", `Commit local criado em ${expectedBranch}: ${commitSha}. Push nao realizado.`);

  return {
    changedFiles,
    commitSha,
    diffSummary: diffSummary || "Commit local criado.",
    skippedReason: null,
  };
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Nao foi possivel aplicar a politica Ralph: trecho ausente (${label}).`);
  if (source.indexOf(needle, index + needle.length) >= 0) {
    throw new Error(`Nao foi possivel aplicar a politica Ralph: trecho duplicado (${label}).`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + needle.length)}`;
}

export function hardenWorkerSource(source) {
  const prepareStart = source.indexOf("async function prepareGitWorkspace(");
  const prepareEnd = source.indexOf("\nfunction runningProjectIds", prepareStart);
  if (prepareStart < 0 || prepareEnd < 0) {
    throw new Error("Nao foi possivel localizar prepareGitWorkspace no worker legado.");
  }

  const safePrepareSource = safePrepareGitWorkspace
    .toString()
    .replace("safePrepareGitWorkspace", "prepareGitWorkspace");
  const helperSources = [
    changedFilesFromStatus,
    ralphIsForbiddenPath,
    ralphCommitMessage,
    ralphProviderTask,
    finalizeGitWorkspace,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");

  let hardened = `${source.slice(0, prepareStart)}${safePrepareSource}\n\n${helperSources}\n${source.slice(prepareEnd)}`;

  hardened = replaceOnce(
    hardened,
    "  const branchName = `ralph/task-${task.id.slice(0, 8)}`;",
    "  let branchName = project.defaultBranch;",
    "branch sintetica",
  );
  hardened = replaceOnce(
    hardened,
    "    aiThought: \"Validando acesso ao repositorio e criando branch isolada para a story.\",",
    "    aiThought: \"Validando acesso ao repositorio e preservando a branch que ja esta ativa.\",",
    "mensagem de progresso",
  );
  hardened = replaceOnce(
    hardened,
    "    gitResult = await prepareGitWorkspace(state, run, project, task, workspacePath, branchName);",
    [
      "    gitResult = await prepareGitWorkspace(state, run, project, task, workspacePath, branchName);",
      "    branchName = gitResult.branchName || branchName;",
      "    task.branchName = branchName;",
      "    await writeWorkspaceFiles(workspacePath, project, task, run);",
    ].join("\n"),
    "captura da branch ativa",
  );
  hardened = replaceOnce(
    hardened,
    "      task: freshTask,",
    "      task: ralphProviderTask(freshTask, branchName),",
    "politica do provider",
  );

  const reviewNeedle = "  freshTask.status = \"review\";";
  const finalizeBlock = [
    "  let commitResult;",
    "  try {",
    "    commitResult = await finalizeGitWorkspace(",
    "      fresh,",
    "      freshRun,",
    "      freshTask,",
    "      workspacePath,",
    "      branchName,",
    "      gitResult.initialHead,",
    "      gitResult.initialDirty,",
    "    );",
    "  } catch (error) {",
    "    freshTask.status = \"blocked\";",
    "    setTaskProgress(freshTask, {",
    "      currentWork: \"Commit local bloqueado pela politica Git.\",",
    "      aiThought: \"A branch mudou, um arquivo proibido foi alterado ou o commit seguro falhou.\",",
    "      progressPercent: 90,",
    "    });",
    "    freshRun.status = \"failed\";",
    "    freshRun.finishedAt = now();",
    "    freshRun.summary = `Falha ao finalizar commit local. ${sanitizeGitError(error)} Push nao realizado.`;",
    "    addLog(fresh, run.id, \"error\", freshRun.summary);",
    "    await writeState(fresh);",
    "    return true;",
    "  }",
    "",
    reviewNeedle,
  ].join("\n");
  hardened = replaceOnce(hardened, reviewNeedle, finalizeBlock, "finalizacao do commit");

  const oldSummaryBlock = [
    "  freshRun.summary = `${providerResult.summary} Workspace e plano Git preparados; aguardando review humano.`;",
    "  freshRun.changedFiles = [...new Set([...gitResult.changedFiles, ...providerResult.changedFiles])];",
    "  freshRun.diffSummary = [gitResult.diffSummary, providerResult.diffSummary].filter(Boolean).join(\"\\n\\n\");",
  ].join("\n");
  const newSummaryBlock = [
    "  const commitSummary = commitResult.commitSha",
    "    ? `Commit local ${commitResult.commitSha} registrado na branch ${branchName}.`",
    "    : commitResult.skippedReason || \"Nenhuma alteracao pendente para novo commit local.\";",
    "  freshRun.summary = `${providerResult.summary} ${commitSummary} Push nao realizado. Aguardando review humano.`;",
    "  freshRun.changedFiles = [",
    "    ...new Set([",
    "      ...gitResult.changedFiles,",
    "      ...providerResult.changedFiles,",
    "      ...commitResult.changedFiles,",
    "    ]),",
    "  ];",
    "  freshRun.diffSummary = [gitResult.diffSummary, providerResult.diffSummary, commitResult.diffSummary]",
    "    .filter(Boolean)",
    "    .join(\"\\n\\n\");",
  ].join("\n");
  hardened = replaceOnce(hardened, oldSummaryBlock, newSummaryBlock, "resumo final Git");

  const forbiddenPatterns = [
    {label: "checkout -B", pattern: /runGit\(\[\"checkout\",\s*\"-B\"/},
    {label: "branch ralph sintetica", pattern: /ralph\/task-\$\{/},
    {label: "reset hard de workspace", pattern: /runGit\(\[\"reset\",\s*\"--hard\"/},
  ];
  for (const {label, pattern} of forbiddenPatterns) {
    if (pattern.test(hardened)) throw new Error(`Politica Ralph incompleta: ainda existe ${label} no worker efetivo.`);
  }

  return hardened;
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Tenta o proximo candidato.
    }
  }
  return "";
}

async function run() {
  const source = await readFile(LEGACY_WORKER_PATH, "utf8");
  let hardened = hardenWorkerSource(source);
  hardened = hardened
    .replaceAll('"./github-auth.mjs"', JSON.stringify(pathToFileURL(path.join(SCRIPT_DIR, "github-auth.mjs")).href))
    .replaceAll('"./providers.mjs"', JSON.stringify(pathToFileURL(path.join(SCRIPT_DIR, "providers.mjs")).href));

  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "ralph-worker-current-branch-"));
  const runtimeWorker = path.join(runtimeDir, "worker.mjs");
  const policyBin = path.join(runtimeDir, "bin");
  await writeFile(runtimeWorker, hardened);
  await import("node:fs/promises").then(({mkdir}) => mkdir(policyBin, {recursive: true}));
  await chmod(GIT_GUARD_PATH, 0o755);
  await symlink(GIT_GUARD_PATH, path.join(policyBin, "git"));

  const realGit = await firstExisting([
    process.env.RALPH_REAL_GIT,
    "/opt/ralph/bin/git-real",
    "/usr/bin/git",
    "/opt/homebrew/bin/git",
  ]);
  if (!realGit) throw new Error("Git real nao encontrado para o guard Ralph.");

  const env = {
    ...process.env,
    PATH: `${policyBin}${path.delimiter}${process.env.PATH || ""}`,
    RALPH_ACTIVE: "1",
    RALPH_REAL_GIT: realGit,
    RALPH_GIT_AUTO_COMMIT_ENABLED: process.env.RALPH_GIT_AUTO_COMMIT_ENABLED || "1",
    RALPH_GIT_PUSH_ENABLED: "0",
    RALPH_EXPLICIT_PUSH: "0",
  };

  const child = spawn(process.execPath, [runtimeWorker, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({code: code ?? 1, signal}));
  });
  await rm(runtimeDir, {recursive: true, force: true});

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.code);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  run().catch((error) => {
    console.error(`Ralph worker policy falhou: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  });
}
