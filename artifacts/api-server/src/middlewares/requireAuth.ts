import { type Request, type Response, type NextFunction } from "express";
import { getSession } from "../services/sessions.js";
import { logger } from "../lib/logger.js";
import { API_KEY_DENIED_ROUTES } from "../lib/api-keys.js";

const MISSING_KEY_WARNING_SHOWN = { shown: false };

/**
 * Authentication middleware (async — checks memory cache then DB).
 *
 * Accepts two kinds of credentials:
 *   1. A per-session token issued at login (src/services/sessions.ts).
 *      Unique per login, bound to a specific user, individually revocable.
 *      Survives server restarts (persisted in PostgreSQL).
 *   2. The API_SECRET_KEY, used as a server-to-server service credential.
 *      Never sent to browser clients.
 *
 * Credentials may be supplied via:
 *   Authorization: Bearer <token>
 *   X-Api-Key: <token>
 *   fp_token cookie (HttpOnly)
 *
 * Log levels:
 *   debug  — normal unauthenticated request (no credentials sent)
 *   info   — bad/expired token sent (invalid credentials)
 *   warn   — genuine security or config anomaly
 *   error  — server misconfiguration preventing all auth
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  _requireAuth(req, res, next).catch(next);
}

async function _requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const serviceSecret = process.env["API_SECRET_KEY"];
  const isProduction  = process.env["NODE_ENV"] === "production";

  const authHeader   = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieToken  = (req as any).cookies?.fp_token;

  let provided: string | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === "string") {
    provided = apiKeyHeader.trim();
  } else if (typeof cookieToken === "string") {
    provided = cookieToken.trim();
  } else if (
    // EventSource cannot set headers — allow a query token for SSE streams only
    req.method === "GET" &&
    typeof req.query["token"] === "string" &&
    (req.headers["accept"] ?? "").includes("text/event-stream")
  ) {
    provided = (req.query["token"] as string).trim();
  }

  if (!provided) {
    // CONTOURNEMENT DE DEVELOPPEMENT, SUR DEMANDE EXPLICITE SEULEMENT.
    //
    // Mesure du 17/10/2026, pendant la mise en place des tests E2E : la
    // condition etait `!serviceSecret && !isProduction`. Autrement dit, toute
    // instance ou API_SECRET_KEY n'etait pas renseignee et ou NODE_ENV ne
    // valait pas exactement "production" servait l'INTEGRALITE de l'API privee
    // a un appelant anonyme. Constate en local : /api/missions et /api/reports
    // repondaient 200 sans aucune credential.
    //
    // Les deux instances deployees repondent bien 401 — elles posent
    // NODE_ENV=production — donc ce n'etait pas une faille en production. Mais
    // l'ouverture dependait de l'ABSENCE d'une variable, c'est-a-dire d'un
    // oubli. Une variable oubliee sur un futur environnement d'apercu aurait
    // tout ouvert, en silence.
    //
    // Elle demande desormais une intention declaree, et refuse de s'appliquer
    // en production meme si le drapeau est pose.
    const contournementDemande = process.env["ALLOW_UNAUTHENTICATED_DEV"] === "true";
    if (contournementDemande && !isProduction) {
      if (!MISSING_KEY_WARNING_SHOWN.shown) {
        logger.warn("[Auth] ALLOW_UNAUTHENTICATED_DEV=true — l'authentification est DESACTIVEE sur cette instance.");
        MISSING_KEY_WARNING_SHOWN.shown = true;
      }
      next();
      return;
    }
    if (!serviceSecret && !isProduction && !MISSING_KEY_WARNING_SHOWN.shown) {
      logger.warn("[Auth] API_SECRET_KEY absente. L'API privee reste FERMEE — posez ALLOW_UNAUTHENTICATED_DEV=true pour l'ouvrir en developpement.");
      MISSING_KEY_WARNING_SHOWN.shown = true;
    }
    // Normal unauthenticated browser request — not a security event
    logger.debug({ method: req.method, url: req.url?.split("?")[0] }, "[Auth] 401 no credentials");
    res.status(401).json({ error: "Unauthorized: missing credentials" });
    return;
  }

  // Accept a valid per-session token (checks memory cache, then DB)
  const session = await getSession(provided);
  if (session) {
    next();
    return;
  }

  // Accept the API_SECRET_KEY as a service credential
  if (serviceSecret && provided === serviceSecret) {
    next();
    return;
  }

  // Accept FlowPoint API keys (fp_pub_ / fp_sec_) resolved by orgContext middleware.
  // orgContext already looked up the key in user_prefs and set req.orgContext.orgId when valid.
  if (provided.startsWith("fp_pub_") || provided.startsWith("fp_sec_")) {
    const resolvedOrgId = req.orgContext?.orgId;
    if (resolvedOrgId && resolvedOrgId !== "default") {
      // Key management, billing and side-effecting GETs are never reachable with a key.
      if (API_KEY_DENIED_ROUTES.some((re) => re.test(req.path))) {
        res.status(403).json({ error: "Forbidden: this route is not available to API keys" });
        return;
      }
      // Public key: read-only — reject any mutating method
      if (provided.startsWith("fp_pub_") && req.method !== "GET") {
        res.status(403).json({ error: "Forbidden: public API key allows read-only access (GET requests only)" });
        return;
      }
      next();
      return;
    }
    // Key present but not resolved — treat as invalid credential
    logger.info({ method: req.method, url: req.url?.split("?")[0] }, "[Auth] 401 unknown fp_* key");
    res.status(401).json({ error: "Unauthorized: invalid API key" });
    return;
  }

  if (!serviceSecret) {
    if (isProduction) {
      logger.error("[Auth] API_SECRET_KEY is not set — all management requests are being rejected");
      res.status(503).json({ error: "Authentication unavailable: server is not configured" });
      return;
    }
    if (!MISSING_KEY_WARNING_SHOWN.shown) {
      logger.warn("[Auth] API_SECRET_KEY not set. Auth is disabled in development.");
      MISSING_KEY_WARNING_SHOWN.shown = true;
    }
    next();
    return;
  }

  // Bad or expired token — informational, not alarming
  logger.info({ method: req.method, url: req.url?.split("?")[0] }, "[Auth] 401 invalid credentials");
  res.status(401).json({ error: "Unauthorized: invalid credentials" });
}
