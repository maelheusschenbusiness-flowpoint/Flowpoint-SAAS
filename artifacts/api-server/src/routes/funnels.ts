/**
 * routes/funnels.ts — CRUD + run for configurable GA4 funnels
 *
 * Security model:
 *  - orgId ALWAYS from req.orgContext — never from body/query
 *  - propertyId ALWAYS from server DB — never from client
 *  - siteUrl validated via behavior_site_tokens (same org)
 *  - All cross-org reads silently return 404
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { getStoredProperty } from "../services/ga4-service.js";
import { runConfiguredFunnel, ALLOWED_BREAKDOWN_DIMENSIONS, ALLOWED_MATCH_TYPES } from "../services/ga4-funnel-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Org context extraction ────────────────────────────────────────────────────

interface OrgReq extends Request {
  orgId?: string;
  orgContext?: { orgId?: string };
}

function getOrgId(req: Request): string {
  const r = req as OrgReq;
  const orgId = r.orgId ?? r.orgContext?.orgId;
  if (!orgId || orgId === "default") {
    throw Object.assign(new Error("Authenticated org context required"), { status: 401 });
  }
  return orgId;
}

// ── Input validation ──────────────────────────────────────────────────────────

interface StepInput {
  position: unknown;
  name: unknown;
  eventName?: unknown;
  pagePathMatchType?: unknown;
  pagePathValue?: unknown;
  parameterFilters?: unknown;
}

function validateSteps(steps: unknown[]): string | null {
  if (steps.length < 2) return "Funnel requires at least 2 steps";
  if (steps.length > 10) return "Funnel allows at most 10 steps";
  const positions = new Set<number>();
  for (const raw of steps) {
    if (typeof raw !== "object" || raw === null) return "Each step must be an object";
    const s = raw as StepInput;
    const pos = s.position;
    if (typeof pos !== "number" || !Number.isInteger(pos) || pos < 1 || pos > 10) {
      return `Step position must be an integer 1–10 (got ${String(pos)})`;
    }
    if (positions.has(pos)) return `Duplicate step position: ${pos}`;
    positions.add(pos);
    const name = s.name;
    if (!name || typeof name !== "string" || !name.trim()) {
      return `Step at position ${pos} has empty name`;
    }
    const hasEvent = !!(s.eventName as string | undefined)?.trim();
    const hasPage = !!(s.pagePathValue as string | undefined)?.trim();
    if (!hasEvent && !hasPage) {
      return `Step "${String(name)}" at position ${pos} requires eventName or pagePathValue`;
    }
    const mt = s.pagePathMatchType as string | undefined;
    if (mt && !ALLOWED_MATCH_TYPES.has(mt)) {
      return `Invalid pagePathMatchType: ${mt}`;
    }
  }
  return null;
}

function validateLookbackDays(raw: unknown): number | string {
  if (raw === undefined || raw === null) return 30;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) return "lookbackDays must be an integer 1–365";
  return n;
}

// ── Site ownership guard ──────────────────────────────────────────────────────

async function assertSiteOwnership(orgId: string, siteUrl: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
      [orgId, siteUrl]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  } finally {
    client.release();
  }
}

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(res: Response, e: unknown, label: string): void {
  const err = e as Error & { status?: number; code?: string };
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ e, label }, `[funnels] ${label} failed`);
  res.status(status).json({
    ok: false,
    error: err.message ?? String(e),
    ...(err.code ? { code: err.code } : {}),
  });
}

// ── Funnel row builder (shared query) ─────────────────────────────────────────

const FUNNEL_SELECT = `
  SELECT f.id, f.org_id, f.site_url, f.name, f.description,
         f.ga4_property_id, f.is_open_funnel, f.lookback_days,
         f.breakdown_dimension, f.created_by, f.created_at, f.updated_at,
         COALESCE(
           json_agg(fs ORDER BY fs.position) FILTER (WHERE fs.id IS NOT NULL),
           '[]'
         ) AS steps
  FROM funnels f
  LEFT JOIN funnel_steps fs ON fs.funnel_id = f.id AND fs.org_id = f.org_id
`;

// ── GET /api/funnels ──────────────────────────────────────────────────────────

router.get("/funnels", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const siteUrl = (req.query["siteUrl"] as string | undefined)?.trim();
    const client = await pool.connect();
    try {
      let rows: unknown[];
      if (siteUrl) {
        const r = await client.query(
          `${FUNNEL_SELECT} WHERE f.org_id = $1 AND f.site_url = $2 GROUP BY f.id ORDER BY f.created_at DESC`,
          [orgId, siteUrl]
        );
        rows = r.rows;
      } else {
        const r = await client.query(
          `${FUNNEL_SELECT} WHERE f.org_id = $1 GROUP BY f.id ORDER BY f.created_at DESC`,
          [orgId]
        );
        rows = r.rows;
      }
      res.json({ ok: true, funnels: rows });
    } finally {
      client.release();
    }
  } catch (e) {
    handleError(res, e, "GET /funnels");
  }
});

// ── POST /api/funnels ─────────────────────────────────────────────────────────

router.post("/funnels", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const body = { ...(req.body as Record<string, unknown>) };
    delete body["orgId"]; // never accepted from client

    const name = (body["name"] as string | undefined)?.trim();
    const siteUrl = (body["siteUrl"] as string | undefined)?.trim();
    const description = (body["description"] as string | undefined)?.trim() ?? null;
    const isOpenFunnel = Boolean(body["isOpenFunnel"] ?? false);
    const ga4PropertyId = (body["ga4PropertyId"] as string | undefined)?.trim() ?? null;
    const breakdownDimension = (body["breakdownDimension"] as string | undefined)?.trim() ?? null;
    const steps = body["steps"] as unknown[] | undefined;

    if (!name) return void res.status(400).json({ ok: false, error: "name is required" });
    if (!siteUrl) return void res.status(400).json({ ok: false, error: "siteUrl is required" });

    const daysResult = validateLookbackDays(body["lookbackDays"]);
    if (typeof daysResult === "string") return void res.status(400).json({ ok: false, error: daysResult });
    const lookbackDays = daysResult;

    if (breakdownDimension && !ALLOWED_BREAKDOWN_DIMENSIONS.has(breakdownDimension)) {
      return void res.status(400).json({ ok: false, error: `Invalid breakdownDimension: ${breakdownDimension}` });
    }
    if (!Array.isArray(steps)) {
      return void res.status(400).json({ ok: false, error: "steps must be an array" });
    }
    const stepsErr = validateSteps(steps);
    if (stepsErr) return void res.status(400).json({ ok: false, error: stepsErr });

    const owned = await assertSiteOwnership(orgId, siteUrl);
    if (!owned) return void res.status(404).json({ ok: false, error: "Site not found for this organisation" });

    const funnelId = randomUUID();
    const now = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO funnels
           (id, org_id, site_url, name, description, ga4_property_id,
            is_open_funnel, lookback_days, breakdown_dimension, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [funnelId, orgId, siteUrl, name, description, ga4PropertyId,
         isOpenFunnel, lookbackDays, breakdownDimension, orgId, now, now]
      );

      for (const step of (steps as StepInput[]).sort((a, b) => (a.position as number) - (b.position as number))) {
        await client.query(
          `INSERT INTO funnel_steps
             (id, org_id, funnel_id, position, name, event_name,
              page_path_match_type, page_path_value, parameter_filters, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            randomUUID(), orgId, funnelId, step.position as number,
            (step.name as string).trim(),
            (step.eventName as string | undefined)?.trim() ?? null,
            (step.pagePathMatchType as string | undefined) ?? null,
            (step.pagePathValue as string | undefined)?.trim() ?? null,
            step.parameterFilters ? JSON.stringify(step.parameterFilters) : null,
            now, now,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true, id: funnelId, funnelId });
  } catch (e) {
    handleError(res, e, "POST /funnels");
  }
});

// ── GET /api/funnels/:id ──────────────────────────────────────────────────────

router.get("/funnels/:id", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      const r = await client.query(
        `${FUNNEL_SELECT} WHERE f.id = $1 AND f.org_id = $2 GROUP BY f.id`,
        [id, orgId]
      );
      if (!r.rows[0]) return void res.status(404).json({ ok: false, error: "Not found" });
      res.json({ ok: true, funnel: r.rows[0] });
    } finally {
      client.release();
    }
  } catch (e) {
    handleError(res, e, "GET /funnels/:id");
  }
});

// ── PATCH /api/funnels/:id ────────────────────────────────────────────────────

router.patch("/funnels/:id", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params as { id: string };
    const body = { ...(req.body as Record<string, unknown>) };
    delete body["orgId"];

    const setClauses: string[] = [];
    const params: unknown[] = [];

    function addSet(clause: string, val: unknown): void {
      params.push(val);
      setClauses.push(`${clause} = $${params.length}`);
    }

    if (body["name"] !== undefined) {
      const n = (body["name"] as string).trim();
      if (!n) return void res.status(400).json({ ok: false, error: "name cannot be empty" });
      addSet("name", n);
    }
    if (body["description"] !== undefined) addSet("description", (body["description"] as string | null) ?? null);
    if (body["isOpenFunnel"] !== undefined) addSet("is_open_funnel", Boolean(body["isOpenFunnel"]));
    if (body["lookbackDays"] !== undefined) {
      const d = validateLookbackDays(body["lookbackDays"]);
      if (typeof d === "string") return void res.status(400).json({ ok: false, error: d });
      addSet("lookback_days", d);
    }
    if (body["breakdownDimension"] !== undefined) {
      const bd = (body["breakdownDimension"] as string | null) ?? null;
      if (bd && !ALLOWED_BREAKDOWN_DIMENSIONS.has(bd)) {
        return void res.status(400).json({ ok: false, error: `Invalid breakdownDimension: ${bd}` });
      }
      addSet("breakdown_dimension", bd);
    }

    let replaceSteps = false;
    if (body["steps"] !== undefined) {
      if (!Array.isArray(body["steps"])) {
        return void res.status(400).json({ ok: false, error: "steps must be an array" });
      }
      const err = validateSteps(body["steps"] as unknown[]);
      if (err) return void res.status(400).json({ ok: false, error: err });
      replaceSteps = true;
    }

    if (setClauses.length === 0 && !replaceSteps) {
      return void res.status(400).json({ ok: false, error: "No valid fields to update" });
    }

    addSet("updated_at", new Date().toISOString());
    params.push(id);
    params.push(orgId);
    const whereId = params.length - 1;
    const whereOrg = params.length;

    const client = await pool.connect();
    try {
      // Verify ownership first
      const check = await client.query(
        `SELECT id FROM funnels WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [id, orgId]
      );
      if (!check.rows[0]) return void res.status(404).json({ ok: false, error: "Not found" });

      await client.query("BEGIN");

      await client.query(
        `UPDATE funnels SET ${setClauses.join(", ")} WHERE id = $${whereId} AND org_id = $${whereOrg}`,
        params
      );

      if (replaceSteps) {
        await client.query(
          `DELETE FROM funnel_steps WHERE funnel_id = $1 AND org_id = $2`,
          [id, orgId]
        );
        const now = new Date().toISOString();
        for (const step of (body["steps"] as StepInput[]).sort(
          (a, b) => (a.position as number) - (b.position as number)
        )) {
          await client.query(
            `INSERT INTO funnel_steps
               (id, org_id, funnel_id, position, name, event_name,
                page_path_match_type, page_path_value, parameter_filters, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              randomUUID(), orgId, id, step.position as number,
              (step.name as string).trim(),
              (step.eventName as string | undefined)?.trim() ?? null,
              (step.pagePathMatchType as string | undefined) ?? null,
              (step.pagePathValue as string | undefined)?.trim() ?? null,
              step.parameterFilters ? JSON.stringify(step.parameterFilters) : null,
              now, now,
            ]
          );
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (e) {
    handleError(res, e, "PATCH /funnels/:id");
  }
});

// ── DELETE /api/funnels/:id ───────────────────────────────────────────────────

router.delete("/funnels/:id", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM funnel_steps WHERE funnel_id = $1 AND org_id = $2`,
        [id, orgId]
      );
      const r = await client.query(
        `DELETE FROM funnels WHERE id = $1 AND org_id = $2 RETURNING id`,
        [id, orgId]
      );
      await client.query("COMMIT");
      if (!r.rows[0]) return void res.status(404).json({ ok: false, error: "Not found" });
      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    handleError(res, e, "DELETE /funnels/:id");
  }
});

// ── POST /api/funnels/:id/run ─────────────────────────────────────────────────

router.post("/funnels/:id/run", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params as { id: string };
    const body = { ...(req.body as Record<string, unknown>) };
    // Security: never accept orgId or propertyId from client
    delete body["orgId"];
    delete body["propertyId"];
    delete body["ga4PropertyId"];

    const daysResult = validateLookbackDays(body["lookbackDays"]);
    if (typeof daysResult === "string") {
      return void res.status(400).json({ ok: false, error: daysResult });
    }
    const overrideDays = body["lookbackDays"] !== undefined ? daysResult : null;

    // Load funnel with org guard
    const client = await pool.connect();
    let funnel: Record<string, unknown>;
    let steps: Array<Record<string, unknown>>;
    try {
      const fr = await client.query(
        `SELECT * FROM funnels WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [id, orgId]
      );
      if (!fr.rows[0]) return void res.status(404).json({ ok: false, error: "Funnel not found" });
      funnel = fr.rows[0] as Record<string, unknown>;

      const sr = await client.query(
        `SELECT * FROM funnel_steps WHERE funnel_id = $1 AND org_id = $2 ORDER BY position`,
        [id, orgId]
      );
      steps = sr.rows as Array<Record<string, unknown>>;
    } finally {
      client.release();
    }

    if (steps.length < 2) {
      return void res.status(400).json({ ok: false, error: "Funnel has no steps configured (min 2)" });
    }

    // propertyId ALWAYS from server — never from client
    const storedProp = await getStoredProperty(orgId);
    if (!storedProp) {
      return void res.status(409).json({
        ok: false,
        error: "GA4 property not configured for this organisation",
        code: "GA4_PROPERTY_NOT_CONFIGURED",
      });
    }

    const lookbackDays = overrideDays ?? (funnel["lookback_days"] as number) ?? 30;
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);

    const stepConfigs = steps.map(s => ({
      position: s["position"] as number,
      name: s["name"] as string,
      eventName: (s["event_name"] as string | null) ?? null,
      pagePathMatchType: (s["page_path_match_type"] as string | null) ?? null,
      pagePathValue: (s["page_path_value"] as string | null) ?? null,
      parameterFilters: s["parameter_filters"] ?? null,
    }));

    const result = await runConfiguredFunnel({
      orgId,
      siteUrl: funnel["site_url"] as string,
      propertyId: storedProp.propertyId,
      startDate,
      endDate,
      isOpenFunnel: Boolean(funnel["is_open_funnel"]),
      steps: stepConfigs,
      breakdownDimension: (funnel["breakdown_dimension"] as string | null) ?? null,
      funnelId: id,
    });

    res.json({ ok: true, result });
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    if (err.code === "GA4_NOT_CONNECTED") {
      return void res.status(409).json({ ok: false, error: err.message, code: err.code });
    }
    handleError(res, e, "POST /funnels/:id/run");
  }
});

export default router;
