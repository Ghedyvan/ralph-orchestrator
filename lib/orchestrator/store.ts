import type {
  AgentProvider,
  DashboardSnapshot,
  OrchestratorState,
  Project,
  Run,
  RunLog,
  Task,
} from "@/lib/orchestrator/types";

import {createSupabaseServerClient, isSupabaseConfigured} from "@/lib/orchestrator/supabase";
import {randomUUID} from "node:crypto";
import {copyFile, mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.RALPH_DATA_DIR
  ? path.resolve(process.env.RALPH_DATA_DIR)
  : path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "orchestrator-state.json");
const STATE_BACKUP_DIR = path.join(DATA_DIR, "backups");
const STATE_BACKUP_LIMIT = 30;

const now = () => new Date().toISOString();
const backupStamp = () => now().replace(/[:.]/g, "-");

type ProjectRow = {
  id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  local_path: string | null;
  default_provider?: AgentProvider | null;
  validation_commands?: string[] | null;
  autonomy_level?: Project["autonomyLevel"] | null;
  status: Project["status"];
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  prompt: string;
  provider: Task["provider"];
  status: Task["status"];
  priority: number;
  branch_name?: string | null;
  workspace_path?: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  task_id: string;
  project_id: string;
  provider: Run["provider"];
  status: Run["status"];
  workspace_path: string;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  changed_files?: string[] | null;
  diff_summary?: string | null;
  commit_sha?: string | null;
  remote_branch?: string | null;
  pr_url?: string | null;
  git_status?: string | null;
};

type LogRow = {
  id: string;
  run_id: string;
  level: RunLog["level"];
  message: string;
  created_at: string;
};

const projectFromRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  repoUrl: row.repo_url,
  defaultBranch: row.default_branch,
  localPath: row.local_path ?? undefined,
  defaultProvider: row.default_provider ?? undefined,
  validationCommands: row.validation_commands ?? undefined,
  autonomyLevel: row.autonomy_level ?? undefined,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const taskFromRow = (row: TaskRow): Task => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  prompt: row.prompt,
  provider: row.provider,
  status: row.status,
  priority: row.priority,
  branchName: row.branch_name ?? undefined,
  workspacePath: row.workspace_path ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const runFromRow = (row: RunRow): Run => ({
  id: row.id,
  taskId: row.task_id,
  projectId: row.project_id,
  provider: row.provider,
  status: row.status,
  workspacePath: row.workspace_path,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  summary: row.summary ?? undefined,
  changedFiles: row.changed_files ?? undefined,
  diffSummary: row.diff_summary ?? undefined,
  commitSha: row.commit_sha ?? undefined,
  remoteBranch: row.remote_branch ?? undefined,
  prUrl: row.pr_url ?? undefined,
  gitStatus: row.git_status ?? undefined,
});

const logFromRow = (row: LogRow): RunLog => ({
  id: row.id,
  runId: row.run_id,
  level: row.level,
  message: row.message,
  createdAt: row.created_at,
});

const initialState = (): OrchestratorState => ({
  version: 1,
  projects: [],
  tasks: [],
  runs: [],
  logs: [],
  providers: [
    {
      provider: "manual",
      label: "Manual / Dry Run",
      requiresApiKey: false,
      executionMode: "dry-run",
      enabled: true,
    },
    {
      provider: "codex",
      label: "Codex CLI",
      requiresApiKey: false,
      executionMode: "local-cli",
      enabled: Boolean(process.env.CODEX_COMMAND),
    },
    {
      provider: "opencode-go",
      label: "opencode go",
      requiresApiKey: false,
      executionMode: "local-cli",
      enabled: Boolean(process.env.OPENCODE_GO_COMMAND),
    },
    {
      provider: "mimo",
      label: "Mimo",
      requiresApiKey: true,
      apiKeyEnv: "MIMO_API_KEY",
      executionMode: "remote-api",
      enabled: Boolean(process.env.MIMO_API_KEY && process.env.MIMO_API_URL && process.env.MIMO_MODEL),
    },
    {
      provider: "minimax",
      label: "Minimax",
      requiresApiKey: true,
      apiKeyEnv: "MINIMAX_API_KEY",
      executionMode: "remote-api",
      enabled: Boolean(
        process.env.MINIMAX_API_KEY && process.env.MINIMAX_API_URL && process.env.MINIMAX_MODEL,
      ),
    },
    {
      provider: "zai",
      label: "Z.ai",
      requiresApiKey: true,
      apiKeyEnv: "ZAI_API_KEY",
      executionMode: "remote-api",
      enabled: Boolean(process.env.ZAI_API_KEY),
    },
    {
      provider: "deepseek",
      label: "DeepSeek",
      requiresApiKey: true,
      apiKeyEnv: "DEEPSEEK_API_KEY",
      executionMode: "remote-api",
      enabled: Boolean(process.env.DEEPSEEK_API_KEY),
    },
  ],
});

async function ensureDataDir() {
  await mkdir(DATA_DIR, {recursive: true});
}

const stateRecordCount = (state: Pick<OrchestratorState, "logs" | "projects" | "runs" | "tasks">) =>
  state.projects.length + state.tasks.length + state.runs.length + state.logs.length;

const isProduction = () => process.env.NODE_ENV === "production";
const allowEmptyBootstrap = () => !isProduction() || process.env.RALPH_ALLOW_EMPTY_STATE === "1";
const allowEmptyReset = () => process.env.RALPH_ALLOW_EMPTY_STATE_RESET === "1";

function stateWithProviders(state: OrchestratorState): OrchestratorState {
  return {
    ...initialState(),
    ...state,
    providers: initialState().providers,
  };
}

async function readJsonStateFile(filePath: string): Promise<OrchestratorState> {
  const raw = await readFile(filePath, "utf8");
  return stateWithProviders(JSON.parse(raw) as OrchestratorState);
}

async function writeFileAtomic(filePath: string, contents: string) {
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

  await Promise.all(
    backups.slice(STATE_BACKUP_LIMIT).map((entry) => rm(path.join(STATE_BACKUP_DIR, entry), {force: true})),
  );
}

async function writeStateBackup(contents: string) {
  await mkdir(STATE_BACKUP_DIR, {recursive: true});
  await writeFileAtomic(path.join(STATE_BACKUP_DIR, `orchestrator-state-${backupStamp()}.json`), contents);
  await pruneStateBackups();
}

async function latestNonEmptyStateBackup(): Promise<OrchestratorState | null> {
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
      // Ignore invalid backup snapshots and continue looking for a usable one.
    }
  }

  return null;
}

async function restoreStateFromBackup(reason: string): Promise<OrchestratorState | null> {
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

export async function readState(): Promise<OrchestratorState> {
  const supabase = createSupabaseServerClient();
  if (supabase) {
    const [projects, tasks, runs, logs] = await Promise.all([
      supabase.from("ralph_projects").select("*").order("created_at", {ascending: false}),
      supabase.from("ralph_tasks").select("*").order("created_at", {ascending: false}),
      supabase.from("ralph_runs").select("*").order("started_at", {ascending: false}),
      supabase.from("ralph_logs").select("*").order("created_at", {ascending: true}),
    ]);

    if (projects.error) throw new Error(projects.error.message);
    if (tasks.error) throw new Error(tasks.error.message);
    if (runs.error) throw new Error(runs.error.message);
    if (logs.error) throw new Error(logs.error.message);

    return {
      ...initialState(),
      projects: ((projects.data ?? []) as ProjectRow[]).map(projectFromRow),
      tasks: ((tasks.data ?? []) as TaskRow[]).map(taskFromRow),
      runs: ((runs.data ?? []) as RunRow[]).map(runFromRow),
      logs: ((logs.data ?? []) as LogRow[]).map(logFromRow),
    };
  }

  await ensureDataDir();

  try {
    const state = await readJsonStateFile(STATE_PATH);
    if (!allowEmptyReset() && stateRecordCount(state) === 0) {
      const restored = await restoreStateFromBackup("arquivo atual vazio");
      if (restored) return restored;
      if (!allowEmptyBootstrap()) throw emptyStateError();
    }
    return state;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const restored = await restoreStateFromBackup(code === "ENOENT" ? "arquivo ausente" : "arquivo invalido");
    if (restored) return restored;

    if (code !== "ENOENT") throw error;
    if (!allowEmptyBootstrap()) throw stateBootstrapError();

    const state = initialState();
    await writeState(state);
    return state;
  }
}

export async function writeState(state: OrchestratorState) {
  if (isSupabaseConfigured()) {
    throw new Error("writeState em massa nao suportado com Supabase. Use operacoes especificas.");
  }

  await ensureDataDir();
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
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writeFileAtomic(STATE_PATH, contents);
  if (stateRecordCount(state) > 0) await writeStateBackup(contents);
}

export async function getSnapshot(): Promise<DashboardSnapshot> {
  const state = await readState();

  return {
    ...state,
    totals: {
      projects: state.projects.filter((project) => project.status === "active").length,
      queued: state.tasks.filter((task) => task.status === "queued").length,
      running: state.tasks.filter((task) => task.status === "running").length,
      completed: state.tasks.filter((task) => task.status === "completed").length,
      failed: state.tasks.filter((task) => task.status === "failed").length,
    },
  };
}

export async function createProject(input: {
  autonomyLevel?: Project["autonomyLevel"];
  defaultBranch?: string;
  defaultProvider?: AgentProvider;
  localPath?: string;
  name: string;
  repoUrl: string;
  validationCommands?: string[];
}): Promise<Project> {
  const name = input.name.trim();
  const repoUrl = input.repoUrl.trim();
  if (!name) throw new Error("Nome do projeto obrigatorio.");
  if (!repoUrl) throw new Error("URL do repositorio obrigatoria.");

  const state = await readState();
  const timestamp = now();
  const project: Project = {
    id: randomUUID(),
    name,
    repoUrl,
    defaultBranch: input.defaultBranch?.trim() || "main",
    localPath: input.localPath?.trim() || undefined,
    defaultProvider: input.defaultProvider ?? "manual",
    validationCommands: input.validationCommands?.length ? input.validationCommands : ["yarn lint", "yarn typecheck"],
    autonomyLevel: input.autonomyLevel ?? "medium",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const supabase = createSupabaseServerClient();
  if (supabase) {
    const {error} = await supabase.from("ralph_projects").insert({
      id: project.id,
      name: project.name,
      repo_url: project.repoUrl,
      default_branch: project.defaultBranch,
      local_path: project.localPath ?? null,
      default_provider: project.defaultProvider ?? null,
      validation_commands: project.validationCommands ?? null,
      autonomy_level: project.autonomyLevel ?? null,
      status: project.status,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    });
    if (error) throw new Error(error.message);
    return project;
  }

  state.projects.unshift(project);
  await writeState(state);
  return project;
}

export async function createTask(input: {
  priority?: number;
  projectId: string;
  prompt: string;
  provider?: AgentProvider;
  title: string;
}): Promise<Task> {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title) throw new Error("Titulo da task obrigatorio.");
  if (!prompt) throw new Error("Prompt da task obrigatorio.");

  const state = await readState();
  const project = state.projects.find((item) => item.id === input.projectId);
  if (!project) throw new Error("Projeto nao encontrado.");

  const provider = input.provider ?? "manual";
  const policy = state.providers.find((item) => item.provider === provider);
  if (!policy) throw new Error("Provider invalido.");

  const timestamp = now();
  const task: Task = {
    id: randomUUID(),
    projectId: project.id,
    title,
    prompt,
    provider,
    status: "queued",
    priority: input.priority ?? 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const supabase = createSupabaseServerClient();
  if (supabase) {
    const {error} = await supabase.from("ralph_tasks").insert({
      id: task.id,
      project_id: task.projectId,
      title: task.title,
      prompt: task.prompt,
      provider: task.provider,
      status: task.status,
      priority: task.priority,
      branch_name: task.branchName ?? null,
      workspace_path: task.workspacePath ?? null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });
    if (error) throw new Error(error.message);
    return task;
  }

  state.tasks.unshift(task);
  await writeState(state);
  return task;
}

export async function appendLog(input: Omit<RunLog, "id" | "createdAt">): Promise<RunLog> {
  const log: RunLog = {
    id: randomUUID(),
    createdAt: now(),
    ...input,
  };

  const supabase = createSupabaseServerClient();
  if (supabase) {
    const {error} = await supabase.from("ralph_logs").insert({
      id: log.id,
      run_id: log.runId,
      level: log.level,
      message: log.message,
      created_at: log.createdAt,
    });
    if (error) throw new Error(error.message);
    return log;
  }

  const state = await readState();
  state.logs.push(log);
  await writeState(state);
  return log;
}

export async function updateRun(run: Run) {
  const supabase = createSupabaseServerClient();
  if (supabase) {
    const {error} = await supabase.from("ralph_runs").upsert({
      id: run.id,
      task_id: run.taskId,
      project_id: run.projectId,
      provider: run.provider,
      status: run.status,
      workspace_path: run.workspacePath,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      summary: run.summary ?? null,
      changed_files: run.changedFiles ?? null,
      diff_summary: run.diffSummary ?? null,
      commit_sha: run.commitSha ?? null,
      remote_branch: run.remoteBranch ?? null,
      pr_url: run.prUrl ?? null,
      git_status: run.gitStatus ?? null,
    });
    if (error) throw new Error(error.message);
    return;
  }

  const state = await readState();
  const index = state.runs.findIndex((item) => item.id === run.id);
  if (index >= 0) state.runs[index] = run;
  else state.runs.push(run);
  await writeState(state);
}

export async function updateTask(task: Task) {
  const updatedAt = now();
  const nextTask = {...task, updatedAt};
  const supabase = createSupabaseServerClient();
  if (supabase) {
    const {error} = await supabase
      .from("ralph_tasks")
      .update({
        title: nextTask.title,
        prompt: nextTask.prompt,
        provider: nextTask.provider,
        status: nextTask.status,
        priority: nextTask.priority,
        branch_name: nextTask.branchName ?? null,
        workspace_path: nextTask.workspacePath ?? null,
        updated_at: nextTask.updatedAt,
      })
      .eq("id", nextTask.id);
    if (error) throw new Error(error.message);
    return;
  }

  const state = await readState();
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index < 0) throw new Error("Task nao encontrada.");
  state.tasks[index] = nextTask;
  await writeState(state);
}

export async function patchTask(taskId: string, patch: Partial<Task>) {
  const state = await readState();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task nao encontrada.");
  await updateTask({...task, ...patch});
}
