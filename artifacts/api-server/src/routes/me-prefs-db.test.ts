/**
 * me-prefs-db.test.ts — PATCH /api/me/prefs against real PostgreSQL.
 *
 * The schema built by init-data-tables declares user_prefs.settings NOT NULL.
 * A PATCH carrying only pinned / checklist / streak used to insert settings =
 * NULL, which PostgreSQL rejects (23502) even when the row already exists —
 * NOT NULL is checked before ON CONFLICT. The catch then answered 200
 * { ok: false } without logging, so the failure was invisible.
 *
 * Coverage:
 *   1. pinned only, no existing row → persisted, settings = {}.
 *   2. checklist only, existing row → persisted, settings kept.
 *   3. streak only, existing row → persisted.
 *   4. API key fields in the body are dropped; stored keys are kept.
 *   5. SQL failure → HTTP 500 and an error log, never 200.
 */

import { vi, describe, it, expect, afterAll } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Override global @workspace/db mock → use real pool ────────────────────────
vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: loggerError, debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn(async () => {}) },
}));

import { pool, withOrgDb } from "@workspace/db";
import meRouter from "./me.js";

const ORG_NEW      = `test-prefs-new-${Date.now()}`;
const ORG_EXISTING = `test-prefs-existing-${Date.now()}`;
const ORG_KEYS     = `test-prefs-keys-${Date.now()}`;

// Mirrors dbContext.ts: every query runs through withOrgDb (GUC + role switch).
function makeApp(orgId: string, failing = false) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgContext = { orgId } as Request["orgContext"];
    req.orgDb = failing
      ? async () => { throw new Error("simulated SQL failure"); }
      : (text: string, values?: unknown[]) =>
          withOrgDb(orgId, (client) =>
            values !== undefined ? client.query(text, values) : client.query(text),
          );
    next();
  });
  app.use("/api", meRouter);
  return app;
}

async function readRow(orgId: string) {
  const r = await pool.query(
    `SELECT streak, pinned, checklist, settings FROM user_prefs WHERE org_id = $1`,
    [orgId],
  );
  return r.rows[0] as Record<string, unknown> | undefined;
}

afterAll(async () => {
  await pool.query(`DELETE FROM user_prefs WHERE org_id = ANY($1::text[])`, [[ORG_NEW, ORG_EXISTING, ORG_KEYS]]);
});

describe("PATCH /api/me/prefs — real PostgreSQL", () => {
  it("persists pinned when no row exists yet", async () => {
    const res = await request(makeApp(ORG_NEW))
      .patch("/api/me/prefs")
      .send({ pinned: { audit_1: true } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const row = await readRow(ORG_NEW);
    expect(row?.pinned).toEqual({ audit_1: true });
    expect(row?.settings).toEqual({});
  });

  it("persists checklist and streak on an existing row without touching settings", async () => {
    const app = makeApp(ORG_EXISTING);
    await request(app).patch("/api/me/prefs").send({ settings: { aiIntensity: "high" } }).expect(200);

    const r1 = await request(app).patch("/api/me/prefs").send({ checklist: { step1: true } });
    expect(r1.body).toEqual({ ok: true });
    const r2 = await request(app).patch("/api/me/prefs").send({ streak: 4 });
    expect(r2.body).toEqual({ ok: true });

    const row = await readRow(ORG_EXISTING);
    expect(row?.checklist).toEqual({ step1: true });
    expect(row?.streak).toBe(4);
    expect(row?.settings).toEqual({ aiIntensity: "high" });
  });

  it("never stores API key fields sent in settings, and keeps the stored ones", async () => {
    await pool.query(
      `INSERT INTO user_prefs (org_id, settings) VALUES ($1, $2::jsonb)`,
      [ORG_KEYS, JSON.stringify({ publicApiKey: "stored-public", secretApiKey: "stored-secret" })],
    );
    const res = await request(makeApp(ORG_KEYS))
      .patch("/api/me/prefs")
      .send({ settings: {
        theme: "dark",
        publicApiKey: "injected-public", secretApiKey: "injected-secret",
        publicApiKeyCreatedAt: "2000-01-01", secretApiKeyCreatedAt: "2000-01-01",
      } });

    expect(res.body).toEqual({ ok: true });
    const row = await readRow(ORG_KEYS);
    expect(row?.settings).toEqual({ publicApiKey: "stored-public", secretApiKey: "stored-secret", theme: "dark" });
  });

  it("reports a SQL failure as 500 and logs it", async () => {
    loggerError.mockClear();
    const res = await request(makeApp(ORG_NEW, true))
      .patch("/api/me/prefs")
      .send({ pinned: { audit_2: true } });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ ok: false, error: "prefs_save_failed" });
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect((await readRow(ORG_NEW))?.pinned).toEqual({ audit_1: true });
  });
});
