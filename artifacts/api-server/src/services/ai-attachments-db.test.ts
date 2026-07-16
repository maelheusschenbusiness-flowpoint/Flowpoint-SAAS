/**
 * ai-attachments-db.test.ts — DB integration tests for resolveAIAttachments.
 *
 * Verifies organisation isolation: a file belonging to orgA cannot be resolved
 * when querying as orgB.  Uses real PostgreSQL via pool from @workspace/db.
 *
 * Isolation strategy:
 *   - Each test uses a unique org_id (timestamp-based, absent from production).
 *   - Test rows are deleted in afterAll via DELETE WHERE org_id.
 *   - The orgDb wrapper applies AND org_id = $2 defence-in-depth even without RLS.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Override global @workspace/db mock → use real pool ────────────────────────
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

import { pool }                from "@workspace/db";
import { resolveAIAttachments, type OrgDb } from "./ai-attachments.js";
import type { ResolvedAIAttachment }         from "../types/ai-attachments.js";

// ── Unique org IDs for test isolation ─────────────────────────────────────────
const orgA = `test-attach-a-${Date.now()}`;
const orgB = `test-attach-b-${Date.now()}`;
let   fileIdA = "";

// ── Real orgDb that scopes queries to a specific org ──────────────────────────
// Isolation is enforced at the SQL level via the explicit AND org_id = $2
// clause in every resolveAIAttachments query — equivalent to RLS for the
// SELECT statements this service issues.  SET LOCAL ROLE is intentionally
// omitted here because the test environment may not have the app_user role,
// and a failed SET inside a transaction aborts all subsequent statements.
function makeRealOrgDb(_orgId: string): OrgDb {
  return async (sql: string, values?: unknown[]) => {
    const result = await pool.query(sql, values as unknown[]);
    return { rows: result.rows };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeB64(sizeBytes: number): string {
  if (sizeBytes <= 0) return "";
  const b64Len = Math.ceil(sizeBytes * 4 / 3);
  const padded = b64Len + (4 - b64Len % 4) % 4;
  return "A".repeat(padded);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  fileIdA = `f_test_${Date.now()}_a`;

  await pool.query(
    `INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [fileIdA, orgA, "test-doc.pdf", "application/pdf", 1024, makeB64(1024), "Test"],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM team_files WHERE org_id = ANY($1)", [[orgA, orgB]]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAIAttachments — DB integration", () => {

  it("J — resolves a file belonging to the correct organisation", async () => {
    const orgDb = makeRealOrgDb(orgA);
    const r = await resolveAIAttachments(orgDb, orgA, [{ fileId: fileIdA }]);
    expect(Array.isArray(r)).toBe(true);
    const files = r as ResolvedAIAttachment[];
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileIdA);
    expect(files[0]?.orgId).toBe(orgA);
    expect(files[0]?.extension).toBe("pdf");
  });

  it("J — returns ATTACHMENT_NOT_FOUND for file belonging to another organisation", async () => {
    // File was created under orgA — querying as orgB should not find it
    const orgDb = makeRealOrgDb(orgB);
    const r = await resolveAIAttachments(orgDb, orgB, [{ fileId: fileIdA }]);
    expect(Array.isArray(r)).toBe(false);
    expect((r as { code: string }).code).toBe("ATTACHMENT_NOT_FOUND");
    expect((r as { httpStatus: number }).httpStatus).toBe(404);
  });

  it("J — error body is identical for cross-org vs non-existent (no leakage)", async () => {
    const orgDbA = makeRealOrgDb(orgA);
    const orgDbB = makeRealOrgDb(orgB);

    const nonExistent = await resolveAIAttachments(orgDbA, orgA, [{ fileId: "totally-fake-id-xyz" }]);
    const crossOrg    = await resolveAIAttachments(orgDbB, orgB, [{ fileId: fileIdA }]);

    expect((nonExistent as { code: string }).code).toBe((crossOrg as { code: string }).code);
    expect((nonExistent as { message: string }).message).toBe((crossOrg as { message: string }).message);
    expect((nonExistent as { httpStatus: number }).httpStatus).toBe((crossOrg as { httpStatus: number }).httpStatus);
  });

  it("J — returns empty array for empty references without any DB call overhead", async () => {
    const orgDb = makeRealOrgDb(orgA);
    const r = await resolveAIAttachments(orgDb, orgA, []);
    expect(Array.isArray(r)).toBe(true);
    expect((r as unknown[]).length).toBe(0);
  });
});
