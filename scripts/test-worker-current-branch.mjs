#!/usr/bin/env node

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ralph-worker-policy-"));
const dataDir = path.join(tempRoot, "data");
const remoteDir = path.join(tempRoot, "remote.git");
const seedDir = path.join(tempRoot, "seed");
const binDir = path.join(tempRoot, "bin");
const providerPath = path.join(binDir, "fake-provider");
const projectId = "policy-project";
const taskId = "policy-task";
const workspaceRepo = path.join(dataDir, "workspaces", projectId, taskId, "repo");
const REAL_GIT = process.env.RALPH_REAL_GIT || "/usr/bin/git";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: {...process.env, ...options.env},
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} falhou (${result.status}).\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return result;
}

function git(args, options = {}) {
  return run(REAL_GIT, args, options);
}

try {
  await mkdir(dataDir, {recursive: true});
  await mkdir(binDir, {recursive: true});
  git(["init", "--bare", remoteDir]);
  git(["init", "-b", "feature/current", seedDir]);
  await writeFile(path.join(seedDir, "base.txt"), "base\n", "utf8");
  git(["add", "base.txt"], {cwd: seedDir});
  git(["-c", "user.name=Ralph Test", "-c", "user.email=ralph@example.invalid", "commit", "-m", "base"], {cwd: seedDir});
  git(["remote", "add", "origin", remoteDir], {cwd: seedDir});
  git(["push", "-u", "origin", "feature/current"], {cwd: seedDir});
  git(["--git-dir", remoteDir, "symbolic-ref", "HEAD", "refs/heads/feature/current"]);

  await writeFile(
    providerPath,
    [
      "#!/bin/sh",
      "set -eu",
      "cat >/dev/null",
      "printf 'implemented\\n' > implemented.txt",
      "git branch forbidden-normal >/dev/null 2>normal-branch.err || true",
      "git checkout -b forbidden-checkout >/dev/null 2>normal-checkout.err || true",
      "git push origin HEAD >/dev/null 2>normal-push.err || true",
      "/usr/bin/git branch forbidden-absolute >/dev/null 2>absolute-branch.err || true",
      "/usr/bin/git checkout -b forbidden-absolute-checkout >/dev/null 2>absolute-checkout.err || true",
      "/usr/bin/git push origin HEAD >/dev/null 2>absolute-push.err || true",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(providerPath, 0o755);

  const now = new Date().toISOString();
  await writeFile(
    path.join(dataDir, "orchestrator-state.json"),
    `${JSON.stringify({
      version: 1,
      projects: [{id: projectId, name: "Policy fixture", repoUrl: remoteDir, defaultBranch: "feature/current", status: "active", createdAt: now, updatedAt: now}],
      tasks: [{id: taskId, projectId, title: "Validate current branch policy", prompt: "Create implemented.txt.", provider: "codex", status: "queued", priority: 1, createdAt: now, updatedAt: now}],
      runs: [], logs: [], providers: [],
    }, null, 2)}\n`,
    "utf8",
  );

  run(process.execPath, ["scripts/worker.current-branch.mjs", "--once"], {
    env: {
      NODE_ENV: "development",
      RALPH_DATA_DIR: dataDir,
      RALPH_RUNNER_ENABLED: "1",
      RALPH_GIT_ENABLED: "1",
      RALPH_GIT_AUTO_COMMIT_ENABLED: "1",
      RALPH_PROVIDER_CALLS_ENABLED: "1",
      CODEX_COMMAND: providerPath,
      RALPH_GITHUB_TOKEN: "",
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
    },
  });

  const branch = git(["branch", "--show-current"], {cwd: workspaceRepo}).stdout.trim();
  const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], {cwd: workspaceRepo}).stdout.trim().split("\n").filter(Boolean);
  const localCommits = Number(git(["rev-list", "--count", "HEAD"], {cwd: workspaceRepo}).stdout.trim());
  const remoteCommits = Number(git(["--git-dir", remoteDir, "rev-list", "--count", "refs/heads/feature/current"]).stdout.trim());
  const state = JSON.parse(await readFile(path.join(dataDir, "orchestrator-state.json"), "utf8"));
  const task = state.tasks[0];
  const latestRun = state.runs.at(-1);

  assert.equal(branch, "feature/current");
  assert.deepEqual(branches, ["feature/current"]);
  assert.equal(localCommits, 2);
  assert.equal(remoteCommits, 1);
  assert.equal(task.status, "review");
  assert.equal(task.branchName, "feature/current");
  assert.ok(latestRun.commitSha);
  assert.match(latestRun.summary, /Push nao realizado\./i);
  assert.equal(await readFile(path.join(workspaceRepo, "implemented.txt"), "utf8"), "implemented\n");
  assert.match(await readFile(path.join(workspaceRepo, "normal-branch.err"), "utf8"), /bloquead|policy/i);
  assert.match(await readFile(path.join(workspaceRepo, "normal-push.err"), "utf8"), /bloquead|policy/i);
  assert.notEqual((await readFile(path.join(workspaceRepo, "absolute-push.err"), "utf8")).trim(), "");
  assert.equal(await readFile(path.join(dataDir, "workspaces", projectId, taskId, ".ralph-git-shadow"), "utf8").catch(() => null), null);

  console.log("Ralph worker E2E: branch atual preservada, commit local criado e remoto inalterado.");
} finally {
  await rm(tempRoot, {force: true, recursive: true});
}
