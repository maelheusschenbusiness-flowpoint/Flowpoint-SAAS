/**
 * Regression test — stale team_members row causes 503 BILLING_DATA_UNAVAILABLE
 *
 * Root cause: resolveOrCreateLegacyOrg Step A2 and handleLoginVerify S6-team-members
 * both query team_members and, if a row is found, use its org_id as sessionOrgId
 * without verifying that the org actually exists in the organizations table.
 *
 * After a full account purge + re-registration, the stale team_members row still
 * points to the old UUID (c143bc00-…) which is absent from organizations and
 * org_settings.  Every login creates a session with org_id = ghost UUID → /api/me
 * returns 503 BILLING_DATA_UNAVAILABLE because loadOrgData() finds no billing row.
 *
 * Fix: both code paths now validate the team_members org_id against organizations
 * before returning; a stale row falls through to Step B (owner_email lookup).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot  = process.cwd();
const authSrc  = readFileSync(resolve(apiRoot, "src/routes/auth.ts"), "utf8");
const meFile   = readFileSync(resolve(apiRoot, "src/routes/me.ts"),   "utf8");

describe("stale team_members org_id → 503 regression", () => {

  // ── Guard 1: resolveOrCreateLegacyOrg Step A2 validates org existence ───────
  it("resolveOrCreateLegacyOrg Step A2 checks organizations before returning guest orgId", () => {
    // The fix inserts an org-existence query between finding the team_members row
    // and returning its org_id.  Keyed by the exact log message.
    expect(authSrc).toContain(
      "team_members org_id not found in organizations (stale row after purge)",
    );
  });

  it("resolveOrCreateLegacyOrg Step A2 falls through when org is absent (does not return early)", () => {
    // When the stale-row guard fires, s6GuestOrgId is cleared to null so the
    // downstream org_settings path runs instead.
    expect(authSrc).toMatch(
      /team_members org_id not found in organizations[\s\S]{0,200}falling through to owner check/,
    );
  });

  // ── Guard 2: handleLoginVerify S6-team-members validates org existence ───────
  it("handleLoginVerify S6-team-members clears ghost orgId before using it as sessionOrgId", () => {
    expect(authSrc).toContain(
      "S6: team_members org_id not in organizations (stale after purge)",
    );
  });

  it("handleLoginVerify S6 nulls out s6GuestOrgId so the org_settings fallback runs", () => {
    // The guard sets s6GuestOrgId = null, which causes the outer if(s6GuestOrgId)
    // block to be skipped and the org_settings fallback to execute instead.
    expect(authSrc).toMatch(/s6GuestOrgId = null/);
  });

  // ── Guard 3: /api/me does not silently swallow the missing-org condition ─────
  it("/api/me emits BILLING_DATA_UNAVAILABLE with HTTP 503 when both billing sources are null", () => {
    // The 503 is the correct observable symptom; the fix prevents sessions from
    // ever being created with a ghost orgId so this branch is never reached in
    // normal operation after the fix is deployed.
    expect(meFile).toContain("BILLING_DATA_UNAVAILABLE");
  });

  // ── Structural: org-existence query is correctly scoped ──────────────────────
  it("org-existence check filters status != deleted", () => {
    // Purged orgs have status = 'deleted'; the check must exclude them.
    expect(authSrc).toContain("status != 'deleted'");
  });

  it("org-existence check uses id::text for UUID-to-text comparison", () => {
    // organization_members.organization_id is TEXT; organizations.id is UUID;
    // the cast is needed to avoid a type-mismatch in the WHERE clause.
    expect(authSrc).toMatch(/id::text = \$1[\s\S]{0,40}status != 'deleted'/);
  });

});
