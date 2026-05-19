import {createPrivateKey, createSign} from "node:crypto";

type GithubAuthConfig = {
  appId: string;
  installationId: string;
  privateKey: string;
};

type GithubTokenCache = {
  token: string;
  expiresAt: number;
};

let cachedToken: GithubTokenCache | null = null;

function envToken() {
  return process.env.RALPH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
}

function normalizePrivateKey(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("BEGIN")) return trimmed.replace(/\\n/g, "\n");
  return Buffer.from(trimmed, "base64").toString("utf8");
}

function githubAppConfig(): GithubAuthConfig | null {
  const appId = process.env.RALPH_GITHUB_APP_ID || "";
  const installationId = process.env.RALPH_GITHUB_INSTALLATION_ID || "";
  const privateKey = normalizePrivateKey(
    process.env.RALPH_GITHUB_APP_PRIVATE_KEY || process.env.RALPH_GITHUB_APP_PRIVATE_KEY_BASE64 || "",
  );
  if (!appId || !installationId || !privateKey) return null;
  return {appId, installationId, privateKey};
}

function createGithubJwt(config: GithubAuthConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({alg: "RS256", typ: "JWT"})).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: config.appId,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(createPrivateKey(config.privateKey)).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function fetchInstallationToken(config: GithubAuthConfig) {
  const response = await fetch(`https://api.github.com/app/installations/${config.installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${createGithubJwt(config)}`,
      "Content-Type": "application/json",
      "User-Agent": "ralph-orchestrator",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub App token ${response.status}: ${text.slice(0, 1200)}`);
  }
  const payload = JSON.parse(text) as {token: string; expires_at: string};
  cachedToken = {
    token: payload.token,
    expiresAt: Date.parse(payload.expires_at) - 60_000,
  };
  return payload.token;
}

export function githubAuthMode() {
  if (envToken()) return "token";
  if (githubAppConfig()) return "app";
  return "none";
}

export async function getGithubToken() {
  const token = envToken();
  if (token) return token;
  const config = githubAppConfig();
  if (!config) return "";
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  return fetchInstallationToken(config);
}
