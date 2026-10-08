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
  emitted.length = 0; metadataWrites = [];
  orgFpLid = FP_LID; billingClaim = true; emitOutcome = "sent";
  vi.clearAllMocks();
});

describe("le webhook emet les bons jalons", () => {
  it("paid : une facture payee porte l event_id, le fp_lid et l horodatage Stripe", async () => {
    await deliver(invoice());
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      eventId: "stripe:evt_AILAB_PAID",
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

  it("un abonnement payant d emblee n emet pas trial", async () => {
    await deliver(subscription({ status: "active" }));
    expect(emitted.filter((e) => e["stage"] === "trial")).toHaveLength(0);
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
      aiLabStage: "paid",
      aiLabOccurredAt: "2026-10-06T18:30:00.000Z",
      aiLabEmitted: false,
    });
  });

  it("un succes marque le jalon comme emis", async () => {
    await deliver(invoice());
    expect(metadataWrites.at(-1)).toMatchObject({ aiLabEmitted: true, aiLabOutcome: "sent" });
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
    expect(last).toMatchObject({ aiLabOutcome: "unreachable" });
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
