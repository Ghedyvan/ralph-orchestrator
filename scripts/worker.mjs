#!/usr/bin/env node

import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import {providerReady, routeProvider, runProvider} from "./providers.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATE_PATH = path.join(DATA_DIR, "orchestrator-state.json");
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
    const raw = await readFile(STATE_PATH, "utf8");
    return {...initialState(), ...JSON.parse(raw), providers: initialState().providers};
  } catch {
    const state = initialState();
    await writeState(state);
    return state;
  }
}

async function writeState(state) {
  await mkdir(DATA_DIR, {recursive: true});
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function addLog(state, runId, level, message) {
  state.logs.push({id: randomUUID(), runId, level, message, createdAt: now()});
}

function repoAllowed(repoUrl) {
  if (ALLOWED_REPOS.length === 0) return true;
  return ALLOWED_REPOS.some((allowed) => repoUrl.includes(allowed));
}

async function writeWorkspaceFiles(workspacePath, project, task, run) {
  await mkdir(workspacePath, {recursive: true});
  await writeFile(
    path.join(workspacePath, "TASK.md"),
    `# ${task.title}\n\nProject: ${project.name}\nRepo: ${project.repoUrl}\nProvider: ${task.provider}\n\n## Prompt\n\n${task.prompt}\n`,
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
  try {
    await runGit(cloneArgs(project.repoUrl, repoPath, project.defaultBranch), ROOT);
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
    task.updatedAt = now();
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
    task.updatedAt = now();
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
  task.updatedAt = now();
  state.runs.push(run);
  addLog(state, run.id, "info", `Run iniciado para task ${task.id}.`);
  if (!repoAllowed(project.repoUrl)) {
    task.status = "blocked";
    run.status = "failed";
    run.finishedAt = now();
    run.summary = "Repositorio bloqueado por RALPH_ALLOWED_REPOS.";
    addLog(state, run.id, "error", run.summary);
    await writeState(state);
    return true;
  }
  await writeState(state);
  await writeWorkspaceFiles(workspacePath, project, task, run);
  let gitResult;
  try {
    gitResult = await prepareGitWorkspace(state, run, project, task, workspacePath, branchName);
  } catch (error) {
    task.status = "blocked";
    task.updatedAt = now();
    run.status = "failed";
    run.finishedAt = now();
    run.summary = `Falha ao preparar Git workspace. ${sanitizeGitError(error)}`;
    addLog(state, run.id, "error", run.summary);
    await writeState(state);
    return true;
  }
  await writeState(state);

  const fresh = await readState();
  const freshTask = fresh.tasks.find((item) => item.id === task.id);
  const freshRun = fresh.runs.find((item) => item.id === run.id);
  if (!freshTask || !freshRun) return true;

  if (!providerReady(selectedProvider) && selectedProvider !== "manual") {
    freshTask.status = "blocked";
    freshTask.updatedAt = now();
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = `Provider ${selectedProvider} desabilitado. Configure adapter e env var antes de execucao real.`;
    addLog(fresh, run.id, "warn", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  if (provider?.executionMode !== "dry-run" && !REAL_RUN_ENABLED) {
    freshTask.status = "blocked";
    freshTask.updatedAt = now();
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = "Execucao real bloqueada. Defina RALPH_RUNNER_ENABLED=1 somente em VPS preparada.";
    addLog(fresh, run.id, "warn", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  let providerResult;
  try {
    providerResult = await runProvider({
      provider: selectedProvider,
      project,
      run: freshRun,
      task: freshTask,
      workspacePath,
    });
  } catch (error) {
    freshTask.status = "blocked";
    freshTask.updatedAt = now();
    freshRun.status = "failed";
    freshRun.finishedAt = now();
    freshRun.summary = `Provider ${selectedProvider} falhou. ${sanitizeGitError(error)}`;
    addLog(fresh, run.id, "error", freshRun.summary);
    await writeState(fresh);
    return true;
  }

  if (!providerResult.ok && providerResult.blocked) {
    freshTask.status = "blocked";
    freshTask.updatedAt = now();
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
  freshTask.updatedAt = now();
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
