/**
 * QA Fixtures — deterministic test endpoints
 *
 * NEVER accessible in production (NODE_ENV=production or RENDER env var set).
 * Public GET (monitor probe) + auth-gated management routes.
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";

const router = Router();

// QA fixtures are blocked only on actual Render.com deployments (RENDER env var set).
// NODE_ENV=production alone is not sufficient — Replit also sets NODE_ENV=production
// but is a dev/test environment, not a live deployment. RENDER=true is set exclusively
// by the Render platform during deployed builds and runtime.
function isProd(): boolean {
  return !!process.env["RENDER"];
}

function qaGuard(_req: Request, res: Response, next: () => void): void {
  if (isProd()) { res.status(404).json({ error: "Not found" }); return; }
  next();
}

// ── In-memory fixture store (sequence controller) ─────────────────────────────
// Key: fixture id, value: { sequence of HTTP status codes, current position }
const fixtures = new Map<string, { sequence: number[]; pos: number }>();

// ── PUBLIC: GET /qa/fixture/:id ───────────────────────────────────────────────
// Monitors call this URL directly — no auth required; protected only by isProd().
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
