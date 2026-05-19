import type {GitHubRepositoryOption} from "@/lib/orchestrator/types";

import {getGithubToken, githubAuthMode} from "@/lib/orchestrator/github-auth";

type GitHubRepositoryApi = {
  clone_url: string;
  default_branch: string;
  full_name: string;
  id: number;
  name: string;
  private: boolean;
};

type InstallationRepositoriesResponse = {
  repositories: GitHubRepositoryApi[];
};

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ralph-orchestrator",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

function mapRepository(repo: GitHubRepositoryApi): GitHubRepositoryOption {
  return {
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch || "main",
    fullName: repo.full_name,
    id: repo.id,
    name: repo.name,
    visibility: repo.private ? "private" : "public",
  };
}

async function listInstallationRepositories(token: string) {
  const repositories: GitHubRepositoryApi[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson<InstallationRepositoriesResponse>(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    repositories.push(...payload.repositories);
    if (payload.repositories.length < 100) break;
  }

  return repositories;
}

async function listUserRepositories(token: string) {
  const repositories: GitHubRepositoryApi[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson<GitHubRepositoryApi[]>(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      token,
    );
    repositories.push(...payload);
    if (payload.length < 100) break;
  }

  return repositories;
}

export async function listGithubRepositories(): Promise<GitHubRepositoryOption[]> {
  const token = await getGithubToken();
  if (!token) return [];

  const mode = githubAuthMode();
  const repositories =
    mode === "app" ? await listInstallationRepositories(token) : await listUserRepositories(token);

  return repositories.map(mapRepository).sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));
}
