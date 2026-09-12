/**
 * Checkout abandonné — gardes contre les mutations prématurées
 *
 * Vérifie que FlowPoint ne persiste aucune donnée métier (plan, subscription,
 * entitlement, billing state) avant un signal de succès réel de Stripe.
 *
 * Frontières testées :
 *   • /api/billing/verify         → payment_status !== "paid" → 402 (pas de persistOrgData)
 *   • /api/public/finalize-checkout (checkout_session) → non-paid → 402
 *   • /api/public/finalize-checkout (payment_intent)   → non-succeeded → 400
 *   • billing/upgrade → aucune écriture DB avant stripe.checkout.sessions.create()
 *   • Client Stripe canonique réutilisé — pas de doublon sur nouvelle tentative
 *   • checkout-return.html → Case B (session_id) ne déclenche pas finalize-checkout
 *
 * Test IDs: CA-1 … CA-6
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Paths relative to this test file (artifacts/api-server/src/tests/)
const DIR = import.meta.dirname ?? __dirname;

const billingTs       = fs.readFileSync(path.join(DIR, "../routes/billing.ts"), "utf8");
const publicBillingTs = fs.readFileSync(path.join(DIR, "../routes/public-billing.ts"), "utf8");
const checkoutReturn  = (() => {
  // Test file: artifacts/api-server/src/tests/ → 3 levels up = artifacts/
  const p = path.join(DIR, "../../../flowpoint-export/checkout-return.html");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
})();
const ensurePath = path.join(DIR, "../services/ensure-stripe-customer.ts");

/* ── CA-1 : /api/billing/verify — checkout abandonné (non-paid) → 402, aucune écriture ── */
describe("CA-1 — billing/verify rejette les sessions non-payées avant toute écriture", () => {
  it("guard payment_status !== 'paid' && status !== 'complete' → renvoie 402", () => {
    // Le guard doit être présent et impérativement positionné AVANT persistOrgData
    const guardIdx      = billingTs.indexOf("payment_status !== \"paid\" && session.status !== \"complete\"");
    const persistIdx    = billingTs.indexOf("await persistOrgData(orgIdVerify");
    const broadcastIdx  = billingTs.indexOf("store.broadcastPlanUpdate");

    expect(guardIdx,   "guard payment_status absent de billing/verify").toBeGreaterThan(0);
    expect(persistIdx, "persistOrgData absent de billing/verify").toBeGreaterThan(0);
    expect(broadcastIdx,"broadcastPlanUpdate absent de billing/verify").toBeGreaterThan(0);
    expect(guardIdx, "guard doit précéder persistOrgData").toBeLessThan(persistIdx);
    expect(guardIdx, "guard doit précéder broadcastPlanUpdate").toBeLessThan(broadcastIdx);
  });

  it("le guard inclut un return (bloque l'exécution du handler)", () => {
    // Regex : la réponse 402 est suivie d'un return dans le même bloc
    expect(billingTs).toMatch(
      /payment_status\s*!==\s*["']paid["'][\s\S]{0,200}res\.status\(402\)[\s\S]{0,100}return/
    );
  });

  it("aucun persistOrgData ni broadcastPlanUpdate ne précède le guard dans le handler verify", () => {
    // Extraire le bloc du handler GET /billing/verify
    const handlerStart  = billingTs.indexOf("router.get(\"/billing/verify\"");
    const guardIdx      = billingTs.indexOf("payment_status !== \"paid\" && session.status !== \"complete\"", handlerStart);
    const persistBeforeGuard = billingTs.lastIndexOf("await persistOrgData(", guardIdx);

    // persistOrgData avant le guard doit être hors du handler verify (dans un autre handler)
    expect(persistBeforeGuard).toBeLessThan(handlerStart);
  });
});

/* ── CA-2 : finalize-checkout checkout_session — non-paid → 402 avant toute écriture ── */
describe("CA-2 — finalize-checkout (checkout_session) rejette les sessions non-payées", () => {
  it("guard payment_status paid|no_payment_required est présent", () => {
    expect(publicBillingTs).toMatch(/_csIsPaid\s*=\s*_csSession\.payment_status\s*===\s*["']paid["']/);
    expect(publicBillingTs).toMatch(/_csSession\.payment_status\s*===\s*["']no_payment_required["']/);
  });

  it("!_csIsPaid → renvoie 402 sans write", () => {
    expect(publicBillingTs).toMatch(/!_csIsPaid[\s\S]{0,200}res\.status\(402\)/);
  });

  it("le guard checkout_session est suivi d'un early-return (aucune mutation ne suit)", () => {
    // Le handler checkout_session se termine par res.json + return AVANT le bloc "1. Verify intent"
    const csSection = (() => {
      const start = publicBillingTs.indexOf("checkout_session: Stripe-hosted subscription checkout");
      const end   = publicBillingTs.indexOf("1. Verify intent & get payment method", start);
      return publicBillingTs.slice(start, end);
    })();

    // La section checkout_session doit contenir les deux chemins de return
    expect(csSection).toMatch(/res\.json\(\{.*awaitingWebhook: true/s);  // succès → awaiting webhook
    expect(csSection).toMatch(/res\.status\(402\)/);                     // non-paid → 402
    // Elle ne doit PAS contenir persistOrgData (pas de write local)
    expect(csSection).not.toContain("persistOrgData");
    expect(csSection).not.toContain("UPDATE organizations");
    expect(csSection).not.toContain("broadcastPlanUpdate");
  });

  it("checkout_session succès → awaitingWebhook:true (le webhook Stripe est la seule source d'activation)", () => {
    expect(publicBillingTs).toMatch(/awaitingWebhook:\s*true/);
    // Le commentaire doit l'expliciter
    expect(publicBillingTs).toMatch(/webhook.*activation/i);
  });
});

/* ── CA-3 : finalize-checkout payment_intent — status non-succeeded → 400 ── */
describe("CA-3 — finalize-checkout (payment_intent) rejette les PI non confirmés", () => {
  it("guard pi.status !== 'succeeded' && !== 'processing' → 400", () => {
    expect(publicBillingTs).toMatch(
      /pi\.status\s*!==\s*["']succeeded["']\s*&&\s*pi\.status\s*!==\s*["']processing["']/
    );
    expect(publicBillingTs).toMatch(/pi\.status\s*!==[\s\S]{0,200}res\.status\(400\)/);
  });

  it("guard SetupIntent si.status !== 'succeeded' → 400", () => {
    expect(publicBillingTs).toMatch(/si\.status\s*!==\s*["']succeeded["']/);
    expect(publicBillingTs).toMatch(/si\.status\s*!==[\s\S]{0,200}res\.status\(400\)/);
  });

  it("les guards PI/SI précèdent les premiers appels DB dans finalize-checkout", () => {
    const piGuardIdx   = publicBillingTs.indexOf("pi.status !== \"succeeded\"");
    const firstDbWrite = publicBillingTs.indexOf("await _aoPool.connect");
    expect(piGuardIdx).toBeGreaterThan(0);
    expect(firstDbWrite).toBeGreaterThan(0);
    expect(piGuardIdx, "guard PI doit précéder le premier accès DB").toBeLessThan(firstDbWrite);
  });
});

/* ── CA-4 : billing/upgrade — aucune activation métier avant stripe.checkout.sessions.create ── */
describe("CA-4 — billing/upgrade ne persiste rien d'activable avant la Checkout Session", () => {
  /* On cherche entre le debut du handler upgrade et le premier checkout.sessions.create()
     que les seules écritures autorisées sont :
       • lecture de stripe_customer_id via anchoredCustomer
       • subscriptionStatus: "canceled" (annulation d'une sub existante — gated sur Stripe)
     Sont interdites AVANT create() : plan=X activé, subscriptionStatus="active",
     stripeSubscriptionId, entitlement.                                            */

  it("billing/upgrade handler existe et contient stripe.checkout.sessions.create", () => {
    const upgradeStart = billingTs.indexOf("router.post(\"/billing/upgrade\"");
    const firstCreate  = billingTs.indexOf("stripe.checkout.sessions.create(", upgradeStart);
    expect(upgradeStart, "handler /billing/upgrade absent").toBeGreaterThan(0);
    expect(firstCreate,  "stripe.checkout.sessions.create absent du handler upgrade").toBeGreaterThan(0);
  });

  it("plan='active' / subscriptionStatus='active' n'est pas écrit avant create()", () => {
    const upgradeStart = billingTs.indexOf("router.post(\"/billing/upgrade\"");
    const firstCreate  = billingTs.indexOf("stripe.checkout.sessions.create(", upgradeStart);
    const preCreate    = billingTs.slice(upgradeStart, firstCreate);
    // La seule écriture d'activation interdite avant create() : subscriptionStatus="active"
    // (une annulation via subscriptionStatus="canceled" est gated sur Stripe et acceptable)
    expect(preCreate).not.toMatch(/subscriptionStatus:\s*["']active["']/);
  });

  it("le premier Checkout authentifié ne pré-crée aucun Customer Stripe", () => {
    const markerStart = billingTs.indexOf("// No existing Stripe subscription");
    const markerEnd = billingTs.indexOf("// ── GET /billing/subscription", markerStart);
    const noSubBlock = billingTs.slice(markerStart, markerEnd > markerStart ? markerEnd : undefined);
    expect(markerStart, "bloc no-sub absent").toBeGreaterThan(0);
    expect(noSubBlock).not.toContain("ensureStripeCustomer(");
    expect(noSubBlock).not.toMatch(/\bcustomer:\s*_nsCustomerId/);
    expect(noSubBlock).toContain("customer_email");
  });

  it("après create(), au moins un persistOrgData est présent (activation post-paiement)", () => {
    // billing/verify appelle persistOrgData après vérification payment_status paid
    const upgradeStart = billingTs.indexOf("router.post(\"/billing/upgrade\"");
    const firstCreate  = billingTs.indexOf("stripe.checkout.sessions.create(", upgradeStart);
    // persistOrgData doit exister dans billing.ts (dans billing/verify ou après Stripe confirm)
    expect(billingTs.indexOf("await persistOrgData(")).toBeGreaterThan(0);
    // Il ne doit PAS y avoir de persistOrgData entre create() et la fin du handler upgrade immédiat
    // (la création seule ne valide pas ; validation arrive via webhook ou /billing/verify)
    const afterCreate = billingTs.slice(firstCreate, firstCreate + 500);
    // La réponse immédiate après create() est { reactivation: true, checkoutUrl } sans persistOrgData
    expect(afterCreate).not.toContain("await persistOrgData(");
  });
});

/* ── CA-5 : Checkout abandonné puis nouvelle tentative — pas de doublon Customer ── */
describe("CA-5 — pas de Customer Stripe parasite sur tentative après abandon", () => {
  it("billing/upgrade réutilise uniquement le Customer ancré pour une réactivation", () => {
    // Scoper la recherche au handler upgrade uniquement
    const upgradeStart = billingTs.indexOf("router.post(\"/billing/upgrade\"");
    const upgradeEnd   = billingTs.indexOf("\nrouter.", upgradeStart + 1);
    const upgradeBlock = billingTs.slice(upgradeStart, upgradeEnd > 0 ? upgradeEnd : undefined);

    // L'ancre organizations est lue, et aucun fallback de création n'existe dans upgrade.
    const anchorIdx = upgradeBlock.indexOf("anchoredCustomer");
    const ensureIdx = upgradeBlock.indexOf("await ensureStripeCustomer(");
    expect(anchorIdx, "anchoredCustomer absent du handler upgrade").toBeGreaterThan(0);
    expect(ensureIdx, "ensureStripeCustomer ne doit pas être appelé dans upgrade").toBe(-1);
  });

  it("ensureStripeCustomer est DB-first (cherche un customer existant avant d'en créer un)", () => {
    // Vérification structurelle dans ensure-stripe-customer.ts
    const ensureSrc  = fs.existsSync(ensurePath) ? fs.readFileSync(ensurePath, "utf8") : "";
    // La fonction doit chercher un customer existant (retrieve ou search) AVANT de créer (customers.create)
    const retrieveIdx = Math.min(
      ensureSrc.indexOf("customers.retrieve") > 0 ? ensureSrc.indexOf("customers.retrieve") : Infinity,
      ensureSrc.indexOf("customers.search")   > 0 ? ensureSrc.indexOf("customers.search")   : Infinity,
    );
    const createIdx = ensureSrc.indexOf("customers.create");
    expect(retrieveIdx, "ensureStripeCustomer doit retrieve/search avant create").toBeLessThan(createIdx);
  });

  it("idempotence : billing/upgrade retourne la même session ouverte si elle existe déjà", () => {
    // La logique d'idempotence doit lister les sessions existantes et les réutiliser
    expect(billingTs).toMatch(/sessions\.list\(/);
    // Elle filtre par status open et métadonnées (reactivation/plan)
    expect(billingTs).toMatch(/status:\s*["']open["']/);
    expect(billingTs).toMatch(/reactivation/);
  });
});

/* ── CA-7 : ONE_CUSTOMER_INVARIANT — checkout-session ne pré-crée pas de Customer ── */
describe("CA-7 — checkout-session (nouveau signup) ne crée pas de Customer avant le paiement", () => {
  it("customers.create() absent du bloc preRegisterToken de checkout-session", () => {
    // Le bloc preRegisterToken s'étend de ONE_CUSTOMER_INVARIANT jusqu'à "No canonical Customer found".
    const invariantStart = publicBillingTs.indexOf("ONE_CUSTOMER_INVARIANT (checkout-session");
    const invariantEnd   = publicBillingTs.indexOf("No canonical Customer found", invariantStart);
    expect(invariantStart, "marqueur ONE_CUSTOMER_INVARIANT absent de public-billing.ts").toBeGreaterThan(0);
    expect(invariantEnd,   "marqueur 'No canonical Customer found' absent").toBeGreaterThan(invariantStart);

    const zone = publicBillingTs.slice(invariantStart, invariantEnd + 200);
    // Strip comment lines before checking: a comment can say "do NOT call customers.create()"
    // without that being an actual call.
    const zoneNoComments = zone.split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");
    // Ne doit pas créer de Customer — seulement en réutiliser un existant ancré par webhook
    expect(zoneNoComments).not.toContain("customers.create(");
  });

  it("customers.list() email-search absent du bloc preRegisterToken de checkout-session (évite les faux positifs)", () => {
    const invariantStart = publicBillingTs.indexOf("ONE_CUSTOMER_INVARIANT (checkout-session");
    const invariantEnd   = publicBillingTs.indexOf("No canonical Customer found", invariantStart);
    const zone = publicBillingTs.slice(invariantStart, invariantEnd + 200);
    const zoneNoComments = zone.split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");
    // Un email-search retournerait des Customers orphelins (Checkout abandonné) — interdit
    expect(zoneNoComments).not.toMatch(/customers\.list\(\s*\{\s*email/);
  });

  it("customer_email est passé à checkout.sessions.create pour les nouveaux signups sans Customer canonique", () => {
    // La prop customer_email doit être présente dans le bloc customerParam
    expect(publicBillingTs).toContain("customer_email: signupRow.email");
  });

  it("reuse uniquement depuis consumed_at (paiement passé réussi), pas depuis un token ouvert", () => {
    // La requête de réutilisation doit filtrer sur consumed_at IS NOT NULL
    // (pas sur expires_at > NOW() AND consumed_at IS NULL comme avant)
    const reuseBlock = publicBillingTs.slice(
      publicBillingTs.indexOf("ONE_CUSTOMER_INVARIANT (checkout-session"),
      publicBillingTs.indexOf("No canonical Customer found")
    );
    expect(reuseBlock).toContain("consumed_at IS NOT NULL");
    expect(reuseBlock).not.toMatch(/consumed_at IS NULL[\s\S]{0,200}stripe_customer_id/);
  });

  it("webhook checkout.session.completed ancre le Customer dans pending_signups", () => {
    const webhookSrc = fs.readFileSync(
      path.join(DIR, "../routes/stripe-webhook.ts"), "utf8"
    );
    // Le webhook doit écrire stripe_customer_id dans pending_signups
    expect(webhookSrc).toMatch(/UPDATE pending_signups SET stripe_customer_id/);
    // Seulement si le Customer n'existe pas encore (idempotent)
    expect(webhookSrc).toMatch(/stripe_customer_id IS NULL OR stripe_customer_id = ''/);
    // La condition sur le token doit utiliser pre_register_token de meta
    expect(webhookSrc).toMatch(/preRegTokenFromMeta|pre_register_token/);
  });
});

/* ── CA-6 : checkout-return.html — Case B (session_id) n'appelle pas finalize-checkout ── */
describe("CA-6 — checkout-return.html Case B (session_id) utilise billing/verify, pas finalize-checkout", () => {
  it("checkout-return.html existe", () => {
    expect(checkoutReturn.length, "checkout-return.html introuvable").toBeGreaterThan(0);
  });

  it("Case B (session_id) appelle /api/billing/verify, pas finalize-checkout", () => {
    // Extraire le bloc Case B (le commentaire utilise "Case B:")
    const caseBStart = checkoutReturn.indexOf("Case B:");
    expect(caseBStart, "Commentaire 'Case B:' introuvable dans checkout-return.html").toBeGreaterThan(0);
    const caseBBlock = checkoutReturn.slice(caseBStart, caseBStart + 3000);
    expect(caseBBlock).toContain("/api/billing/verify");
    expect(caseBBlock).not.toContain("/api/public/finalize-checkout");
  });

  it("Case B est protégé par le guard payment_status côté serveur (billing/verify renvoie 402 si non-paid)", () => {
    // billing/verify apparaît dans checkout-return.html pour le path session_id
    const verifyErrIdx = checkoutReturn.indexOf("/api/billing/verify");
    expect(verifyErrIdx).toBeGreaterThan(0);
    // Il y a un handler .catch ou une vérification de statut après le fetch
    const afterVerify = checkoutReturn.slice(verifyErrIdx, verifyErrIdx + 2000);
    const hasErrHandling = afterVerify.includes(".catch") || afterVerify.includes(".ok") ||
                           afterVerify.includes("status") || afterVerify.includes("!res.ok");
    expect(hasErrHandling, "checkout-return.html doit gérer les erreurs de billing/verify").toBe(true);
  });

  it("Case A (payment_intent) appelle finalize-checkout mais seulement avec un intentId valide", () => {
    const caseAStart = checkoutReturn.indexOf("Case A:");
    expect(caseAStart, "Commentaire 'Case A:' introuvable dans checkout-return.html").toBeGreaterThan(0);
    const caseABlock = checkoutReturn.slice(caseAStart, caseAStart + 2000);
    expect(caseABlock).toContain("/api/public/finalize-checkout");
    // intentId doit être non-vide (guard côté client)
    expect(caseABlock).toMatch(/paymentIntentId|setupIntentId/);
  });
});
