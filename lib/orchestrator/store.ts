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
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "orchestrator-state.json");

const now = () => new Date().toISOString();

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
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as OrchestratorState;
    return {
      ...initialState(),
      ...parsed,
      providers: initialState().providers,
    };
  } catch {
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
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
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
