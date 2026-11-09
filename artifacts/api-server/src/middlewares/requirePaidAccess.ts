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
 * REGLE COMMERCIALE (annulation / past_due) — decision UNIQUE : resolveAccessMode()
 * (lib/subscription-state.ts), appelee par loadBillingContext().
 *  - full       : acces complet (actif, essai, annule dans sa periode payee,
 *                 past_due dans la grace PAST_DUE_GRACE_DAYS)
 *  - read_only  : annule apres current_period_end / past_due hors grace /
 *                 unpaid / paused → lectures (GET/HEAD/OPTIONS) autorisees,
 *                 toute ecriture refusee en 402 SUBSCRIPTION_READ_ONLY, SAUF les
 *                 chemins de regularisation et de compte (READ_ONLY_WRITE_ALLOWED :
 *                 facturation, auth, profil, suppression de ses donnees...).
 *                 Aucune donnee n'est supprimee ; les exports (GET) restent ouverts.
 *  - blocked    : jamais finalise / essai expire → 402 SUBSCRIPTION_REQUIRED.
 *
 * PAS DE SECOND SYSTEME DE PERMISSIONS : la decision vient de
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
import { loadBillingContext, BillingContextUnavailableError, type BillingContext } from "../services/billing-context.js";

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

/**
 * En LECTURE SEULE, ces chemins restent ECRIVABLES (regularisation + compte) :
 * facturation / reactivation / nouvelle souscription, authentification, profil
 * et preferences de l'utilisateur, securite du compte, onboarding, invitations,
 * droit d'effacement (DELETE /settings/data). Tout le reste des ecritures —
 * y compris celles des prefixes exemptes de blocage total (/org, /settings,
 * /addons, /ai-credits, /permissions, /roles) — est refuse.
 */
const READ_ONLY_WRITE_ALLOWED: readonly string[] = [
  "/health", "/healthz", "/status", "/version", "/diagnostics",
  "/auth", "/sessions", "/sso",
  "/public", "/plans",
  "/billing", "/stripe", "/webhooks",
  "/me", "/preferences", "/security",
  "/onboarding", "/team/invitations",
  "/admin", "/qa",
  "/settings/data",
];
/** Sous-chemins de READ_ONLY_WRITE_ALLOWED qui restent des ecritures metier a refuser. */
const READ_ONLY_WRITE_BLOCKED: readonly string[] = ["/me/addons", "/me/settings", "/me/dataforseo"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const isSafeMethod = (m: string | undefined) => SAFE_METHODS.has((m ?? "GET").toUpperCase());

function matchesPrefix(path: string, list: readonly string[]): boolean {
  for (const prefix of list) {
    if (path === prefix || path.startsWith(prefix + "/")) return true;
  }
  return false;
}

/** true quand une ECRITURE sur ce chemin reste permise en lecture seule. */
export function isReadOnlyWriteAllowedPath(path: string): boolean {
  return matchesPrefix(path, READ_ONLY_WRITE_ALLOWED) && !matchesPrefix(path, READ_ONLY_WRITE_BLOCKED);
}

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

/** Decision d'acces mise en cache sur la requete (evite un 2e chargement de facturation). */
export type PaidAccessDecision =
  | { status: "allowed"; ctx?: BillingContext }
  | { status: "denied"; ctx: BillingContext }
  | { status: "read_only"; ctx: BillingContext }
  | { status: "unavailable"; err: unknown };

const DECISION_KEY = "__paidAccessDecision";

/**
 * Evalue (une seule fois par requete) si l'abonnement de l'organisation ouvre
 * l'acces payant. Partage entre le middleware global et les gardes de planGate
 * (requirePlan / requireFeature / requireQuota / requireAddon) : il n'y a pas
 * de second systeme de permissions, et le meme verdict n'est jamais recalcule.
 * Les gardes de planGate couvrent aussi les routes situees sous un prefixe
 * exempte du middleware global (ex. /permissions).
 */
export async function evaluatePaidAccess(req: Request): Promise<PaidAccessDecision> {
  const bag = req as unknown as Record<string, PaidAccessDecision | undefined>;
  const cached = bag[DECISION_KEY];
  if (cached) return cached;

  const orgId = (req as Request & { orgId?: string }).orgId;
  let decision: PaidAccessDecision;
  if (!orgId || orgId === "default") {
    // Pas de contexte d'organisation : requete non authentifiee ou appel de
    // service. Le garde d'authentification de la route tranche — transformer
    // cela en 402 masquerait un 401 et casserait les appels internes.
    decision = { status: "allowed" };
  } else {
    try {
      const ctx = await loadBillingContext(orgId);
      decision = ctx.accessMode === "full" ? { status: "allowed", ctx }
        : ctx.accessMode === "read_only" ? { status: "read_only", ctx }
        : { status: "denied", ctx };
    } catch (err) {
      if (err instanceof BillingContextUnavailableError || isProd()) {
        // Etat de facturation illisible : on ne devine pas un droit. 503
        // retryable, jamais un acces accorde par defaut ni un 402 definitif.
        decision = { status: "unavailable", err };
      } else {
        // Hors production uniquement : meme convention que planGate, pour ne
        // pas rendre le developpement local dependant d'une base de facturation.
        logger.warn({ err, orgId, path: req.path },
          "[PaidAccess] etat de facturation illisible — passage autorise (hors production)");
        decision = { status: "allowed" };
      }
    }
  }
  bag[DECISION_KEY] = decision;
  return decision;
}

/**
 * Garde reutilisable (planGate) : repond 402 SUBSCRIPTION_REQUIRED ou 503
 * BILLING_STATE_UNAVAILABLE et renvoie false quand l'acces payant n'est pas
 * ouvert ; renvoie true sinon (l'appelant poursuit).
 */
export async function enforcePaidAccess(req: Request, res: Response): Promise<boolean> {
  const decision = await evaluatePaidAccess(req);
  if (decision.status === "allowed") return true;
  const orgId = (req as Request & { orgId?: string }).orgId;

  if (decision.status === "read_only") {
    // Lecture seule : les lectures passent, toute ecriture / action premium /
    // generation / consommation de credits est refusee (402, code exploitable).
    if (isSafeMethod(req.method)) { markReadOnly(res); return true; }
    refuseReadOnly(req, res, decision.ctx);
    return false;
  }

  if (decision.status === "unavailable") {
    logger.error({ err: decision.err, orgId, path: req.path },
      "[PaidAccess] etat de facturation illisible — acces refuse (retryable)");
    res.status(503).json({
      ok: false,
      error: "Impossible de verifier votre abonnement. Reessayez dans un instant.",
      code: "BILLING_STATE_UNAVAILABLE",
      retryable: true,
    });
    return false;
  }

  const ctx = decision.ctx;
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
  return false;
}

function markReadOnly(res: Response): void {
  if (typeof res.setHeader === "function") res.setHeader("X-FP-Access-Mode", "read_only");
}

/** 402 SUBSCRIPTION_READ_ONLY : l'organisation est en lecture seule. */
function refuseReadOnly(req: Request, res: Response, ctx: BillingContext): void {
  const orgId = (req as Request & { orgId?: string }).orgId;
  logger.info({ orgId, status: ctx.subscriptionStatus, reason: ctx.accessReason, path: req.path, method: req.method },
    "[PaidAccess] ecriture refusee — organisation en lecture seule");
  markReadOnly(res);
  res.status(402).json({
    ok: false,
    error: "Votre abonnement n'est plus actif : votre espace est en lecture seule. Vos donnees sont conservees ; reprenez un abonnement pour modifier ou generer du contenu.",
    code: "SUBSCRIPTION_READ_ONLY",
    readOnly: true,
    accessMode:         ctx.accessMode,
    accessReason:       ctx.accessReason,
    subscriptionStatus: ctx.subscriptionStatus,
    plan:               ctx.plan,
    currentPeriodEnd:   ctx.currentPeriodEnd,
    graceEndsAt:        ctx.graceEndsAt,
    billingUrl:         "/pricing.html",
    recovery:           { plans: "/api/plans/catalog", subscription: "/api/billing/subscription", reactivate: "/api/billing/reactivate" },
  });
}

export async function requirePaidAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isExempt(req.path)) {
    // Prefixe exempte du blocage total. En lecture seule, une ECRITURE n'est
    // pourtant permise que sur les chemins de regularisation / de compte.
    if (isSafeMethod(req.method) || isReadOnlyWriteAllowedPath(req.path)) { next(); return; }
    const d = await evaluatePaidAccess(req);
    if (d.status === "read_only") { refuseReadOnly(req, res, d.ctx); return; }
    next();
    return;
  }

  const decision = await evaluatePaidAccess(req);
  if (decision.status === "allowed") {
    if (decision.ctx?.inPaidGracePeriod) {
      logger.info({ orgId: (req as Request & { orgId?: string }).orgId, status: decision.ctx.subscriptionStatus,
        currentPeriodEnd: decision.ctx.currentPeriodEnd, path: req.path },
        "[PaidAccess] acces accorde par la periode deja payee");
    }
    next();
    return;
  }
  // read_only + lecture : enforcePaidAccess renvoie true (on poursuit) ;
  // ecriture / blocage / 503 : la reponse est deja envoyee.
  if (await enforcePaidAccess(req, res)) next();
}
