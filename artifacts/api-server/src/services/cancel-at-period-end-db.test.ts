/**
 * cancel-at-period-end-db.test.ts
 *
 * Reproduit avec un evenement Stripe REEL en certification : Stripe renvoyait
 * cancel_at_period_end=true et cancel_at=2026-10-27, le webhook acceptait
 * l'evenement (HTTP 200), et FlowPoint n'en gardait AUCUNE trace — ni colonne,
 * ni champ dans /me, zero occurrence dans me.ts et billing-context.ts.
 *
 * Consequence : impossible d'afficher « votre abonnement se termine le … », et
 * impossible de distinguer un abonnement actif qui se renouvelle d'un actif
 * qui s'arrete — alors que billing.ts sait deja lever cette annulation en
 * relisant l'etat chez Stripe a la demande.
 *
 * Ces tests verrouillent la persistance sur PostgreSQL reel, dans les deux
 * sens : pose de l'annulation ET levee (le retour a false doit etre ecrit,
 * sinon une annulation levee resterait affichee indefiniment).
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
import { loadOrgData, persistOrgData } from "./org-data.js";
import { loadBillingContext } from "./billing-context.js";

const ORG = randomUUID();
const EMAIL = `cape-${Date.now()}@example.test`;
const CANCEL_AT = new Date(Date.now() + 14 * 86400_000).toISOString();
let dbUp = false;

async function raw(): Promise<{ cape: boolean | null; at: string | null } | null> {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT cancel_at_period_end AS cape, cancel_at::text AS at
         FROM organizations WHERE id = $1::uuid`, [ORG]);
    const row = r.rows[0] as { cape: boolean | null; at: string | null } | undefined;
    return row ?? null;
  } finally { c.release(); }
}

beforeAll(async () => {
  let c: PoolClient;
  try { c = (await pool.connect()) as unknown as PoolClient; }
  catch { dbUp = false; return; }
  try {
    await c.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email,
                                  subscription_status, stripe_subscription_id, stripe_customer_id)
       VALUES ($1,$2,$3,'test-user','active','pro',$4,'active','sub_cape','cus_cape')
       ON CONFLICT (id) DO NOTHING`,
      [ORG, "Cape Org", `cape-${Date.now()}`, EMAIL]);
    dbUp = true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try { await c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]); }
  finally { c.release(); }
});

describe("annulation programmee en fin de periode", () => {
  it("1 — par defaut : aucune annulation programmee", async () => {
    if (!dbUp) return;
    expect((await raw())?.cape).toBe(false);
    expect((await loadOrgData(ORG))?.cancelAtPeriodEnd).toBe(false);
    expect((await loadOrgData(ORG))?.cancelAt).toBeNull();
  });

  it("2 — la pose de l'annulation est persistee avec sa date", async () => {
    if (!dbUp) return;
    await persistOrgData(ORG, { cancelAtPeriodEnd: true, cancelAt: CANCEL_AT });
    const r = await raw();
    expect(r?.cape).toBe(true);
    expect(r?.at).toBeTruthy();
    const d = await loadOrgData(ORG);
    expect(d?.cancelAtPeriodEnd).toBe(true);
    expect(new Date(d!.cancelAt!).toISOString()).toBe(new Date(CANCEL_AT).toISOString());
  });

  it("3 — le contexte de facturation l'expose", async () => {
    if (!dbUp) return;
    const ctx = await loadBillingContext(ORG);
    expect(ctx.cancelAtPeriodEnd).toBe(true);
    expect(ctx.cancelAt).toBeTruthy();
    // L'annulation programmee ne retire PAS l'acces : la periode est payee.
    expect(ctx.hasPaidAccess).toBe(true);
  });

  it("4 — la LEVEE de l'annulation est persistee (false doit s'ecrire)", async () => {
    if (!dbUp) return;
    await persistOrgData(ORG, { cancelAtPeriodEnd: false, cancelAt: null });
    const r = await raw();
    expect(r?.cape).toBe(false);
    expect(r?.at).toBeNull();
    const ctx = await loadBillingContext(ORG);
    expect(ctx.cancelAtPeriodEnd).toBe(false);
    expect(ctx.cancelAt).toBeNull();
  });

  it("5 — un champ non fourni ne remet pas l'annulation a zero", async () => {
    if (!dbUp) return;
    await persistOrgData(ORG, { cancelAtPeriodEnd: true, cancelAt: CANCEL_AT });
    // Ecriture sans rapport : l'annulation doit survivre.
    await persistOrgData(ORG, { plan: "ultra" });
    const r = await raw();
    expect(r?.cape).toBe(true);
    expect(r?.at).toBeTruthy();
  });

  it("6 — les colonnes existent dans le schema de production", async () => {
    if (!dbUp) return;
    const c = await pool.connect();
    try {
      const r = await c.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name='organizations'
            AND column_name IN ('cancel_at_period_end','cancel_at')`);
      const cols = new Map((r.rows as Array<Record<string, string>>).map((x) => [x["column_name"], x]));
      expect(cols.has("cancel_at_period_end")).toBe(true);
      expect(cols.has("cancel_at")).toBe(true);
      // Valeur par defaut false : « aucune annulation programmee » pour les
      // organisations existantes, aucune donnee client reinterpretee.
      expect(String(cols.get("cancel_at_period_end")?.["column_default"])).toContain("false");
      expect(cols.get("cancel_at_period_end")?.["is_nullable"]).toBe("NO");
    } finally { c.release(); }
  });
});
