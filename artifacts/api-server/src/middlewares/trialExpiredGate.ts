/**
 * trialExpiredGate — controle d'acces SERVEUR d'un essai sans carte expire.
 *
 * Cible exacte : une organisation `trialing`, SANS abonnement Stripe, dont
 * `trial_consumed_at` est pose et `trial_ends_at` depasse
 * (CARDLESS_TRIAL_EXPIRED_WHERE). Aucun autre etat n'est touche : un essai
 * Stripe, un abonnement actif, `past_due`, `canceled`… passent comme avant.
 *
 * Regle, dans l'ordre :
 *   1. route OUVERTE (paiement, compte, preferences, export/suppression,
 *      notifications, flux SSE)      → passe
 *   2. route COUTEUSE meme en lecture (IA, SEO/DataForSEO, mots-cles,
 *      PageSpeed, cartes, Google…) → 402 TRIAL_EXPIRED, quelle que soit la methode
 *   3. toute autre ecriture (POST/PUT/PATCH/DELETE : lancer un audit, une
 *      mission, une automatisation, un rapport…) → 402 TRIAL_EXPIRED
 *   4. toute autre lecture (GET/HEAD) → passe (lecture des donnees deja en base)
 *
 * Actif seulement quand TRIAL_WITHOUT_CARD=true : drapeau eteint, aucune
 * requete supplementaire, aucun changement. Etat mis en cache 30 s par
 * organisation. Erreur de base : on laisse passer (la base indisponible fait
 * deja echouer les routes en aval) et on journalise.
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { CARDLESS_TRIAL_EXPIRED_WHERE, isTrialWithoutCardEnabled } from "../services/trial-without-card.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expired: boolean; at: number }>();

/** Routes toujours ouvertes (prefixes, chemin relatif au routeur /api). */
export const TRIAL_EXPIRED_OPEN_PREFIXES = [
  "/billing",            // checkout, upgrade, portail, factures, suppression du compte (/billing/account)
  "/auth",               // connexion / deconnexion / session
  "/me",                 // profil, preferences, reglages, add-ons (lecture)
  "/preferences",
  "/ai/preferences",     // preference, aucun appel IA
  "/ai/config",
  "/settings",           // donnees, export, cles API
  "/security",
  "/sessions",
  "/data/storage",
  "/org",                // profil d'organisation
  "/notifications",
  "/events",             // flux SSE du dashboard
  "/onboarding",
  "/plans",
  "/addons",
];

/**
 * Traitements couteux meme en lecture (appels IA, DataForSEO, PageSpeed, Google…) :
 * bloques pour toute methode. Les autres routes (audits, rapports, moniteurs,
 * missions, automatisations…) restent lisibles ; leurs ecritures et
 * declenchements tombent sous la regle 3.
 */
export const TRIAL_EXPIRED_COSTLY_PREFIXES = [
  "/ai", "/ai-credits", "/ai-workspace", "/agent", "/seo", "/dataforseo", "/keywords",
  "/competitors", "/pagespeed", "/market-intel", "/market-intelligence", "/review-intel",
  "/review-intelligence", "/local-maps", "/maps", "/gsc", "/ga4", "/llm-visibility", "/forecast",
];

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some(p => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

export type TrialGateDecision = "open" | "blocked" | "read";

/** Decision pure pour une org EXPIREE — testable sans base. */
export function decideExpiredTrialAccess(method: string, path: string): TrialGateDecision {
  if (matches(path, TRIAL_EXPIRED_OPEN_PREFIXES)) return "open";
  if (matches(path, TRIAL_EXPIRED_COSTLY_PREFIXES)) return "blocked";
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS" ? "read" : "blocked";
}

export async function isOrgCardlessTrialExpired(orgId: string): Promise<boolean> {
  if (!UUID_RE.test(orgId)) return false;
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.expired;
  const r = await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM organizations WHERE id = $1 AND ${CARDLESS_TRIAL_EXPIRED_WHERE} LIMIT 1`,
    [orgId],
  );
  const expired = (r.rows?.length ?? 0) > 0;
  cache.set(orgId, { expired, at: Date.now() });
  return expired;
}

/** Pour les tests et apres un paiement : oublie l'etat memorise. */
export function clearTrialGateCache(orgId?: string): void {
  if (orgId) cache.delete(orgId); else cache.clear();
}

export const TRIAL_EXPIRED_BODY = {
  error: "Votre essai gratuit est terminé. Activez votre abonnement pour continuer.",
  code: "TRIAL_EXPIRED",
  redirectTo: "/dashboard.html#billing/plans",
} as const;

export function trialExpiredGate(req: Request, res: Response, next: NextFunction): void {
  if (!isTrialWithoutCardEnabled()) { next(); return; }
  const orgId = (req as { orgContext?: { orgId?: string } }).orgContext?.orgId
    ?? (req as { orgId?: string }).orgId;
  if (!orgId || orgId === "default") { next(); return; }
  const decision = decideExpiredTrialAccess(req.method, req.path);
  if (decision === "open") { next(); return; }
  isOrgCardlessTrialExpired(orgId).then(expired => {
    if (expired && decision === "blocked") {
      logger.info({ orgId, method: req.method, path: req.path }, "[TrialGate] cardless trial expired — request blocked");
      res.status(402).json(TRIAL_EXPIRED_BODY);
      return;
    }
    next();
  }).catch(err => {
    logger.warn({ err: (err as Error)?.message, orgId }, "[TrialGate] state lookup failed — fail-open");
    next();
  });
}
