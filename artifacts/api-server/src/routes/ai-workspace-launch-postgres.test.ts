import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AWL_HISTORY_LIMIT, listWorkspaceLaunches } from "../services/awl-history.js";

const url = process.env["DATABASE_URL"] ?? "";
const certUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"] ?? "";
const certDatabase = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"] ?? "";
const certHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"] ?? "";

function isExactDisposableTarget(
  databaseUrl: string,
  dedicatedUrl: string,
  expectedDatabase: string,
  expectedHost: string,
): boolean {
  if (
    !databaseUrl ||
    !dedicatedUrl ||
    databaseUrl !== dedicatedUrl ||
    expectedDatabase !== "flowpoint_addon_cert_e2e" ||
    !expectedHost
  ) {
    return false;
  }

  try {
    const target = new URL(dedicatedUrl);
    return (
      (target.protocol === "postgres:" || target.protocol === "postgresql:") &&
      target.hostname.toLowerCase() === expectedHost.trim().toLowerCase() &&
      decodeURIComponent(target.pathname) === `/${expectedDatabase}`
    );
  } catch {
    return false;
  }
}

function isExactCiTarget(databaseUrl: string, nodeEnv: string | undefined): boolean {
  if (nodeEnv !== "test") return false;
  try {
    const target = new URL(databaseUrl);
    return (
      (target.protocol === "postgres:" || target.protocol === "postgresql:") &&
      target.hostname === "127.0.0.1" &&
      decodeURIComponent(target.pathname) === "/flowpoint_ci"
    );
  } catch {
    return false;
  }
}

const certMode = isExactDisposableTarget(url, certUrl, certDatabase, certHost);
const ci = isExactCiTarget(url, process.env["NODE_ENV"]);
const suite = ci || certMode ? describe : describe.skip;

describe("AI Workspace Launch PostgreSQL target guard", () => {
  it("rejects a certification URL whose host differs from the explicitly expected host", () => {
    expect(
      isExactDisposableTarget(
        "postgresql://user:password@unexpected.test:5432/flowpoint_addon_cert_e2e",
        "postgresql://user:password@unexpected.test:5432/flowpoint_addon_cert_e2e",
        "flowpoint_addon_cert_e2e",
        "approved.test",
      ),
    ).toBe(false);
  });

  it("rejects a certification URL with a different database name", () => {
    expect(
      isExactDisposableTarget(
        "postgresql://user:password@approved.test:5432/other",
        "postgresql://user:password@approved.test:5432/other",
        "flowpoint_addon_cert_e2e",
        "approved.test",
      ),
    ).toBe(false);
  });
});

suite("AI Workspace Launch PostgreSQL persistence certification (synthetic data; no AI provider)", () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const sessionA = `qa-awl-${randomUUID()}`;
  const sessionB = `qa-awl-${randomUUID()}`;
  const profileA = `qa-awl-profile-${randomUUID()}`;
  const profileB = `qa-awl-profile-${randomUUID()}`;
  const missionA = `qa-awl-mission-${randomUUID()}`;
  const missionB = `qa-awl-mission-${randomUUID()}`;
  let db: Pool | undefined;

  async function scoped<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!db) throw new Error("Certification database has not been initialized.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    // Both certification and CI targets are fully validated before Pool can
    // open a socket. Remote certification targets additionally require a
    // database-side disposable marker after the connection is established.
    if (!ci && !certMode) {
      throw new Error("Refusing workspace-launch integration test: database target guard failed.");
    }

    const candidate = new Pool({ connectionString: url, max: 4 });
    db = candidate;
    if (certMode) {
      try {
        const identity = await candidate.query("SELECT current_database() AS database_name");
        const marker = await candidate.query(
          "SELECT database_name, classification FROM public.flowpoint_test_database_guard WHERE purpose = $1",
          ["addon-cert"],
        );
        if (
          identity.rows[0]?.database_name !== certDatabase ||
          marker.rows.length !== 1 ||
          marker.rows[0].database_name !== identity.rows[0]?.database_name ||
          marker.rows[0].classification !== "disposable"
        ) {
          throw new Error("identity mismatch");
        }
      } catch {
        await candidate.end();
        db = undefined;
        throw new Error("Refusing workspace-launch integration test: disposable DB guard failed.");
      }
    }

    for (const [orgId, sessionId, profileId, missionId] of [
      [orgA, sessionA, profileA, missionA],
      [orgB, sessionB, profileB, missionB],
    ]) {
      await scoped(orgId, async (client) => {
        await client.query(
          `INSERT INTO onboarding_sessions
             (id, org_id, user_id, status, site_url, business_name, metadata)
           VALUES ($1, $2, $3, 'completed', $4, $5, '{}'::jsonb)`,
          [sessionId, orgId, "qa-user", "https://qa-fixture.invalid", "Synthetic workspace"],
        );
        await client.query(
          `INSERT INTO ai_workspace_profiles
             (id, org_id, session_id, business_name, generated_roadmap, generated_strategy, seo_score)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            profileId,
            orgId,
            sessionId,
            "Synthetic workspace",
            JSON.stringify([{ title: "Fixture" }]),
            "Synthetic strategy",
            73,
          ],
        );
        await client.query(
          `INSERT INTO ai_generated_missions
             (id, org_id, profile_id, title, category, priority)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [missionId, orgId, profileId, "Synthetic mission", "seo", 1],
        );
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    for (const orgId of [orgA, orgB]) {
      await scoped(orgId, async (client) => {
        await client.query("DELETE FROM ai_generated_missions WHERE org_id = $1", [orgId]);
        await client.query("DELETE FROM ai_workspace_profiles WHERE org_id = $1", [orgId]);
        await client.query("DELETE FROM onboarding_sessions WHERE org_id = $1", [orgId]);
      });
    }
    await db.end();
  });

  it("loads a session, profile, and missions only for the owning tenant", async () => {
    const result = await scoped(orgA, async (client) => {
      const session = await client.query(
        `SELECT s.*, p.id AS profile_id, p.generated_roadmap, p.generated_strategy, p.seo_score,
                (SELECT COUNT(*) FROM ai_generated_missions WHERE org_id = $2 AND profile_id = p.id)
                  AS mission_count
           FROM onboarding_sessions s
           LEFT JOIN ai_workspace_profiles p ON p.session_id = s.id AND p.org_id = s.org_id
          WHERE s.id = $1 AND s.org_id = $2`,
        [sessionA, orgA],
      );
      const missions = await client.query(
        `SELECT id, title, category, priority, status
           FROM ai_generated_missions WHERE org_id = $1 AND profile_id = $2
          ORDER BY priority ASC`,
        [orgA, profileA],
      );
      const foreign = await client.query(
        "SELECT id FROM onboarding_sessions WHERE id = $1 AND org_id = $2",
        [sessionB, orgA],
      );
      return { session: session.rows[0], missions: missions.rows, foreign: foreign.rows };
    });

    expect(result.session.profile_id).toBe(profileA);
    expect(result.session.generated_strategy).toBe("Synthetic strategy");
    expect(Number(result.session.mission_count)).toBe(1);
    expect(result.missions.map((mission) => mission.id)).toEqual([missionA]);
    expect(result.foreign).toEqual([]);
  });

  it("lists the history from the real SQL, scoped to the organization, newest first", async () => {
    const olderSession = `qa-awl-${randomUUID()}`;
    const olderProfile = `qa-awl-profile-${randomUUID()}`;
    await scoped(orgA, async (client) => {
      await client.query(
        `INSERT INTO onboarding_sessions (id, org_id, user_id, status, business_name, started_at, metadata)
         VALUES ($1, $2, 'qa-user', 'completed', 'Older', now() - interval '2 days', '{}'::jsonb)`,
        [olderSession, orgA]);
      await client.query(
        `INSERT INTO ai_workspace_profiles (id, org_id, session_id, business_name, generated_roadmap, generated_strategy, seo_score)
         VALUES ($1, $2, $3, 'Older', '[]'::jsonb, 's', 1)`, [olderProfile, orgA, olderSession]);
      // Une session sans profil genere n'a rien a restaurer : elle n'apparait pas.
      await client.query(
        `INSERT INTO onboarding_sessions (id, org_id, user_id, status, metadata) VALUES ($1, $2, 'qa-user', 'in_progress', '{}'::jsonb)`,
        [`qa-awl-${randomUUID()}`, orgA]);
    });
    const a = await scoped(orgA, (client) => listWorkspaceLaunches((sql, params) => client.query(sql, params), orgA));
    const b = await scoped(orgB, (client) => listWorkspaceLaunches((sql, params) => client.query(sql, params), orgB));
    expect(a.map(item => item.sessionId)).toEqual([sessionA, olderSession]);
    expect(a[0]).toMatchObject({ businessName: "Synthetic workspace", missionCount: 1, siteUrl: "https://qa-fixture.invalid" });
    expect(a[1]!.missionCount).toBe(0);
    expect(b.map(item => item.sessionId)).toEqual([sessionB]);
    expect(a.length).toBeLessThanOrEqual(AWL_HISTORY_LIMIT);
    await scoped(orgA, async (client) => {
      await client.query("DELETE FROM ai_workspace_profiles WHERE id = $1", [olderProfile]);
      await client.query("DELETE FROM onboarding_sessions WHERE org_id = $1 AND id <> $2", [orgA, sessionA]);
    });
  });
});
