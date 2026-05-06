#!/usr/bin/env node

import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
let owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO || "ralph-orchestrator";
const visibility = process.env.GITHUB_PRIVATE === "1" ? "private" : "public";

if (!token) {
  console.error("GITHUB_TOKEN ou GH_TOKEN obrigatorio.");
  process.exit(2);
}
async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok && response.status !== 422) {
    throw new Error(body.message || `GitHub API ${response.status}`);
  }
  return {body, status: response.status};
}

async function git(args) {
  const {stdout, stderr} = await execFileAsync("git", args, {
    timeout: 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 10,
  });
  return `${stdout}${stderr}`.trim();
}

if (!owner) {
  const user = await github("/user", {method: "GET"});
  owner = user.body.login;
}

if (!owner) {
  console.error("GITHUB_OWNER obrigatorio.");
  process.exit(2);
}

const existing = await github(`/repos/${owner}/${repo}`, {method: "GET"});
if (existing.status === 422 || existing.body.message === "Not Found") {
  await github("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      auto_init: false,
      description: "Ralph Orchestrator dashboard and worker for delegated coding tasks.",
      name: repo,
      private: visibility === "private",
    }),
  });
}

const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
const remotes = await git(["remote"]);
if (remotes.split("\n").includes("origin")) {
  await git(["remote", "set-url", "origin", remoteUrl]);
} else {
  await git(["remote", "add", "origin", remoteUrl]);
}
await git(["branch", "-M", "main"]);
await git(["push", "-u", "origin", "main"]);
await git(["remote", "set-url", "origin", `https://github.com/${owner}/${repo}.git`]);

console.log(`Publicado: https://github.com/${owner}/${repo}`);
