/**
 * export-quota-db.test.ts — quota d'exports sur BASE REELLE (B-01).
 *
 * Avant correction, checkQuota("exports") filtrait sur `event_type` alors que
 * usage_events porte la colonne `kind` : la requete echouait, l'erreur etait
 * avalee et le quota renvoyait allowed:true (fail-open) — exports illimites.
 * Un test a base de mocks n'aurait jamais vu l'erreur SQL : ici on compte de
 * vrais evenements dans une vraie table.
 */
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
const errorLog = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: errorLog, debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { checkQuota } from "./billing-service.js";
import { recordUsageEvent } from "./usage-events.js";
import { PLAN_LIMITS } from "../lib/plans.js";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const EXPORT_LIMIT = PLAN_LIMITS["standard"]!.exports;

beforeAll(async () => {
  await recordUsageEvent(randomUUID(), "export"); // cree la table paresseusement
});

afterEach(() => { errorLog.mockClear(); vi.restoreAllMocks(); });

afterAll(async () => {
  await pool.query(`DELETE FROM usage_events WHERE org_id = ANY($1::text[])`, [[ORG_A, ORG_B]]).catch(() => {});
});

describe("checkQuota('exports') sur usage_events reel", () => {
  it("compte les evenements export, health_export et pdf_export du mois, par organisation", async () => {
    await recordUsageEvent(ORG_A, "export");
    await recordUsageEvent(ORG_A, "health_export");
    await recordUsageEvent(ORG_A, "pdf_export");
    await recordUsageEvent(ORG_A, "audit_created"); // autre nature : non compte
    await recordUsageEvent(ORG_B, "export");
    // Evenement d'un mois precedent : non compte.
    await pool.query(
      `INSERT INTO usage_events (org_id, kind, created_at) VALUES ($1,'export', now() - interval '40 days')`, [ORG_A]);

    const a = await checkQuota("exports", ORG_A);
    expect(a.used).toBe(3);
    expect(a.limit).toBe(EXPORT_LIMIT);
    expect(a.allowed).toBe(true);
    expect(a.available).toBeUndefined();
    const b = await checkQuota("exports", ORG_B);
    expect(b.used).toBe(1);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("refuse (allowed:false) une fois le plafond atteint", async () => {
    const org = randomUUID();
    await pool.query(
      `INSERT INTO usage_events (org_id, kind) SELECT $1, 'export' FROM generate_series(1, $2::int)`, [org, EXPORT_LIMIT]);
    const q = await checkQuota("exports", org);
    expect(q.used).toBe(EXPORT_LIMIT);
    expect(q.allowed).toBe(false);
    await pool.query(`DELETE FROM usage_events WHERE org_id = $1`, [org]);
  });

  it("fonctionne sur une base neuve ou usage_events n'existe pas encore (creation paresseuse)", async () => {
    await pool.query(`ALTER TABLE usage_events RENAME TO usage_events_bak_test`);
    try {
      // Module neuf : le drapeau _tableReady du service est remis a zero.
      vi.resetModules();
      const { checkQuota: fresh } = await import("./billing-service.js");
      const q = await fresh("exports", randomUUID(), { failClosed: true }); // appel reel de la route d export
      expect(q.available).toBeUndefined();
      expect(q.allowed).toBe(true);
      expect(q.used).toBe(0);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS usage_events`);
      await pool.query(`ALTER TABLE usage_events_bak_test RENAME TO usage_events`);
    }
  });

  it("echoue FERME et journalise en ERROR quand le comptage est impossible (exports)", async () => {
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("db down") as never);
    vi.spyOn(pool, "query").mockRejectedValue(new Error("db down") as never);
    const q = await checkQuota("exports", ORG_A);
    expect(q.allowed).toBe(false);
    expect(q.available).toBe(false);
    expect(errorLog).toHaveBeenCalled();
  });

  it("garde le fail-open pour les autres ressources mais journalise en ERROR", async () => {
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("db down") as never);
    vi.spyOn(pool, "query").mockRejectedValue(new Error("db down") as never);
    const q = await checkQuota("audits", ORG_A);
    expect(q.allowed).toBe(true);
    expect(errorLog).toHaveBeenCalled();
    const strict = await checkQuota("audits", ORG_A, { failClosed: true });
    expect(strict.allowed).toBe(false);
  });
});
