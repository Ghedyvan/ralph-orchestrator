#!/usr/bin/env node

import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import {providerReady, routeProvider, runProvider} from "./providers.mjs";

const ROOT = process.cwd();
const DATA_DIR = process.env.RALPH_DATA_DIR ? path.resolve(process.env.RALPH_DATA_DIR) : path.join(ROOT, "data");
const STATE_PATH = path.join(DATA_DIR, "orchestrator-state.json");
const STATE_BACKUP_DIR = path.join(DATA_DIR, "backups");
const STATE_BACKUP_LIMIT = 30;
const WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.RALPH_WORKER_INTERVAL_MS || 5000);
const TASK_TIMEOUT_MS = Number(process.env.RALPH_TASK_TIMEOUT_MS || 1000 * 60 * 30);
const REAL_RUN_ENABLED = process.env.RALPH_RUNNER_ENABLED === "1";
const GIT_ENABLED = process.env.RALPH_GIT_ENABLED === "1";
const FORBIDDEN_PATHS = (process.env.RALPH_FORBIDDEN_PATHS || ".env,.env.local,.ssh,id_rsa,id_ed25519")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ALLOWED_REPOS = (process.env.RALPH_ALLOWED_REPOS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ALLOWED_COMMANDS = (process.env.RALPH_ALLOWED_COMMANDS || "yarn lint,yarn typecheck,yarn build")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const GITHUB_TOKEN = process.env.RALPH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const execFileAsync = promisify(execFile);

const now = () => new Date().toISOString();
const backupStamp = () => now().replace(/[:.]/g, "-");

function initialState() {
  return {
    version: 1,
    projects: [],
    tasks: [],
    runs: [],
    logs: [],
    providers: [
      {provider: "manual", label: "Manual / Dry Run", requiresApiKey: false, executionMode: "dry-run", enabled: true},
      {provider: "codex", label: "Codex CLI", requiresApiKey: false, executionMode: "local-cli", enabled: Boolean(process.env.CODEX_COMMAND)},
      {provider: "opencode-go", label: "opencode go", requiresApiKey: false, executionMode: "local-cli", enabled: Boolean(process.env.OPENCODE_GO_COMMAND)},
      {provider: "mimo", label: "Mimo", requiresApiKey: true, apiKeyEnv: "MIMO_API_KEY", executionMode: "remote-api", enabled: false},
      {provider: "minimax", label: "Minimax", requiresApiKey: true, apiKeyEnv: "MINIMAX_API_KEY", executionMode: "remote-api", enabled: false},
      {provider: "zai", label: "Z.ai", requiresApiKey: true, apiKeyEnv: "ZAI_API_KEY", executionMode: "remote-api", enabled: Boolean(process.env.ZAI_API_KEY)},
      {provider: "deepseek", label: "DeepSeek", requiresApiKey: true, apiKeyEnv: "DEEPSEEK_API_KEY", executionMode: "remote-api", enabled: Boolean(process.env.DEEPSEEK_API_KEY)},
    ],
  };
}

async function readState() {
  await mkdir(DATA_DIR, {recursive: true});
  try {
    const state = await readJsonStateFile(STATE_PATH);
    if (!allowEmptyReset() && stateRecordCount(state) === 0) {
      const restored = await restoreStateFromBackup("arquivo atual vazio");
      if (restored) return restored;
      if (!allowEmptyBootstrap()) throw emptyStateError();
    }
    return state;
  } catch (error) {
    const restored = await restoreStateFromBackup(error?.code === "ENOENT" ? "arquivo ausente" : "arquivo invalido");
    if (restored) return restored;

    if (error?.code !== "ENOENT") throw error;
    if (!allowEmptyBootstrap()) throw stateBootstrapError();

    const state = initialState();
    await writeState(state);
    return state;
  }
}

async function writeState(state) {
  await mkdir(DATA_DIR, {recursive: true});
  if (!allowEmptyReset() && stateRecordCount(state) === 0) {
    try {
      const current = await readJsonStateFile(STATE_PATH);
      if (stateRecordCount(current) > 0) {
        throw new Error(
          "Recusando sobrescrever estado local com dados por estado vazio. " +
            "Defina RALPH_ALLOW_EMPTY_STATE_RESET=1 apenas se esta limpeza for intencional.",
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writeFileAtomic(STATE_PATH, contents);
  if (stateRecordCount(state) > 0) await writeStateBackup(contents);
}

function stateRecordCount(state) {
  return state.projects.length + state.tasks.length + state.runs.length + state.logs.length;
}

function withProviders(state) {
  return {...initialState(), ...state, providers: initialState().providers};
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function allowEmptyBootstrap() {
  return !isProduction() || process.env.RALPH_ALLOW_EMPTY_STATE === "1";
}

function allowEmptyReset() {
  return process.env.RALPH_ALLOW_EMPTY_STATE_RESET === "1";
}

async function readJsonStateFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return withProviders(JSON.parse(raw));
}

async function writeFileAtomic(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, contents);
  await rename(tempPath, filePath);
}

async function pruneStateBackups() {
  const entries = await readdir(STATE_BACKUP_DIR).catch(() => []);
  const backups = entries
    .filter((entry) => entry.startsWith("orchestrator-state-") && entry.endsWith(".json"))
    .sort()
    .reverse();

  await Promise.all(backups.slice(STATE_BACKUP_LIMIT).map((entry) => rm(path.join(STATE_BACKUP_DIR, entry), {force: true})));
}

async function writeStateBackup(contents) {
  await mkdir(STATE_BACKUP_DIR, {recursive: true});
  await writeFileAtomic(path.join(STATE_BACKUP_DIR, `orchestrator-state-${backupStamp()}.json`), contents);
  await pruneStateBackups();
}

async function latestNonEmptyStateBackup() {
  const entries = await readdir(STATE_BACKUP_DIR).catch(() => []);
  const backups = entries
    .filter((entry) => entry.startsWith("orchestrator-state-") && entry.endsWith(".json"))
    .sort()
    .reverse();

  for (const backup of backups) {
    try {
      const state = await readJsonStateFile(path.join(STATE_BACKUP_DIR, backup));
      if (stateRecordCount(state) > 0) return state;
    } catch {
      // Backup invalido; tenta o proximo snapshot.
    }
  }

  return null;
}

async function restoreStateFromBackup(reason) {
  const backup = await latestNonEmptyStateBackup();
  if (!backup) return null;

  const contents = `${JSON.stringify(backup, null, 2)}\n`;
  await writeFileAtomic(STATE_PATH, contents);
  await copyFile(STATE_PATH, path.join(DATA_DIR, `orchestrator-state.restored-${backupStamp()}.json`));
  console.warn(`Ralph restaurou o estado local a partir do backup mais recente: ${reason}.`);
  return backup;
}

function stateBootstrapError() {
  return new Error(
    "Estado local ausente em producao. Monte o volume persistente em /app/data ou defina RALPH_DATA_DIR. " +
      "Para inicializar um ambiente novo vazio, defina RALPH_ALLOW_EMPTY_STATE=1 conscientemente.",
  );
}

function emptyStateError() {
  return new Error(
    "Estado local vazio em producao sem permissao explicita. " +
      "Se este ambiente e novo, defina RALPH_ALLOW_EMPTY_STATE=1; se nao e novo, verifique backups e volume persistente.",
  );
}

function addLog(state, runId, level, message) {
  state.logs.push({id: randomUUID(), runId, level, message, createdAt: now()});
}

function storyLabel(task) {
  if (task.storyIndex && task.storyCount) return `story ${task.storyIndex}/${task.storyCount}`;
  return "task";
}

function setTaskProgress(task, {aiThought, currentWork, progressPercent}) {
  if (typeof progressPercent === "number") task.progressPercent = Math.max(0, Math.min(100, progressPercent));
  if (currentWork) task.currentWork = currentWork;
  if (aiThought) task.aiThought = aiThought;
  task.updatedAt = now();
}

function taskMetadataMarkdown(task) {
  return [
    task.storyGroupId ? `Story group: ${task.storyGroupId}` : null,
    task.storyIndex && task.storyCount ? `Story: ${task.storyIndex}/${task.storyCount}` : null,
    task.storyArea ? `Area: ${task.storyArea}` : null,
    task.storyParentTitle ? `Parent task: ${task.storyParentTitle}` : null,
    task.modelHint ? `Requested model: ${task.modelHint}` : null,
    typeof task.progressPercent === "number" ? `Progress: ${task.progressPercent}%` : null,
    task.currentWork ? `Current work: ${task.currentWork}` : null,
    task.aiThought ? `AI operational thought: ${task.aiThought}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function repoAllowed(repoUrl) {
  if (ALLOWED_REPOS.length === 0) return true;
  return ALLOWED_REPOS.some((allowed) => repoUrl.includes(allowed));
}

async function writeWorkspaceFiles(workspacePath, project, task, run) {
  await mkdir(workspacePath, {recursive: true});
  await writeFile(
    path.join(workspacePath, "TASK.md"),
    `# ${task.title}\n\nProject: ${project.name}\nRepo: ${project.repoUrl}\nProvider: ${task.provider}\n${taskMetadataMarkdown(task)}\n\n## Prompt\n\n${task.prompt}\n`,
  );
  await writeFile(path.join(workspacePath, "RUN.json"), `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(
    path.join(workspacePath, "GIT_PLAN.md"),
    `# Git Plan\n\nRepo: ${project.repoUrl}\nBranch: ${task.branchName}\nMode: ${REAL_RUN_ENABLED ? "real-enabled" : "safe-dry-run"}\n\nForbidden paths:\n${FORBIDDEN_PATHS.map((item) => `- ${item}`).join("\n")}\n`,
  );
  await writeFile(
    path.join(workspacePath, "SECURITY_POLICY.md"),
    `# Security Policy\n\nAllowed repos:\n${ALLOWED_REPOS.length ? ALLOWED_REPOS.map((item) => `- ${item}`).join("\n") : "- all (not recommended for production)"}\n\nAllowed commands:\n${ALLOWED_COMMANDS.map((item) => `- ${item}`).join("\n")}\n\nForbidden paths:\n${FORBIDDEN_PATHS.map((item) => `- ${item}`).join("\n")}\n`,
  );
}

async function runGit(args, cwd) {
  const {stdout, stderr} = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GCM_INTERACTIVE: "never",
      GIT_TERMINAL_PROMPT: "0",
    },
    timeout: 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 10,
  });
  return `${stdout}${stderr}`.trim();
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeGitError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const sanitized = GITHUB_TOKEN ? message.replaceAll(GITHUB_TOKEN, "[redacted]") : message;
  return sanitized
    .replace(/x-access-token:[^@\\s]+@/g, "x-access-token:[redacted]@")
    .replace(/Authorization: Bearer\s+[^\s]+/gi, "Authorization: Bearer [redacted]")
    .replace(/Authorization: Basic\s+[A-Za-z0-9+/=]+/gi, "Authorization: Basic [redacted]")
    .slice(0, 2000);
}

function gitErrorText(error) {
  const parts = [
    error?.message,
    error?.stderr,
    error?.stdout,
  ].filter(Boolean);
  return parts.join("\n");
}

function isGitAuthFailure(error) {
  const text = gitErrorText(error).toLowerCase();
  return [
    "could not read username",
    "authentication failed",
    "repository not found",
    "terminal prompts disabled",
    "support for password authentication was removed",
  ].some((item) => text.includes(item));
}

function gitAuthHint(repoUrl) {
  if (!repoUrl.startsWith("https://github.com/")) return "";
  if (!GITHUB_TOKEN) {
    return " Configure RALPH_GITHUB_TOKEN, GITHUB_TOKEN ou GH_TOKEN no worker com acesso de leitura ao repositorio.";
  }
  return " Verifique se o token configurado no worker tem acesso de leitura ao repositorio.";
}

function cloneArgs(repoUrl, repoPath, branchName) {
  const baseArgs = ["clone", "--depth", "1"];
  if (branchName) baseArgs.push("--branch", branchName);
  if (GITHUB_TOKEN && repoUrl.startsWith("https://github.com/")) {
    const basicToken = Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString("base64");
    baseArgs.push("-c", `http.https://github.com/.extraheader=Authorization: Basic ${basicToken}`);
  }
  return [...baseArgs, repoUrl, repoPath];
}

async function prepareGitWorkspace(state, run, project, task, workspacePath, branchName) {
  const repoPath = path.join(workspacePath, "repo");
  if (!GIT_ENABLED) {
    addLog(state, run.id, "info", "Git real desabilitado. Defina RALPH_GIT_ENABLED=1 para clone/fetch.");
    return {changedFiles: [], diffSummary: "Git dry-run: clone/fetch nao executado."};
  }

  await mkdir(workspacePath, {recursive: true});
  if (await pathExists(path.join(repoPath, ".git"))) {
    await runGit(["fetch", "--depth", "1", "origin", project.defaultBranch], repoPath);
    await runGit(["checkout", project.defaultBranch], repoPath);
    await runGit(["reset", "--hard", `origin/${project.defaultBranch}`], repoPath);
  } else if (await pathExists(repoPath)) {
    await rm(repoPath, {force: true, recursive: true});
  }

  try {
    if (!(await pathExists(repoPath))) {
      await runGit(cloneArgs(project.repoUrl, repoPath, project.defaultBranch), ROOT);
    }
  } catch (error) {
    if (isGitAuthFailure(error)) {
      throw new Error(`Clone Git falhou por autenticacao/acesso.${gitAuthHint(project.repoUrl)} ${sanitizeGitError(error)}`);
    }
    addLog(state, run.id, "warn", `Clone com branch ${project.defaultBranch} falhou; tentando clone default. ${sanitizeGitError(error)}`);
    try {
      await runGit(cloneArgs(project.repoUrl, repoPath), ROOT);
    } catch (fallbackError) {
      if (isGitAuthFailure(fallbackError)) {
        throw new Error(`Clone Git falhou por autenticacao/acesso.${gitAuthHint(project.repoUrl)} ${sanitizeGitError(fallbackError)}`);
      }
      throw fallbackError;
    }
    await runGit(["checkout", project.defaultBranch], repoPath);
  }
  await runGit(["checkout", "-B", branchName], repoPath);
  const changedOutput = await runGit(["status", "--short"], repoPath);
  const diffSummary = await runGit(["diff", "--stat"], repoPath);
  const changedFiles = changedOutput
    .split("\n")
    .map((line) => line.trim().slice(3).trim())
    .filter(Boolean);
  await writeFile(path.join(workspacePath, "DIFF_SUMMARY.txt"), diffSummary || "Sem diff.");
  await writeFile(path.join(workspacePath, "CHANGED_FILES.json"), `${JSON.stringify(changedFiles, null, 2)}\n`);
  addLog(state, run.id, "info", `Git workspace pronto em ${repoPath}. Push automatico desabilitado.`);
  return {changedFiles, diffSummary: diffSummary || "Sem diff."};
}

function runningProjectIds(state) {
  return new Set(state.tasks.filter((item) => item.status === "running").map((item) => item.projectId));
}

function expireStaleRuns(state) {
  const cutoff = Date.now() - TASK_TIMEOUT_MS;
  let changed = false;
  for (const task of state.tasks) {
    if (task.status !== "running") continue;
    if (new Date(task.updatedAt).getTime() > cutoff) continue;
    task.status = "failed";
    setTaskProgress(task, {
      currentWork: "Timeout de task atingido.",
      aiThought: "Bloqueio operacional: execucao excedeu tempo maximo configurado.",
      progressPercent: task.progressPercent ?? 0,
    });
    const run = state.runs.find((item) => item.taskId === task.id && item.status === "running");
    if (run) {
      run.status = "failed";
      run.finishedAt = now();
      run.summary = "Timeout de task atingido.";
      addLog(state, run.id, "error", run.summary);
    }
    changed = true;
  }
  return changed;
}

async function processOne() {
  const state = await readState();
  if (expireStaleRuns(state)) await writeState(state);
  const lockedProjects = runningProjectIds(state);
  const task = state.tasks
    .filter((item) => item.status === "queued" && !lockedProjects.has(item.projectId))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];

  if (!task) return false;

  const project = state.projects.find((item) => item.id === task.projectId);
  if (!project || project.status !== "active") {
    task.status = "blocked";
    setTaskProgress(task, {
      currentWork: "Projeto indisponivel para execucao.",
      aiThought: "Bloqueio operacional: projeto ausente ou pausado precisa ser corrigido antes de executar.",
      progressPercent: task.progressPercent ?? 0,
    });
    await writeState(state);
    return true;
  }

  const selectedProvider = routeProvider(task);
  const provider = state.providers.find((item) => item.provider === selectedProvider);
  const workspacePath = path.join(WORKSPACES_DIR, project.id, task.id);
  const branchName = `ralph/task-${task.id.slice(0, 8)}`;
  const run = {
    id: randomUUID(),
    taskId: task.id,
    projectId: project.id,
    provider: selectedProvider,
    status: "running",
    workspacePath,
    startedAt: now(),
  };

  task.status = "running";
  task.branchName = branchName;
  task.workspacePath = workspacePath;
  setTaskProgress(task, {
    currentWork: "Preparando workspace e arquivos Ralph.",
    aiThought: `Executando ${storyLabel(task)} com provider ${selectedProvider}.`,
    progressPercent: 10,
  });
  state.runs.push(run);
  addLog(state, run.id, "info", `Run iniciado para task ${task.id}.`);
  if (!repoAllowed(project.repoUrl)) {
    task.status = "blocked";
    setTaskProgress(task, {
      currentWork: "Repositorio bloqueado por politica.",
      aiThought: "Bloqueio operacional: RALPH_ALLOWED_REPOS nao permite este repositorio.",
      progressPercent: 10,
    });
    run.status = "failed";
    run.finishedAt = now();
    run.summary = "Repositorio bloqueado por RALPH_ALLOWED_REPOS.";
    addLog(state, run.id, "error", run.summary);
    await writeState(state);
    return true;
  }
  await writeState(state);
  await writeWorkspaceFiles(workspacePath, project, task, run);
  setTaskProgress(task, {
    currentWork: "Preparando workspace Git.",
    aiThought: "Validando acesso ao repositorio e criando branch isolada para a story.",
    progressPercent: 25,
  });
  let gitResult;
  try {
    gitResult = await prepareGitWorkspace(state, run, project, task, workspacePath, branchName);
  } catch (error) {
    task.status = "blocked";
    setTaskProgress(task, {
      currentWork: "Bloqueado ao preparar Git workspace.",
      aiThought: "Bloqueio operacional: acesso Git/autenticacao precisa acao antes da execucao.",
      progressPercent: 30,
    });
    run.status = "failed";
    run.finishedAt = now();
    run.summary = `Falha ao preparar Git workspace. ${sanitizeGitError(error)}`;
    addLog(state, run.id, "error", run.summary);
    await writeState(state);
    return true;
  }
  setTaskProgress(task, {
    currentWork: "Workspace Git pronto; avaliando provider.",
    aiThought: "Repositorio preparado; proxima etapa e chamar o provider responsavel pela story.",
    progressPercent: 45,
  });
  await writeState(state);

  const fresh = await readState();
  const freshTask = fresh.tasks.find((item) => item.id === task.id);
  const freshRun = fresh.runs.find((item) => item.id === run.id);
  if (!freshTask || !freshRun) return true;

  if (!providerReady(selectedProvider, freshTask) && selectedProvider !== "manual") {
    freshTask.status = "blocked";
    setTaskProgress(freshTask, {
      currentWork: `Provider ${selectedProvider} indisponivel.`,
      aiThought: "Bloqueio operacional: configure adapter/env vars do provider antes da execucao real.",
      progressPercent: 50,
    });
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = `Provider ${selectedProvider} desabilitado. Configure adapter e env var antes de execucao real.`;
    addLog(fresh, run.id, "warn", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  if (provider?.executionMode !== "dry-run" && !REAL_RUN_ENABLED) {
    freshTask.status = "blocked";
    setTaskProgress(freshTask, {
      currentWork: "Execucao real bloqueada por politica.",
      aiThought: "Bloqueio operacional: habilite RALPH_RUNNER_ENABLED apenas em VPS preparada.",
      progressPercent: 50,
    });
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = "Execucao real bloqueada. Defina RALPH_RUNNER_ENABLED=1 somente em VPS preparada.";
    addLog(fresh, run.id, "warn", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  let providerResult;
  try {
    setTaskProgress(freshTask, {
      currentWork: `Chamando provider ${selectedProvider}.`,
      aiThought: `Story roteada para ${freshTask.modelHint ?? selectedProvider}; aguardando resposta do agente.`,
      progressPercent: 65,
    });
    await writeState(fresh);
    providerResult = await runProvider({
      provider: selectedProvider,
      project,
      run: freshRun,
      task: freshTask,
      workspacePath,
    });
  } catch (error) {
    freshTask.status = "blocked";
    setTaskProgress(freshTask, {
      currentWork: `Provider ${selectedProvider} falhou.`,
      aiThought: "Bloqueio operacional: provider retornou erro antes de concluir a story.",
      progressPercent: 70,
    });
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = `Provider ${selectedProvider} falhou. ${sanitizeGitError(error)}`;
    addLog(fresh, run.id, "error", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  if (!providerResult.ok && providerResult.blocked) {
    freshTask.status = "blocked";
    setTaskProgress(freshTask, {
      currentWork: providerResult.summary,
      aiThought: "Bloqueio operacional: provider recusou ou ficou indisponivel; revisar configuracao.",
      progressPercent: 70,
    });
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = providerResult.summary;
    freshRun.changedFiles = providerResult.changedFiles;
    freshRun.diffSummary = providerResult.diffSummary;
    addLog(fresh, run.id, "warn", providerResult.summary);
    await writeState(fresh);
    return true;
  }

  freshTask.status = "review";
  freshTask.branchName = branchName;
  freshTask.workspacePath = workspacePath;
  setTaskProgress(freshTask, {
    currentWork: "Aguardando review humano.",
    aiThought: "Execucao terminou; revisar logs, diff e resultados antes de commit/push/PR.",
    progressPercent: 100,
  });
  freshRun.status = "completed";
  freshRun.finishedAt = now();
  freshRun.summary = `${providerResult.summary} Workspace e plano Git preparados; aguardando review humano.`;
  freshRun.changedFiles = [...new Set([...gitResult.changedFiles, ...providerResult.changedFiles])];
  freshRun.diffSummary = [gitResult.diffSummary, providerResult.diffSummary].filter(Boolean).join("\n\n");
  addLog(fresh, run.id, "info", freshRun.summary);
  await writeState(fresh);
  return true;
}

async function main() {
  console.log(`Ralph worker iniciado. once=${ONCE} realRun=${REAL_RUN_ENABLED}`);
  do {
    const processed = await processOne();
    if (ONCE) {
      console.log(processed ? "Task processada." : "Fila vazia.");
      return;
    }
    if (!processed) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
