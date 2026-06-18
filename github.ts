import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger.js";
import {
  isGitHubConfigured, getGitHubAuthUrl, exchangeCodeForToken, getGitHubUser,
  getUserRepos, getRepoCommits, getRepoDeployments, getRepoReleases,
  getRepoBranches, getRepoContributors, getWorkflowRuns,
  analyzeRepo, getAnalysis, saveConnection, getConnection, disconnectGitHub,
} from "../services/github-service.js";

const router = Router();
const ORG_ID = "default";

// GET /github/status — connection status
router.get("/github/status", async (_req: Request, res: Response) => {
  const conn = await getConnection(ORG_ID).catch(() => null);
  res.json({
    connected: !!conn,
    configured: isGitHubConfigured(),
    login: conn?.login || null,
    name: conn?.name || null,
    connectedAt: conn?.connected_at || null,
  });
});

// GET /github/auth — initiate OAuth
router.get("/github/auth", (req: Request, res: Response) => {
  if (!isGitHubConfigured()) {
    res.status(503).json({ ok: false, error: "GitHub OAuth not configured. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET." });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  const url = getGitHubAuthUrl(state);
  res.json({ ok: true, url, state });
});

// GET /github/callback — OAuth callback (also accessible without auth for redirect)
router.get("/github/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = process.env["PUBLIC_URL"] || "";

  if (oauthError) {
    res.redirect(`${publicUrl}/dashboard.html#integrations?github_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code) {
    res.status(400).json({ ok: false, error: "Missing OAuth code" });
    return;
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    if (!tokens.access_token) throw new Error("No access token received");

    const user = await getGitHubUser(tokens.access_token);
    await saveConnection(ORG_ID, user.id, user.login, user.name, user.email, user.avatar_url, tokens.access_token, tokens.scope || "");

    logger.info({ login: user.login }, "[GitHub] OAuth connection saved");
    res.redirect(`${publicUrl}/dashboard.html#integrations?github_connected=1&login=${encodeURIComponent(user.login)}`);
  } catch (err) {
    logger.error({ err }, "[GitHub] OAuth callback failed");
    res.redirect(`${publicUrl}/dashboard.html#integrations?github_error=oauth_failed`);
  }
});

// GET /github/repos — list repos
router.get("/github/repos", async (_req: Request, res: Response) => {
  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected. Call /api/github/auth first." }); return; }

  try {
    const repos = await getUserRepos(conn.access_token);
    res.json({ repos: repos.slice(0, 50) });
  } catch (err) {
    logger.error({ err }, "[GitHub] Failed to fetch repos");
    res.status(500).json({ error: "Failed to fetch repositories" });
  }
});

// GET /github/commits/:owner/:repo — commit analytics
router.get("/github/commits/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const days = Number(req.query["days"] || 30);
  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected" }); return; }

  try {
    const commits = await getRepoCommits(conn.access_token, owner, repo, days);

    const byDay = new Map<string, number>();
    const byAuthor = new Map<string, number>();
    commits.forEach(c => {
      const day = (c.commit?.author?.date || "").slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
      const author = c.commit?.author?.name || "Unknown";
      byAuthor.set(author, (byAuthor.get(author) || 0) + 1);
    });

    res.json({
      total: commits.length,
      days,
      byDay: Object.fromEntries(byDay),
      byAuthor: Array.from(byAuthor.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      recent: commits.slice(0, 20).map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0].slice(0, 100),
        author: c.commit.author.name,
        date: c.commit.author.date,
        url: `https://github.com/${owner}/${repo}/commit/${c.sha}`,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[GitHub] Failed to fetch commits");
    res.status(500).json({ error: "Failed to fetch commits" });
  }
});

// GET /github/deployments/:owner/:repo — deployment monitoring
router.get("/github/deployments/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected" }); return; }

  try {
    const [deployments, releases, runs] = await Promise.all([
      getRepoDeployments(conn.access_token, owner, repo).catch(() => []),
      getRepoReleases(conn.access_token, owner, repo).catch(() => []),
      getWorkflowRuns(conn.access_token, owner, repo).catch(() => ({ workflow_runs: [] })),
    ]);

    res.json({
      deployments: deployments.slice(0, 20),
      releases: releases.slice(0, 10),
      workflowRuns: runs.workflow_runs.slice(0, 15),
    });
  } catch (err) {
    logger.error({ err }, "[GitHub] Failed to fetch deployments");
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

// POST /github/analysis/:owner/:repo — trigger full analysis
router.post("/github/analysis/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected" }); return; }

  try {
    logger.info({ owner, repo }, "[GitHub] Starting repo analysis");
    const analysis = await analyzeRepo(conn.access_token, owner, repo);
    res.json({ ok: true, analysis });
  } catch (err) {
    logger.error({ err }, "[GitHub] Repo analysis failed");
    res.status(500).json({ error: "Repo analysis failed" });
  }
});

// GET /github/analysis/:owner/:repo — get cached analysis
router.get("/github/analysis/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const analysis = await getAnalysis(owner, repo).catch(() => null);
  if (!analysis) { res.status(404).json({ error: "No analysis found. POST to /api/github/analysis/:owner/:repo to run one." }); return; }
  res.json({ analysis });
});

// GET /github/issues/:owner/:repo — issues and security alerts
router.get("/github/issues/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected" }); return; }

  try {
    const issues = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=30&labels=bug,security`, {
      headers: { "Authorization": `Bearer ${conn.access_token}`, "Accept": "application/vnd.github+json" },
    }).then(r => r.json()) as Array<{ id: number; title: string; state: string; labels: Array<{ name: string; color: string }>; created_at: string; html_url: string }>;

    res.json({
      total: Array.isArray(issues) ? issues.length : 0,
      issues: Array.isArray(issues) ? issues.slice(0, 30).map(i => ({
        id: i.id,
        title: i.title,
        labels: i.labels.map(l => l.name),
        createdAt: i.created_at,
        url: i.html_url,
      })) : [],
    });
  } catch (err) {
    logger.error({ err }, "[GitHub] Failed to fetch issues");
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

// GET /github/health/:owner/:repo — health score
router.get("/github/health/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const cached = await getAnalysis(owner, repo).catch(() => null);

  if (cached) {
    res.json({ health: cached.health, fromCache: true, analyzedAt: cached.analyzedAt });
    return;
  }

  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected. No cached analysis available." }); return; }

  try {
    const analysis = await analyzeRepo(conn.access_token, owner, repo);
    res.json({ health: analysis.health, fromCache: false, analyzedAt: analysis.analyzedAt });
  } catch (err) {
    logger.error({ err }, "[GitHub] Failed to compute health");
    res.status(500).json({ error: "Failed to compute repository health" });
  }
});

// GET /github/contributors/:owner/:repo — contributors
router.get("/github/contributors/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params as { owner: string; repo: string };
  const conn = await getConnection(ORG_ID).catch(() => null);
  if (!conn) { res.status(403).json({ error: "GitHub not connected" }); return; }

  try {
    const contributors = await getRepoContributors(conn.access_token, owner, repo);
    const branches = await getRepoBranches(conn.access_token, owner, repo).catch(() => []);
    res.json({ contributors: contributors.slice(0, 30), branches: branches.slice(0, 30) });
  } catch (err) {
    logger.error({ err }, "[GitHub] Failed to fetch contributors");
    res.status(500).json({ error: "Failed to fetch contributors" });
  }
});

// POST /github/disconnect — disconnect GitHub
router.post("/github/disconnect", async (_req: Request, res: Response) => {
  await disconnectGitHub(ORG_ID).catch(() => {});
  logger.info("[GitHub] Disconnected");
  res.json({ ok: true });
});

export default router;
