/**
 * checkout-subscription-claim-db.test.ts
 *
 * Un checkout = un abonnement, sur PostgreSQL reel.
 *
 * Invariant protege : pour une meme tentative de checkout, un seul appel repart
 * avec le droit de creer l'abonnement Stripe. Mesure du defaut d'origine, trois
 * appels concurrents de finalize-checkout sur Stripe en mode test : trois
 * abonnements `trialing` sur le meme prix, donc trois facturations.
 *
 * Ce qui est verifie ici est la barriere PostgreSQL seule : atomicite de la
 * revendication, reprise du bail d'un processus mort, refus de reprendre un
 * bail vivant ou une tentative conclue, et premier-ecrivain-gagne a
 * l'inscription du resultat. La barriere Stripe (cle d'idempotence) est
 * verifiee dans routes/checkout-single-subscription.test.ts.
 *
 * Le test de schema echoue explicitement si la cle primaire disparait : sans
 * elle, l'INSERT ... ON CONFLICT n'est plus atomique et le double abonnement
 * repasse en silence.
 *
 * Isolation : cles de tentative uniques par execution, lignes purgees en
 * afterAll.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  CLAIM_TABLE,
  subscriptionAttemptKey,
  claimSubscriptionCreation,
  settleSubscriptionClaim,
  waitForClaimedSubscription,
  createWithIdempotency,
  ensureClaimTable,
} from "./checkout-subscription-claim.js";

const RUN = randomUUID().slice(0, 8);
const key = (name: string): string =>
  subscriptionAttemptKey({ scope: "plan", intentId: `seti_${RUN}_${name}`, plan: "pro", priceId: "price_test" });

const claim = (attemptKey: string, leaseMs?: number) =>
  claimSubscriptionCreation(pool, {
    attemptKey,
    intentId: `seti_${RUN}`,
    plan: "pro",
    priceId: "price_test",
    orgRef: null,
    ...(leaseMs !== undefined ? { leaseMs } : {}),
  });

beforeAll(async () => {
  await ensureClaimTable(pool);
});

afterAll(async () => {
  await pool.query(`DELETE FROM ${CLAIM_TABLE} WHERE intent_id LIKE $1`, [`seti_${RUN}%`]);
});

describe("schema — l'atomicite repose sur la cle primaire", () => {
  it("attempt_key est la cle primaire de la table", async () => {
    const res = await pool.query<{ col: string }>(
      `SELECT a.attname AS col
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [CLAIM_TABLE]
    );
    expect(res.rows.map((r) => r.col)).toEqual(["attempt_key"]);
  });

  it("la table est backend-only : RLS active et forcee, aucune policy publique", async () => {
    const res = await pool.query<{ rls: boolean; forced: boolean; policies: string }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = $1) AS policies
         FROM pg_class c WHERE c.relname = $1`,
      [CLAIM_TABLE]
    );
    expect(res.rows[0]?.rls).toBe(true);
    expect(res.rows[0]?.forced).toBe(true);
    expect(Number(res.rows[0]?.policies)).toBe(0);
  });
});

describe("identite de la tentative", () => {
  it("meme intent, meme plan, meme prix → meme cle", () => {
    const a = subscriptionAttemptKey({ scope: "plan", intentId: "seti_1", plan: "pro", priceId: "price_1" });
    const b = subscriptionAttemptKey({ scope: "plan", intentId: "seti_1", plan: "pro", priceId: "price_1" });
    expect(a).toBe(b);
  });

  it("panier different → cle differente (une nouvelle tentative n'est pas bloquee)", () => {
    const base = { scope: "plan", intentId: "seti_1", plan: "pro", priceId: "price_1" };
    const keys = new Set([
      subscriptionAttemptKey(base),
      subscriptionAttemptKey({ ...base, plan: "ultra" }),
      subscriptionAttemptKey({ ...base, priceId: "price_2" }),
      subscriptionAttemptKey({ ...base, intentId: "seti_2" }),
      subscriptionAttemptKey({ ...base, scope: "plan_addons" }),
    ]);
    expect(keys.size).toBe(5);
  });

  it("la cle est utilisable telle quelle comme cle d'idempotence Stripe", () => {
    const k = subscriptionAttemptKey({ scope: "plan", intentId: "seti_1", plan: "pro", priceId: "price_1" });
    expect(k.length).toBeLessThanOrEqual(255);
    expect(k).toMatch(/^fp_sub_[0-9a-f]{48}$/);
  });
});

describe("revendication atomique", () => {
  it("le premier appel est proprietaire, le second attend", async () => {
    const k = key("seq");
    expect((await claim(k)).role).toBe("owner");
    expect((await claim(k)).role).toBe("pending");
  });

  it("vingt revendications simultanees : un seul proprietaire", async () => {
    const k = key("conc");
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => claim(k)));
    const owners = outcomes.filter((o) => o.role === "owner");
    expect(owners.length).toBe(1);
    expect(outcomes.filter((o) => o.role === "pending").length).toBe(19);
  });

  it("une fois le resultat inscrit, tout appel suivant le reutilise", async () => {
    const k = key("settled");
    await claim(k);
    await settleSubscriptionClaim(pool, k, "sub_winner");
    const after = await claim(k);
    expect(after.role).toBe("settled");
    expect(after.subscriptionId).toBe("sub_winner");
  });

  it("les suiveurs recuperent l'identifiant inscrit par le proprietaire", async () => {
    const k = key("wait");
    await claim(k);
    const waiting = waitForClaimedSubscription(pool, k, { timeoutMs: 4000, pollMs: 50 });
    setTimeout(() => void settleSubscriptionClaim(pool, k, "sub_from_owner"), 150);
    await expect(waiting).resolves.toBe("sub_from_owner");
  });

  it("un suiveur qui n'obtient rien repart avec null, jamais avec un faux identifiant", async () => {
    const k = key("wait_timeout");
    await claim(k);
    await expect(
      waitForClaimedSubscription(pool, k, { timeoutMs: 300, pollMs: 50 })
    ).resolves.toBeNull();
  });
});

describe("bail — reprise apres interruption du processus", () => {
  it("un bail expire sans resultat est repris, et la reprise est comptee", async () => {
    const k = key("takeover");
    await claim(k, 1); // bail d'une seconde
    await pool.query(
      `UPDATE ${CLAIM_TABLE} SET claim_expires_at = NOW() - INTERVAL '1 minute' WHERE attempt_key = $1`,
      [k]
    );
    const retaken = await claim(k);
    expect(retaken.role).toBe("takeover");
    const row = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM ${CLAIM_TABLE} WHERE attempt_key = $1`,
      [k]
    );
    expect(Number(row.rows[0]?.attempts)).toBe(2);
  });

  it("un bail encore valide n'est jamais repris", async () => {
    const k = key("live_lease");
    await claim(k, 120_000);
    expect((await claim(k)).role).toBe("pending");
  });

  it("une tentative conclue n'est pas reprise, meme bail expire", async () => {
    const k = key("settled_expired");
    await claim(k);
    await settleSubscriptionClaim(pool, k, "sub_kept");
    await pool.query(
      `UPDATE ${CLAIM_TABLE} SET claim_expires_at = NOW() - INTERVAL '1 hour' WHERE attempt_key = $1`,
      [k]
    );
    const after = await claim(k);
    expect(after.role).toBe("settled");
    expect(after.subscriptionId).toBe("sub_kept");
  });
});

describe("inscription du resultat — premier ecrivain gagne", () => {
  it("un second abonnement inscrit sur la meme tentative ne remplace pas le premier", async () => {
    const k = key("first_wins");
    await claim(k);
    expect(await settleSubscriptionClaim(pool, k, "sub_first")).toBe("sub_first");
    // Un doublon cree malgre tout : l'appelant doit l'apprendre pour l'annuler.
    expect(await settleSubscriptionClaim(pool, k, "sub_second")).toBe("sub_first");
  });

  it("le rejeu de l'inscription avec le meme identifiant est idempotent", async () => {
    const k = key("settle_replay");
    await claim(k);
    await settleSubscriptionClaim(pool, k, "sub_same");
    expect(await settleSubscriptionClaim(pool, k, "sub_same")).toBe("sub_same");
    const row = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${CLAIM_TABLE} WHERE attempt_key = $1`,
      [k]
    );
    expect(Number(row.rows[0]?.n)).toBe(1);
  });
});

describe("cle d'idempotence Stripe — attente de la reponse memorisee", () => {
  it("une tentative concurrente en vol est attendue, avec la MEME cle", async () => {
    const seen: string[] = [];
    let calls = 0;
    const create = async (k: string): Promise<string> => {
      seen.push(k);
      calls++;
      if (calls < 3) {
        throw Object.assign(new Error("in flight"), { code: "idempotency_in_progress" });
      }
      return "sub_replayed";
    };
    await expect(
      createWithIdempotency(create, "fp_sub_key", { attempts: 5, delayMs: 1 })
    ).resolves.toBe("sub_replayed");
    // Controle negatif : repartir sans la cle, ou avec une autre, recreerait un
    // abonnement. Les trois appels doivent porter exactement la meme.
    expect(new Set(seen)).toEqual(new Set(["fp_sub_key"]));
    expect(seen.length).toBe(3);
  });

  it("une carte refusee n'est pas transformee en attente — l'erreur remonte", async () => {
    const declined = Object.assign(new Error("declined"), { code: "card_declined" });
    await expect(
      createWithIdempotency(async () => { throw declined; }, "fp_sub_key", { attempts: 3, delayMs: 1 })
    ).rejects.toBe(declined);
  });
});
