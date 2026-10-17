/**
 * stripe-webhook-signature.test.ts
 *
 * Le webhook de facturation est le seul endroit ou un tiers non authentifie
 * peut faire accorder un abonnement payant. Sa seule protection est la
 * signature Stripe.
 *
 * DEUX TROUS MESURES LE 18/10/2026 :
 *
 *   1. Le seul test qui verifiait le refus d'une signature invalide,
 *      `src/stripe.test.ts`, N'ETAIT PAS dans la liste `include` de
 *      vitest.config.ts : il ne s'executait jamais. Il acceptait en plus
 *      `[400, 401, 500]` comme resultat, donc un 500 l'aurait satisfait.
 *
 *   2. La branche sans identifiants traitait l'evenement SANS verifier la
 *      signature des lors que NODE_ENV ne valait pas exactement "production".
 *      Il suffisait que `STRIPE_SECRET_KEY` ou `STRIPE_WEBHOOK_SECRET` soit
 *      absente sur une instance d'apercu pour qu'un `invoice.paid` forge
 *      active un abonnement payant, gratuitement.
 *
 * Verification faite avant de conclure : les deux instances deployees
 * repondent 400 a une signature invalide. Ce n'etait pas une faille en
 * production — mais l'ouverture dependait de l'ABSENCE d'une variable.
 *
 * Ces tests n'utilisent AUCUNE cle Stripe. La signature est calculee ici, avec
 * le meme HMAC que Stripe : c'est ce qui permet de prouver les deux cotes —
 * une signature valide est acceptee, une signature forgee est refusee.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";
// NOTE : le corps est envoye en CHAINE, pas en Buffer. `supertest` serialise un
// Buffer en JSON quand le Content-Type est application/json — la charge recue
// devenait {"type":"Buffer","data":[...]} et la signature ne pouvait plus
// correspondre. Verifie : chaine -> 200, Buffer -> 400.
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), connect: vi.fn() },
  getDBMode: vi.fn(() => "postgres"),
  getOrgDb: vi.fn(() => vi.fn()),
  queryWithRetry: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const SECRET = "whsec_secret_de_test_calcule_localement";

/** Signature Stripe : `t=<horodatage>,v1=<hmac_sha256("t.corps", secret)>`. */
function signer(corps: string, secret = SECRET, horodatage = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex");
  return `t=${horodatage},v1=${signature}`;
}

/** Monte l'application comme app.ts : corps BRUT, puis le routeur. */
async function monter() {
  const { default: routeur } = await import("./stripe-webhook.js");
  const app = express();
  app.use(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    (req: express.Request & { rawBody?: Buffer }, _res, next) => { req.rawBody = req.body as Buffer; next(); },
  );
  app.use("/api", routeur);
  return app;
}

const CORPS = JSON.stringify({
  id: "evt_essai",
  type: "flowpoint.type.inexistant.pour.ce.test",
  created: Math.floor(Date.now() / 1000),
  data: { object: {} },
});

const environnement = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...environnement };
  delete process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"];
  process.env["NODE_ENV"] = "development";
});
afterAll(() => { process.env = { ...environnement }; });

describe("avec des identifiants Stripe, la signature est exigee", () => {
  beforeEach(() => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_cle_de_test_locale";
    process.env["STRIPE_TEST_KEY"] = "sk_test_cle_de_test_locale";
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });

  it("une signature VALIDE est acceptee", async () => {
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signer(CORPS))
      .send(CORPS);
    // Le type d'evenement est inconnu : aucun traitement ne s'applique, mais la
    // signature a ete acceptee — donc pas de 400.
    expect(r.status, `une signature valide a ete refusee (${r.status})`).not.toBe(400);
  });

  it("une signature FORGEE est refusee en 400", async () => {
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=" + "f".repeat(64))
      .send(CORPS);
    expect(r.status).toBe(400);
  });

  it("une signature calculee avec un AUTRE secret est refusee", async () => {
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signer(CORPS, "whsec_secret_d_un_attaquant"))
      .send(CORPS);
    expect(r.status).toBe(400);
  });

  it("aucune signature du tout est refusee", async () => {
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(CORPS);
    expect(r.status).toBe(400);
  });

  it("un corps MODIFIE apres signature est refuse", async () => {
    // C'est l'interet de signer le corps brut : rejouer une signature valide
    // avec une autre charge ne doit rien donner.
    const signature = signer(CORPS);
    const falsifie = JSON.stringify({ ...JSON.parse(CORPS), type: "invoice.paid" });
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(falsifie);
    expect(r.status, "une signature valide a ete rejouee sur une autre charge").toBe(400);
  });

  it("une signature trop ancienne est refusee", async () => {
    // Stripe tolere cinq minutes. Au-dela, un evenement capture et rejoue plus
    // tard ne doit plus passer.
    const vieux = Math.floor(Date.now() / 1000) - 3600;
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signer(CORPS, SECRET, vieux))
      .send(CORPS);
    expect(r.status).toBe(400);
  });
});

describe("sans identifiants Stripe, rien n'est traite sans intention declaree", () => {
  beforeEach(() => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_TEST_KEY"];
    delete process.env["STRIPE_LIVE_API_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
  });

  it("par defaut, l'evenement est REFUSE en 503", async () => {
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(CORPS);
    expect(r.status, "un evenement non signe a ete traite sans intention declaree").toBe(503);
  });

  it("en production, le refus tient meme avec le drapeau pose", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"] = "true";
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(CORPS);
    expect(r.status, "le drapeau a ouvert le webhook EN PRODUCTION").toBe(503);
  });

  it("le drapeau explicite ouvre le traitement hors production", async () => {
    process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"] = "true";
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(CORPS);
    expect(r.status, "le drapeau explicite ne permet pas le developpement local").not.toBe(503);
  });

  it("une valeur autre que la chaine « true » n'ouvre rien", async () => {
    for (const valeur of ["1", "yes", "True", "oui", ""]) {
      process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"] = valeur;
      const r = await request(await monter())
        .post("/api/webhooks/stripe")
        .set("Content-Type", "application/json")
        .send(CORPS);
      expect(r.status, `la valeur « ${valeur} » a ouvert le webhook`).toBe(503);
    }
  });
});
