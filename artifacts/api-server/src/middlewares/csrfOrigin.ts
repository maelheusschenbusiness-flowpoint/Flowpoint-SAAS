/**
 * Protection CSRF par controle Origin/Referer (audit C-01).
 *
 * S'applique aux methodes non sures authentifiees UNIQUEMENT par le cookie
 * `fp_token`. Exceptions explicites :
 *  - methodes sures (GET/HEAD/OPTIONS) ;
 *  - webhooks Stripe (signature, pas de cookie) ;
 *  - requetes sans cookie de session (endpoints publics) ;
 *  - requetes portant un jeton explicite (Authorization: Bearer, X-API-Key :
 *    cles fp_pub_/fp_sec_) : le cookie n'est alors pas utilise (voir orgContext).
 *
 * Une requete cookie sans Origin ni Referer valide est refusee (403).
 */
import type { Request, Response, NextFunction } from "express";
import { isOriginAllowed, type OriginPattern } from "../lib/cors-policy.js";
import { logger } from "../lib/logger.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PATHS = ["/api/webhooks/stripe", "/api/billing/webhook"];

/**
 * Exception explicite, et unique, pour le callback Apple Sign In : Apple
 * renvoie l'utilisateur par un POST `response_mode=form_post` cross-site dont
 * l'Origin est Apple (non liste). Ce callback n'est pas protege par
 * Origin/Referer mais par un `state` aleatoire lie a un cookie httpOnly
 * (fp_oauth_apple), un nonce et la verification du jeton signe Apple
 * (PR #367). Ne PAS elargir a /api/auth/* : les autres POST restent controles.
 */
const OAUTH_FORM_POST_EXEMPT_PATHS = ["/api/auth/apple/callback"];

function hasExplicitCredential(req: Request): boolean {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return true;
  const key = req.headers["x-api-key"];
  return typeof key === "string" && key.trim() !== "";
}

function originOf(value: string | undefined): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function csrfOrigin(allowed: OriginPattern[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (EXEMPT_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
    if (OAUTH_FORM_POST_EXEMPT_PATHS.includes(req.path)) return next();
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const cookieToken = cookies?.["fp_token"];
    if (typeof cookieToken !== "string" || cookieToken.trim() === "") return next();
    if (hasExplicitCredential(req)) return next();

    const host = req.get("host");
    const sameOrigin = host ? `${req.protocol}://${host}` : null;
    const candidate = req.headers.origin !== undefined
      ? originOf(req.headers.origin)
      : originOf(req.headers.referer);

    if (candidate && (candidate === sameOrigin || isOriginAllowed(candidate, allowed))) {
      return next();
    }
    logger.warn(
      { origin: req.headers.origin ?? null, hasReferer: Boolean(req.headers.referer), method: req.method, path: req.path },
      "[CSRF] Requete cookie refusee : Origin/Referer absent ou non autorise",
    );
    res.status(403).json({ ok: false, error: "Origin not allowed", code: "CSRF_ORIGIN_REJECTED" });
  };
}
