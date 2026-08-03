/**
 * ai-usage-tracking-db.test.ts
 *
 * Tests d'intégration DB réelle pour recordCompletedUsage() :
 *   1. Écriture nominale — 1 ligne ai_usage_logs + agrégat ai_monthly_usage incrémenté.
 *   2. Idempotence — un requestId rejoué n'insère PAS de 2e log et n'incrémente PAS l'agrégat.
 *   3. Canonicalisation — un orgId legacy (email) est résolu vers organizations.id (UUID).
 *   4. OrgId irrésoluble — aucune écriture, pas de crash.
 *
 * Isolation : org UUID généré par test, données purgées en afterAll.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("./store.js", () => ({
  store: {
    me: { plan: null, email: null, name: null },
    broadcast:        vi.fn(),
    addSseClient:     vi.fn(),
    removeSseClient:  vi.fn(),
    broadcastPlanUpdate: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { recordCompletedUsage, resolveCanonicalOrgUuid, checkAIQuota, getOrCreateMonthlyUsage, consumeAICredits, processAiUsageOutboxOnce } from "./ai-engine.js";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ORG_A = randomUUID();               // test 1+2 (UUID direct)
const ORG_B = randomUUID();               // test 3 (canonicalisation email)
const LEGACY_EMAIL = `aiusage-test-${Date.now()}@example.test`;
const ALL_ORGS = [ORG_A, ORG_B];

async function fetchState(orgId: string) {
  const c = await pool.connect();
  try {
    const logs = await c.query(
      `SELECT id, credits_used, tokens_in, tokens_out FROM ai_usage_logs WHERE org_id = $1::uuid`, [orgId]);
    const monthly = await c.query(
      `SELECT credits_used, request_count, tokens_used, cost_eur
         FROM ai_monthly_usage WHERE org_id = $1::uuid AND month = $2`, [orgId, currentMonth()]);
    return { logs: logs.rows, monthly: monthly.rows[0] ?? null };
  } finally { c.release(); }
}

beforeAll(async () => {
  const c = await pool.connect();
  try {
    // ai_usage_logs.org_id has an FK to organizations(id) — both test orgs
    // must exist as canonical organizations (as they always do in prod).
    await c.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ($1,$2,$3,'test-user','active','pro',$4),
              ($5,$6,$7,'test-user','active','pro',$8)
       ON CONFLICT (id) DO NOTHING`,
      [ORG_A, "AI Usage Test Org A", `ai-usage-a-${Date.now()}`, `aiusage-a-${Date.now()}@example.test`,
       ORG_B, "AI Usage Test Org B", `ai-usage-b-${Date.now()}`, LEGACY_EMAIL]
    );
  } finally { c.release(); }
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM ai_usage_logs WHERE org_id = ANY($1::uuid[])`, [ALL_ORGS]);
    await c.query(`DELETE FROM ai_monthly_usage WHERE org_id = ANY($1::uuid[])`, [ALL_ORGS]);
    await c.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ALL_ORGS]);
  } finally { c.release(); }
});

describe("recordCompletedUsage — atomic + idempotent tracking", () => {
  const reqId = `req_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  it("1 — nominal write: log row + monthly aggregate", async () => {
    const res = await recordCompletedUsage({
      feature: "chat", orgId: ORG_A, userId: "test-user",
      model: "claude-sonnet-4-5", provider: "anthropic",
      tokensIn: 1000, tokensOut: 500, latencyMs: 800, success: true,
      requestId: reqId,
    });
    expect(res.creditsDebited).toBeGreaterThan(0);

    const st = await fetchState(ORG_A);
    expect(st.logs).toHaveLength(1);
    expect(st.monthly).not.toBeNull();
    expect(Number(st.monthly.request_count)).toBe(1);
    expect(Number(st.monthly.tokens_used)).toBe(1500);
    expect(Number(st.monthly.credits_used)).toBe(res.creditsDebited);
  });

  it("2 — replayed requestId does NOT double-count", async () => {
    await recordCompletedUsage({
      feature: "chat", orgId: ORG_A, userId: "test-user",
      model: "claude-sonnet-4-5", provider: "anthropic",
      tokensIn: 1000, tokensOut: 500, latencyMs: 800, success: true,
      requestId: reqId, // same key
    });
    const st = await fetchState(ORG_A);
    expect(st.logs).toHaveLength(1);
    expect(Number(st.monthly.request_count)).toBe(1);
    expect(Number(st.monthly.tokens_used)).toBe(1500);
  });

  it("3 — legacy email orgId is canonicalized to organizations.id", async () => {
    const resolved = await resolveCanonicalOrgUuid(LEGACY_EMAIL);
    expect(resolved).toBe(ORG_B);

    await recordCompletedUsage({
      feature: "audit_summary", orgId: LEGACY_EMAIL, userId: "test-user",
      model: "gpt-4o-mini", provider: "openai",
      tokensIn: 200, tokensOut: 100, latencyMs: 300, success: true,
      requestId: `req_test_legacy_${Date.now()}`,
    });
    const st = await fetchState(ORG_B);
    expect(st.logs).toHaveLength(1);
    expect(Number(st.monthly.request_count)).toBe(1);
    expect(Number(st.monthly.tokens_used)).toBe(300);
  });

  it("5 — legacy email org OVER quota is blocked by checkAIQuota BEFORE any provider call", async () => {
    // Seed the UUID org's monthly aggregate far above any plan limit.
    const c = await pool.connect();
    try {
      await c.query(
        `INSERT INTO ai_monthly_usage (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
         VALUES ($1,$2,$3,99999999,0,0,0,NOW()+INTERVAL '30 days',NOW())
         ON CONFLICT (org_id, month) DO UPDATE SET credits_used = 99999999`,
        [`amu_${ORG_B}_${currentMonth()}`, ORG_B, currentMonth()]
      );
    } finally { c.release(); }

    // Quota check with the LEGACY id must resolve to the UUID org and block.
    const gate = await checkAIQuota({ feature: "chat", orgId: LEGACY_EMAIL });
    expect(gate.allowed).toBe(false);
    expect(gate.remaining).toBe(0);

    // And usage read through the legacy id comes from the UUID org's row.
    const usage = await getOrCreateMonthlyUsage(LEGACY_EMAIL);
    expect(usage.creditsUsed).toBe(99999999);
  });

  it("6 — unresolvable orgId fails CLOSED in checkAIQuota (no degraded unlimited allow)", async () => {
    const gate = await checkAIQuota({ feature: "chat", orgId: "org_unknown_legacy_id" });
    expect(gate.allowed).toBe(false);
    expect(gate.remaining).toBe(0);
  });

  it("7 — consumeAICredits with legacy email org OVER quota is blocked (PageSpeed/missions debit path)", async () => {
    // ORG_B was seeded over quota in test 5 — the legacy id must be resolved
    // and the debit denied BEFORE any write.
    const before = await fetchState(ORG_B);
    const res = await consumeAICredits({ feature: "behavior_analysis", orgId: LEGACY_EMAIL, model: "gpt-5-mini", provider: "openai" });
    expect(res.allowed).toBe(false);
    expect(res.creditsUsed).toBe(0);
    const after = await fetchState(ORG_B);
    expect(after.logs.length).toBe(before.logs.length);
    expect(Number(after.monthly.request_count)).toBe(Number(before.monthly.request_count));
  });

  it("8 — consumeAICredits with unresolvable orgId fails CLOSED and writes nothing", async () => {
    const res = await consumeAICredits({ feature: "mission_auto", orgId: "org_unknown_legacy_id", model: "gpt-5-mini", provider: "openai", requestId: `req_test_consume_unres_${Date.now()}` });
    expect(res.allowed).toBe(false);
    expect(res.creditsUsed).toBe(0);
    const c = await pool.connect();
    try {
      const r = await c.query(`SELECT 1 FROM ai_usage_logs WHERE idempotency_key LIKE 'req_test_consume_unres_%'`);
      expect(r.rowCount).toBe(0);
    } finally { c.release(); }
  });

  it("9 — consumeAICredits under quota debits atomically via the shared path (idempotent)", async () => {
    // ORG_A is under quota. Same requestId twice → single log, single increment.
    const reqId2 = `req_test_consume_${Date.now()}`;
    const before = await fetchState(ORG_A);
    const r1 = await consumeAICredits({ feature: "behavior_analysis", orgId: ORG_A, model: "gpt-5-mini", provider: "openai", requestId: reqId2 });
    const r2 = await consumeAICredits({ feature: "behavior_analysis", orgId: ORG_A, model: "gpt-5-mini", provider: "openai", requestId: reqId2 });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    const after = await fetchState(ORG_A);
    expect(after.logs.length).toBe(before.logs.length + 1);
    expect(Number(after.monthly.request_count)).toBe(Number(before.monthly.request_count) + 1);
  });

  it("4 — unresolvable orgId FAILS explicitly (no success-shaped result) and records nothing", async () => {
    await expect(recordCompletedUsage({
      feature: "chat", orgId: "org_unknown_legacy_id", userId: "test-user",
      model: "gpt-4o-mini", provider: "openai",
      tokensIn: 50, tokensOut: 50, latencyMs: 100, success: true,
      requestId: `req_test_unres_${Date.now()}`,
    })).rejects.toMatchObject({ code: "ORG_NOT_CANONICAL" });
    const c = await pool.connect();
    try {
      const r = await c.query(`SELECT 1 FROM ai_usage_logs WHERE idempotency_key LIKE 'req_test_unres_%'`);
      expect(r.rowCount).toBe(0);
    } finally { c.release(); }
  });

  it("10 — outbox restart recovery: a persisted pending write is replayed idempotently", async () => {
    const reqId = `req_test_outbox_${Date.now()}`;
    const payload = {
      feature: "chat", orgId: ORG_A, userId: "test-user",
      model: "gpt-4o-mini", provider: "openai",
      tokensIn: 30, tokensOut: 20, latencyMs: 50, success: true, requestId: reqId,
    };
    const c = await pool.connect();
    try {
      // Simulate a crashed process: only the outbox row survived the restart.
      await c.query(`
        CREATE TABLE IF NOT EXISTS ai_usage_pending_writes (
          id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, org_id TEXT NOT NULL,
          payload JSONB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
          next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await c.query(
        `INSERT INTO ai_usage_pending_writes (id, request_id, org_id, payload) VALUES ($1,$2,$3,$4)
         ON CONFLICT (request_id) DO NOTHING`,
        [`aup_test_${Date.now()}`, reqId, ORG_A, JSON.stringify(payload)]
      );
    } finally { c.release(); }

    const before = await fetchState(ORG_A);
    const recovered1 = await processAiUsageOutboxOnce();
    expect(recovered1).toBeGreaterThanOrEqual(1);
    const after = await fetchState(ORG_A);
    expect(after.logs.length).toBe(before.logs.length + 1);
    expect(Number(after.monthly.request_count)).toBe(Number(before.monthly.request_count) + 1);

    // Row consumed — a second worker pass recovers nothing and never re-bills.
    const c2 = await pool.connect();
    try {
      const r = await c2.query(`SELECT 1 FROM ai_usage_pending_writes WHERE request_id = $1`, [reqId]);
      expect(r.rowCount).toBe(0);
    } finally { c2.release(); }
    const afterSecondPass = await fetchState(ORG_A);
    expect(afterSecondPass.logs.length).toBe(after.logs.length);
  });
});
