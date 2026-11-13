/**
 * ai-usage-idempotency-db.test.ts
 *
 * Rejeu et concurrence sur le débit des crédits IA (PostgreSQL réel).
 *
 * Invariant protégé : un même requestId ne débite JAMAIS deux fois les crédits
 * d'une organisation — ni par un rejeu séquentiel (retry applicatif, worker
 * d'outbox, webhook relivré), ni par deux exécutions concurrentes.
 *
 * L'idempotence repose entièrement sur l'index UNIQUE partiel
 * ai_usage_logs (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL :
 * recordCompletedUsage() insère en ON CONFLICT DO NOTHING et n'incrémente
 * l'agrégat ai_monthly_usage que si la ligne a réellement été insérée. Le test
 * « garde de schéma » échoue donc explicitement si l'index disparaît, au lieu
 * de laisser le double débit repasser silencieusement.
 *
 * L'unicité est scopée à l'org : le test croisé prouve qu'un requestId
 * identique dans deux organisations reste compté une fois DANS CHACUNE —
 * un index global en ferait perdre une (ON CONFLICT DO NOTHING).
 *
 * Isolation : orgs UUID générées par exécution, données purgées en afterAll.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("./store.js", () => ({
  store: {
    me: { plan: null, email: null, name: null },
    broadcast:           vi.fn(),
    addSseClient:        vi.fn(),
    removeSseClient:     vi.fn(),
    broadcastPlanUpdate: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { recordCompletedUsage, consumeAICredits } from "./ai-engine.js";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ORG_REPLAY  = randomUUID();   // rejeu séquentiel
const ORG_CONC    = randomUUID();   // concurrence, même clé
const ORG_DISTINCT= randomUUID();   // concurrence, clés distinctes
const ORG_X1      = randomUUID();   // clé partagée entre deux orgs
const ORG_X2      = randomUUID();
const ALL_ORGS = [ORG_REPLAY, ORG_CONC, ORG_DISTINCT, ORG_X1, ORG_X2];

/** La suite ne s'exécute que face à une base réelle ; sinon elle est ignorée. */
let dbUp = false;

async function state(orgId: string) {
  const c = await pool.connect();
  try {
    const logs = await c.query(
      `SELECT id, credits_used, idempotency_key
         FROM ai_usage_logs WHERE org_id = $1::uuid`, [orgId]);
    const monthly = await c.query(
      `SELECT credits_used, request_count, tokens_used
         FROM ai_monthly_usage WHERE org_id = $1::uuid AND month = $2`,
      [orgId, currentMonth()]);
    return { logs: logs.rows, monthly: monthly.rows[0] ?? null };
  } finally { c.release(); }
}

beforeAll(async () => {
  let c: PoolClient;
  try {
    c = (await pool.connect()) as unknown as PoolClient;   // seul échec toléré : pas de base du tout
  } catch {
    dbUp = false;
    return;
  }
  try {
    const values = ALL_ORGS
      .map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},'test-user','active','pro',$${i * 4 + 4})`)
      .join(",");
    const params = ALL_ORGS.flatMap((id, i) => [
      id, `AI Idem Test Org ${i}`, `ai-idem-${i}-${Date.now()}`,
      `ai-idem-${i}-${Date.now()}@example.test`,
    ]);
    await c.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ${values} ON CONFLICT (id) DO NOTHING`, params);
    dbUp = true;
    // Un échec du seed face à une base JOIGNABLE doit être bruyant : il ne doit
    // jamais se traduire par une suite silencieusement ignorée.
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM ai_usage_logs    WHERE org_id = ANY($1::uuid[])`, [ALL_ORGS]);
    await c.query(`DELETE FROM ai_monthly_usage WHERE org_id = ANY($1::uuid[])`, [ALL_ORGS]);
    await c.query(`DELETE FROM organizations    WHERE id     = ANY($1::uuid[])`, [ALL_ORGS]);
  } finally { c.release(); }
});

const base = {
  feature: "chat" as const, userId: "test-user",
  model: "claude-sonnet-4-5" as const, provider: "anthropic" as const,
  tokensIn: 1000, tokensOut: 500, latencyMs: 120, success: true,
};

describe("crédits IA — rejeu et concurrence", () => {
  it("garde de schéma — l'index UNIQUE (org_id, idempotency_key) existe", async () => {
    if (!dbUp) return;
    const c = await pool.connect();
    try {
      const r = await c.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'ai_usage_logs' AND indexdef ILIKE '%UNIQUE%'
            AND indexdef ILIKE '%idempotency_key%'`);
      // Sans cet index, ON CONFLICT DO NOTHING n'absorbe rien et chaque rejeu
      // re-débite les crédits. L'absence doit faire échouer la suite.
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows.some((row) => /org_id/.test(row.indexdef))).toBe(true);
    } finally { c.release(); }
  });

  it("rejeu séquentiel — 3 appels, même requestId : 1 seul débit", async () => {
    if (!dbUp) return;
    const reqId = `req_replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const first = await recordCompletedUsage({ ...base, orgId: ORG_REPLAY, requestId: reqId });
    expect(first.creditsDebited).toBeGreaterThan(0);

    await recordCompletedUsage({ ...base, orgId: ORG_REPLAY, requestId: reqId });
    await recordCompletedUsage({ ...base, orgId: ORG_REPLAY, requestId: reqId });

    const st = await state(ORG_REPLAY);
    expect(st.logs).toHaveLength(1);
    expect(Number(st.monthly.request_count)).toBe(1);
    expect(Number(st.monthly.tokens_used)).toBe(1500);
    expect(Number(st.monthly.credits_used)).toBe(first.creditsDebited);
  });

  it("concurrence — 8 appels parallèles, même requestId : 1 seul débit", async () => {
    if (!dbUp) return;
    const reqId = `req_conc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        recordCompletedUsage({ ...base, orgId: ORG_CONC, requestId: reqId })));

    // Aucune exécution ne doit échouer : la perdante absorbe le conflit.
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(0);

    const st = await state(ORG_CONC);
    expect(st.logs).toHaveLength(1);
    expect(Number(st.monthly.request_count)).toBe(1);
    expect(Number(st.monthly.tokens_used)).toBe(1500);
  });

  it("concurrence — 6 requestId distincts : 6 débits, aucun perdu", async () => {
    if (!dbUp) return;
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        recordCompletedUsage({ ...base, orgId: ORG_DISTINCT, requestId: `req_dist_${stamp}_${i}` })));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);

    const st = await state(ORG_DISTINCT);
    // L'index ne doit absorber que les rejeux : six clés distinctes = six lignes.
    expect(st.logs).toHaveLength(6);
    expect(Number(st.monthly.request_count)).toBe(6);
    expect(Number(st.monthly.tokens_used)).toBe(6 * 1500);
  });

  it("unicité scopée à l'org — même requestId dans 2 orgs : 1 débit CHACUNE", async () => {
    if (!dbUp) return;
    const shared = `req_shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await recordCompletedUsage({ ...base, orgId: ORG_X1, requestId: shared });
    await recordCompletedUsage({ ...base, orgId: ORG_X2, requestId: shared });

    for (const orgId of [ORG_X1, ORG_X2]) {
      const st = await state(orgId);
      expect(st.logs).toHaveLength(1);
      expect(Number(st.monthly.request_count)).toBe(1);
    }
    // Rejeu dans une seule des deux : toujours un débit chacune.
    await recordCompletedUsage({ ...base, orgId: ORG_X1, requestId: shared });
    expect(Number((await state(ORG_X1)).monthly.request_count)).toBe(1);
    expect(Number((await state(ORG_X2)).monthly.request_count)).toBe(1);
  });

  it("consumeAICredits — rejeu concurrent du même requestId : 1 seul débit", async () => {
    if (!dbUp) return;
    const reqId = `req_consume_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const before = Number((await state(ORG_REPLAY)).monthly?.request_count ?? 0);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => consumeAICredits({
        feature: "chat", orgId: ORG_REPLAY, userId: "test-user",
        model: "claude-sonnet-4-5", provider: "anthropic",
        tokensIn: 1000, tokensOut: 500, requestId: reqId,
      })));
    // Le chemin partagé reste autorisant (quota disponible) ...
    expect(results.every((r) => r.allowed)).toBe(true);
    // ... mais l'agrégat ne bouge que d'UNE requête.
    const after = await state(ORG_REPLAY);
    expect(Number(after.monthly.request_count)).toBe(before + 1);
    expect(after.logs.filter((r) => r["idempotency_key"] === reqId)).toHaveLength(1);
  });
});
