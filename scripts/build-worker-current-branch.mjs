#!/usr/bin/env node

import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "scripts", "worker.mjs");
const outputPath = path.join(root, "scripts", "worker.current-branch.mjs");

let source = await readFile(sourcePath, "utf8");

function replaceExactly(label, before, after) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Nao foi possivel aplicar a politica Ralph (${label}). Esperado 1 trecho, encontrados ${occurrences}.`,
    );
  }
  source = source.replace(before, after);
}

replaceExactly(
  "usar provider protegido por shadow Git",
  'import {providerReady, routeProvider, runProvider} from "./providers.mjs";\n',
  'import {providerReady, routeProvider, runProvider} from "./providers-current-branch.mjs";\n',
);

replaceExactly(
  "habilitar auto-commit local por padrao",
  'const GIT_ENABLED = process.env.RALPH_GIT_ENABLED === "1";\n',
  'const GIT_ENABLED = process.env.RALPH_GIT_ENABLED === "1";\n' +
    'const GIT_AUTO_COMMIT_ENABLED = process.env.RALPH_GIT_AUTO_COMMIT_ENABLED !== "0";\n',
);

replaceExactly(
  "preservar workspace e branch existentes",
  `  if (await pathExists(path.join(repoPath, ".git"))) {
    await runGit(["fetch", "--depth", "1", "origin", project.defaultBranch], repoPath);
    await runGit(["checkout", project.defaultBranch], repoPath);
    await runGit(["reset", "--hard", \`origin/\${project.defaultBranch}\`], repoPath);
  } else if (await pathExists(repoPath)) {
    await rm(repoPath, {force: true, recursive: true});
  }
`,
  `  if (await pathExists(path.join(repoPath, ".git"))) {
    const currentBranch = await runGit(["branch", "--show-current"], repoPath);
    if (!currentBranch) {
      throw new Error("Workspace Git esta em detached HEAD; Ralph nao criara uma branch automaticamente.");
    }
    addLog(state, run.id, "info", \`Reutilizando workspace na branch atual \${currentBranch}.\`);
  } else if (await pathExists(repoPath)) {
    await rm(repoPath, {force: true, recursive: true});
  }
`,
);

replaceExactly(
  "nao trocar branch no fallback",
  '    await runGit(["checkout", project.defaultBranch], repoPath);\n',
  '    addLog(state, run.id, "info", "Clone fallback concluido; mantendo a branch selecionada pelo Git.");\n',
);

replaceExactly(
  "capturar branch atual sem criar branch",
  `  await runGit(["checkout", "-B", branchName], repoPath);
  const changedOutput = await runGit(["status", "--short"], repoPath);
`,
  `  const activeBranch = await runGit(["branch", "--show-current"], repoPath);
  if (!activeBranch) {
    throw new Error("Repositorio em detached HEAD; commit local bloqueado e nenhuma branch sera criada automaticamente.");
  }
  const initialHead = await runGit(["rev-parse", "HEAD"], repoPath);
  const initialStatus = await runGit(["status", "--short"], repoPath);
  const initialBranches = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], repoPath);
  const changedOutput = initialStatus;
`,
);

replaceExactly(
  "retornar branch atual e HEAD inicial",
  '  return {changedFiles, diffSummary: diffSummary || "Sem diff."};\n',
  '  return {branchName: activeBranch, changedFiles, diffSummary: diffSummary || "Sem diff.", initialBranches, initialHead, initialStatus};\n',
);

replaceExactly(
  "usar branch do projeto apenas como expectativa inicial",
  '  const branchName = `ralph/task-${task.id.slice(0, 8)}`;\n',
  '  let branchName = task.branchName || project.defaultBranch;\n',
);

replaceExactly(
  "descrever politica de branch atual",
  '    aiThought: "Validando acesso ao repositorio e criando branch isolada para a story.",\n',
  '    aiThought: "Validando acesso ao repositorio e preservando a branch que ja esta ativa.",\n',
);

replaceExactly(
  "registrar branch real apos preparar Git",
  '    gitResult = await prepareGitWorkspace(state, run, project, task, workspacePath, branchName);\n',
  `    gitResult = await prepareGitWorkspace(state, run, project, task, workspacePath, branchName);
    branchName = gitResult.branchName;
    task.branchName = branchName;
    await writeWorkspaceFiles(workspacePath, project, task, run);
`,
);

const helperAnchor = `async function pathExists(targetPath) {
`;
const helper = `function parseStatusFiles(status) {
  return status
    .split("\\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const value = line.slice(3).trim();
      return value.includes(" -> ") ? value.split(" -> ").at(-1).trim() : value;
    });
}

function assertNoForbiddenFiles(files) {
  const blocked = files.filter((file) =>
    FORBIDDEN_PATHS.some((forbidden) => file === forbidden || file.includes(\`/\${forbidden}\`)),
  );
  if (blocked.length > 0) {
    throw new Error(\`Arquivos proibidos no diff: \${blocked.join(", ")}\`);
  }
}

async function commitWorkspaceChanges(workspacePath, task, expectedBranch, initialHead, initialStatus, initialBranches) {
  if (!GIT_ENABLED) {
    return {
      changedFiles: [],
      commitSha: null,
      diffSummary: "Git desabilitado; commit local nao executado.",
      summary: "Git desabilitado; commit local nao executado. Push nao realizado.",
    };
  }
  if (!GIT_AUTO_COMMIT_ENABLED) {
    return {
      changedFiles: [],
      commitSha: null,
      diffSummary: "Auto-commit local desabilitado por RALPH_GIT_AUTO_COMMIT_ENABLED=0.",
      summary: "Auto-commit local desabilitado. Push nao realizado.",
    };
  }

  const repoPath = path.join(workspacePath, "repo");
  const activeBranch = await runGit(["branch", "--show-current"], repoPath);
  if (!activeBranch) {
    throw new Error("Repositorio em detached HEAD; Ralph nao criara branch nem fara commit.");
  }
  if (activeBranch !== expectedBranch) {
    throw new Error(
      \`Branch alterada durante a execucao: esperada \${expectedBranch}, atual \${activeBranch}. Commit bloqueado.\`,
    );
  }

  const branchesAfter = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], repoPath);
  const beforeSet = new Set((initialBranches || "").split("\\n").filter(Boolean));
  const unexpectedBranches = branchesAfter.split("\\n").filter(Boolean).filter((branch) => !beforeSet.has(branch));
  if (unexpectedBranches.length > 0) {
    throw new Error(\`Provider criou branch nao autorizada: \${unexpectedBranches.join(", ")}\`);
  }

  const currentHead = await runGit(["rev-parse", "HEAD"], repoPath);
  const status = await runGit(["status", "--short"], repoPath);
  if ((initialStatus || "").trim() && status) {
    return {
      changedFiles: parseStatusFiles(status),
      commitSha: null,
      diffSummary: status,
      summary: "Workspace ja possuia alteracoes antes da execucao; auto-commit amplo foi bloqueado para nao misturar trabalho preexistente. Push nao realizado.",
    };
  }
  if (!status) {
    if (currentHead !== initialHead) {
      const diffSummary = await runGit(["show", "--stat", "--oneline", "--summary", currentHead], repoPath);
      return {
        changedFiles: [],
        commitSha: currentHead,
        diffSummary: diffSummary || \`Commit existente: \${currentHead}\`,
        summary: \`Provider criou commit local \${currentHead} na branch \${activeBranch}. Push nao realizado.\`,
      };
    }
    return {
      changedFiles: [],
      commitSha: null,
      diffSummary: "Nenhuma alteracao para commit.",
      summary: \`Nenhuma alteracao para commit na branch \${activeBranch}. Push nao realizado.\`,
    };
  }

  const changedFiles = parseStatusFiles(status);
  assertNoForbiddenFiles(changedFiles);
  await runGit(["add", "-A"], repoPath);
  const commitMessage = \`ralph: \${task.title}\`.slice(0, 180);
  await runGit(
    [
      "-c",
      "user.name=Ralph Orchestrator",
      "-c",
      "user.email=ralph-orchestrator@example.invalid",
      "commit",
      "-m",
      commitMessage,
    ],
    repoPath,
  );
  const commitSha = await runGit(["rev-parse", "HEAD"], repoPath);
  const nextStatus = await runGit(["status", "--short"], repoPath);
  if (nextStatus) {
    throw new Error(\`Commit criado, mas o workspace ainda possui alteracoes: \${nextStatus}\`);
  }
  const diffSummary = await runGit(["show", "--stat", "--oneline", "--summary", commitSha], repoPath);
  await writeFile(path.join(workspacePath, "DIFF_SUMMARY.txt"), diffSummary || \`Commit \${commitSha}\`);
  await writeFile(path.join(workspacePath, "CHANGED_FILES.json"), \`\${JSON.stringify(changedFiles, null, 2)}\\n\`);
  return {
    changedFiles,
    commitSha,
    diffSummary: diffSummary || \`Commit \${commitSha}\`,
    summary: \`Commit local \${commitSha} criado na branch \${activeBranch}. Push nao realizado.\`,
  };
}

`;
replaceExactly("inserir auto-commit local", helperAnchor, helper + helperAnchor);

replaceExactly(
  "commitar depois do provider",
  `  freshTask.status = "review";
`,
  `  let commitResult;
  try {
    commitResult = await commitWorkspaceChanges(
      workspacePath,
      freshTask,
      branchName,
      gitResult.initialHead,
      gitResult.initialStatus,
      gitResult.initialBranches,
    );
  } catch (error) {
    freshTask.status = "blocked";
    setTaskProgress(freshTask, {
      currentWork: "Commit local bloqueado pela politica Git.",
      aiThought: "A branch mudou, o repositorio ficou em detached HEAD ou o diff contem arquivo proibido.",
      progressPercent: 90,
    });
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = \`Falha ao criar commit local. \${sanitizeGitError(error)} Push nao realizado.\`;
    addLog(fresh, run.id, "error", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  freshTask.status = "review";
`,
);

replaceExactly(
  "atualizar mensagem de review",
  '    currentWork: "Aguardando review humano.",\n    aiThought: "Execucao terminou; revisar logs, diff e resultados antes de commit/push/PR.",\n',
  '    currentWork: "Aguardando review humano; commit local concluido quando havia alteracoes.",\n    aiThought: "Execucao terminou na branch original; push automatico nao foi realizado.",\n',
);

replaceExactly(
  "registrar commit e ausencia de push",
  '  freshRun.summary = `${providerResult.summary} Workspace e plano Git preparados; aguardando review humano.`;\n  freshRun.changedFiles = [...new Set([...gitResult.changedFiles, ...providerResult.changedFiles])];\n  freshRun.diffSummary = [gitResult.diffSummary, providerResult.diffSummary].filter(Boolean).join("\\n\\n");\n',
  '  freshRun.summary = `${providerResult.summary} ${commitResult.summary} Aguardando review humano.`;\n  freshRun.commitSha = commitResult.commitSha || undefined;\n  freshRun.changedFiles = [...new Set([...gitResult.changedFiles, ...providerResult.changedFiles, ...commitResult.changedFiles])];\n  freshRun.diffSummary = [gitResult.diffSummary, providerResult.diffSummary, commitResult.diffSummary].filter(Boolean).join("\\n\\n");\n',
);

await writeFile(outputPath, source);
console.log(`Worker com politica de branch atual gerado em ${outputPath}`);
