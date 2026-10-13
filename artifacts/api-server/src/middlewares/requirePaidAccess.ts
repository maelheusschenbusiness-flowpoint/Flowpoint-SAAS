/**
 * requirePaidAccess — controle serveur de l'acces aux fonctionnalites payantes.
 *
 * POLITIQUE PRODUIT APPLIQUEE
 *  - essai valide de 14 jours        → acces aux fonctionnalites du plan
 *  - abonnement actif                → acces selon le plan et ses quotas
 *  - essai expire sans abonnement    → fonctionnalites payantes bloquees
 *  - expire / annule / suspendu      → bloquees, SAUF si la periode deja payee
 *                                      reste valide (current_period_end futur)
 *  - compte, authentification, facturation, renouvellement, reactivation
 *                                    → toujours accessibles, pour que le client
 *                                      puisse regulariser sa situation
 *
 * PAS DE SECOND SYSTEME DE PERMISSIONS : la decision vient de
 * grantsPaidAccess() (lib/subscription-state.ts) alimente par
 * loadBillingContext() — les memes primitives que /me et que planGate.
 * Les quotas et les droits par plan restent la responsabilite de planGate ;
 * ce middleware ne repond qu'a « l'abonnement ouvre-t-il l'acces ? ».
 *
 * MONTE CENTRALEMENT sur /api : la regle s'applique donc aussi aux appels
 * directs a l'API, pas seulement aux parcours du dashboard. La liste
 * d'exemptions ci-dessous est un allowlist explicite — tout chemin non
 * exempte est protege par defaut, ce qui evite qu'une route payante ajoutee
 * plus tard soit ouverte par oubli.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { loadBillingContext, BillingContextUnavailableError } from "../services/billing-context.js";

const isProd = () => process.env["NODE_ENV"] === "production" && !process.env["REPLIT_DEV_DOMAIN"];

/**
 * Chemins toujours accessibles, quel que soit l'etat de l'abonnement.
 * Comparaison sur le chemin relatif au montage ("/me", "/billing/subscription"…),
 * exacte ou par prefixe de segment — "/me" n'ouvre donc pas "/members".
 */
const EXEMPT_PREFIXES: readonly string[] = [
  // ── Infrastructure et sonde ───────────────────────────────────────────────
  "/health", "/healthz", "/status", "/version", "/diagnostics",
  // ── Authentification et session ───────────────────────────────────────────
  "/auth", "/sessions", "/sso",
  // ── Parcours public : devis, paiement, finalisation d'inscription ─────────
  "/public", "/plans",
  // ── Facturation : factures, portail, moyens de paiement, REACTIVATION ────
  "/billing", "/stripe", "/webhooks",
  // ── Achats : add-ons et credits IA doivent rester payables ───────────────
  "/addons", "/ai-credits",
  // ── Compte, profil, preferences, parametres, securite du compte ──────────
  "/me", "/org", "/organizations", "/settings", "/preferences", "/security",
  // ── Droits : un client bloque doit pouvoir lire ses propres permissions ──
  "/permissions", "/roles",
  // ── Reprise d'inscription et acceptation d'invitation ────────────────────
  "/onboarding", "/team/invitations",
  // ── Administration interne et fixtures QA (deja protegees par cle) ──────
  "/admin", "/qa",
];

function isExempt(path: string): boolean {
  for (const prefix of EXEMPT_PREFIXES) {
    if (path === prefix) return true;
    if (path.startsWith(prefix + "/")) return true;
  }
  return false;
}

/** Expose la liste pour les tests de non-regression. */
export const PAID_ACCESS_EXEMPT_PREFIXES = EXEMPT_PREFIXES;
export { isExempt as isPaidAccessExemptPath };

export async function requirePaidAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isExempt(req.path)) { next(); return; }

  // Pas de contexte d'organisation : la requete est soit non authentifiee, soit
  // un appel de service. Le garde d'authentification de la route tranche —
  // transformer cela en 402 masquerait un 401 et casserait les appels internes.
  const orgId = (req as Request & { orgId?: string }).orgId;
  if (!orgId || orgId === "default") { next(); return; }

  let ctx: Awaited<ReturnType<typeof loadBillingContext>>;
  try {
    ctx = await loadBillingContext(orgId);
  } catch (err) {
    if (err instanceof BillingContextUnavailableError || isProd()) {
      // Etat de facturation illisible : on ne devine pas un droit. 503
      // retryable, jamais un acces accorde par defaut ni un 402 definitif.
      logger.error({ err, orgId, path: req.path },
        "[PaidAccess] etat de facturation illisible — acces refuse (retryable)");
      res.status(503).json({
        ok: false,
        error: "Impossible de verifier votre abonnement. Reessayez dans un instant.",
        code: "BILLING_STATE_UNAVAILABLE",
        retryable: true,
      });
      return;
    }
    // Hors production uniquement : meme convention que planGate, pour ne pas
    // rendre le developpement local dependant d'une base de facturation.
    logger.warn({ err, orgId, path: req.path },
      "[PaidAccess] etat de facturation illisible — passage autorise (hors production)");
    next();
    return;
  }

  if (ctx.hasPaidAccess) {
    if (ctx.inPaidGracePeriod) {
      logger.info({ orgId, status: ctx.subscriptionStatus, currentPeriodEnd: ctx.currentPeriodEnd, path: req.path },
        "[PaidAccess] acces accorde par la periode deja payee");
    }
    next();
    return;
  }

  logger.info({ orgId, status: ctx.subscriptionStatus, plan: ctx.plan, path: req.path, method: req.method },
    "[PaidAccess] fonctionnalite payante refusee — abonnement inactif");
  res.status(402).json({
    ok: false,
    error: "Cette fonctionnalite necessite un abonnement actif. Reprenez un abonnement pour retrouver vos donnees.",
    code: "SUBSCRIPTION_REQUIRED",
    subscriptionStatus: ctx.subscriptionStatus,
    plan:               ctx.plan,
    trialEndsAt:        ctx.trialEndsAt,
    currentPeriodEnd:   ctx.currentPeriodEnd,
    canStartTrial:      ctx.canStartTrial,
    // Chemins laisses ouverts pour que le client puisse regulariser.
    billingUrl:         "/pricing.html",
    recovery:           { plans: "/api/plans/catalog", subscription: "/api/billing/subscription", reactivate: "/api/billing/reactivate" },
  });
}
