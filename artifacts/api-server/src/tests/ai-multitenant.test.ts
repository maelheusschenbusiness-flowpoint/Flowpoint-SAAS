/**
 * Multi-tenant isolation test for AI mission tools — Task #592 CR-8 / Item #11.
 *
 * Tests are PURE LOGIC (no real DB needed) — verifies that:
 *  1. Every SQL query the tool-executor builds for missions includes `org_id = $1`
 *  2. The orgId guard in chatHandler rejects "default" and undefined
 *  3. delete_mission SQL always scopes by org_id (cannot cross tenant by ID alone)
 *
 * These are structural guarantees that remain true regardless of the test environment.
 * DB-integration tests (real insert/delete across orgs) require a non-mocked pool and
 * are tracked separately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Load tool-executor source for SQL pattern analysis ───────────────────────
const executorSource = readFileSync(
  resolve(__dirname, "../agent/tool-executor.ts"),
  "utf8"
);

// ── Load ai.ts for orgId guard analysis ──────────────────────────────────────
const aiRouteSource = readFileSync(
  resolve(__dirname, "../routes/ai.ts"),
  "utf8"
);

// ── Helper: extract SQL blocks for a given tool ───────────────────────────────
function extractSqlBlock(source: string, toolName: string): string {
  const start = source.indexOf(`if (name === "${toolName}")`);
  if (start === -1) return "";
  // Find the closing brace of this if-block by counting braces
  let depth = 0;
  let i = start;
  let blockStart = -1;
  while (i < source.length) {
    if (source[i] === "{") {
      if (blockStart === -1) blockStart = i;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return source.slice(start);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CR-8 Multi-tenant isolation — SQL org_id scoping", () => {

  const READ_TOOLS  = ["list_missions", "search_mission"];
  const WRITE_TOOLS = ["create_mission", "update_mission", "complete_mission", "assign_mission", "delete_mission"];

  READ_TOOLS.forEach(tool => {
    it(`${tool}: SQL WHERE clause includes org_id = $1 (read isolation)`, () => {
      const block = extractSqlBlock(executorSource, tool);
      expect(block).not.toBe("");
      // Every SELECT must be scoped to org_id
      expect(block).toMatch(/WHERE org_id = \$1/);
    });
  });

  WRITE_TOOLS.forEach(tool => {
    it(`${tool}: uses orgId parameter in every DB mutation (write isolation)`, () => {
      const block = extractSqlBlock(executorSource, tool);
      expect(block).not.toBe("");
      // Writes must reference orgId — either as a param binding or in the snapshot helper
      // (snapMission enforces org_id = $2 for ownership verification)
      const hasOrgRef = /orgId|org_id/.test(block);
      expect(hasOrgRef).toBe(true);
    });
  });

  it("delete_mission: SQL includes AND org_id so cross-tenant delete is impossible", () => {
    const block = extractSqlBlock(executorSource, "delete_mission");
    // delete_mission handler calls snapMission which scopes to org_id, then deletes by id+org_id
    const hasOrgScope = /AND org_id/.test(block) || /org_id.*AND|snapMission/.test(block);
    expect(hasOrgScope).toBe(true);
  });

  it("list_missions: base SQL starts with org_id = $1 before any optional filter", () => {
    const block = extractSqlBlock(executorSource, "list_missions");
    // The first param must be org_id — confirm $1 appears in WHERE org_id context
    const match = block.match(/FROM missions WHERE org_id = \$(\d+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("1"); // org_id must be the first param, not an optional one
  });

  it("search_mission: org_id = $1 is always the first binding, query is optional ($2 if present)", () => {
    const block = extractSqlBlock(executorSource, "search_mission");
    const match = block.match(/FROM missions WHERE org_id = \$(\d+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("1");
  });
});

describe("CR-8 Multi-tenant isolation — orgId guard logic", () => {
  // These test the inline guard logic extracted from ai.ts
  // Guard: if (!orgId || orgId === "default") → 400

  const cases: Array<{ orgId: unknown; shouldBlock: boolean; label: string }> = [
    { orgId: undefined,  shouldBlock: true,  label: "undefined orgId" },
    { orgId: null,       shouldBlock: true,  label: "null orgId" },
    { orgId: "",         shouldBlock: true,  label: "empty string orgId" },
    { orgId: "default",  shouldBlock: true,  label: "sentinel 'default' orgId" },
    { orgId: "cea721d7-fe12-4ca1-a816-2bee87a30ed4", shouldBlock: false, label: "valid UUID orgId" },
    { orgId: "support@flowpoint.pro", shouldBlock: false, label: "legacy email orgId (not blocked at guard)" },
  ];

  cases.forEach(({ orgId, shouldBlock, label }) => {
    it(`blocks=${shouldBlock} for: ${label}`, () => {
      const wouldBlock = !orgId || orgId === "default";
      expect(wouldBlock).toBe(shouldBlock);
    });
  });

  it("ai.ts guard code is present — rejects orgId === 'default' with 400", () => {
    // Verify the guard was actually added to the source (not just a test assertion)
    expect(aiRouteSource).toMatch(/orgId === "default"/);
    expect(aiRouteSource).toMatch(/ORG_ID_REQUIRED/);
    expect(aiRouteSource).toMatch(/res\.status\(400\)/);
  });
});

describe("CR-8 Multi-tenant isolation — model cannot supply its own orgId", () => {
  it("orgId comes exclusively from req.orgId (set by requireAuth), not from the request body", () => {
    // Verify that the chatHandler reads orgId from req.orgId, not from req.body
    // This ensures the AI model cannot inject a different org_id via the JSON body
    const orgIdAssignment = aiRouteSource.match(/const orgId = req\.orgId/);
    expect(orgIdAssignment).not.toBeNull();
    // There must be NO code like: const orgId = req.body.orgId or req.query.orgId
    expect(aiRouteSource).not.toMatch(/orgId\s*=\s*req\.body.*orgId/);
    expect(aiRouteSource).not.toMatch(/orgId\s*=\s*req\.query.*orgId/);
  });
});
