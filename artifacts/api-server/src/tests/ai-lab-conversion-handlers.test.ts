/**
 * Les handlers emettent-ils vraiment, et seulement quand il faut ?
 *
 * `ai-lab-conversion-emitters.test.ts` prouve que le client ne nuit jamais. Il ne
 * prouve pas que quiconque l'appelle : un emetteur correct que personne
 * n'invoque se teste tout aussi vert. Ces tests pilotent donc le VRAI routeur du
 * webhook Stripe, avec un Postgres factice — le motif deja employe par
 * `stripe-webhook-pending-activation.test.ts`.
 *
 * Deux proprietes comptent plus que l'emission elle-meme.
 *
 * Le jalon n'est annonce qu'APRES la transition metier. Un evenement marque
 * `failed` ou deja traite ne doit rien emettre : on ne declare pas un paiement
 * qu'on n'a pas enregistre.
 *
 * Et `paid` exclut ce qui n'est pas un premier paiement positif de l'abonnement
 * principal. Le funnel ne retient qu'un jalon par prospect et par etape, donc la
 * premiere facture gagne : une facture a 0 € au demarrage de l'essai marquerait
 * « payant » un prospect qui n'a rien paye, et definitivement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const EMAIL = "lead@example.com";
const ORG = "4e4f1f3e-1d6c-4f1a-9b3a-7a2c9c5e1f01";
const CUS = "cus_AILAB";
const SUB = "sub_AILAB";
const FP_LID = "TestLeadFp_0000000001A";
const CREATED = Math.floor(Date.parse("2026-10-06T18:30:00.000Z") / 1000);

let orgFpLid: string | null;
let billingClaim: boolean;
let metadataWrites: Record<string, unknown>[];
// Les ecritures de `markEventStatus`, isolees : c'est la seule attendue avant la
// reponse, donc la seule qu'un arret du processus ne peut pas escamoter.
let statusWrites: Record<string, unknown>[];

const emitted: Record<string, unknown>[] = [];
let emitOutcome: string;

vi.mock("../lib/conversion-events.js", async () => {
  const actual = await import("../lib/conversion-events.js");
  return {
    ...actual,
    emitConversionEvent: vi.fn(async (e: Record<string, unknown>) => {
      emitted.push(e);
      return emitOutcome;
    }),
  };
});

function fakeQuery(sql: string, p?: unknown[]): { rows: unknown[]; rowCount: number } {
  const q = sql.replace(/\s+/g, " ").trim();
  if (/INSERT INTO billing_events/i.test(q)) {
    return { rows: billingClaim ? [{ status: null }] : [], rowCount: billingClaim ? 1 : 0 };
  }
  // `markEventStatus` : statut en $2, metadonnees supplementaires en $3.
  if (/UPDATE billing_events SET metadata = jsonb_set/i.test(q)) {
    const write = {
      status: String((p ?? [])[1] ?? ""),
      ...JSON.parse(String((p ?? [])[2] ?? "{}")) as Record<string, unknown>,
    };
    statusWrites.push(write);
    metadataWrites.push(write);
    return { rows: [], rowCount: 1 };
  }
  // `noteEmission` : fusion jsonb simple, champs en $2.
  if (/UPDATE billing_events SET metadata/i.test(q)) {
    metadataWrites.push(JSON.parse(String((p ?? [])[1] ?? "{}")));
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT fp_lid FROM organizations/i.test(q)) {
    return { rows: [{ fp_lid: orgFpLid }], rowCount: 1 };
  }
  if (/UPDATE billing_events/i.test(q)) return { rows: [], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => {
  const client = { query: vi.fn((s: string, p?: unknown[]) => fakeQuery(s, p)), release: vi.fn() };
  return {
    pool: { connect: vi.fn(async () => client), query: vi.fn((s: string, p?: unknown[]) => fakeQuery(s, p)) },
    db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn(),
  };
});
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/stripe-factory.js", () => ({
  getStripeKey: vi.fn(() => undefined),
  createStripeClient: vi.fn(async () => null),
}));
vi.mock("../services/org-data.js", () => ({
  findOrgByStripeCustomer: vi.fn(async () => ORG),
  persistOrgData: vi.fn(async () => {}),
  loadOrgData: vi.fn(async () => ({ email: EMAIL, firstName: "Lead", plan: "standard" })),
}));
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => null),
  upsertOrgSettings: vi.fn(async () => {}),
}));
vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async () => true),
  deactivateAddon: vi.fn(async () => true),
  provisionPlanAddons: vi.fn(async () => {}),
}));

type FakeRes = { statusCode: number; body: unknown; status(c: number): FakeRes; json(b: unknown): FakeRes };

async function deliver(event: Record<string, unknown>): Promise<FakeRes> {
  const { default: router } = await import("../routes/stripe-webhook.js");
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === "/webhooks/stripe");
  const res: FakeRes = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = { headers: {}, body: event, rawBody: Buffer.from(JSON.stringify(event)) };
  await layer!.route!.stack[0]!.handle(req, res);
  // L'emission est detachee : on laisse la micro-tache s'executer.
  await new Promise((r) => setTimeout(r, 0));
  return res;
}

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "evt_AILAB_PAID", type: "invoice.payment_succeeded", created: CREATED,
  data: { object: {
    id: "in_AILAB", object: "invoice", customer: CUS, subscription: SUB,
    amount_paid: 4900, billing_reason: "subscription_cycle", lines: { data: [] },
    ...over,
  } },
});

const subscription = (over: Record<string, unknown> = {}) => ({
  id: "evt_AILAB_SUB", type: "customer.subscription.created", created: CREATED,
  data: { object: {
    id: SUB, object: "subscription", customer: CUS, status: "trialing",
    metadata: { orgId: ORG }, items: { data: [] }, ...over,
  } },
});

const checkout = () => ({
  id: "evt_AILAB_CO", type: "checkout.session.completed", created: CREATED,
  data: { object: { id: "cs_AILAB", object: "checkout_session", customer: CUS, metadata: { orgId: ORG } } },
});

beforeEach(() => {
  emitted.length = 0; metadataWrites = []; statusWrites = [];
  orgFpLid = FP_LID; billingClaim = true; emitOutcome = "sent";
  vi.clearAllMocks();
});

describe("le webhook emet les bons jalons", () => {
  it("paid : une facture payee porte l event_id, le fp_lid et l horodatage Stripe", async () => {
    await deliver(invoice());
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      eventId: "stripe:evt_AILAB_PAID:paid",
      stage: "paid",
      source: "stripe",
      fpLid: FP_LID,
      occurredAt: "2026-10-06T18:30:00.000Z",
    });
  });

  it("trial : un abonnement en essai emet trial", async () => {
    await deliver(subscription());
    expect(emitted.map((e) => e["stage"])).toEqual(["trial"]);
  });

  it("checkout : une session completee emet checkout", async () => {
    await deliver(checkout());
    expect(emitted.map((e) => e["stage"])).toEqual(["checkout"]);
  });

  it("l horodatage vient de event.created, jamais de l heure courante", async () => {
    await deliver(invoice());
    // Si l'emetteur utilisait `Date.now()`, un rejeu presenterait un autre
    // horodatage et AI Lab le refuserait comme collision d'identifiant.
    expect(emitted[0]!["occurredAt"]).toBe(new Date(CREATED * 1000).toISOString());
  });
});

describe("paid exclut ce qui n est pas un premier paiement positif", () => {
  it("une facture a 0 € n emet rien", async () => {
    await deliver(invoice({ amount_paid: 0 }));
    expect(emitted).toHaveLength(0);
  });

  it("une proration ou un add-on n emet rien", async () => {
    await deliver(invoice({ billing_reason: "subscription_update" }));
    expect(emitted).toHaveLength(0);
  });

  it("une facture sans abonnement n emet rien", async () => {
    await deliver(invoice({ subscription: null }));
    expect(emitted).toHaveLength(0);
  });

  // Les trois gardes ci-dessus laissaient passer le RENOUVELLEMENT d'un add-on :
  // montant positif, `billing_reason: "subscription_cycle"`, abonnement
  // renseigne. Les add-ons vivent sur leur propre abonnement Stripe, marque
  // `metadata.addonSub` — c'est ainsi que `services/addon-stripe-sync.ts`
  // reconnait l'abonnement principal. Renouvele avant le premier prelevement du
  // plan, il verrouillait « payant » sur un paiement qui n'est pas la conversion.
  it("le renouvellement d un add-on n emet rien (marqueur sur l abonnement)", async () => {
    await deliver(invoice({ subscription_details: { metadata: { addonSub: "true", orgId: ORG } } }));
    expect(emitted).toHaveLength(0);
  });

  it("le renouvellement d un add-on n emet rien (marqueur sur une ligne)", async () => {
    await deliver(invoice({ lines: { data: [{ metadata: { addonSub: "true" } }] } }));
    expect(emitted).toHaveLength(0);
  });

  // Le marqueur `addonSub` ne couvrait que les add-ons de `addon-stripe-sync`.
  // Le parcours public reel — `finalize-checkout`, celui qu'appellent
  // `checkout-payment.html` et `checkout-return.html` — cree l'abonnement
  // d'add-on avec `source: "checkout_payment_addons"` et SANS `addonSub`
  // (public-billing.ts:2404). Sa facture de renouvellement passait donc toutes
  // les gardes. Mesure E2E : elle produisait un faux jalon `paid`.
  it("le renouvellement d un add-on du parcours public n emet rien", async () => {
    await deliver(invoice({
      subscription_details: { metadata: { plan: "standard", source: "checkout_payment_addons" } },
      lines: { data: [{ metadata: { source: "checkout_payment_addons" } }] },
    }));
    expect(emitted).toHaveLength(0);
  });

  it("le marqueur sur les metadonnees d abonnement de la facture compte aussi", async () => {
    await deliver(invoice({ subscription_metadata: { addonSub: "true" } }));
    expect(emitted).toHaveLength(0);
  });

  it("une facture de l abonnement principal emet toujours paid", async () => {
    // Le garde-fou vise le marqueur, pas la presence de metadonnees : sans
    // marqueur on emet, car un signal absent n'est pas un signal negatif et
    // perdre la conversion coute plus cher qu'en compter une de trop.
    await deliver(invoice({
      subscription_details: { metadata: { orgId: ORG } },
      lines: { data: [{ metadata: { plan: "standard" } }] },
    }));
    expect(emitted.map((e) => e["stage"])).toEqual(["paid"]);
  });

  it("un abonnement payant d emblee n emet pas trial", async () => {
    await deliver(subscription({ status: "active" }));
    expect(emitted.filter((e) => e["stage"] === "trial")).toHaveLength(0);
  });

  // `customer.subscription.created` n'avait AUCUNE garde add-on. Or l'abonnement
  // d'add-on nait `trialing` par construction : `finalize-checkout` lui pose
  // `trial_end = +30 jours` parce que le premier mois est deja encaisse par
  // PaymentIntent. Mesure E2E : il produisait un faux jalon `trial` pour un
  // prospect sans aucun essai de plan.
  it("un abonnement d add-on ne declare pas un essai (parcours public)", async () => {
    await deliver(subscription({
      status: "trialing",
      metadata: { orgId: ORG, plan: "standard", source: "checkout_payment_addons" },
    }));
    expect(emitted).toHaveLength(0);
  });

  it("un abonnement d add-on dedie ne declare pas un essai (addon-stripe-sync)", async () => {
    await deliver(subscription({
      status: "trialing", metadata: { orgId: ORG, addonSub: "true" },
    }));
    expect(emitted).toHaveLength(0);
  });

  it("l abonnement de PLAN du parcours public declare checkout puis essai", async () => {
    // `finalize-checkout` etiquette le plan `source: "checkout_payment"` — sans
    // le suffixe `_addons`. La garde doit distinguer les deux. Et sa creation
    // prouve DEUX etapes : l'engagement, puis l'essai.
    await deliver(subscription({
      status: "trialing",
      metadata: { orgId: ORG, plan: "standard", source: "checkout_payment" },
    }));
    expect(emitted.map((e) => e["stage"])).toEqual(["checkout", "trial"]);
    expect(emitted.map((e) => e["eventId"])).toEqual([
      "stripe:evt_AILAB_SUB:checkout", "stripe:evt_AILAB_SUB:trial"]);
  });
});

describe("checkout suit le parcours PaymentIntent reel", () => {
  // Les pages du funnel appellent `/public/payment-intent` puis
  // `/public/finalize-checkout` (checkout-payment.html:360,
  // checkout-return.html:94). Rien n'appelle `/public/checkout-session`, donc
  // `checkout.session.completed` ne part JAMAIS dans ce parcours et l'etape
  // restait vide. L'evenement serveur fiable est la creation de l'abonnement
  // principal, que `finalize-checkout` ne fait qu'apres un moyen de paiement
  // valide.
  const planSub = (over: Record<string, unknown> = {}) => subscription({
    metadata: { orgId: ORG, plan: "standard", source: "checkout_payment" }, ...over });

  it("un abonnement principal cree sans essai emet checkout", async () => {
    await deliver(planSub({ status: "active" }));
    expect(emitted.map((e) => e["stage"])).toEqual(["checkout"]);
  });

  it("un abonnement reconnu par son prix, sans metadata.plan, emet checkout", async () => {
    // `parsePlanFromSubscription` retombe sur les items : c'est le mecanisme
    // deja utilise par ce fichier, et il couvre les abonnements sans metadonnee.
    await deliver(subscription({
      status: "active", metadata: { orgId: ORG },
      items: { data: [{ price: { id: "price_x", metadata: { plan: "pro" } } }] },
    }));
    expect(emitted.map((e) => e["stage"])).toEqual(["checkout"]);
  });

  // ── garde-fou 1 : les doublons ──
  it("une MISE A JOUR d abonnement n emet jamais checkout", async () => {
    // L'engagement a lieu une fois. Un changement de plan, de quantite ou de
    // moyen de paiement n'est pas un nouveau checkout.
    await deliver({ ...planSub({ status: "active" }), type: "customer.subscription.updated" });
    expect(emitted).toHaveLength(0);
  });

  it("une mise a jour vers trialing emet trial, jamais checkout", async () => {
    await deliver({ ...planSub({ status: "trialing" }), type: "customer.subscription.updated" });
    expect(emitted.map((e) => e["stage"])).toEqual(["trial"]);
  });

  // ── garde-fou 2 : les add-ons ──
  it("la creation d un abonnement d add-on n emet pas checkout", async () => {
    await deliver(subscription({
      status: "active", metadata: { orgId: ORG, plan: "standard", source: "checkout_payment_addons" } }));
    expect(emitted).toHaveLength(0);
  });

  it("la creation d un add-on dedie n emet pas checkout", async () => {
    await deliver(subscription({
      status: "trialing", metadata: { orgId: ORG, plan: "standard", addonSub: "true" } }));
    expect(emitted).toHaveLength(0);
  });

  // ── garde-fou 3 : les evenements non pertinents ──
  it("un abonnement qui n est pas un plan n emet pas checkout", async () => {
    // Ni metadata.plan, ni item reconnaissable : credits, achat ponctuel.
    await deliver(subscription({ status: "active", metadata: { orgId: ORG, type: "ai_credits" } }));
    expect(emitted).toHaveLength(0);
  });

  it.each(["incomplete", "incomplete_expired", "canceled", "unpaid", "paused"])(
    "un abonnement cree en %s n emet pas checkout", async (status) => {
      // `incomplete` est l'etat que Stripe donne quand le paiement n'a PAS
      // abouti — et `addon-stripe-sync.ts` cree justement ses abonnements en
      // `payment_behavior: "default_incomplete"`.
      await deliver(planSub({ status }));
      expect(emitted).toHaveLength(0);
    });

  it("une Checkout Session hebergee emet toujours checkout", async () => {
    // Les mises a niveau de `billing.ts` et `/public/checkout-session` passent
    // encore par la : ce chemin ne doit pas regresser.
    await deliver(checkout());
    expect(emitted.map((e) => e["stage"])).toEqual(["checkout"]);
  });

  it("les deux jalons d une meme creation portent des identifiants distincts", async () => {
    // `event_id` est la cle primaire chez AI Lab : deux jalons ne peuvent pas la
    // partager. Et il reste stable au rejeu, l identifiant Stripe et l etape l etant.
    await deliver(planSub({ status: "trialing" }));
    const ids = emitted.map((e) => e["eventId"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["stripe:evt_AILAB_SUB:checkout", "stripe:evt_AILAB_SUB:trial"]);
  });

  it("l intention persistee porte les DEUX etapes", async () => {
    await deliver(planSub({ status: "trialing" }));
    expect(statusWrites[0]).toMatchObject({
      status: "processed", aiLabStages: ["checkout", "trial"], aiLabEmitted: false });
  });

  it("une seule etape en panne laisse l ensemble non emis, donc rattrapable", async () => {
    emitOutcome = "unreachable";
    await deliver(planSub({ status: "trialing" }));
    const last = metadataWrites.at(-1)!;
    expect(last["aiLabEmitted"]).toBeUndefined();
    expect(last).toMatchObject({ aiLabOutcomes: { checkout: "unreachable", trial: "unreachable" } });
  });
});

describe("rien n est emis sans transition metier reussie", () => {
  it("un evenement deja traite n emet rien", async () => {
    // La revendication d'idempotence echoue : le webhook sort en doublon avant
    // d'atteindre l'emission.
    billingClaim = false;
    const res = await deliver(invoice());
    expect(res.body).toMatchObject({ duplicate: true });
    expect(emitted).toHaveLength(0);
  });

  it("sans fp_lid sur l organisation, rien n est emis", async () => {
    orgFpLid = null;
    await deliver(invoice());
    expect(emitted).toHaveLength(0);
  });

  it("un fp_lid malforme en base n est pas emis", async () => {
    orgFpLid = "pas-un-fp-lid";
    await deliver(invoice());
    expect(emitted).toHaveLength(0);
  });
});

describe("un jalon perdu reste rattrapable", () => {
  it("l intention est inscrite avant l appel, avec l horodatage exact", async () => {
    await deliver(invoice());
    expect(metadataWrites[0]).toMatchObject({
      aiLabStages: ["paid"],
      aiLabOccurredAt: "2026-10-06T18:30:00.000Z",
      aiLabEmitted: false,
    });
  });

  // Le coeur de la garantie : l'intention et la marque `processed` partent dans
  // UNE SEULE ecriture, celle qui est attendue avant la reponse. Inscrite plus
  // tard, dans la tache detachee, elle disparaissait avec le processus — et le
  // jalon devenait invisible, puisque Stripe ne rejoue pas un evenement deja
  // traite. Ici, ou les deux sont en base, ou aucune, et alors Stripe reessaie.
  it("l intention voyage dans la MEME ecriture que la marque processed", async () => {
    await deliver(invoice());
    expect(statusWrites).toHaveLength(1);
    expect(statusWrites[0]).toMatchObject({
      status: "processed",
      aiLabStages: ["paid"],
      aiLabOccurredAt: "2026-10-06T18:30:00.000Z",
      aiLabEmitted: false,
    });
  });

  it("cette ecriture precede l appel a AI Lab", async () => {
    await deliver(invoice());
    // Si l'intention etait ecrite apres l'emission, un arret entre les deux
    // laisserait un jalon emis sans trace, ou une trace sans jalon.
    expect(metadataWrites.indexOf(statusWrites[0]!)).toBe(0);
    expect(emitted).toHaveLength(1);
  });

  it("un evenement sans jalon n inscrit aucune intention", async () => {
    await deliver(invoice({ amount_paid: 0 }));
    expect(statusWrites).toHaveLength(1);
    expect(statusWrites[0]).toMatchObject({ status: "processed" });
    expect(statusWrites[0]!["aiLabStages"]).toBeUndefined();
  });

  it("l intention est inscrite meme si l organisation n a pas de fp_lid", async () => {
    // L'emission s'arrete faute de `fp_lid`, mais l'etape prouvee par Stripe,
    // elle, est un fait : elle reste lisible en base.
    orgFpLid = null;
    await deliver(invoice());
    expect(statusWrites[0]).toMatchObject({ aiLabStages: ["paid"], aiLabEmitted: false });
    expect(emitted).toHaveLength(0);
  });

  it("un succes marque le jalon comme emis", async () => {
    await deliver(invoice());
    expect(metadataWrites.at(-1)).toMatchObject({ aiLabEmitted: true, aiLabOutcomes: { paid: "sent" } });
  });

  it("un doublon compte aussi comme emis", async () => {
    emitOutcome = "duplicate";
    await deliver(invoice());
    expect(metadataWrites.at(-1)).toMatchObject({ aiLabEmitted: true });
  });

  it("une panne laisse le jalon NON emis, donc retrouvable", async () => {
    emitOutcome = "unreachable";
    await deliver(invoice());
    const last = metadataWrites.at(-1)!;
    expect(last["aiLabEmitted"]).toBeUndefined();
    expect(last).toMatchObject({ aiLabOutcomes: { paid: "unreachable" } });
    // L'intention porte toujours `aiLabEmitted: false` : c'est ce que la requete
    // de rattrapage cherche.
    expect(metadataWrites[0]).toMatchObject({ aiLabEmitted: false });
  });

  it("une panne ne fait pas echouer le webhook", async () => {
    emitOutcome = "unreachable";
    const res = await deliver(invoice());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true });
  });
});
