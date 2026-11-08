/**
 * billing-verify-guards.ts — garde-fous de GET /billing/verify.
 *
 * Correctif de securite (2026-11-08) : la route relisait n'importe quelle session
 * Checkout Stripe puis ecrivait plan / customer / souscription sur l'organisation
 * appelante, sans verifier que la session lui appartenait. Ce module isole la
 * logique pure (propriete de la session, classement des erreurs Stripe, plan) pour
 * qu'elle soit testable sans Stripe ni base.
 *
 * Metadonnees fiables : posees par le serveur a la creation de la session
 * (customer = customer Stripe de l'organisation, metadata.orgId, client_reference_id).
 * Le client ne peut pas les forger : il ne controle que le session_id.
 */

export const VERIFY_PLANS = ["standard", "pro", "ultra"] as const;
export type VerifyPlan = (typeof VERIFY_PLANS)[number];

/** Identifiant de session Checkout : cs_test_... / cs_live_... (borne la valeur envoyee a Stripe). */
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{4,250}$/;
export function isWellFormedCheckoutSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

export interface SessionLike {
  customer?: unknown;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

export function sessionCustomerId(session: SessionLike): string {
  const c = session.customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "id" in c) return String((c as { id: unknown }).id ?? "");
  return "";
}

/**
 * Autorise le traitement uniquement si la session appartient a `orgId` :
 *  - aucun identifiant d'organisation de la session ne doit contredire `orgId` ;
 *  - aucun customer de la session ne doit differer de celui de l'organisation ;
 *  - au moins une correspondance positive (customer == celui de l'org, ou orgId meta/client_reference_id).
 */
export function sessionBelongsToOrg(
  session: SessionLike,
  orgId: string,
  orgStripeCustomerId: string | null | undefined,
): boolean {
  const meta = session.metadata ?? {};
  const orgClaims = [meta["orgId"], session.client_reference_id]
    .map(v => String(v ?? "").trim())
    .filter(Boolean);
  const claimConflict = orgClaims.some(v => v !== orgId);
  const claimMatch = orgClaims.length > 0 && !claimConflict;

  const sessCust = sessionCustomerId(session);
  const customerConflict = !!sessCust && !!orgStripeCustomerId && sessCust !== orgStripeCustomerId;
  const customerMatch = !!sessCust && !!orgStripeCustomerId && sessCust === orgStripeCustomerId;

  if (claimConflict || customerConflict) return false;
  return claimMatch || customerMatch;
}

export interface VerifyHttpError {
  status: number;
  code: "SESSION_NOT_FOUND" | "STRIPE_UNAVAILABLE" | "STRIPE_REJECTED" | "VERIFY_INTERNAL_ERROR";
  error: string;
  /** Code d'erreur Stripe (jamais le message : il peut citer des identifiants). */
  stripeCode: string | null;
  stripeType: string | null;
}

/**
 * Classe une erreur levee par stripe.checkout.sessions.retrieve.
 * Session inexistante / identifiant invalide -> 404 ; Stripe indisponible -> 502/503 ;
 * jamais 500 pour une session invalide.
 */
export function classifyStripeRetrieveError(err: unknown): VerifyHttpError {
  const e = (err ?? {}) as { type?: unknown; code?: unknown; statusCode?: unknown; rawType?: unknown };
  const type = typeof e.type === "string" ? e.type : typeof e.rawType === "string" ? e.rawType : null;
  const code = typeof e.code === "string" ? e.code : null;
  const statusCode = typeof e.statusCode === "number" ? e.statusCode : null;
  const base = { stripeCode: code, stripeType: type };

  const invalidRequest = type === "StripeInvalidRequestError" || type === "invalid_request_error";
  if (code === "resource_missing" || (invalidRequest && (statusCode === 404 || statusCode === 400 || statusCode === null))) {
    return { ...base, status: 404, code: "SESSION_NOT_FOUND", error: "Session de paiement introuvable." };
  }
  if (type === "StripeRateLimitError" || type === "StripeConnectionError" || statusCode === 429) {
    return { ...base, status: 503, code: "STRIPE_UNAVAILABLE", error: "Service de paiement momentanement indisponible." };
  }
  if (type === "StripeAPIError" || type === "StripeAuthenticationError" || type === "StripePermissionError"
      || (statusCode !== null && statusCode >= 500)) {
    return { ...base, status: 502, code: "STRIPE_UNAVAILABLE", error: "Service de paiement momentanement indisponible." };
  }
  return { ...base, status: 500, code: "VERIFY_INTERNAL_ERROR", error: "Failed to verify checkout session" };
}

/** Plan valide issu des metadonnees de session, ou null (aucun defaut silencieux). */
export function resolveVerifiedPlan(meta: Record<string, string>): VerifyPlan | null {
  const raw = String(meta["selected_plan"] || meta["plan"] || "").trim().toLowerCase();
  return (VERIFY_PLANS as readonly string[]).includes(raw) ? (raw as VerifyPlan) : null;
}
