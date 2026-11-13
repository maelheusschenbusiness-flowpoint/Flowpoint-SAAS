/**
 * stripe-webhook-ordering-db.test.ts
 *
 * Regression : Stripe ne garantit pas l'ordre de livraison des evenements.
 * Un `customer.subscription.updated` ancien, relivre apres un plus recent,
 * ecrasait l'etat de facturation courant — un client Pro paye repassait en
 * Standard/trialing (reproduit en certification fonctionnelle P0).
 *
 * La garde claimSubscriptionEventOrder() fait un compare-and-set atomique sur
 * organizations.last_subscription_event_at. Ces tests verifient sur une base
 * PostgreSQL reelle que :
 *   1. le premier evenement est applique et pose le filigrane ;
 *   2. un evenement anterieur est refuse (pas d'ecrasement) ;
 *   3. un evenement de la MEME seconde est accepte (Stripe horodate a la
 *      seconde : en rejeter un ferait perdre une transition legitime) ;
 *   4. un evenement posterieur est accepte et avance le filigrane ;
 *   5. une organisation inconnue laisse passer (l'activation cree la ligne
 *      juste apres — la garde ne doit pas bloquer une activation) ;
 *   6. sous livraisons concurrentes, un seul des deux evenements perimes passe
 *      et le filigrane ne recule jamais.
 *
 * Sans PostgreSQL, la suite s'ignore proprement.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { claimSubscriptionEventOrder } from "./stripe-webhook.js";

const ORG = randomUUID();
const EMAIL = `wh-order-${Date.now()}@example.test`;
const T0 = Math.floor(Date.now() / 1000);
let dbUp = false;

async function watermark(): Promise<string | null> {
  const c = await pool.connect();
  try {
    const r = await c.query<{ w: string | null }>(
      `SELECT last_subscription_event_at::text AS w FROM organizations WHERE id = $1::uuid`, [ORG]);
    return r.rows[0]?.w ?? null;
  } finally { c.release(); }
}

beforeAll(async () => {
  let c: PoolClient;
  try {
    c = (await pool.connect()) as unknown as PoolClient;   // seul echec tolere : pas de base
  } catch {
    dbUp = false; return;
  }
  try {
    await c.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ($1,$2,$3,'test-user','active','ultra',$4) ON CONFLICT (id) DO NOTHING`,
      [ORG, "WH Ordering Org", `wh-order-${Date.now()}`, EMAIL]);
    dbUp = true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try { await c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]); }
  finally { c.release(); }
});

describe("webhook — ordonnancement des evenements d'abonnement", () => {
  it("1 — premier evenement applique et filigrane pose", async () => {
    if (!dbUp) return;
    expect(await claimSubscriptionEventOrder(ORG, T0)).toBe(true);
    expect(await watermark()).not.toBeNull();
  });

  it("2 — evenement ANTERIEUR refuse (pas d'ecrasement d'etat)", async () => {
    if (!dbUp) return;
    const before = await watermark();
    expect(await claimSubscriptionEventOrder(ORG, T0 - 20 * 86400)).toBe(false);
    // Le filigrane ne recule pas.
    expect(await watermark()).toBe(before);
  });

  it("3 — evenement de la MEME seconde accepte", async () => {
    if (!dbUp) return;
    expect(await claimSubscriptionEventOrder(ORG, T0)).toBe(true);
  });

  it("4 — evenement POSTERIEUR accepte et avance le filigrane", async () => {
    if (!dbUp) return;
    const before = await watermark();
    expect(await claimSubscriptionEventOrder(ORG, T0 + 3600)).toBe(true);
    expect(await watermark()).not.toBe(before);
  });

  it("5 — organisation inconnue : la garde laisse passer", async () => {
    if (!dbUp) return;
    expect(await claimSubscriptionEventOrder(randomUUID(), T0)).toBe(true);
  });

  it("6 — sans horodatage exploitable, la garde laisse passer", async () => {
    if (!dbUp) return;
    expect(await claimSubscriptionEventOrder(ORG, null)).toBe(true);
    expect(await claimSubscriptionEventOrder("default", T0)).toBe(true);
  });

  it("7 — concurrence : aucun evenement perime ne passe, le filigrane ne recule pas", async () => {
    if (!dbUp) return;
    const before = await watermark();
    const results = await Promise.all([
      claimSubscriptionEventOrder(ORG, T0 - 10),
      claimSubscriptionEventOrder(ORG, T0 - 20),
      claimSubscriptionEventOrder(ORG, T0 - 30),
    ]);
    expect(results).toEqual([false, false, false]);
    expect(await watermark()).toBe(before);
  });

  it("8 — l'organisation est retrouvee aussi par owner_email (orgId legacy)", async () => {
    if (!dbUp) return;
    expect(await claimSubscriptionEventOrder(EMAIL, T0 - 86400)).toBe(false);
    expect(await claimSubscriptionEventOrder(EMAIL, T0 + 7200)).toBe(true);
  });
});
