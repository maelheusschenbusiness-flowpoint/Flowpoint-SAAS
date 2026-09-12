/**
 * p0-org-members-legacy.test.ts — P0-B
 *
 * Tests 6, 7, 8:
 *   6. No query on legacy "org_members" table
 *   7. alert-events-service uses "organization_members" with correct column name
 *   8. permissions-service uses "organization_members" with correct column name
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 — org_members (legacy) must not appear in SQL in these two files
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_6 — no legacy org_members SQL queries in patched files", () => {
  it("alert-events-service.ts has no SQL referencing 'FROM org_members' or 'JOIN org_members'", () => {
    const src = readSrc("services/alert-events-service.ts");
    // Allow the word in comments; reject in SQL strings
    const sqlRef = /['`]([\s\S]*?(FROM|JOIN)\s+org_members[\s\S]*?)['`]/i;
    expect(sqlRef.test(src)).toBe(false);
  });

  it("permissions-service.ts has no SQL referencing 'FROM org_members'", () => {
    const src = readSrc("services/permissions-service.ts");
    const sqlRef = /['`]([\s\S]*?FROM\s+org_members[\s\S]*?)['`]/i;
    expect(sqlRef.test(src)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7 — alert-events-service uses organization_members with organization_id
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_7 — alert-events-service uses correct table and column", () => {
  it("SQL JOIN targets organization_members with organization_id column", () => {
    const src = readSrc("services/alert-events-service.ts");
    // Confirm the correct join is present
    expect(src).toContain("organization_members");
    expect(src).toContain("om.organization_id");
  });

  it("user join column is om.user_id (unchanged)", () => {
    const src = readSrc("services/alert-events-service.ts");
    expect(src).toContain("u.id = om.user_id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8 — permissions-service uses organization_members with organization_id
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_8 — permissions-service uses correct table and column", () => {
  it("SQL COUNT targets organization_members with organization_id column", () => {
    const src = readSrc("services/permissions-service.ts");
    expect(src).toContain("organization_members");
    expect(src).toContain("organization_id=$1");
    // Must not contain the legacy table name in SQL context
    expect(src).not.toMatch(/FROM\s+org_members/i);
  });
});
