export const AGENT_PROVIDERS = [
  "manual",
  "codex",
  "opencode-go",
  "mimo",
  "minimax",
  "zai",
  "deepseek",
] as const;
export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;
export const TASK_STATUSES = [
  "queued",
  "running",
  "blocked",
  "failed",
  "completed",
  "review",
  "cancelled",
] as const;
export const RUN_STATUSES = ["created", "running", "failed", "completed"] as const;
export const TASK_STORY_AREAS = ["scope", "backend", "frontend", "validation", "docs", "review", "general"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type TaskStoryArea = (typeof TASK_STORY_AREAS)[number];

export type Project = {
  id: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  localPath?: string;
  defaultProvider?: AgentProvider;
  validationCommands?: string[];
  autonomyLevel?: "low" | "medium" | "high";
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  provider: AgentProvider;
  status: TaskStatus;
  priority: number;
  branchName?: string;
  workspacePath?: string;
  storyGroupId?: string;
  storyParentTitle?: string;
  storyIndex?: number;
  storyCount?: number;
  storyArea?: TaskStoryArea;
  modelHint?: string;
  progressPercent?: number;
  currentWork?: string;
  // Operational summary for UI, not raw hidden chain-of-thought.
  aiThought?: string;
  createdAt: string;
  updatedAt: string;
};

export type RunLog = {
  id: string;
  runId: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
};

export type Run = {
  id: string;
  taskId: string;
  projectId: string;
  provider: AgentProvider;
  status: RunStatus;
  workspacePath: string;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  changedFiles?: string[];
  diffSummary?: string;
  commitSha?: string;
  remoteBranch?: string;
  prUrl?: string;
  gitStatus?: string;
};

export type ProviderPolicy = {
  provider: AgentProvider;
  label: string;
  requiresApiKey: boolean;
  apiKeyEnv?: string;
  executionMode: "dry-run" | "local-cli" | "remote-api";
  enabled: boolean;
};

export type OrchestratorState = {
  version: number;
  projects: Project[];
  tasks: Task[];
  runs: Run[];
  logs: RunLog[];
  providers: ProviderPolicy[];
};

export type DashboardSnapshot = OrchestratorState & {
  totals: {
    projects: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
};
