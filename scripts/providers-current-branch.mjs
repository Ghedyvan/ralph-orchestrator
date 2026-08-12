import {spawnSync} from "node:child_process";
import {access, chmod, cp, mkdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {
  providerReady,
  routeProvider,
  runProvider as runUnsafeProvider,
} from "./providers.mjs";

export {providerReady, routeProvider};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const POLICY_VERSION = "current-branch-local-commit-no-auto-push-v4";
const POLICY = `## Política Git obrigatória do Ralph (${POLICY_VERSION})

- Capture a branch com git branch --show-current e permaneça nela.
- Não crie, troque, renomeie ou apague branches.
- Não execute checkout, switch, reset --hard, clean, merge, rebase ou worktree mutável.
- Faça apenas commits locais pequenos na branch atual depois das validações.
- Nunca execute git push, configure upstream, publique tags ou abra PR automaticamente.
- Preserve alterações preexistentes e finalize com a frase: Push não realizado.`;

const MANAGED_ENV = [
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_SSH_COMMAND",
  "GIT_TERMINAL_PROMPT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GH_PROMPT_DISABLED",
  "PATH",
  "RALPH_ACTIVE",
  "RALPH_CURRENT_BRANCH",
  "RALPH_EXPLICIT_PUSH",
  "RALPH_GIT_PUSH_ENABLED",
  "RALPH_REAL_GIT",
  "RALPH_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SSH_AUTH_SOCK",
];

function snapshotEnvironment() {
  return new Map(MANAGED_ENV.map((name) => [name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined]));
}

function restoreEnvironment(snapshot) {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function runRealGit(args, cwd, env = process.env) {
  const result = spawnSync(process.env.RALPH_REAL_GIT || "/usr/bin/git", args, {
    cwd,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`Git sandbox falhou: ${result.stderr || result.stdout || args.join(" ")}`);
  }
  return (result.stdout || "").trim();
}

async function pathExists(target) {
  return access(target).then(() => true).catch(() => false);
}

async function prepareSandbox(workspacePath, branchName) {
  const repoPath = path.join(workspacePath, "repo");
  const sourceGitDir = path.join(repoPath, ".git");
  if (!(await pathExists(sourceGitDir))) return null;

  const shadowGitDir = path.join(workspacePath, ".ralph-git-shadow");
  const binDir = path.join(workspacePath, ".ralph-bin");
  const hooksDir = path.join(workspacePath, ".ralph-hooks");
  const wrapperPath = path.join(binDir, "git");
  const prePushPath = path.join(hooksDir, "pre-push");

  await rm(shadowGitDir, {force: true, recursive: true});
  await rm(binDir, {force: true, recursive: true});
  await rm(hooksDir, {force: true, recursive: true});
  await cp(sourceGitDir, shadowGitDir, {recursive: true, force: true});
  await mkdir(binDir, {recursive: true});
  await mkdir(hooksDir, {recursive: true});

  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec /bin/bash ${JSON.stringify(path.join(SCRIPT_DIR, "ralph-git-guard.sh"))} "$@"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  await writeFile(
    prePushPath,
    "#!/bin/sh\necho 'Ralph: push automático bloqueado no provider.' >&2\nexit 73\n",
    "utf8",
  );
  await chmod(prePushPath, 0o755);

  const sandboxEnv = {
    ...process.env,
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
    GIT_SSH_COMMAND: "/bin/false",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooksDir,
    GIT_DIR: shadowGitDir,
    GIT_WORK_TREE: repoPath,
    GH_PROMPT_DISABLED: "1",
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    RALPH_ACTIVE: "1",
    RALPH_CURRENT_BRANCH: branchName || "",
    RALPH_EXPLICIT_PUSH: "0",
    RALPH_GIT_PUSH_ENABLED: "0",
    RALPH_REAL_GIT: process.env.RALPH_REAL_GIT || "/usr/bin/git",
  };

  delete sandboxEnv.RALPH_GITHUB_TOKEN;
  delete sandboxEnv.GITHUB_TOKEN;
  delete sandboxEnv.GH_TOKEN;
  delete sandboxEnv.SSH_AUTH_SOCK;

  runRealGit(["config", "--local", "remote.origin.pushurl", "no_push://ralph-disabled"], repoPath, sandboxEnv);
  return {binDir, hooksDir, repoPath, sandboxEnv, shadowGitDir};
}

export async function runProvider(args) {
  if (args.provider === "manual") return runUnsafeProvider(args);

  const sandbox = await prepareSandbox(args.workspacePath, args.task.branchName);
  const guardedTask = {
    ...args.task,
    prompt: `${POLICY}\n\n## Tarefa\n\n${args.task.prompt}`,
  };
  if (!sandbox) return runUnsafeProvider({...args, task: guardedTask});

  const previous = snapshotEnvironment();
  Object.assign(process.env, sandbox.sandboxEnv);
  for (const secret of ["RALPH_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "SSH_AUTH_SOCK"]) delete process.env[secret];

  try {
    return await runUnsafeProvider({...args, task: guardedTask});
  } finally {
    restoreEnvironment(previous);
    await rm(sandbox.shadowGitDir, {force: true, recursive: true}).catch(() => {});
    await rm(sandbox.binDir, {force: true, recursive: true}).catch(() => {});
    await rm(sandbox.hooksDir, {force: true, recursive: true}).catch(() => {});
  }
}
