/**
 * Souscriptions d'un nouveau compte apres paiement — UN SEUL code, deux appelants.
 *
 * A-09 — l'essai ne dependait que du navigateur. `finalize-checkout` (appele par
 * checkout-return.html) etait le SEUL a creer l'abonnement Stripe, alors que le
 * webhook `setup_intent.succeeded` / `payment_intent.succeeded` activait deja
 * l'organisation en `trialing` avec `trial_ends_at = +14 j`. Onglet ferme apres
 * `confirmSetup` (3DS, mobile, coupure) : organisation `trialing` SANS
 * abonnement, donc aucun prelevement a J+14.
 *
 * Ce module porte la creation (plan + abonnement d'add-ons) pour que le webhook
 * et finalize l'executent a l'identique :
 *  - meme corps de requete (ancre = `created` de l'intent, jamais l'horloge) ;
 *  - meme cle d'idempotence : `subscriptionAttemptKey({scope, intentId, plan,
 *    priceId})` — le meme materiau de cle que finalize a toujours utilise, donc
 *    aucune souscription n'est creee deux fois, quel que soit l'ordre ;
 *  - meme verrou PostgreSQL (checkout_subscription_claims).
 * Aucun prix, aucune duree d'essai n'est defini ici : prix via getPlanPriceId /
 * getAddonPriceId (lib/plans.ts), duree via `trial_days_remaining` de l'intent
 * (fixee par billing-quote, TRIAL_DAYS = 14).
 */
import type Stripe from "stripe";
import { logger } from "../lib/logger.js";
import { FLAG_ADDONS, QTY_ADDONS, PLAN_INCLUDED_ADDONS, getAddonPriceId, getPlanPriceId } from "../lib/plans.js";
import { createStripeClient, getStripeKey } from "./stripe-factory.js";
import { lireAttributionFunnel, metadataDepuisAttribution } from "./funnel-events.js";
import {
  subscriptionAttemptKey,
  claimSubscriptionCreation,
  settleSubscriptionClaim,
  waitForClaimedSubscription,
  createWithIdempotency,
  ensureClaimTable,
  type ClaimOutcome,
} from "./checkout-subscription-claim.js";

export type AddonsMap = Record<string, boolean | number>;
export type StripeClient = Awaited<ReturnType<typeof createStripeClient>>;

/**
 * Cree l'abonnement d'une tentative de checkout — exactement une fois.
 *
 * Le garde par liste d'abonnements qui precede chaque appel reste en place ; il
 * attrape le cas sequentiel (rechargement de page, rejeu du webhook) et il ne
 * voit rien du cas concurrent. C'est cette fonction qui ferme la fenetre, avec
 * les deux barrieres decrites dans services/checkout-subscription-claim.ts :
 * le verrou PostgreSQL evite le second appel reseau, la cle d'idempotence
 * Stripe garantit qu'un second appel, s'il a lieu quand meme, renvoie le meme
 * abonnement au lieu d'en creer un autre.
 *
 * Rien ici ne peut faire echouer la finalisation : le client vient de payer.
 * Une base injoignable degrade vers « barriere Stripe seule », journalisee en
 * ERROR, et non vers un refus de service.
 */
export async function createSubscriptionForAttempt(args: {
  stripe: StripeClient;
  intentId: string;
  scope: string;
  plan: string;
  priceId: string;
  orgRef: string | null;
  params: Stripe.SubscriptionCreateParams;
}): Promise<Stripe.Subscription> {
  const attemptKey = subscriptionAttemptKey({
    scope:    args.scope,
    intentId: args.intentId,
    plan:     args.plan,
    priceId:  args.priceId,
  });
  const claimArgs = {
    attemptKey,
    intentId: args.intentId,
    plan:     args.plan,
    priceId:  args.priceId,
    orgRef:   args.orgRef,
  };

  const { pool } = await import("@workspace/db");

  const tryClaim = async (): Promise<ClaimOutcome | null> => {
    try {
      return await claimSubscriptionCreation(pool, claimArgs);
    } catch (err) {
      // 42P01 : deploiement anterieur a la migration — poser la table et reessayer.
      if ((err as { code?: string } | null)?.code === "42P01") {
        try {
          await ensureClaimTable(pool);
          return await claimSubscriptionCreation(pool, claimArgs);
        } catch (healErr) {
          logger.error({ healErr, scope: args.scope },
            "[PublicBilling][P0] verrou d'abonnement indisponible (table absente) — barriere Stripe seule");
          return null;
        }
      }
      logger.error({ err, scope: args.scope },
        "[PublicBilling][P0] verrou d'abonnement indisponible — barriere Stripe seule");
      return null;
    }
  };

  let claim: ClaimOutcome = (await tryClaim()) ?? { role: "owner", subscriptionId: null };

  if (claim.role === "pending") {
    // Un autre appel du meme checkout tient le bail : son resultat fait foi.
    const waited = await waitForClaimedSubscription(pool, attemptKey).catch(() => null);
    if (waited) {
      claim = { role: "settled", subscriptionId: waited };
    } else {
      // Bail non conclu dans le delai : processus tue, requete abandonnee. On
      // reprend — la cle d'idempotence Stripe empeche le doublon si l'autre
      // appel avait deja cree l'abonnement sans pouvoir l'inscrire.
      const retried = await tryClaim();
      claim = retried && retried.role !== "pending" ? retried : { role: "takeover", subscriptionId: null };
      logger.warn({ scope: args.scope, attemptKey, role: claim.role },
        "[PublicBilling][P0] bail de creation non conclu — reprise sous cle d'idempotence Stripe");
    }
  }

  if (claim.role === "settled" && claim.subscriptionId) {
    logger.info({ scope: args.scope, subscriptionId: claim.subscriptionId, attemptKey },
      "[PublicBilling][P0] abonnement deja cree pour cette tentative — reutilisation (aucun doublon)");
    return await args.stripe.subscriptions.retrieve(claim.subscriptionId);
  }

  let created: Stripe.Subscription;
  try {
    created = await createWithIdempotency<Stripe.Subscription>(
      (idempotencyKey) => args.stripe.subscriptions.create(args.params, { idempotencyKey }),
      attemptKey
    );
  } catch (createErr) {
    // Echec de la creation : le bail est libere pour que la reprise (nouvelle
    // livraison du webhook, finalize) n'attende pas son expiration. La cle
    // d'idempotence Stripe protege du doublon si Stripe avait en fait cree.
    await pool.query(
      `UPDATE checkout_subscription_claims SET claim_expires_at = NOW()
        WHERE attempt_key = $1 AND subscription_id IS NULL`,
      [attemptKey],
    ).catch(() => {});
    throw createErr;
  }

  const winner = await settleSubscriptionClaim(pool, attemptKey, created.id).catch(() => null);
  if (winner && winner !== created.id) {
    // Les deux barrieres ont ete contournees (bases distinctes, cle divergente).
    // L'abonnement de cet appel date de quelques secondes et ferait une seconde
    // facturation : il est annule tout de suite, celui de la tentative reste.
    logger.error({ scope: args.scope, duplicate: created.id, kept: winner, attemptKey },
      "[PublicBilling][P0] ABONNEMENT EN DOUBLE DETECTE — annulation immediate du doublon");
    try {
      await args.stripe.subscriptions.cancel(created.id);
    } catch (cancelErr) {
      logger.error({ cancelErr, duplicate: created.id },
        "[PublicBilling][P0] annulation du doublon IMPOSSIBLE — intervention manuelle requise");
    }
    return await args.stripe.subscriptions.retrieve(winner);
  }

  logger.info({ scope: args.scope, subscriptionId: created.id, attemptKey, role: claim.role },
    "[PublicBilling][P0] abonnement cree une seule fois pour cette tentative");
  return created;
}

/* Add-ons that are one-time purchases (not subscription items) */
export const AI_CREDIT_PACKS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

/* PLAN_INCLUDED_ADDONS imported from plans.ts — do NOT duplicate here */

export function buildLineItems(
  plan: string,
  addons: AddonsMap,
): {
  subscriptionItems: Array<{ price: string; quantity: number }>;
  oneTimeItems: Array<{ price: string; quantity: number }>;
  checkoutType: string;
} {
  const included = PLAN_INCLUDED_ADDONS[plan.toLowerCase()] ?? new Set();
  const subscriptionItems: Array<{ price: string; quantity: number }> = [];
  const oneTimeItems: Array<{ price: string; quantity: number }> = [];

  /* Plan */
  const planPriceId = getPlanPriceId(plan);
  if (plan && !planPriceId) throw new Error("MISSING_PRICE_ID");
  if (planPriceId) subscriptionItems.push({ price: planPriceId, quantity: 1 });

  /* Resolve the Stripe key once so getAddonPriceId() can prefer test-mode overrides */
  const _stripeKeyForPrices = (() => { try { return getStripeKey() ?? ""; } catch { return ""; } })();

  /* Monthly flag add-ons */
  for (const key of FLAG_ADDONS) {
    if (!addons[key]) continue;
    if (included.has(key)) continue; /* skip included */
    if (AI_CREDIT_PACKS.has(key)) continue;
    const priceId = getAddonPriceId(key, _stripeKeyForPrices);
    if (!priceId) throw new Error("MISSING_PRICE_ID");
    subscriptionItems.push({ price: priceId, quantity: 1 });
  }

  /* Qty add-ons */
  for (const key of QTY_ADDONS) {
    const qty = Number(addons[key] || 0);
    if (qty <= 0) continue;
    if (AI_CREDIT_PACKS.has(key)) {
      /* One-time */
      const priceId = getAddonPriceId(key, _stripeKeyForPrices);
      if (!priceId) throw new Error("MISSING_PRICE_ID");
      oneTimeItems.push({ price: priceId, quantity: qty });
    } else {
      const priceId = getAddonPriceId(key, _stripeKeyForPrices);
      if (!priceId) throw new Error("MISSING_PRICE_ID");
      subscriptionItems.push({ price: priceId, quantity: qty });
    }
  }

  const hasPlan  = !!planPriceId;
  const hasOneTime = oneTimeItems.length > 0;
  const hasMonthly = subscriptionItems.filter(i => i.price !== planPriceId).length > 0;

  let checkoutType: string;
  if (hasPlan) checkoutType = "subscription";
  else if (hasOneTime && !hasMonthly) checkoutType = "ai_credits_only";
  else checkoutType = "addon_only";

  return { subscriptionItems, oneTimeItems, checkoutType };
}

/** Duree d'essai portee par l'intent (clamp 0-90, defaut 14 : intents anterieurs au champ). */
export function intentTrialDaysOf(intentMeta: Record<string, string>): number {
  const raw = intentMeta["trial_days_remaining"];
  return raw !== undefined && Number.isFinite(Number(raw))
    ? Math.max(0, Math.min(90, Math.round(Number(raw))))
    : 14;
}

export type EnsureSubscriptionsResult =
  | {
      kind: "ready";
      planSubscription: Stripe.Subscription;
      addonSubscriptionId: string | null;
      grantTrial: boolean;
      trialEndUnix: number | undefined;
    }
  | { kind: "conflict"; conflictSubscriptionId: string; conflictStatus: string };

/**
 * Cree (ou retrouve) l'abonnement du plan puis celui des add-ons pour une
 * tentative de checkout. Le moyen de paiement doit deja etre rattache au client.
 *
 * Aucun effet de bord hors Stripe et checkout_subscription_claims. Les erreurs
 * Stripe REMONTENT : le webhook en fait un 500 (Stripe renvoie l'evenement),
 * finalize les laisse a son catch general.
 */
export async function ensureSignupSubscriptions(args: {
  stripe: StripeClient;
  intentId: string;
  planKey: string;
  addons: AddonsMap;
  intentMeta: Record<string, string>;
  intentCreatedUnix: number | null;
  customerId: string;
  paymentMethodId: string;
  hasSubscriptionHistory: boolean;
  /** Cle d'organisation portee par les metadonnees (e-mail du signup, ou UUID). */
  orgRef: string;
  preRegisterToken: string;
  sellerCode: string | null;
  caller: "finalize" | "webhook";
}): Promise<EnsureSubscriptionsResult> {
  const { stripe, intentId, planKey, intentMeta, customerId, paymentMethodId, orgRef } = args;
  const planPriceId = getPlanPriceId(planKey);
  if (!planPriceId) throw new Error("MISSING_PLAN_PRICE_ID");

  const intentTrialDays = intentTrialDaysOf(intentMeta);
  // Essai uniquement pour un premier abonne confirme ; trial_days_remaining = 0
  // => essai deja consomme, facturation immediate.
  const grantTrial = !args.hasSubscriptionHistory && intentTrialDays > 0;
  // Ancre deterministe : l'essai part de la tentative de checkout (intent.created),
  // pas de l'horloge locale — deux appelants (finalize / webhook) construisent
  // ainsi un corps de requete identique, condition de l'idempotence Stripe.
  const anchorUnix = args.intentCreatedUnix ?? Math.floor(Date.now() / 1000);
  const trialEndUnix = grantTrial ? anchorUnix + intentTrialDays * 86400 : undefined;
  logger.info({ planKey, grantTrial, intentTrialDays, hasSubscriptionHistory: args.hasSubscriptionHistory, customerId, caller: args.caller },
    "[SignupSubscription] trial decision");

  const preRegToken = args.preRegisterToken || intentMeta["pre_register_token"] || "";
  let planSubscription: Stripe.Subscription;
  {
    const allSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    const activeOrTrialing = (allSubs.data as Stripe.Subscription[]).filter(
      (s) => (s.status === "active" || s.status === "trialing" || s.status === "past_due") && !s.cancel_at_period_end,
    );
    logger.info({
      customerId, planKey, planPriceId, caller: args.caller,
      totalSubsFetched: allSubs.data.length,
      activeOrTrialing: activeOrTrialing.length,
      activeSubSummary: activeOrTrialing.map((s) => ({ id: s.id, status: s.status, priceId: s.items.data[0]?.price.id ?? null })),
    }, "[SignupSubscription] sub state before idempotency check");

    const samePlanReusable = activeOrTrialing.find(
      (s) => s.items.data.some((item) => item.price.id === planPriceId),
    );
    if (samePlanReusable) {
      logger.info({ subscriptionId: samePlanReusable.id, planKey, customerId, caller: args.caller },
        "[SignupSubscription] reusing existing plan subscription (idempotent)");
      planSubscription = samePlanReusable;
    } else if (activeOrTrialing.length > 0) {
      const conflict = activeOrTrialing[0]!;
      logger.error({
        conflictSubId: conflict.id, conflictStatus: conflict.status,
        conflictPriceId: conflict.items.data[0]?.price.id, newPlan: planKey, customerId, orgRef, caller: args.caller,
      }, "[PublicBilling][P0] DUPLICATE SUBSCRIPTION BLOCKED — customer already has active/trialing subscription for a different plan");
      return { kind: "conflict", conflictSubscriptionId: conflict.id, conflictStatus: conflict.status };
    } else {
      planSubscription = await createSubscriptionForAttempt({
        stripe,
        intentId,
        scope:    "plan",
        plan:     planKey,
        priceId:  planPriceId,
        orgRef,
        params: {
          customer:               customerId,
          items:                  [{ price: planPriceId, quantity: 1 }],
          ...(trialEndUnix !== undefined ? { trial_end: trialEndUnix } : {}),
          default_payment_method: paymentMethodId,
          metadata: {
            plan:           planKey,
            source:         "checkout_payment",
            flowpoint_cart: "true",
            org_id:         orgRef,
            orgId:          orgRef,
            ...(args.sellerCode ? { seller_id: args.sellerCode, seller_attribution: "ref_link" } : {}),
            ...(preRegToken ? { pre_register_token: preRegToken } : {}),
            ...metadataDepuisAttribution(lireAttributionFunnel(intentMeta)),
          },
        },
      });
    }
  }

  // Add-ons : deja payes au mois 1 via le PaymentIntent ; l'abonnement recurrent
  // demarre au mois 2 (meme ancre deterministe que l'essai du plan).
  const { subscriptionItems } = buildLineItems(planKey, args.addons);
  const addonItems = subscriptionItems.filter((i) => i.price !== planPriceId);
  let addonSubscriptionId: string | null = null;
  if (addonItems.length > 0) {
    const addonSub = await createSubscriptionForAttempt({
      stripe,
      intentId,
      scope:    "plan_addons",
      plan:     planKey,
      priceId:  addonItems.map((i) => String(i.price)).sort().join("+"),
      orgRef,
      params: {
        customer:               customerId,
        items:                  addonItems,
        trial_end:              anchorUnix + 30 * 24 * 60 * 60,
        default_payment_method: paymentMethodId,
        metadata: {
          plan:           planKey,
          addons:         JSON.stringify(args.addons),
          source:         "checkout_payment_addons",
          flowpoint_cart: "true",
        },
      },
    });
    addonSubscriptionId = addonSub.id;
  }
  return { kind: "ready", planSubscription, addonSubscriptionId, grantTrial, trialEndUnix };
}

/**
 * Rattache le moyen de paiement au client et le pose par defaut. Idempotent :
 * un PM deja rattache ne declenche aucun appel d'attache (finalize peut passer
 * avant ou apres le webhook).
 */
export async function attachPaymentMethodIdempotent(
  stripe: StripeClient,
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
  const already = pm?.customer && pm.customer === customerId;
  if (!already) {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (err) {
      const msg = String((err as { message?: string } | null)?.message ?? err ?? "");
      if (!(msg.includes("already been attached") || msg.includes("already attached"))) throw err;
    }
  }
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
}

/* ───────────────────────────────────────────────────────────────────────────
   Provisionnement depuis un intent REUSSI (chemin webhook et rattrapage)
   ─────────────────────────────────────────────────────────────────────────── */

/** Raisons explicites pour lesquelles AUCUNE souscription n'a ete creee (organisation non premium). */
export type UnresolvedReason =
  | "no_plan"            // metadata.plan absent ou inconnu
  | "plan_price_missing" // aucun prix Stripe configure pour ce plan/mode
  | "no_payment_method"  // l'intent ne porte pas de moyen de paiement
  | "no_customer"        // ni intent.customer ni pending_signups.stripe_customer_id
  | "signup_not_found"   // pas de pending_signups pour le jeton (cle d'organisation introuvable)
  | "intent_not_succeeded"
  | "existing_subscription_conflict"; // le client a deja un abonnement actif d'un AUTRE plan

export type ProvisionedSubscription = {
  subscriptionId: string;
  status: string;
  trialEndUnix: number | null;
  currentPeriodEndUnix: number | null;
  plan: string;
  customerId: string;
  addonSubscriptionId: string | null;
};

export type ProvisionResult =
  | { kind: "ready"; subscription: ProvisionedSubscription; customerId: string; orgRef: string }
  | { kind: "unresolved"; reason: UnresolvedReason; customerId: string | null; orgRef: string | null };

type IntentLike = {
  id: string;
  status?: string;
  created?: number;
  customer?: unknown;
  payment_method?: unknown;
  metadata?: Record<string, string> | null;
};

const idOf = (v: unknown): string | null =>
  typeof v === "string" && v ? v : (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

/**
 * Cree (ou retrouve) la souscription d'essai d'un intent reussi, SANS navigateur.
 *
 * Meme decision que finalize-checkout (ensureSignupSubscriptions) : prix resolus
 * par getPlanPriceId/getAddonPriceId, essai = trial_days_remaining de l'intent,
 * cle d'idempotence partagee. Les erreurs Stripe/DB REMONTENT (le webhook repond
 * 500 pour que Stripe renvoie l'evenement) ; seuls les cas definitivement
 * irresolvables retournent `unresolved`, avec leur raison.
 */
export async function provisionSubscriptionFromIntent(args: {
  stripe: StripeClient;
  intent: IntentLike;
  preRegisterToken: string;
  /** Rattrapage : cle d'organisation connue (owner_email) quand pending_signups a disparu. */
  orgRefOverride?: string | null;
  /**
   * #410 — Customer deja resolu APRES confirmation (ensurePendingSignupStripeCustomer,
   * chemin payment_intent.succeeded). Prioritaire sur intent.customer.
   */
  customerIdOverride?: string | null;
  caller: "webhook" | "reconcile";
}): Promise<ProvisionResult> {
  const { stripe, intent } = args;
  const meta = (intent.metadata ?? {}) as Record<string, string>;
  const { pool } = await import("@workspace/db");

  if (intent.status && intent.status !== "succeeded") {
    return { kind: "unresolved", reason: "intent_not_succeeded", customerId: null, orgRef: null };
  }

  // Cle d'organisation portee par les metadonnees : l'e-mail du signup, comme
  // finalize-checkout (_authenticatedOrgId) — sinon le corps differe et Stripe
  // refuserait de rejouer la reponse memorisee.
  let orgRef: string | null = args.orgRefOverride ?? null;
  let signupCustomerId: string | null = null;
  if (args.preRegisterToken) {
    const r = await pool.query(
      `SELECT email, stripe_customer_id FROM pending_signups WHERE token = $1 LIMIT 1`,
      [args.preRegisterToken],
    );
    if (r.rows[0]) {
      orgRef = orgRef ?? ((r.rows[0] as { email?: string }).email ?? null);
      signupCustomerId = (r.rows[0] as { stripe_customer_id?: string | null }).stripe_customer_id || null;
    }
  }

  const planKey = (meta["plan"] ?? "").toLowerCase();
  const customerId = args.customerIdOverride || idOf(intent.customer) || signupCustomerId;
  if (!orgRef) return { kind: "unresolved", reason: "signup_not_found", customerId, orgRef };
  if (!planKey) return { kind: "unresolved", reason: "no_plan", customerId, orgRef };
  if (!getPlanPriceId(planKey)) return { kind: "unresolved", reason: "plan_price_missing", customerId, orgRef };
  const paymentMethodId = idOf(intent.payment_method);
  if (!paymentMethodId) return { kind: "unresolved", reason: "no_payment_method", customerId, orgRef };
  if (!customerId) return { kind: "unresolved", reason: "no_customer", customerId, orgRef };

  let addons: AddonsMap = {};
  try { addons = JSON.parse(meta["addons"] || "{}") as AddonsMap; } catch { addons = {}; }

  // #410 — meme decision d'essai que finalize-checkout (resolveTrialEligibility) :
  // l'historique d'une PERSONNE (toutes ses organisations, tous les clients Stripe
  // de son e-mail, abonnements annules compris), pas seulement celui de ce
  // Customer. Echec de la verification => erreur (500, relivraison), jamais un
  // essai accorde par defaut.
  const { isTrialEligibleForIdentity } = await import("./stripe-trial-history.js");
  // Rattrapage (reconcile) : l'organisation existe deja, son eligibilite a ete
  // decidee a l'inscription — seul l'historique de ce Customer est relu (#390).
  const trialEligible = args.caller === "webhook" && orgRef.includes("@")
    ? await isTrialEligibleForIdentity(
        pool as never,
        { email: orgRef, customerIds: [customerId] },
        stripe as never,
      )
    : (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 })).data.length === 0;
  await attachPaymentMethodIdempotent(stripe, customerId, paymentMethodId);

  const res = await ensureSignupSubscriptions({
    stripe,
    intentId: intent.id,
    planKey,
    addons,
    intentMeta: meta,
    intentCreatedUnix: typeof intent.created === "number" ? intent.created : null,
    customerId,
    paymentMethodId,
    hasSubscriptionHistory: !trialEligible,
    orgRef,
    preRegisterToken: args.preRegisterToken,
    sellerCode: meta["seller_id"] || null,
    caller: args.caller === "reconcile" ? "webhook" : args.caller,
  });
  if (res.kind === "conflict") {
    return { kind: "unresolved", reason: "existing_subscription_conflict", customerId, orgRef };
  }
  const sub = res.planSubscription as Stripe.Subscription & {
    trial_end?: number | null; current_period_end?: number | null;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const periodEnd = typeof sub.current_period_end === "number"
    ? sub.current_period_end
    : (typeof sub.items?.data?.[0]?.current_period_end === "number" ? sub.items!.data![0]!.current_period_end! : null);
  return {
    kind: "ready",
    customerId,
    orgRef,
    subscription: {
      subscriptionId: sub.id,
      status: sub.status ?? (res.grantTrial ? "trialing" : "active"),
      trialEndUnix: typeof sub.trial_end === "number" ? sub.trial_end : (res.trialEndUnix ?? null),
      currentPeriodEndUnix: periodEnd,
      plan: planKey,
      customerId,
      addonSubscriptionId: res.addonSubscriptionId,
    },
  };
}
