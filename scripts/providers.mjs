import {execFile} from "node:child_process";
import {access, writeFile} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

const PROVIDER_ENV = {
  codex: "CODEX_API_KEY",
  "opencode-go": "OPENCODE_GO_API_KEY",
  mimo: "MIMO_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

const COMMAND_ENV = {
  codex: "CODEX_COMMAND",
  "opencode-go": "OPENCODE_GO_COMMAND",
};

const HTTP_CONFIG = {
  mimo: {model: "MIMO_MODEL", url: "MIMO_API_URL"},
  minimax: {model: "MINIMAX_MODEL", url: "MINIMAX_API_URL"},
};

export function providerReady(provider) {
  if (provider === "manual") return true;
  const envName = PROVIDER_ENV[provider];
  if (!envName || !process.env[envName]) return false;
  if (COMMAND_ENV[provider]) return Boolean(process.env[COMMAND_ENV[provider]]);
  const http = HTTP_CONFIG[provider];
  if (http) return Boolean(process.env[http.url] && process.env[http.model]);
  return false;
}

export function routeProvider(task) {
  if (task.provider && task.provider !== "manual") return task.provider;
  const prompt = `${task.title}\n${task.prompt}`.toLowerCase();
  if (prompt.includes("doc") || prompt.includes("readme")) return "mimo";
  if (prompt.includes("test") || prompt.includes("lint")) return "opencode-go";
  return "codex";
}

export async function runProvider({provider, project, run, task, workspacePath}) {
  if (provider === "manual") {
    return {
      ok: true,
      summary: "Manual dry-run. Nenhum provider externo chamado.",
      changedFiles: [],
      diffSummary: "Provider manual nao alterou arquivos.",
    };
  }

  const envName = PROVIDER_ENV[provider];
  if (!process.env.RALPH_PROVIDER_CALLS_ENABLED || process.env.RALPH_PROVIDER_CALLS_ENABLED !== "1") {
    return {
      ok: false,
      blocked: true,
      summary: `Provider ${provider} roteado, mas chamadas reais bloqueadas. Defina RALPH_PROVIDER_CALLS_ENABLED=1.`,
      changedFiles: [],
      diffSummary: "Provider bloqueado por politica.",
    };
  }

  if (!envName || !process.env[envName]) {
    return {
      ok: false,
      blocked: true,
      summary: `Provider ${provider} requer ${envName}.`,
      changedFiles: [],
      diffSummary: "Provider sem credencial.",
    };
  }

  if (provider === "codex" || provider === "opencode-go") {
    return runCliProvider({provider, project, run, task, workspacePath});
  }

  if (provider === "mimo" || provider === "minimax") {
    return runHttpProvider({provider, project, run, task, workspacePath});
  }

  return {
    ok: false,
    blocked: true,
    summary: `Provider ${provider} sem adapter conhecido.`,
    changedFiles: [],
    diffSummary: "Provider invalido.",
  };
}

function parseCommand(command) {
  return command
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function runCliProvider({provider, project, run, task, workspacePath}) {
  const command = process.env[COMMAND_ENV[provider]];
  if (!command) {
    return {
      ok: false,
      blocked: true,
      summary: `Provider ${provider} requer ${COMMAND_ENV[provider]}.`,
      changedFiles: [],
      diffSummary: "Comando ausente.",
    };
  }

  const promptPath = path.join(workspacePath, "PROVIDER_PROMPT.md");
  await writeFile(
    promptPath,
    [
      `# ${task.title}`,
      "",
      `Project: ${project.name}`,
      `Repo: ${project.repoUrl}`,
      `Run: ${run.id}`,
      `Workspace: ${workspacePath}`,
      "",
      task.prompt,
    ].join("\n"),
  );

  const [bin, ...args] = parseCommand(command);
  const finalArgs = args.map((arg) => arg.replaceAll("{prompt}", promptPath).replaceAll("{workspace}", workspacePath));
  const repoPath = path.join(workspacePath, "repo");
  const cwd = await access(repoPath)
    .then(() => repoPath)
    .catch(() => workspacePath);
  const {stdout, stderr} = await execFileAsync(bin, finalArgs, {
    cwd,
    timeout: Number(process.env.RALPH_PROVIDER_TIMEOUT_MS || 1000 * 60 * 20),
    maxBuffer: 1024 * 1024 * 10,
  });

  return {
    ok: true,
    summary: `Provider ${provider} executado via ${bin}.`,
    changedFiles: [],
    diffSummary: `${stdout}${stderr}`.trim() || "Provider executado sem output.",
  };
}

async function runHttpProvider({provider, project, run, task, workspacePath}) {
  const config = HTTP_CONFIG[provider];
  const url = process.env[config.url];
  const model = process.env[config.model];
  const apiKey = process.env[PROVIDER_ENV[provider]];
  if (!url || !model || !apiKey) {
    return {
      ok: false,
      blocked: true,
      summary: `Provider ${provider} requer ${PROVIDER_ENV[provider]}, ${config.url} e ${config.model}.`,
      changedFiles: [],
      diffSummary: "Config HTTP ausente.",
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "Voce e um agente de desenvolvimento. Responda com plano executavel e patches/validacoes quando nao tiver acesso direto ao filesystem.",
        },
        {
          role: "user",
          content: [
            `Project: ${project.name}`,
            `Repo: ${project.repoUrl}`,
            `Run: ${run.id}`,
            `Workspace: ${workspacePath}`,
            "",
            task.prompt,
          ].join("\n"),
        },
      ],
      model,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      blocked: true,
      summary: `Provider ${provider} retornou HTTP ${response.status}.`,
      changedFiles: [],
      diffSummary: text.slice(0, 4000),
    };
  }

  await writeFile(path.join(workspacePath, `${provider.toUpperCase()}_RESPONSE.json`), text);
  return {
    ok: true,
    summary: `Provider ${provider} executado por HTTP.`,
    changedFiles: [],
    diffSummary: text.slice(0, 4000),
  };
}
