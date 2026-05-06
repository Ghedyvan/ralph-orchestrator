import type {Run, Task} from "@/lib/orchestrator/types";

import {execFile} from "node:child_process";
import {access, realpath} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

const WORKSPACES_DIR = path.join(process.cwd(), "data", "workspaces");
const GITHUB_TOKEN = process.env.RALPH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const FORBIDDEN_PATHS = (process.env.RALPH_FORBIDDEN_PATHS || ".env,.env.local,.ssh,id_rsa,id_ed25519")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

type GitActionResult = {
  commitSha?: string;
  gitStatus?: string;
  output: string;
  prUrl?: string;
  remoteBranch?: string;
};

async function runGit(args: string[], cwd: string) {
  try {
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
  } catch (error) {
    const message = error instanceof Error ? sanitizeGitOutput(error.message) : sanitizeGitOutput(String(error));
    throw new Error(message);
  }
}

function githubAuthArgs() {
  if (!GITHUB_TOKEN) return [];
  const basicToken = Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${basicToken}`];
}

async function clearGithubAuthHeader(repoPath: string) {
  await runGit(["config", "--unset-all", "http.https://github.com/.extraheader"], repoPath).catch(() => "");
}

function sanitizeGitOutput(output: string) {
  return output
    .replaceAll(GITHUB_TOKEN, "[redacted]")
    .replace(/Authorization: Basic\s+[A-Za-z0-9+/=]+/gi, "Authorization: Basic [redacted]");
}

function assertFlag(name: string) {
  if (process.env[name] !== "1") {
    throw new Error(`${name}=1 obrigatorio para esta acao.`);
  }
}

function parseGitHubRemote(remoteUrl: string) {
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return {owner: httpsMatch[1], repo: httpsMatch[2]};

  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return {owner: sshMatch[1], repo: sshMatch[2]};

  throw new Error(`Remote GitHub nao reconhecido: ${remoteUrl}`);
}

async function githubJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (!GITHUB_TOKEN) throw new Error("RALPH_GITHUB_TOKEN, GITHUB_TOKEN ou GH_TOKEN obrigatorio para criar PR.");

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ralph-orchestrator",
      ...init?.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${sanitizeGitOutput(text).slice(0, 1200)}`);
  }
  return JSON.parse(text) as T;
}

async function repoPathFromRun(run: Run) {
  const workspaceReal = await realpath(run.workspacePath);
  const allowedRoot = await realpath(WORKSPACES_DIR);
  if (!workspaceReal.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error("Workspace fora de data/workspaces.");
  }

  const repoPath = path.join(workspaceReal, "repo");
  await access(path.join(repoPath, ".git"));
  return repoPath;
}

function parseStatusFiles(status: string) {
  return status
    .split("\n")
    .map((line) => line.trim().slice(3).trim())
    .filter(Boolean);
}

function assertNoForbiddenFiles(files: string[]) {
  const blocked = files.filter((file) =>
    FORBIDDEN_PATHS.some((forbidden) => file === forbidden || file.includes(`/${forbidden}`)),
  );
  if (blocked.length > 0) {
    throw new Error(`Arquivos proibidos no diff: ${blocked.join(", ")}`);
  }
}

export async function getGitStatus(run: Run): Promise<GitActionResult> {
  const repoPath = await repoPathFromRun(run);
  const status = await runGit(["status", "--short"], repoPath);
  return {gitStatus: status || "clean", output: status || "Sem alteracoes."};
}

export async function commitRunChanges(run: Run, task: Task, message?: string): Promise<GitActionResult> {
  assertFlag("RALPH_GIT_WRITE_ENABLED");
  const repoPath = await repoPathFromRun(run);
  const status = await runGit(["status", "--short"], repoPath);
  const files = parseStatusFiles(status);
  if (files.length === 0) throw new Error("Nada para commit.");
  assertNoForbiddenFiles(files);

  await runGit(["add", "-A"], repoPath);
  const commitMessage = (message?.trim() || `ralph: ${task.title}`).slice(0, 180);
  await runGit([
    "-c",
    "user.name=Ralph Orchestrator",
    "-c",
    "user.email=ralph-orchestrator@example.invalid",
    "commit",
    "-m",
    commitMessage,
  ], repoPath);
  const commitSha = await runGit(["rev-parse", "HEAD"], repoPath);
  const nextStatus = await runGit(["status", "--short"], repoPath);
  return {
    commitSha,
    gitStatus: nextStatus || "clean",
    output: `Commit criado: ${commitSha}`,
  };
}

export async function pushRunBranch(run: Run, task: Task): Promise<GitActionResult> {
  assertFlag("RALPH_GIT_WRITE_ENABLED");
  assertFlag("RALPH_GIT_PUSH_ENABLED");
  const repoPath = await repoPathFromRun(run);
  const branch = task.branchName || (await runGit(["branch", "--show-current"], repoPath));
  if (!branch) throw new Error("Branch nao encontrada.");
  await clearGithubAuthHeader(repoPath);
  const output = await runGit([...githubAuthArgs(), "push", "-u", "origin", branch], repoPath);
  return {output: sanitizeGitOutput(output || `Branch enviada: ${branch}`), remoteBranch: branch};
}

export async function createRunPullRequest(run: Run, task: Task, baseBranch: string): Promise<GitActionResult> {
  assertFlag("RALPH_GIT_WRITE_ENABLED");
  assertFlag("RALPH_GIT_PUSH_ENABLED");
  assertFlag("RALPH_GIT_PR_ENABLED");
  const repoPath = await repoPathFromRun(run);
  const branch = task.branchName || (await runGit(["branch", "--show-current"], repoPath));
  if (!branch) throw new Error("Branch nao encontrada.");
  await clearGithubAuthHeader(repoPath);
  const remoteUrl = await runGit(["remote", "get-url", "origin"], repoPath);
  const {owner, repo} = parseGitHubRemote(remoteUrl);

  const body = [
    `Task: ${task.id}`,
    `Run: ${run.id}`,
    "",
    "Criado pelo Ralph Orchestrator apos review humano.",
  ].join("\n");

  type PullRequestResponse = {html_url: string};
  let prUrl: string;
  try {
    const pr = await githubJson<PullRequestResponse>(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      body: JSON.stringify({
        base: baseBranch,
        body,
        head: branch,
        title: task.title,
      }),
      method: "POST",
    });
    prUrl = pr.html_url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("A pull request already exists")) throw error;
    const existing = await githubJson<PullRequestResponse[]>(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=open`,
    );
    if (!existing[0]?.html_url) throw error;
    prUrl = existing[0].html_url;
  }

  return {output: prUrl, prUrl, remoteBranch: branch};
}
