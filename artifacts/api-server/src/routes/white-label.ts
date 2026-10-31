import { Router, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import {
  CustomDomainError,
  isCustomSubdomain,
  normalizeCustomDomain,
  ensureRenderCustomDomain,
  refreshRenderCustomDomain,
  deleteRenderCustomDomain,
  verifyDomainTxtRecord,
  verifyHttpsDomainRoute,
} from "../services/custom-domain-service.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);
const PG_UNIQUE_VIOLATION = "23505";

type CustomDomainRow = {
  id: string;
  org_id: string;
  domain: string;
  status: string;
  ssl_active: boolean;
  verification_token: string | null;
  verified_at: string | null;
  render_domain_id: string | null;
  render_target_host: string | null;
  last_error: string | null;
};

function domainError(err: unknown): { statusCode: number; code: string; message: string } {
  if (err instanceof CustomDomainError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message };
  }
  const code = pgCode(err);
  if (code === PG_UNIQUE_VIOLATION) {
    return { statusCode: 409, code: "DOMAIN_ALREADY_CLAIMED", message: "This domain is already registered." };
  }
  return { statusCode: 500, code: "CUSTOM_DOMAIN_ERROR", message: "The custom-domain request could not be completed." };
}

async function requireCustomDomainEntitlement(orgId: string): Promise<boolean> {
  const { loadBillingContext } = await import("../services/billing-context.js");
  const ctx = await loadBillingContext(orgId).catch(() => null);
  return Boolean(ctx?.addons?.["customDomain"]);
}

// ── SQL error classification ────────────────────────────────────────────────
// Reliability: never disguise a schema/SQL failure as a legitimate empty
// result. A missing table/column is schema drift that our idempotent init can
// self-heal; anything else is a genuine failure that MUST surface as 500 so the
// frontend can show a retry — not a silent {templates:[]} that looks empty.
const PG_UNDEFINED_TABLE  = "42P01";
const PG_UNDEFINED_COLUMN = "42703";
function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code
    ?? (err as { raw?: { code?: string } })?.raw?.code;
}
function isSchemaMissing(err: unknown): boolean {
  const code = pgCode(err);
  return code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN;
}
async function selfHealDataTables(): Promise<void> {
  const { initDataTables } = await import("../services/init-data-tables.js");
  await initDataTables();
}

// ── Report templates ──────────────────────────────────────────────────────────

router.get("/white-label/templates", async (req: Request, res: Response) => {
  // Stable contract: on success ALWAYS { templates: [...] } scoped to the
  // authenticated org (real persisted rows — a genuinely empty org yields []).
  // On failure NEVER return {templates:[]} (that hides the error); return 500
  // so the frontend can show a retry. Missing schema → self-heal once + retry.
  const sql = `SELECT * FROM report_templates WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`;
  const orgId = org(req);
  try {
    const r = await db(req)(sql, [orgId]);
    res.json({ templates: r.rows ?? [] });
  } catch (err) {
    if (isSchemaMissing(err)) {
      logger.warn({ orgId, code: pgCode(err) }, "[WhiteLabel] report_templates schema missing — self-healing and retrying");
      try {
        await selfHealDataTables();
        const r = await db(req)(sql, [orgId]);
        res.json({ templates: r.rows ?? [] });
        return;
      } catch (retryErr) {
        logger.error({ err: retryErr, orgId }, "[WhiteLabel] templates fetch failed after self-heal");
        res.status(500).json({ error: "Failed to fetch templates" });
        return;
      }
    }
    logger.error({ err, orgId }, "[WhiteLabel] templates fetch failed");
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.post("/white-label/templates", async (req: Request, res: Response) => {
  // Feature gate — loadBillingContext overlays plan-bundled add-ons so Pro/Ultra
  // subscribers are granted access without a manual org_addons row.
  const { loadBillingContext } = await import("../services/billing-context.js");
  const ctx = await loadBillingContext(org(req)).catch(() => null);
  if (!ctx?.addons?.["whiteLabel"]) {
    res.status(403).json({ error: "White-label add-on required" }); return;
  }
  const { name, logoUrl, primaryColor, secondaryColor, font, footerText, headerText, hideFlowpointBranding, isDefault } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const orgId = org(req);
  const id = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    if (isDefault) {
      await db(req)(`UPDATE report_templates SET is_default=false WHERE org_id=$1`, [orgId]);
    }
    await db(req)(
      `INSERT INTO report_templates (id, org_id, name, logo_url, primary_color, secondary_color, font, footer_text, header_text, hide_flowpoint_branding, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, orgId, name, logoUrl ?? null, primaryColor ?? "#2563EB", secondaryColor ?? "#22c55e",
       font ?? "Inter", footerText ?? null, headerText ?? null,
       hideFlowpointBranding ?? false, isDefault ?? false]
    );
    res.status(201).json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.patch("/white-label/templates/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = { ...(req.body ?? {}) };
  if (body.orgId !== undefined || body.org_id !== undefined) logger.debug({ id }, "[WhiteLabel] Ignoring client-supplied orgId/org_id. Using authenticated context.");
  delete body.id; delete body.orgId; delete body.org_id;

  const setClauses: string[] = ["updated_at=now()"];
  const params: unknown[] = [];

  const map: Record<string, string> = {
    name: "name", logoUrl: "logo_url", primaryColor: "primary_color", secondaryColor: "secondary_color",
    font: "font", footerText: "footer_text", headerText: "header_text",
    hideFlowpointBranding: "hide_flowpoint_branding", isDefault: "is_default",
  };
  for (const [key, col] of Object.entries(map)) {
    if (body[key] !== undefined) { params.push(body[key]); setClauses.push(`${col}=$${params.length}`); }
  }

  params.push(id, org(req));
  try {
    await db(req)(
      `UPDATE report_templates SET ${setClauses.join(",")} WHERE id=$${params.length - 1} AND org_id=$${params.length}`,
      params
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update template" });
  }
});

// ── Custom domains ────────────────────────────────────────────────────────────

router.get("/white-label/domains", requireAdmin, async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT id, org_id, domain, status, ssl_active, verification_token,
              verified_at, render_domain_id, render_target_host, last_error,
              created_at, updated_at
         FROM custom_domains WHERE org_id=$1 ORDER BY created_at DESC`,
      [org(req)],
    );
    res.json({ domains: r.rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch domains" });
  }
});

router.post("/white-label/domains", requireAdmin, async (req: Request, res: Response) => {
  const orgId = org(req);
  if (!await requireCustomDomainEntitlement(orgId)) {
    res.status(403).json({ error: "Custom domain add-on required" }); return;
  }

  let domain: string;
  try {
    domain = normalizeCustomDomain(req.body?.domain);
  } catch (err) {
    const failure = domainError(err);
    res.status(failure.statusCode).json({ error: failure.message, code: failure.code });
    return;
  }
  if (!isCustomSubdomain(domain)) {
    res.status(400).json({
      error: "Beta supports a client subdomain such as portal.example.com; root and www domains are not accepted.",
      code: "SUBDOMAIN_REQUIRED",
    });
    return;
  }

  try {
    const indexCheck = await db(req)(
      `SELECT
         COALESCE((SELECT i.indisunique FROM pg_index i
                    WHERE i.indexrelid=to_regclass('public.custom_domains_domain_unique_idx')
                    LIMIT 1), false) AS domain_index_is_unique,
         COALESCE((SELECT i.indisunique FROM pg_index i
                    WHERE i.indexrelid=to_regclass('public.custom_domains_org_unique_idx')
                    LIMIT 1), false) AS org_index_is_unique`,
    );
    if (indexCheck.rows[0]?.domain_index_is_unique !== true || indexCheck.rows[0]?.org_index_is_unique !== true) {
      res.status(503).json({
        error: "Domain ownership protection is not ready. Contact support before trying again.",
        code: "DOMAIN_UNIQUENESS_GUARD_UNAVAILABLE",
      });
      return;
    }

    const existing = await db(req)(
      `SELECT id FROM custom_domains WHERE org_id=$1 LIMIT 1`,
      [orgId],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({
        error: "This organization already has a custom domain. Remove it before replacing it.",
        code: "DOMAIN_LIMIT_REACHED",
      });
      return;
    }

    const id = `cd_${randomUUID()}`;
    const token = `fpv_${randomBytes(32).toString("hex")}`;
    await db(req)(
      `INSERT INTO custom_domains
         (id, org_id, domain, status, ssl_active, verification_token, created_at, updated_at)
       VALUES ($1,$2,$3,'pending_dns',false,$4,NOW(),NOW())`,
      [id, orgId, domain, token],
    );
    res.status(201).json({
      ok: true,
      id,
      domain,
      status: "pending_dns",
      verificationToken: token,
      instructions: {
        record: { host: `_flowpoint-verify.${domain}`, type: "TXT", value: token },
        note: "Add this TXT record first. Render is not contacted until ownership is verified.",
      },
    });
  } catch (err) {
    const failure = domainError(err);
    if (failure.statusCode >= 500) logger.error({ err, orgId }, "[WhiteLabel] Domain claim creation failed");
    res.status(failure.statusCode).json({ error: failure.message, code: failure.code });
  }
});

async function verifyCustomDomain(req: Request, res: Response): Promise<void> {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  const orgId = org(req);
  if (!await requireCustomDomainEntitlement(orgId)) {
    res.status(403).json({ error: "Custom domain entitlement required" }); return;
  }

  try {
    const read = await db(req)(
      `SELECT id, org_id, domain, status, ssl_active, verification_token,
              verified_at, render_domain_id, render_target_host, last_error
         FROM custom_domains WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [id, orgId],
    );
    const row = read.rows[0] as CustomDomainRow | undefined;
    if (!row) { res.status(404).json({ error: "Domain not found" }); return; }
    if (row.status === "active" && row.ssl_active) {
      res.json({ ok: true, status: "active", sslActive: true, domain: row.domain, message: "HTTPS and workspace routing are active." });
      return;
    }

    let token = row.verification_token;
    if (!token) {
      token = `fpv_${randomBytes(32).toString("hex")}`;
      await db(req)(
        `UPDATE custom_domains
            SET verification_token=$1, status='pending_dns', ssl_active=false,
                render_domain_id=NULL, render_target_host=NULL, last_error=NULL, updated_at=NOW()
          WHERE id=$2 AND org_id=$3`,
        [token, id, orgId],
      );
      res.json({
        ok: true,
        status: "pending_dns",
        instructions: { record: { host: `_flowpoint-verify.${row.domain}`, type: "TXT", value: token } },
        message: "Add the TXT ownership record, then verify again.",
      });
      return;
    }

    const txt = await verifyDomainTxtRecord(row.domain, token);
    if (!txt.verified) {
      await db(req)(
        `UPDATE custom_domains SET status='pending_dns', ssl_active=false, last_checked_at=NOW(),
                last_error=NULL, updated_at=NOW()
          WHERE id=$1 AND org_id=$2`,
        [id, orgId],
      );
      res.status(422).json({
        ok: false,
        status: "pending_dns",
        code: "DOMAIN_TXT_NOT_VERIFIED",
        dnsCode: txt.dnsCode,
        required: { host: `_flowpoint-verify.${row.domain}`, type: "TXT", value: token },
        message: "Ownership TXT record was not found yet. Check the value and retry after DNS propagation.",
      });
      return;
    }

    let renderDomain: {
      id: string;
      name: string;
      verificationStatus: "verified" | "unverified";
      targetHost: string;
    } | null = row.render_domain_id
      ? { id: row.render_domain_id, name: row.domain, verificationStatus: "unverified", targetHost: row.render_target_host ?? "" }
      : null;
    if (!renderDomain) {
      try {
        renderDomain = await ensureRenderCustomDomain(row.domain);
        await db(req)(
          `UPDATE custom_domains
              SET status='render_pending', ssl_active=false, render_domain_id=$1,
                  render_target_host=$2, verified_at=COALESCE(verified_at,NOW()),
                  last_checked_at=NOW(), last_error=NULL, updated_at=NOW()
            WHERE id=$3 AND org_id=$4`,
          [renderDomain.id, renderDomain.targetHost, id, orgId],
        );
      } catch (err) {
        const failure = domainError(err);
        await db(req)(
          `UPDATE custom_domains SET status='ownership_verified', ssl_active=false,
                  last_checked_at=NOW(), last_error=$1, updated_at=NOW()
            WHERE id=$2 AND org_id=$3`,
          [failure.code, id, orgId],
        ).catch(() => undefined);
        res.status(failure.statusCode).json({
          error: failure.message,
          code: failure.code,
          status: "ownership_verified",
          message: "Domain ownership is proven, but Render provisioning is not complete.",
        });
        return;
      }
    }

    if (!renderDomain) {
      throw new CustomDomainError("Render domain was not resolved", "RENDER_DOMAIN_INVALID_RESPONSE", 502);
    }

    try {
      const refreshed = await refreshRenderCustomDomain(row.domain, renderDomain.id);
      if (refreshed.verificationStatus !== "verified") {
        await db(req)(
          `UPDATE custom_domains SET status='render_pending', ssl_active=false,
                  render_target_host=$1, last_checked_at=NOW(), last_error=NULL, updated_at=NOW()
            WHERE id=$2 AND org_id=$3`,
          [refreshed.targetHost, id, orgId],
        );
        res.status(202).json({
          ok: true,
          status: "render_pending",
          domain: row.domain,
          dns: { host: row.domain, type: "CNAME", value: refreshed.targetHost },
          removeAaaa: true,
          message: "Render has not verified the DNS route yet. Add the CNAME record and retry.",
        });
        return;
      }

      await db(req)(
        `UPDATE custom_domains SET status='render_verified', ssl_active=false,
                render_target_host=$1, last_checked_at=NOW(), last_error=NULL, updated_at=NOW()
          WHERE id=$2 AND org_id=$3`,
        [refreshed.targetHost, id, orgId],
      );

      const routed = await verifyHttpsDomainRoute(row.domain, id, refreshed.targetHost);
      if (!routed) {
        await db(req)(
          `UPDATE custom_domains SET status='tls_pending', ssl_active=false,
                  last_checked_at=NOW(), last_error='https_route_not_ready', updated_at=NOW()
            WHERE id=$1 AND org_id=$2`,
          [id, orgId],
        );
        res.status(202).json({
          ok: true,
          status: "tls_pending",
          domain: row.domain,
          dns: { host: row.domain, type: "CNAME", value: refreshed.targetHost },
          removeAaaa: true,
          message: "Render verified DNS. Waiting for a valid HTTPS certificate and a successful route check.",
        });
        return;
      }

      await db(req)(
        `UPDATE custom_domains SET status='active', ssl_active=true,
                last_checked_at=NOW(), last_error=NULL, updated_at=NOW()
          WHERE id=$1 AND org_id=$2`,
        [id, orgId],
      );
      res.json({
        ok: true,
        status: "active",
        sslActive: true,
        domain: row.domain,
        message: "HTTPS and organization routing were verified.",
      });
    } catch (err) {
      const failure = domainError(err);
      logger.warn({ code: failure.code, domainId: id, orgId }, "[WhiteLabel] Render domain verification failed");
      await db(req)(
        `UPDATE custom_domains SET status='render_pending', ssl_active=false,
                last_checked_at=NOW(), last_error=$1, updated_at=NOW()
          WHERE id=$2 AND org_id=$3`,
        [failure.code, id, orgId],
      ).catch(() => undefined);
      res.status(failure.statusCode).json({ error: failure.message, code: failure.code, status: "render_pending" });
    }
  } catch (err) {
    logger.error({ err, domainId: id, orgId }, "[WhiteLabel] Domain verification failed");
    res.status(500).json({ error: "Failed to verify custom domain", code: "CUSTOM_DOMAIN_VERIFY_FAILED" });
  }
}

router.post("/white-label/domains/:id/verify", requireAdmin, verifyCustomDomain);
// Preserve the older endpoint as an alias while the dashboard moves to /verify.
router.post("/white-label/domains/:id/ssl-check", requireAdmin, verifyCustomDomain);

router.delete("/white-label/domains/:id", requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const orgId = org(req);
  try {
    const read = await db(req)(
      `SELECT render_domain_id FROM custom_domains WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [id, orgId],
    );
    if (!read.rows[0]) { res.status(404).json({ error: "Domain not found" }); return; }
    const renderDomainId = (read.rows[0] as { render_domain_id?: string | null }).render_domain_id ?? null;

    // Revoke tenant routing before asking Render to remove the hostname. If
    // Render is unavailable, the row remains non-routable and can be retried.
    await db(req)(
      `UPDATE custom_domains SET status='deletion_pending', ssl_active=false,
              last_error=NULL, updated_at=NOW()
        WHERE id=$1 AND org_id=$2`,
      [id, orgId],
    );
    if (renderDomainId) {
      try {
        await deleteRenderCustomDomain(renderDomainId);
      } catch (err) {
        const failure = domainError(err);
        await db(req)(
          `UPDATE custom_domains SET last_error=$1, updated_at=NOW()
            WHERE id=$2 AND org_id=$3`,
          [failure.code, id, orgId],
        ).catch(() => undefined);
        res.status(failure.statusCode).json({ error: failure.message, code: failure.code, status: "deletion_pending" });
        return;
      }
    }
    await db(req)(`DELETE FROM custom_domains WHERE id=$1 AND org_id=$2`, [id, orgId]);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, domainId: id, orgId }, "[WhiteLabel] Domain deletion failed");
    res.status(500).json({ error: "Failed to remove custom domain" });
  }
});

// ── Exports ────────────────────────────────────────────────────────────────────

router.get("/white-label/exports", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(`SELECT * FROM report_exports WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20`, [org(req)]);
    res.json({ exports: r.rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch exports" });
  }
});

export default router;
