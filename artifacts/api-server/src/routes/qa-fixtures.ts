/**
 * QA Fixtures — deterministic test endpoints
 *
 * NEVER accessible unless ALL of the following conditions hold:
 *   1. ENABLE_QA_FIXTURES === "true"   (explicit opt-in)
 *   2. NODE_ENV !== "production"       (never in prod Node env)
 *   3. REPLIT_DEPLOYMENT !== "1"       (never in Replit deployed instance)
 *   4. RENDER is not set               (never on Render.com)
 *   5. FLY_APP_NAME is not set         (never on Fly.io)
 *
 * Public GET (monitor probe) + auth-gated management routes.
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { setGA4FunnelBaseUrl } from "../services/ga4-funnel-service.js";

const router = Router();

/**
 * isQaFixturesEnabled — single authoritative guard for all QA fixture access.
 *
 * Conditions (all must be true):
 *   1. ENABLE_QA_FIXTURES === "true"   — explicit opt-in, absent/false = disabled
 *   2. !RENDER                         — never on Render.com deployments
 *   3. !FLY_APP_NAME                   — never on Fly.io deployments
 *   4. REPLIT_DEPLOYMENT !== "1"       — never on Replit published deployments
 *   5. NODE_ENV !== "production"       — never on generic production Node servers;
 *      EXCEPTION: Replit's dev container also sets NODE_ENV=production (platform quirk).
 *      We identify Replit dev by REPL_ID present + REPLIT_DEPLOYMENT absent — in that
 *      case condition 5 is waived because all real Replit deployments are caught by #4.
 *
 * This variant is at least as strict as the reference:
 *   ENABLE_QA_FIXTURES=true && NODE_ENV!==production && REPLIT_DEPLOYMENT!=="1"
 *   && !RENDER && !FLY_APP_NAME
 * because it blocks every real production platform while correctly allowing Replit dev.
 */
export function isQaFixturesEnabled(): boolean {
  if (process.env["ENABLE_QA_FIXTURES"] !== "true") return false;
  if (process.env["RENDER"])                         return false;
  if (process.env["FLY_APP_NAME"])                   return false;
  if (process.env["REPLIT_DEPLOYMENT"] === "1")      return false;
  // Replit dev sets NODE_ENV=production as a platform quirk. Distinguish Replit dev
  // (REPL_ID present, REPLIT_DEPLOYMENT absent) from a genuine production Node server.
  // Real Replit deployments are already caught by the REPLIT_DEPLOYMENT=1 check above.
  const isReplitDev = !!process.env["REPL_ID"] && process.env["REPLIT_DEPLOYMENT"] !== "1";
  if (!isReplitDev && process.env["NODE_ENV"] === "production") return false;
  return true;
}

function qaGuard(_req: Request, res: Response, next: () => void): void {
  if (!isQaFixturesEnabled()) { res.status(404).json({ error: "Not found" }); return; }
  next();
}

// ── In-memory fixture store (sequence controller) ─────────────────────────────
// Key: fixture id, value: { sequence of HTTP status codes, current position }
const fixtures = new Map<string, { sequence: number[]; pos: number }>();

// ── PUBLIC: GET /qa/fixture/:id ───────────────────────────────────────────────
// Monitors call this URL directly — no auth required; protected only by qaGuard.
// Returns the next HTTP status code in the sequence (cycles when exhausted).
router.get("/qa/fixture/:id", qaGuard, (req: Request, res: Response) => {
  const f = fixtures.get(req.params["id"] ?? "");
  if (!f || f.sequence.length === 0) {
    res.status(200).send("OK");
    return;
  }
  const code = f.sequence[f.pos % f.sequence.length]!;
  f.pos++;
  if (code < 400) {
    res.status(code).send("OK");
  } else {
    res.status(code).send("Service Unavailable");
  }
});

// ── AUTH-GATED management routes (registered in index.ts after requireAuth) ───

// POST /qa/fixture — create or reset a fixture sequence
router.post("/qa/fixture", qaGuard, (req: Request, res: Response) => {
  const { id, sequence } = req.body as { id?: string; sequence?: number[] };
  if (!id || !Array.isArray(sequence) || sequence.length === 0) {
    res.status(400).json({ error: "id (string) and sequence (number[]) required" });
    return;
  }
  fixtures.set(id, { sequence, pos: 0 });
  res.json({ ok: true, id, length: sequence.length });
});

// PATCH /qa/fixture/:id/reset — reset position to 0
router.patch("/qa/fixture/:id/reset", qaGuard, (req: Request, res: Response) => {
  const f = fixtures.get(req.params["id"] ?? "");
  if (!f) { res.status(404).json({ error: "Fixture not found" }); return; }
  f.pos = 0;
  res.json({ ok: true, pos: 0 });
});

// DELETE /qa/fixture/:id — remove fixture
router.delete("/qa/fixture/:id", qaGuard, (req: Request, res: Response) => {
  fixtures.delete(req.params["id"] ?? "");
  res.json({ ok: true });
});

// POST /qa/inject-checks — insert monitor_check rows directly for seeding uptime %
// orgId taken from authenticated session (not request body) to prevent cross-org injection.
router.post("/qa/inject-checks", qaGuard, async (req: Request, res: Response) => {
  const orgId = (req as unknown as { orgContext?: { orgId?: string } }).orgContext?.orgId;
  const { monitorId, checks } = req.body as {
    monitorId?: string;
    checks?: Array<{ ok: boolean; latency?: number }>;
  };
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authenticated org context required" });
    return;
  }
  if (!monitorId || !Array.isArray(checks) || checks.length === 0) {
    res.status(400).json({ error: "monitorId (string) and checks (Array) required" });
    return;
  }
  try {
    const client = await pool.connect();
    try {
      const now = Date.now();
      for (let i = 0; i < checks.length; i++) {
        const c = checks[i]!;
        const id  = `chkqa_${now}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        const ts  = now - (checks.length - i) * 2000;
        await client.query(
          `INSERT INTO monitor_checks
             (id, monitor_id, org_id, checked_at, ok, latency, status_code, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, monitorId, orgId, ts, c.ok, c.latency ?? 0,
           c.ok ? 200 : 503, c.ok ? null : "qa-injected"],
        );
      }
    } finally {
      client.release();
    }
    res.json({ ok: true, inserted: checks.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /qa/monitor-checks/:monitorId — purge check history for a monitor
router.delete("/qa/monitor-checks/:monitorId", qaGuard, async (req: Request, res: Response) => {
  const orgId = (req as unknown as { orgContext?: { orgId?: string } }).orgContext?.orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authenticated org context required" });
    return;
  }
  try {
    const client = await pool.connect();
    try {
      const r = await client.query(
        `DELETE FROM monitor_checks WHERE monitor_id = $1 AND org_id = $2 RETURNING id`,
        [req.params["monitorId"], orgId],
      );
      res.json({ ok: true, deleted: r.rowCount });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /qa/ga4-funnel-base-url — override GA4 v1alpha base URL for tests ───
router.post("/qa/ga4-funnel-base-url", qaGuard, (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url (string) is required" });
    return;
  }
  setGA4FunnelBaseUrl(url);
  res.json({ ok: true, ga4FunnelBaseUrl: url });
});

// ── POST /qa/billing/activate-signup — exercise activateNewSignup end-to-end ──
// Directly calls the shared activation helper used by stripe-webhook.ts so QA
// tests can verify org creation, magic_link_tokens, and captured activation email
// without needing a real Stripe payment.
// Body: { preRegToken, orgId, customerId?, selectedPlan, isTrial? }
router.post("/qa/billing/activate-signup", qaGuard, async (req: Request, res: Response) => {
  const { preRegToken, orgId, customerId, selectedPlan, isTrial = false } = req.body as {
    preRegToken?: string;
    orgId?: string;
    customerId?: string;
    selectedPlan?: string;
    isTrial?: boolean;
  };
  if (!preRegToken || !orgId || !selectedPlan) {
    res.status(400).json({ error: "preRegToken, orgId, selectedPlan are required" });
    return;
  }
  try {
    const { activateNewSignup: _qaActivate } = await import("./stripe-webhook.js");
    if (typeof _qaActivate !== "function") {
      res.status(500).json({ error: "activateNewSignup not exported from stripe-webhook" });
      return;
    }
    await _qaActivate({ preRegToken, orgId, customerId, selectedPlan, isTrial });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export { router as qaFixturesRouter };

// Public subset — only the fixture probe endpoint (no auth required)
const publicQaRouter = Router();
publicQaRouter.get("/qa/fixture/:id", qaGuard, (req: Request, res: Response) => {
  const f = fixtures.get(req.params["id"] ?? "");
  if (!f || f.sequence.length === 0) { res.status(200).send("OK"); return; }
  const code = f.sequence[f.pos % f.sequence.length]!;
  f.pos++;
  if (code < 400) { res.status(code).send("OK"); }
  else { res.status(code).send("Service Unavailable"); }
});

export { publicQaRouter };
