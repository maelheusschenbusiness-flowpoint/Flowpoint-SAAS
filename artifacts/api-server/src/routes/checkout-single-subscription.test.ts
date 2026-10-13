/**
 * checkout-single-subscription.test.ts
 *
 * Anti-double-facturation : les deux barrieres ensemble, sur PostgreSQL reel et
 * sur un Stripe simule qui reproduit fidelement l'idempotence du vrai (meme cle
 * → la reponse memorisee, aucune creation).
 *
 * Le defaut d'origine, mesure sur Stripe en mode test : trois appels
 * concurrents de finalize-checkout → trois abonnements `trialing` sur le meme
 * prix, soit trois facturations a la fin de l'essai. Le garde historique lit
 * les abonnements du client puis cree ; entre les deux, rien.
 *
 * Le CONTROLE NEGATIF est ici la piece importante : il refait exactement ce que
 * faisait le code d'avant — lecture puis creation, sans verrou ni cle — sur le
 * meme Stripe simule, et exige DEUX creations. Sans lui, un test vert ne
 * prouverait rien : il pourrait l'etre parce que le simulateur ne sait pas
 * creer deux abonnements.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// Le pool reel, mais interceptable : un test doit pouvoir simuler une base
// injoignable pour prouver que la cle Stripe tient toute seule.
let dbFailure: Error | null = null;
vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...real,
    pool: {
      ...real.pool,
      query: (sql: string, params?: unknown[]) => {
        if (dbFailure) return Promise.reject(dbFailure);
        return (real.pool.query as (s: string, p?: unknown[]) => Promise<unknown>)(sql, params);
      },
      connect: () => real.pool.connect(),
    },
  };
});

import { pool as realPool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  CLAIM_TABLE,
  ensureClaimTable,
  subscriptionAttemptKey,
} from "../services/checkout-subscription-claim.js";
import { createSubscriptionForAttempt } from "./public-billing.js";

/* ── Stripe simule ─────────────────────────────────────────────────────────
   Deux comportements du vrai Stripe comptent ici : une cle d'idempotence deja
   vue renvoie l'objet memorise, et une creation sans cle cree un objet de plus.
   `created` ne compte que les creations reelles. ───────────────────────────── */
function fakeStripe(opts?: { onCreate?: (id: string) => Promise<void> | void }) {
  const byKey = new Map<string, Record<string, unknown>>();
  const byId = new Map<string, Record<string, unknown>>();
  let created = 0;
  let replayed = 0;
  const cancelled: string[] = [];
  const paramsSeen: string[] = [];
  const stripe = {
    subscriptions: {
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        paramsSeen.push(JSON.stringify(params));
        const k = options?.idempotencyKey;
        if (k && byKey.has(k)) { replayed++; return byKey.get(k)!; }
        created++;
        const sub = { id: `sub_${created}_${randomUUID().slice(0, 6)}`, status: "trialing", items: { data: [] } };
        if (k) byKey.set(k, sub);
        byId.set(sub.id, sub);
        await opts?.onCreate?.(sub.id);
        return sub;
      },
      retrieve: async (id: string) => byId.get(id) ?? { id, status: "trialing", items: { data: [] } },
      cancel: async (id: string) => { cancelled.push(id); return byId.get(id); },
    },
  };
  return { stripe, counts: () => ({ created, replayed }), cancelled, paramsSeen };
}

const RUN = randomUUID().slice(0, 8);
let n = 0;
const nextIntent = (): string => `seti_${RUN}_${++n}`;

const call = (stripe: unknown, intentId: string) =>
  createSubscriptionForAttempt({
    stripe: stripe as Parameters<typeof createSubscriptionForAttempt>[0]["stripe"],
    intentId,
    scope: "plan",
    plan: "pro",
    priceId: "price_test",
    orgRef: null,
    params: { customer: "cus_test", items: [{ price: "price_test", quantity: 1 }] } as never,
  });

beforeAll(async () => { await ensureClaimTable(realPool); });
beforeEach(() => { dbFailure = null; });
afterAll(async () => {
  dbFailure = null;
  await realPool.query(`DELETE FROM ${CLAIM_TABLE} WHERE intent_id LIKE $1`, [`seti_${RUN}%`]);
});

describe("tentatives concurrentes", () => {
  it("trois appels simultanes du meme checkout → un seul abonnement", async () => {
    const f = fakeStripe();
    const intentId = nextIntent();
    const subs = await Promise.all([call(f.stripe, intentId), call(f.stripe, intentId), call(f.stripe, intentId)]);
    expect(f.counts().created).toBe(1);
    expect(new Set(subs.map((s) => s.id)).size).toBe(1);
  });

  it("CONTROLE NEGATIF — lecture puis creation sans verrou ni cle : deux abonnements", async () => {
    // Le code d'avant le correctif, reduit a son squelette : chacun interroge
    // Stripe, aucun ne voit d'abonnement, puis chacun cree le sien. C'est
    // exactement la sequence observee en conditions reelles — trois appels
    // concurrents, trois abonnements `trialing` sur le meme prix.
    const f = fakeStripe();
    const listSubscriptions = async (): Promise<number> => {
      await new Promise((r) => setTimeout(r, 5));   // latence de l'appel Stripe
      return f.counts().created;
    };
    const [seenByA, seenByB] = await Promise.all([listSubscriptions(), listSubscriptions()]);
    expect(seenByA).toBe(0);
    expect(seenByB).toBe(0);
    await Promise.all([
      f.stripe.subscriptions.create({ customer: "cus_test" }),
      f.stripe.subscriptions.create({ customer: "cus_test" }),
    ]);
    expect(f.counts().created).toBe(2);
  });

  it("dix appels simultanes → toujours un seul abonnement", async () => {
    const f = fakeStripe();
    const intentId = nextIntent();
    const subs = await Promise.all(Array.from({ length: 10 }, () => call(f.stripe, intentId)));
    expect(f.counts().created).toBe(1);
    expect(new Set(subs.map((s) => s.id)).size).toBe(1);
  });
});

describe("rejeu", () => {
  it("un rejeu sequentiel reutilise l'abonnement de la tentative", async () => {
    const f = fakeStripe();
    const intentId = nextIntent();
    const first = await call(f.stripe, intentId);
    const second = await call(f.stripe, intentId);
    expect(f.counts().created).toBe(1);
    expect(second.id).toBe(first.id);
  });

  it("une nouvelle tentative de checkout cree bien un nouvel abonnement", async () => {
    // L'idempotence ne doit pas geler un achat legitime : autre intent, autre
    // tentative, autre abonnement.
    const f = fakeStripe();
    const a = await call(f.stripe, nextIntent());
    const b = await call(f.stripe, nextIntent());
    expect(f.counts().created).toBe(2);
    expect(a.id).not.toBe(b.id);
  });
});

describe("reprise apres interruption du processus", () => {
  it("proprietaire tue entre la creation Stripe et l'ecriture : aucun second abonnement", async () => {
    const f = fakeStripe();
    const intentId = nextIntent();
    const attemptKey = subscriptionAttemptKey({ scope: "plan", intentId, plan: "pro", priceId: "price_test" });

    // Premier appel complet, puis on remet la ligne dans l'etat exact que laisse
    // un kill -9 : abonnement cree chez Stripe, resultat jamais inscrit, bail
    // expire. Mesure de cet etat en conditions reelles (kill -9 a 2,4 s) :
    //   attempts=1 sub=(VIDE) ... alors que l'abonnement existe chez Stripe.
    const original = await call(f.stripe, intentId);
    await realPool.query(
      `UPDATE ${CLAIM_TABLE}
          SET subscription_id = NULL, settled_at = NULL,
              claim_expires_at = NOW() - INTERVAL '5 minutes'
        WHERE attempt_key = $1`,
      [attemptKey]
    );

    const recovered = await call(f.stripe, intentId);
    expect(f.counts().created).toBe(1);        // rien de nouveau n'a ete cree
    expect(f.counts().replayed).toBe(1);       // Stripe a renvoye le memorise
    expect(recovered.id).toBe(original.id);
  });
});

describe("base de donnees injoignable", () => {
  it("le verrou tombe, la cle Stripe tient : un seul abonnement pour trois appels", async () => {
    const f = fakeStripe();
    const intentId = nextIntent();
    dbFailure = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const subs = await Promise.all([call(f.stripe, intentId), call(f.stripe, intentId), call(f.stripe, intentId)]);
    expect(f.counts().created).toBe(1);
    expect(new Set(subs.map((s) => s.id)).size).toBe(1);
  });

  it("table absente : elle est posee, puis le verrou fonctionne", async () => {
    const f = fakeStripe();
    const intentId = nextIntent();
    dbFailure = Object.assign(new Error('relation "checkout_subscription_claims" does not exist'), { code: "42P01" });
    const first = call(f.stripe, intentId);
    // L'auto-reparation reessaie sur une base saine.
    dbFailure = null;
    await first;
    expect(f.counts().created).toBe(1);
  });
});

describe("doublon malgre les deux barrieres", () => {
  it("l'abonnement en trop est annule, celui de la tentative est conserve", async () => {
    // Pire cas : un autre processus inscrit son abonnement pendant que celui-ci
    // appelle Stripe. Le simulateur ecrit dans la ligne de verrou au moment
    // meme de la creation, ce qui reproduit cette fenetre exactement.
    const intentId = nextIntent();
    const attemptKey = subscriptionAttemptKey({ scope: "plan", intentId, plan: "pro", priceId: "price_test" });
    const f = fakeStripe({
      onCreate: async () => {
        await realPool.query(
          `UPDATE ${CLAIM_TABLE} SET subscription_id = $2, settled_at = NOW() WHERE attempt_key = $1`,
          [attemptKey, "sub_autre_processus"]
        );
      },
    });
    const sub = await call(f.stripe, intentId);
    expect(sub.id).toBe("sub_autre_processus");
    expect(f.cancelled.length).toBe(1);
    expect(f.cancelled[0]).toMatch(/^sub_1_/);
  });
});

describe("garde de regression — corps de requete deterministe", () => {
  /* La cle d'idempotence Stripe ne rejoue la reponse memorisee que si le corps
     de la requete est identique. Un `trial_end` calcule sur Date.now() differe
     d'un appel concurrent a l'autre : Stripe refuse alors de rejouer et la
     seconde barriere disparait sans qu'aucun test de comportement ne bouge.
     D'ou cette verification sur la source : l'essai doit partir de l'horodatage
     de l'intent, pas de l'horloge locale. */
  it("l'essai est ancre sur l'intent Stripe, pas sur Date.now()", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(import.meta.dirname ?? __dirname, "public-billing.ts"),
      "utf8"
    );
    expect(src).toContain("const _fcAttemptAnchorUnix = intentCreatedUnix ?? Math.floor(Date.now() / 1000);");
    expect(src).toContain("const trialEndUnix = grantTrial ? _fcAttemptAnchorUnix + intentTrialDays * 86400 : undefined;");
    // Les trois creations d'abonnement du parcours passent par le verrou.
    const guarded = src.match(/createSubscriptionForAttempt\(\{/g) ?? [];
    expect(guarded.length).toBe(3);
    // Aucune creation directe ne subsiste dans finalize-checkout.
    const finalizeStart = src.indexOf('router.post("/public/finalize-checkout"');
    expect(finalizeStart).toBeGreaterThan(0);
    expect(src.slice(finalizeStart)).not.toContain("stripe.subscriptions.create(");
  });
});
