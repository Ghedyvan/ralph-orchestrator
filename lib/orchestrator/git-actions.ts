import type {Run, Task} from "@/lib/orchestrator/types";

import {execFile} from "node:child_process";
import {access, realpath} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

const WORKSPACES_DIR = path.join(process.cwd(), "data", "workspaces");
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
  const {stdout, stderr} = await execFileAsync("git", args, {
    cwd,
    timeout: 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 10,
  });
  return `${stdout}${stderr}`.trim();
}

async function runGh(args: string[], cwd: string) {
  const {stdout, stderr} = await execFileAsync("gh", args, {
    cwd,
    timeout: 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 10,
  });
  return `${stdout}${stderr}`.trim();
}

function assertFlag(name: string) {
  if (process.env[name] !== "1") {
    throw new Error(`${name}=1 obrigatorio para esta acao.`);
  }
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
  await runGit(["commit", "-m", commitMessage], repoPath);
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
  const output = await runGit(["push", "-u", "origin", branch], repoPath);
  return {output: output || `Branch enviada: ${branch}`, remoteBranch: branch};
}

export async function createRunPullRequest(run: Run, task: Task, baseBranch: string): Promise<GitActionResult> {
  assertFlag("RALPH_GIT_WRITE_ENABLED");
  assertFlag("RALPH_GIT_PUSH_ENABLED");
  assertFlag("RALPH_GIT_PR_ENABLED");
  const repoPath = await repoPathFromRun(run);
  const branch = task.branchName || (await runGit(["branch", "--show-current"], repoPath));
  if (!branch) throw new Error("Branch nao encontrada.");

  const body = [
    `Task: ${task.id}`,
    `Run: ${run.id}`,
    "",
    "Criado pelo Ralph Orchestrator apos review humano.",
  ].join("\n");
  const prUrl = await runGh(
    ["pr", "create", "--base", baseBranch, "--head", branch, "--title", task.title, "--body", body],
    repoPath,
  );
  return {output: prUrl, prUrl, remoteBranch: branch};
}
