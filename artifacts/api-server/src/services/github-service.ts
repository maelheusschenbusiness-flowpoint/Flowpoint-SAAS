import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const GH_BASE = "https://api.github.com";

export interface GitHubConnection { orgId: string; login: string; avatarUrl: string; accessToken: string; installedAt: string; }
export interface RepoInfo { id: number; name: string; fullName: string; private: boolean; description: string | null; url: string; language: string | null; stars: number; forks: number; openIssues: number; pushedAt: string; }

export function isGitHubConfigured(): boolean {
  return !!(process.env["GITHUB_CLIENT_ID"] && process.env["GITHUB_CLIENT_SECRET"]);
}

export function getGitHubAuthUrl(state: string): string {
  const clientId = process.env["GITHUB_CLIENT_ID"] ?? "";
  const redirect  = process.env["GITHUB_REDIRECT_URI"] ?? "";
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&scope=repo,read:user&state=${state}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["GITHUB_CLIENT_ID"],
      client_secret: process.env["GITHUB_CLIENT_SECRET"],
      code,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (data["error"]) throw new Error(String(data["error_description"] ?? data["error"]));
  return String(data["access_token"]);
}

async function ghFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} — ${path}`);
  return res.json() as Promise<T>;
}

export async function getGitHubUser(token: string): Promise<{ login: string; name: string; email: string | null; avatarUrl: string }> {
  const u = await ghFetch<Record<string, unknown>>(token, "/user");
  return { login: String(u["login"]), name: String(u["name"] ?? u["login"]), email: u["email"] ? String(u["email"]) : null, avatarUrl: String(u["avatar_url"]) };
}

export async function getUserRepos(token: string): Promise<RepoInfo[]> {
  const repos = await ghFetch<Record<string, unknown>[]>(token, "/user/repos?sort=pushed&per_page=50");
  return repos.map(r => ({
    id: Number(r["id"]), name: String(r["name"]), fullName: String(r["full_name"]),
    private: Boolean(r["private"]), description: r["description"] ? String(r["description"]) : null,
    url: String(r["html_url"]), language: r["language"] ? String(r["language"]) : null,
    stars: Number(r["stargazers_count"] ?? 0), forks: Number(r["forks_count"] ?? 0),
    openIssues: Number(r["open_issues_count"] ?? 0), pushedAt: String(r["pushed_at"] ?? ""),
  }));
}

export async function getRepoCommits(token: string, owner: string, repo: string, limit = 20): Promise<unknown[]> {
  return ghFetch(token, `/repos/${owner}/${repo}/commits?per_page=${limit}`);
}

export async function getRepoDeployments(token: string, owner: string, repo: string): Promise<unknown[]> {
  return ghFetch(token, `/repos/${owner}/${repo}/deployments?per_page=20`);
}

export async function getRepoReleases(token: string, owner: string, repo: string): Promise<unknown[]> {
  return ghFetch(token, `/repos/${owner}/${repo}/releases?per_page=10`);
}

export async function getRepoBranches(token: string, owner: string, repo: string): Promise<unknown[]> {
  return ghFetch(token, `/repos/${owner}/${repo}/branches?per_page=30`);
}

export async function getRepoContributors(token: string, owner: string, repo: string): Promise<unknown[]> {
  return ghFetch(token, `/repos/${owner}/${repo}/contributors?per_page=20`);
}

export async function getWorkflowRuns(token: string, owner: string, repo: string): Promise<unknown[]> {
  const data = await ghFetch<Record<string, unknown>>(token, `/repos/${owner}/${repo}/actions/runs?per_page=10`);
  return (data["workflow_runs"] as unknown[]) ?? [];
}

export async function analyzeRepo(token: string, owner: string, repo: string): Promise<Record<string, unknown>> {
  const [commits, deployments, releases, branches] = await Promise.allSettled([
    getRepoCommits(token, owner, repo, 10),
    getRepoDeployments(token, owner, repo),
    getRepoReleases(token, owner, repo),
    getRepoBranches(token, owner, repo),
  ]);
  return {
    commits: commits.status === "fulfilled" ? commits.value : [],
    deployments: deployments.status === "fulfilled" ? deployments.value : [],
    releases: releases.status === "fulfilled" ? releases.value : [],
    branches: branches.status === "fulfilled" ? branches.value : [],
    analyzedAt: new Date().toISOString(),
  };
}

export async function getAnalysis(orgId: string, repoFullName: string): Promise<Record<string, unknown> | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM github_analyses WHERE org_id=$1 AND repo_full_name=$2 ORDER BY created_at DESC LIMIT 1`,
      [orgId, repoFullName]
    );
    return res.rows[0] ?? null;
  } catch { return null; } finally { client.release(); }
}

export async function saveConnection(orgId: string, data: Omit<GitHubConnection, "orgId">): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO github_connections (org_id, login, avatar_url, access_token, installed_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (org_id) DO UPDATE SET login=$2, avatar_url=$3, access_token=$4, installed_at=NOW()`,
      [orgId, data.login, data.avatarUrl, data.accessToken]
    );
  } finally { client.release(); }
}

export async function getConnection(orgId: string): Promise<GitHubConnection | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM github_connections WHERE org_id=$1 LIMIT 1`, [orgId]);
    return res.rows[0] ?? null;
  } catch { return null; } finally { client.release(); }
}

export async function disconnectGitHub(orgId: string): Promise<void> {
  const client = await pool.connect();
  try { await client.query(`DELETE FROM github_connections WHERE org_id=$1`, [orgId]); }
  finally { client.release(); }
}
