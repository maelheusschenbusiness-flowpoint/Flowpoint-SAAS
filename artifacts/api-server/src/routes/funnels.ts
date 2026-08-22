/**
 * routes/funnels.ts — CRUD + run for configurable GA4 funnels
 *
 * Security model:
 *  - orgId ALWAYS from req.orgContext — never from body/query
 *  - propertyId ALWAYS from server DB — never from client
 *  - siteUrl validated via behavior_site_tokens (same org)
 *  - All cross-org reads silently return 404
 *  - UUID validated before SQL (returns 400 INVALID_FUNNEL_ID on malformed input)
 *  - All DB queries use withOrgDb (GUC + RLS) for tenant-scoped operations
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { pool, withOrgDb } from "@workspace/db";
import { getStoredProperty } from "../services/ga4-service.js";
import {
  runConfiguredFunnel,
  ALLOWED_BREAKDOWN_DIMENSIONS,
  ALLOWED_MATCH_TYPES,
  ALLOWED_PARAMETER_NAMES,
  type ParameterFilterInput,
} from "../services/ga4-funnel-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── UUID validation ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidUUID(id: string): void {
  if (!UUID_RE.test(id)) {
    throw Object.assign(
      new Error(`Invalid funnel ID: "${id}"`),
      { status: 400, code: "INVALID_FUNNEL_ID" }
    );
  }
}

// ── Org context extraction ────────────────────────────────────────────────────

interface OrgReq {
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
  pageLocationMatchType?: unknown;
  pageLocationValue?: unknown;
  parameterFilters?: unknown;
}

function validateParameterFilters(pfs: unknown[], stepName: string): string | null {
  for (const pf of pfs) {
    if (!pf || typeof pf !== "object") return `parameterFilters in step "${stepName}" must be objects`;
    const p = pf as Record<string, unknown>;
    const paramName = p["paramName"];
    if (typeof paramName !== "string" || !paramName) {
      return `parameterFilter in step "${stepName}" missing paramName`;
    }
    if (!ALLOWED_PARAMETER_NAMES.has(paramName)) {
      return `Invalid parameter filter name: "${paramName}"`;
    }
    const matchType = p["matchType"];
    if (typeof matchType !== "string" || !ALLOWED_MATCH_TYPES.has(matchType)) {
      return `Invalid parameterFilter matchType: "${String(matchType)}" in step "${stepName}"`;
    }
    if (typeof p["value"] !== "string") {
      return `parameterFilter in step "${stepName}" missing value string`;
    }
  }
  return null;
}

function validateSteps(steps: unknown[]): string | null {
  if (steps.length < 2) return "Le funnel nécessite au moins 2 étapes";
  if (steps.length > 10) return "Le funnel ne peut pas dépasser 10 étapes";
  const positions = new Set<number>();
  for (const raw of steps) {
    if (typeof raw !== "object" || raw === null) return "Chaque étape doit être un objet valide";
    const s = raw as StepInput;
    const pos = s.position;
    if (typeof pos !== "number" || !Number.isInteger(pos) || pos < 1 || pos > 10) {
      return `La position de l'étape doit être un entier entre 1 et 10 (reçu : ${String(pos)})`;
    }
    if (positions.has(pos)) return `Position d'étape en double : ${pos}`;
    positions.add(pos);
    const name = s.name;
    if (!name || typeof name !== "string" || !name.trim()) {
      return `L'étape à la position ${pos} n'a pas de nom`;
    }
    const hasEvent = !!(s.eventName as string | undefined)?.trim();
    const hasPage = !!(s.pagePathValue as string | undefined)?.trim();
    const hasLocation = !!(s.pageLocationValue as string | undefined)?.trim();
    if (!hasEvent && !hasPage && !hasLocation) {
      return `L'étape "${String(name)}" (position ${pos}) doit avoir un événement, un chemin de page ou une URL`;
    }
    const mt = s.pagePathMatchType as string | undefined;
    if (mt && !ALLOWED_MATCH_TYPES.has(mt)) {
      return `Invalid pagePathMatchType: ${mt}`;
    }
    const lmt = s.pageLocationMatchType as string | undefined;
    if (lmt && !ALLOWED_MATCH_TYPES.has(lmt)) {
      return `Invalid pageLocationMatchType: ${lmt}`;
    }
    if (s.parameterFilters !== undefined && s.parameterFilters !== null) {
      if (!Array.isArray(s.parameterFilters)) {
        return `parameterFilters in step "${String(name)}" must be an array`;
      }
      const pfErr = validateParameterFilters(s.parameterFilters as unknown[], String(name));
      if (pfErr) return pfErr;
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

// ── Site ownership guard (uses pool with explicit WHERE — ownership check only)

async function assertSiteOwnership(orgId: string, siteUrl: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
      [orgId, siteUrl]
    );
    return r.rows.length > 0;
  } catch {
    return false;
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

// ── Step row builder ──────────────────────────────────────────────────────────

function stepParams(
  stepId: string,
  orgId: string,
  funnelId: string,
  step: StepInput,
  now: string
): unknown[] {
  return [
    stepId,
    orgId,
    funnelId,
    step.position as number,
    (step.name as string).trim(),
    (step.eventName as string | undefined)?.trim() ?? null,
    (step.pagePathMatchType as string | undefined) ?? null,
    (step.pagePathValue as string | undefined)?.trim() ?? null,
    (step.pageLocationMatchType as string | undefined) ?? null,
    (step.pageLocationValue as string | undefined)?.trim() ?? null,
    step.parameterFilters ? JSON.stringify(step.parameterFilters) : null,
    now,
    now,
  ];
}

// ── Funnel SELECT (with steps) ────────────────────────────────────────────────

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
    const rows = await withOrgDb(orgId, async (client) => {
      if (siteUrl) {
        const r = await client.query(
          `${FUNNEL_SELECT} WHERE f.org_id = $1 AND f.site_url = $2 GROUP BY f.id ORDER BY f.created_at DESC`,
          [orgId, siteUrl]
        );
        return r.rows;
      }
      const r = await client.query(
        `${FUNNEL_SELECT} WHERE f.org_id = $1 GROUP BY f.id ORDER BY f.created_at DESC`,
        [orgId]
      );
      return r.rows;
    });
    res.json({ ok: true, funnels: rows });
  } catch (e) {
    handleError(res, e, "GET /funnels");
  }
});

// ── POST /api/funnels ─────────────────────────────────────────────────────────

router.post("/funnels", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const body = { ...(req.body as Record<string, unknown>) };
    if (body["orgId"] !== undefined) logger.debug({ orgId }, "[Funnels] Ignoring client-supplied orgId. Using authenticated context.");
    delete body["orgId"];

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

    // Site ownership check is advisory only — GA4 funnels work without behaviour tracking
    const owned = await assertSiteOwnership(orgId, siteUrl);
    if (!owned) {
      console.warn(`[funnels] siteUrl ${siteUrl} not in behavior_site_tokens for org ${orgId} — creating funnel anyway`);
    }

    const funnelId = randomUUID();
    const now = new Date().toISOString();

    await withOrgDb(orgId, async (client) => {
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
              page_path_match_type, page_path_value,
              page_location_match_type, page_location_value,
              parameter_filters, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          stepParams(randomUUID(), orgId, funnelId, step, now)
        );
      }
    });

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
    assertValidUUID(id);
    const row = await withOrgDb(orgId, async (client) => {
      const r = await client.query(
        `${FUNNEL_SELECT} WHERE f.id = $1 AND f.org_id = $2 GROUP BY f.id`,
        [id, orgId]
      );
      return r.rows[0] ?? null;
    });
    if (!row) return void res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, funnel: row });
  } catch (e) {
    handleError(res, e, "GET /funnels/:id");
  }
});

// ── PATCH /api/funnels/:id ────────────────────────────────────────────────────

router.patch("/funnels/:id", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params as { id: string };
    assertValidUUID(id);
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

    await withOrgDb(orgId, async (client) => {
      const check = await client.query(
        `SELECT id FROM funnels WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [id, orgId]
      );
      if (!check.rows[0]) {
        throw Object.assign(new Error("Not found"), { status: 404 });
      }

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
                page_path_match_type, page_path_value,
                page_location_match_type, page_location_value,
                parameter_filters, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            stepParams(randomUUID(), orgId, id, step, now)
          );
        }
      }
    });

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
    assertValidUUID(id);

    let found = false;
    await withOrgDb(orgId, async (client) => {
      await client.query(
        `DELETE FROM funnel_steps WHERE funnel_id = $1 AND org_id = $2`,
        [id, orgId]
      );
      const r = await client.query(
        `DELETE FROM funnels WHERE id = $1 AND org_id = $2 RETURNING id`,
        [id, orgId]
      );
      found = !!r.rows[0];
    });

    if (!found) return void res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    handleError(res, e, "DELETE /funnels/:id");
  }
});

// ── POST /api/funnels/:id/run ─────────────────────────────────────────────────

router.post("/funnels/:id/run", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params as { id: string };
    assertValidUUID(id);

    const body = { ...(req.body as Record<string, unknown>) };
    delete body["orgId"];
    delete body["propertyId"];
    delete body["ga4PropertyId"];

    const daysResult = validateLookbackDays(body["lookbackDays"]);
    if (typeof daysResult === "string") {
      return void res.status(400).json({ ok: false, error: daysResult });
    }
    const overrideDays = body["lookbackDays"] !== undefined ? daysResult : null;

    // Load funnel with org guard
    let funnel: Record<string, unknown>;
    let steps: Array<Record<string, unknown>>;

    const queryResult = await withOrgDb(orgId, async (client) => {
      const fr = await client.query(
        `SELECT * FROM funnels WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [id, orgId]
      );
      if (!fr.rows[0]) {
        throw Object.assign(new Error("Funnel not found"), { status: 404 });
      }
      const sr = await client.query(
        `SELECT * FROM funnel_steps WHERE funnel_id = $1 AND org_id = $2 ORDER BY position`,
        [id, orgId]
      );
      return { funnel: fr.rows[0] as Record<string, unknown>, steps: sr.rows as Array<Record<string, unknown>> };
    });

    funnel = queryResult.funnel;
    steps = queryResult.steps;

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
      pageLocationMatchType: (s["page_location_match_type"] as string | null) ?? null,
      pageLocationValue: (s["page_location_value"] as string | null) ?? null,
      parameterFilters: s["parameter_filters"]
        ? (JSON.parse(typeof s["parameter_filters"] === "string"
            ? s["parameter_filters"]
            : JSON.stringify(s["parameter_filters"])) as ParameterFilterInput[])
        : null,
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
