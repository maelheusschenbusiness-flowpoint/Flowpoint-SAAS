/**
 * Debit de credits IA ATOMIQUE (constat 2) : N debits concurrents, un seul solde restant.
 * Avant : verification « lire puis ecrire » non atomique -> tous les debits concurrents passaient
 * et le plafond etait depasse. Apres : UPDATE conditionnel dans la transaction du journal d'usage.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("./store.js", () => ({
  store: { me: { plan: null }, broadcast: vi.fn(), addSseClient: vi.fn(), removeSseClient: vi.fn(), broadcastPlanUpdate: vi.fn() },
}));
vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { consumeAICredits } from "./ai-engine.js";
import { PLAN_AI_CREDITS } from "../lib/plans.js";
import { computeCreditsDebited, computeRealCostEur } from "../config/ai-config.js";

const ORG = randomUUID();
const month = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
const MODEL = "gpt-5-mini" as const;
const cost = computeCreditsDebited({
  feature: "audit_summary", model: MODEL,
  realCostEur: computeRealCostEur({ model: MODEL, tokensIn: 800, tokensOut: 400, cachedTokens: 0 }),
});
const hardLimit = Math.floor(PLAN_AI_CREDITS["standard"]! * 1.05);

beforeAll(async () => {
  const c = await pool.connect();
  try {
    await c.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ($1,'AI Atomic Test',$2,'test-user','active','standard',$3) ON CONFLICT (id) DO NOTHING`,
      [ORG, `ai-atomic-${Date.now()}`, `ai-atomic-${Date.now()}@example.test`],
    );
    // Reste exactement 1.5 debit sous le plafond dur : un seul debit peut passer.
    await c.query(
      `INSERT INTO ai_monthly_usage (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,$4,0,0,0,NOW() + interval '10 days',NOW())`,
      [`amu_atomic_${ORG}`, ORG, month, hardLimit - Math.floor(cost * 1.5)],
    );
  } finally { c.release(); }
});
afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM ai_usage_logs WHERE org_id = $1::uuid`, [ORG]);
    await c.query(`DELETE FROM ai_monthly_usage WHERE org_id = $1::uuid`, [ORG]);
    await c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]);
  } finally { c.release(); }
});

describe("consumeAICredits — plafond atomique", () => {
  it("6 debits concurrents : un seul passe, les autres sont refuses (quota_exhausted), le cumul ne depasse pas le plafond", { timeout: 30_000 }, async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      consumeAICredits({ feature: "audit_summary", orgId: ORG, userId: "u", model: MODEL, provider: "openai", requestId: `atomic-${i}-${ORG}` })));
    expect(results.filter(r => r.allowed)).toHaveLength(1);
    const refused = results.filter(r => !r.allowed);
    expect(refused).toHaveLength(5);
    for (const r of refused) expect(r.reason).toBe("quota_exhausted");

    const c = await pool.connect();
    try {
      const m = await c.query(`SELECT credits_used, request_count FROM ai_monthly_usage WHERE org_id=$1::uuid AND month=$2`, [ORG, month]);
      expect(Number(m.rows[0].credits_used)).toBeLessThanOrEqual(hardLimit);
      expect(Number(m.rows[0].request_count)).toBe(1);
      const logs = await c.query(`SELECT count(*)::int AS n FROM ai_usage_logs WHERE org_id=$1::uuid`, [ORG]);
      expect(logs.rows[0].n).toBe(1); // les debits refuses ne laissent AUCUN journal (transaction annulee)
    } finally { c.release(); }
  });

  it("au plafond : refus net, rien d'ecrit", async () => {
    const r = await consumeAICredits({ feature: "audit_summary", orgId: ORG, userId: "u", model: MODEL, provider: "openai", requestId: `atomic-after-${ORG}` });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("quota_exhausted");
  });
});
