/**
 * Cross-tenant isolation — roles & SSO providers & session revocation
 *
 * Proves that an admin from org A can NEVER read/update/delete role,
 * SSO-provider, or session records owned by org B, even with a valid
 * (guessed/leaked) record id. All service mutations must be org-scoped
 * in SQL (WHERE id=? AND org_id=?) and throw 404 on cross-org access.
 *
 * These are server-side integration tests; they run against the live DB.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Un-mock the DB — this suite runs against the live database.
vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

import { pool } from "@workspace/db";
import { randomBytes } from "crypto";
import {
  updateRole, deleteRole, assignRole,
} from "../services/permissions-service.js";
import {
  updateSSOProvider, deleteSSOProvider, invalidateSession,
} from "../services/sso-service.js";

const RUN = randomBytes(4).toString("hex");
const ORG_A = `test-xt-a-${RUN}`;
const ORG_B = `test-xt-b-${RUN}`;

const ROLE_B = `role_${ORG_B}_${Date.now()}`;
const SSO_B = `sso_${ORG_B}_saml_${Date.now()}`;
const TOKEN_B = randomBytes(24).toString("hex");
const USER_B = `usr-xt-${RUN}`;

beforeAll(async () => {
  // Org B owns one role, one SSO provider, one team member, one session.
  await pool.query(
    `INSERT INTO roles (id, org_id, name, description, is_system, permissions, created_at)
     VALUES ($1,$2,'Org B Role','victim',false,'{}',NOW())`,
    [ROLE_B, ORG_B]
  );
  await pool.query(
    `INSERT INTO sso_providers (id, org_id, provider_type, type, name, enabled, default_role, created_at)
     VALUES ($1,$2,'saml','saml','Org B SAML',true,'member',NOW())`,
    [SSO_B, ORG_B]
  );
  await pool.query(
    `INSERT INTO team_members (id, org_id, user_id, email, role, joined, created_at)
     VALUES ($1,$2,$3,$4,'member',NOW()::text,NOW())
     ON CONFLICT DO NOTHING`,
    [`tm-xt-${RUN}`, ORG_B, USER_B, `xt-${RUN}@test.flowpoint.internal`]
  );
  await pool.query(
    `INSERT INTO user_sessions (token, user_id, org_id, email, created_at, expires_at)
     VALUES ($1,$2,$3,$4,NOW(),NOW()+INTERVAL '1 hour')`,
    [TOKEN_B, USER_B, ORG_B, `xt-${RUN}@test.flowpoint.internal`]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM roles WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  await pool.query(`DELETE FROM sso_providers WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  await pool.query(`DELETE FROM team_members WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  await pool.query(`DELETE FROM user_sessions WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
});

describe("roles — cross-tenant mutations are blocked", () => {
  it("org A cannot update org B's role", async () => {
    await expect(
      updateRole(ORG_A, ROLE_B, { name: "hijacked" })
    ).rejects.toThrow(/not found/i);
    const r = await pool.query(`SELECT name FROM roles WHERE id=$1`, [ROLE_B]);
    expect(r.rows[0].name).toBe("Org B Role"); // unchanged
  });

  it("org A cannot delete org B's role", async () => {
    await expect(deleteRole(ORG_A, ROLE_B)).rejects.toThrow(/not found/i);
    const r = await pool.query(`SELECT 1 FROM roles WHERE id=$1`, [ROLE_B]);
    expect(r.rowCount).toBe(1); // still there
  });

  it("org A cannot assign org B's custom role to a member (ownership check fires first)", async () => {
    await expect(assignRole(ORG_A, USER_B, ROLE_B)).rejects.toThrow(/not found/i);
    const r = await pool.query(`SELECT role FROM team_members WHERE user_id=$1 AND org_id=$2`, [USER_B, ORG_B]);
    expect(r.rows[0]?.role).toBe("member"); // unchanged
  });

  it("org B CAN update its own role (positive control)", async () => {
    const updated = await updateRole(ORG_B, ROLE_B, { name: "Org B Role v2" });
    expect(updated.name).toBe("Org B Role v2");
    await updateRole(ORG_B, ROLE_B, { name: "Org B Role" }); // restore
  });
});

describe("SSO providers — cross-tenant mutations are blocked", () => {
  it("org A cannot update org B's SSO provider", async () => {
    await expect(
      updateSSOProvider(ORG_A, SSO_B, { enabled: false })
    ).rejects.toThrow(/not found/i);
    const r = await pool.query(`SELECT enabled FROM sso_providers WHERE id=$1`, [SSO_B]);
    expect(r.rows[0].enabled).toBe(true); // unchanged
  });

  it("org A cannot delete org B's SSO provider", async () => {
    await expect(deleteSSOProvider(ORG_A, SSO_B)).rejects.toThrow(/not found/i);
    const r = await pool.query(`SELECT 1 FROM sso_providers WHERE id=$1`, [SSO_B]);
    expect(r.rowCount).toBe(1); // still there
  });

  it("org B CAN update its own SSO provider (positive control)", async () => {
    const updated = await updateSSOProvider(ORG_B, SSO_B, { name: "Org B SAML v2" });
    expect(updated.name).toBe("Org B SAML v2");
  });
});

describe("sessions — cross-tenant revocation is blocked", () => {
  it("org A cannot invalidate org B's session", async () => {
    await invalidateSession(ORG_A, TOKEN_B); // must be a no-op, not a delete
    const r = await pool.query(`SELECT 1 FROM user_sessions WHERE token=$1`, [TOKEN_B]);
    expect(r.rowCount).toBe(1); // session survives
  });

  it("org B CAN invalidate its own session (positive control)", async () => {
    await invalidateSession(ORG_B, TOKEN_B);
    const r = await pool.query(`SELECT 1 FROM user_sessions WHERE token=$1`, [TOKEN_B]);
    expect(r.rowCount).toBe(0);
  });
});
