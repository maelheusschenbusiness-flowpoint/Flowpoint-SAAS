import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { isCustomDomainTestBetaEnabled } from "../lib/plans.js";
import {
  isQaCustomDomainCertificationEnabled,
  normalizeRequestHost,
  QA_CUSTOM_DOMAIN_CERT_DOMAIN,
  QA_CUSTOM_DOMAIN_CERT_ORG_ID,
} from "../services/custom-domain-service.js";

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
  const domain = normalizeRequestHost(req.headers.host);
  if (!isCustomDomainTestBetaEnabled()) {
    if (domain === QA_CUSTOM_DOMAIN_CERT_DOMAIN) {
      res.status(404).json({ error: "Custom QA domain is disabled" });
      return;
    }
    next();
    return;
  }

  if (!domain) {
    next();
    return;
  }
  const isQaCertificationHost = domain === QA_CUSTOM_DOMAIN_CERT_DOMAIN;
  if (
    PLATFORM_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`)) &&
    !isQaCertificationHost
  ) {
    next();
    return;
  }
  if (isQaCertificationHost && !await isQaCustomDomainCertificationEnabled()) {
    res.status(404).json({ error: "Custom QA domain is disabled" });
    return;
  }

  if (req.method === "GET" && req.path === DOMAIN_PROOF_PATH) {
    const proof = isQaCertificationHost
      ? await pool.query<{ id: string; domain: string }>(
        `SELECT d.id, d.domain
           FROM custom_domains d
           JOIN organizations o ON o.id::text=d.org_id
          WHERE lower(d.domain)=$1 AND d.org_id=$2
            AND o.id=$2::uuid AND o.is_internal_qa=true AND o.status='active'
            AND d.status IN ('render_verified','active')
          LIMIT 1`,
        [domain, QA_CUSTOM_DOMAIN_CERT_ORG_ID],
      )
      : await pool.query<{ id: string; domain: string }>(
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

  const result = isQaCertificationHost
    ? await pool.query<{ org_id: string }>(
      `SELECT d.org_id
         FROM custom_domains d
         JOIN organizations o ON o.id::text=d.org_id
        WHERE lower(d.domain)=$1 AND d.org_id=$2
          AND o.id=$2::uuid AND o.is_internal_qa=true AND o.status='active'
          AND d.status='active' AND d.ssl_active=true
        LIMIT 1`,
      [domain, QA_CUSTOM_DOMAIN_CERT_ORG_ID],
    )
    : await pool.query<{ org_id: string }>(
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
    if (isQaCertificationHost) {
      res.status(404).json({ error: "Custom QA domain route is not active" });
      return;
    }
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
