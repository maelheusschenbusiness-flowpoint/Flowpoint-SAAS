import { Router, type Request, type Response } from "express";
import { db, reportTemplatesTable, customDomainsTable, reportExportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { promises as dns } from "node:dns";
import https from "node:https";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Report templates ──────────────────────────────────────────────────────────

router.get("/white-label/templates", async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(reportTemplatesTable)
      .where(eq(reportTemplatesTable.orgId, "default")).limit(100);
    res.json({ templates });
  } catch {
    res.json({ templates: [] });
  }
});

router.post("/white-label/templates", async (req: Request, res: Response) => {
  if (!store.me.addons?.whiteLabel) {
    res.status(403).json({ error: "White-label add-on required" }); return;
  }
  const { name, logoUrl, primaryColor, secondaryColor, font, footerText, headerText, hideFlowpointBranding, isDefault } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try {
    const id = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (isDefault) {
      await db.update(reportTemplatesTable)
        .set({ isDefault: false })
        .where(eq(reportTemplatesTable.orgId, "default"));
    }
    await db.insert(reportTemplatesTable).values({
      id, orgId: "default", name,
      logoUrl: logoUrl ?? null, primaryColor: primaryColor ?? "#2563EB",
      secondaryColor: secondaryColor ?? "#22c55e", font: font ?? "Inter",
      footerText: footerText ?? null, headerText: headerText ?? null,
      hideFlowpointBranding: hideFlowpointBranding ?? false,
      isDefault: isDefault ?? false,
    });
    res.status(201).json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.patch("/white-label/templates/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body ?? {};
  try {
    delete updates.id; delete updates.orgId;
    await db.update(reportTemplatesTable).set({ ...updates, updatedAt: new Date() }).where(eq(reportTemplatesTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update template" });
  }
});

// ── Custom domains ────────────────────────────────────────────────────────────

router.get("/white-label/domains", async (_req: Request, res: Response) => {
  try {
    const domains = await db.select().from(customDomainsTable).where(eq(customDomainsTable.orgId, "default"));
    res.json({ domains });
  } catch {
    res.status(500).json({ error: "Failed to fetch domains" });
  }
});

router.post("/white-label/domains", async (req: Request, res: Response) => {
  if (!store.me.addons?.customDomain) {
    res.status(403).json({ error: "Custom domain add-on required" }); return;
  }
  const { domain } = req.body ?? {};
  if (!domain) { res.status(400).json({ error: "domain required" }); return; }
  try {
    const { randomBytes } = await import("node:crypto");
    const id    = `cd_${Date.now()}_${randomBytes(3).toString("hex")}`;
    const token = `fpv_${randomBytes(16).toString("hex")}`;
    await db.insert(customDomainsTable).values({
      id, orgId: "default", domain,
      status: "pending_dns",
      sslActive: false,
      verificationToken: token,
    });
    res.status(201).json({
      ok: true, id, verificationToken: token,
      status: "pending_dns",
      instructions: {
        step1: `Ajoutez un enregistrement DNS TXT sur votre domaine :`,
        record: `_flowpoint-verify.${domain}`,
        value: token,
        note: "La propagation DNS peut prendre jusqu'à 24h. Cliquez 'Vérifier' une fois le record ajouté.",
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to add domain" });
  }
});

// ── POST /white-label/domains/:id/verify — real DNS TXT check ─────────────────
router.post("/white-label/domains/:id/verify", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await db.select().from(customDomainsTable).where(eq(customDomainsTable.id, id));
    if (!rows.length) { res.status(404).json({ error: "Domain not found" }); return; }

    const { domain, verificationToken } = rows[0];

    // Real DNS TXT lookup
    let verified = false;
    let dnsError: string | null = null;
    try {
      const txtRecords = await dns.resolveTxt(`_flowpoint-verify.${domain}`);
      const flat = txtRecords.flat();
      verified = flat.includes(verificationToken ?? "");
    } catch (err) {
      dnsError = String((err as NodeJS.ErrnoException).code ?? err);
      logger.info({ domain, dnsError }, "[WhiteLabel] DNS TXT lookup failed");
    }

    if (!verified) {
      await db.update(customDomainsTable)
        .set({ status: "pending_dns", updatedAt: new Date() })
        .where(eq(customDomainsTable.id, id));
      res.status(422).json({
        ok: false,
        status: "pending_dns",
        verified: false,
        dnsError,
        message: `Enregistrement DNS TXT introuvable. Ajoutez _flowpoint-verify.${domain} → ${verificationToken ?? ""} et réessayez dans quelques minutes.`,
        required: { host: `_flowpoint-verify.${domain}`, type: "TXT", value: verificationToken },
      });
      return;
    }

    // DNS verified — mark dns_verified, SSL still pending (not automatic)
    await db.update(customDomainsTable)
      .set({ status: "dns_verified", sslActive: false, verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(customDomainsTable.id, id));

    res.json({
      ok: true,
      status: "dns_verified",
      sslActive: false,
      message: "DNS vérifié avec succès. SSL doit être configuré manuellement via votre hébergeur ou proxy (Cloudflare, Caddy, Nginx + Let's Encrypt).",
      nextStep: "Configurez votre proxy/hébergeur pour pointer ce domaine vers FlowPoint, puis utilisez /ssl-check pour confirmer le SSL.",
    });
  } catch (err) {
    logger.error({ err }, "[WhiteLabel] Verify failed");
    res.status(500).json({ error: "Failed to verify domain" });
  }
});

// ── POST /white-label/domains/:id/ssl-check — optional HTTPS reachability check ──
router.post("/white-label/domains/:id/ssl-check", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await db.select().from(customDomainsTable).where(eq(customDomainsTable.id, id));
    if (!rows.length) { res.status(404).json({ error: "Domain not found" }); return; }

    const { domain, status } = rows[0];
    if (status !== "dns_verified" && status !== "ssl_pending") {
      res.status(400).json({ error: "DNS must be verified before SSL check", status });
      return;
    }

    // Attempt HTTPS GET to the domain
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
    await db.update(customDomainsTable)
      .set({ status: newStatus, sslActive: sslOk, updatedAt: new Date() })
      .where(eq(customDomainsTable.id, id));

    res.json({
      ok: true,
      status: newStatus,
      sslActive: sslOk,
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

router.get("/white-label/exports", async (_req: Request, res: Response) => {
  try {
    const exports = await db.select().from(reportExportsTable).limit(20);
    res.json({ exports });
  } catch {
    res.status(500).json({ error: "Failed to fetch exports" });
  }
});

export default router;
