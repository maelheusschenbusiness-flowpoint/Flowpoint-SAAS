import { Router, type Request, type Response } from "express";
import { promises as dns } from "node:dns";
import https from "node:https";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

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

router.get("/white-label/domains", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(`SELECT * FROM custom_domains WHERE org_id=$1 ORDER BY created_at DESC`, [org(req)]);
    res.json({ domains: r.rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch domains" });
  }
});

router.post("/white-label/domains", async (req: Request, res: Response) => {
  // Feature gate — loadBillingContext overlays plan-bundled add-ons so Ultra
  // subscribers are granted access without a manual org_addons row.
  const { loadBillingContext } = await import("../services/billing-context.js");
  const ctx = await loadBillingContext(org(req)).catch(() => null);
  if (!ctx?.addons?.["customDomain"]) {
    res.status(403).json({ error: "Custom domain add-on required" }); return;
  }
  const { domain } = req.body ?? {};
  if (!domain) { res.status(400).json({ error: "domain required" }); return; }
  const { randomBytes } = await import("node:crypto");
  const id    = `cd_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const token = `fpv_${randomBytes(16).toString("hex")}`;
  try {
    await db(req)(
      `INSERT INTO custom_domains (id, org_id, domain, status, ssl_active, verification_token)
       VALUES ($1,$2,$3,'pending_dns',false,$4)`,
      [id, org(req), domain, token]
    );
    res.status(201).json({
      ok: true, id, verificationToken: token, status: "pending_dns",
      instructions: {
        step1: `Ajoutez un enregistrement DNS TXT sur votre domaine :`,
        record: `_flowpoint-verify.${domain}`, value: token,
        note: "La propagation DNS peut prendre jusqu'à 24h. Cliquez 'Vérifier' une fois le record ajouté.",
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to add domain" });
  }
});

router.post("/white-label/domains/:id/verify", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const r = await db(req)(`SELECT * FROM custom_domains WHERE id=$1 AND org_id=$2`, [id, org(req)]);
    if (!r.rows.length) { res.status(404).json({ error: "Domain not found" }); return; }
    const { domain, verification_token } = r.rows[0] as Record<string, string>;

    let verified = false;
    let dnsError: string | null = null;
    try {
      const txtRecords = await dns.resolveTxt(`_flowpoint-verify.${domain}`);
      verified = txtRecords.flat().includes(verification_token ?? "");
    } catch (err) {
      dnsError = String((err as NodeJS.ErrnoException).code ?? err);
      logger.info({ domain, dnsError }, "[WhiteLabel] DNS TXT lookup failed");
    }

    if (!verified) {
      await db(req)(`UPDATE custom_domains SET status='pending_dns', updated_at=now() WHERE id=$1 AND org_id=$2`, [id, org(req)]);
      res.status(422).json({
        ok: false, status: "pending_dns", verified: false, dnsError,
        message: `Enregistrement DNS TXT introuvable. Ajoutez _flowpoint-verify.${domain} → ${verification_token ?? ""} et réessayez dans quelques minutes.`,
        required: { host: `_flowpoint-verify.${domain}`, type: "TXT", value: verification_token },
      }); return;
    }

    await db(req)(`UPDATE custom_domains SET status='dns_verified', ssl_active=false, verified_at=now(), updated_at=now() WHERE id=$1 AND org_id=$2`, [id, org(req)]);
    res.json({
      ok: true, status: "dns_verified", sslActive: false,
      message: "DNS vérifié avec succès. SSL doit être configuré manuellement via votre hébergeur ou proxy (Cloudflare, Caddy, Nginx + Let's Encrypt).",
      nextStep: "Configurez votre proxy/hébergeur pour pointer ce domaine vers FlowPoint, puis utilisez /ssl-check pour confirmer le SSL.",
    });
  } catch (err) {
    logger.error({ err }, "[WhiteLabel] Verify failed");
    res.status(500).json({ error: "Failed to verify domain" });
  }
});

router.post("/white-label/domains/:id/ssl-check", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const r = await db(req)(`SELECT domain, status FROM custom_domains WHERE id=$1 AND org_id=$2`, [id, org(req)]);
    if (!r.rows.length) { res.status(404).json({ error: "Domain not found" }); return; }
    const { domain, status } = r.rows[0] as Record<string, string>;
    if (status !== "dns_verified" && status !== "ssl_pending") {
      res.status(400).json({ error: "DNS must be verified before SSL check", status }); return;
    }

    const sslOk = await new Promise<boolean>((resolve) => {
      const req2 = https.request(
        { hostname: domain, path: "/", method: "HEAD", timeout: 8000, rejectUnauthorized: true },
        () => resolve(true)
      );
      req2.on("error", () => resolve(false));
      req2.on("timeout", () => { req2.destroy(); resolve(false); });
      req2.end();
    });

    const newStatus = sslOk ? "ssl_active" : "ssl_pending";
    await db(req)(`UPDATE custom_domains SET status=$1, ssl_active=$2, updated_at=now() WHERE id=$3 AND org_id=$4`, [newStatus, sslOk, id, org(req)]);
    res.json({
      ok: true, status: newStatus, sslActive: sslOk,
      message: sslOk
        ? "SSL actif — votre domaine personnalisé est opérationnel."
        : "SSL non détecté. Configurez votre proxy (Cloudflare, Caddy, ou Nginx + Let's Encrypt) pour activer HTTPS sur ce domaine.",
      note: "La provisioning SSL automatique n'est pas disponible. Configuration manuelle requise côté hébergeur/proxy.",
    });
  } catch (err) {
    logger.error({ err }, "[WhiteLabel] SSL check failed");
    res.status(500).json({ error: "Failed to perform SSL check" });
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
