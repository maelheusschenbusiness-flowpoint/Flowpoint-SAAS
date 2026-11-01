import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { isCustomDomainTestBetaEnabled } from "../lib/plans.js";
import { normalizeRequestHost } from "../services/custom-domain-service.js";

declare global {
  namespace Express {
    interface Request {
      customDomainContext?: { domain: string; orgId: string };
    }
  }
}

const DOMAIN_PROOF_PATH = "/api/.well-known/flowpoint-domain-proof";
const PLATFORM_SUFFIXES = ["onrender.com", "flowpoint.pro", "flowpoint.io", "replit.dev", "replit.app"];

/**
 * Resolves only active, TLS-verified custom domains. The raw Host header is
 * used intentionally; X-Forwarded-Host is not a tenant identity source.
 */
export function customDomainHost(req: Request, res: Response, next: NextFunction): void {
  void resolveCustomDomainHost(req, res, next).catch((err: unknown) => {
    logger.error({ err, path: req.path }, "[CustomDomain] Host resolution failed");
    if (!res.headersSent) res.status(503).json({ error: "Custom-domain routing is temporarily unavailable" });
  });
}

async function resolveCustomDomainHost(req: Request, res: Response, next: NextFunction): Promise<void> {
  const isPortalPage = ["/", "/dashboard", "/dashboard.html", "/signin.html"].includes(req.path);
  if (!req.path.startsWith("/api/") && !isPortalPage) {
    next();
    return;
  }
  if (!isCustomDomainTestBetaEnabled()) {
    next();
    return;
  }

  const domain = normalizeRequestHost(req.headers.host);
  if (!domain) {
    next();
    return;
  }
  if (PLATFORM_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) {
    next();
    return;
  }

  if (req.method === "GET" && req.path === DOMAIN_PROOF_PATH) {
    const proof = await pool.query<{ id: string; domain: string }>(
      `SELECT id, domain
         FROM custom_domains
        WHERE lower(domain)=$1
          AND status IN ('render_verified','active')
        LIMIT 1`,
      [domain],
    );
    const row = proof.rows[0];
    if (!row) {
      res.status(404).json({ error: "Domain route not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json({ ok: true, id: row.id, domain: row.domain.toLowerCase() });
    return;
  }

  const result = await pool.query<{ org_id: string }>(
    `SELECT org_id
       FROM custom_domains
      WHERE lower(domain)=$1
        AND status='active'
        AND ssl_active=true
      LIMIT 1`,
    [domain],
  );
  const row = result.rows[0];
  if (!row) {
    next();
    return;
  }

  const orgId = String(row.org_id);
  req.customDomainContext = { domain, orgId };

  if (req.userId && String(req.orgId ?? "").toLowerCase() !== orgId.toLowerCase()) {
    res.status(421).json({ error: "This session does not belong to this workspace" });
    return;
  }

  if (!req.secure) {
    res.redirect(308, `https://${domain}${req.originalUrl}`);
    return;
  }

  next();
}
