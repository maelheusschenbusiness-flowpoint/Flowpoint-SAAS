import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());

import { pool } from "@workspace/db";
import { INSERT_QA_TEST_SESSION_SQL } from "../services/qa-test-session.js";

const QA_USER = "10000000-0000-4000-8000-000000000001";
const QA_ORG = "10000000-0000-4000-8000-000000000002";
let dbAvailable = false;

beforeAll(async () => {
  try { const client = await pool.connect(); client.release(); dbAvailable = true; } catch { dbAvailable = false; }
});

describe("QA test-session PostgreSQL parameter types", () => {
  it("reproduces the TEXT/UUID bind failure and inserts with separate typed binds", async () => {
    expect(dbAvailable, "CI PostgreSQL service is required for this regression test").toBe(true);
    const client = await pool.connect();
    try {
      await client.query("CREATE TEMP TABLE user_sessions (" +
        "token TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NOT NULL, email TEXT NOT NULL, " +
        "role TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ, user_id_v2 UUID)");
      const legacySql = "INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at, user_id_v2) " +
        "VALUES ($1, $2, $3, 'qa@flowpoint.pro', $4, $5, NOW(), $2::uuid)";
      await expect(client.query(legacySql, ["fp_qa_repro", QA_USER, QA_ORG, "owner", new Date(Date.now() + 60_000)])).rejects.toMatchObject({
        code: "42P08",
        message: expect.stringContaining("inconsistent types deduced for parameter $2"),
      });

      const token = "fp_qa_fixed";
      await client.query(INSERT_QA_TEST_SESSION_SQL, [token, QA_USER, QA_ORG, "owner", new Date(Date.now() + 60_000), QA_USER]);
      const result = await client.query("SELECT user_id, org_id, user_id_v2 FROM user_sessions WHERE token = $1::text", [token]);
      expect(result.rows).toEqual([{ user_id: QA_USER, org_id: QA_ORG, user_id_v2: QA_USER }]);
    } finally {
      await client.query("DROP TABLE IF EXISTS pg_temp.user_sessions").catch(() => {});
      client.release();
    }
  });
});
