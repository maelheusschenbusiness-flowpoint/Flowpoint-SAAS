/**
 * Langue d'inscription — PostgreSQL reel (CI). Donnees de test uniques, nettoyees.
 * Ignore sans DATABASE_URL.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const HAS_DB = !!process.env["DATABASE_URL"];
const RUN = Date.now().toString(36);

describe.skipIf(!HAS_DB)("langue d'inscription (DB)", async () => {
  const { pool } = await import("@workspace/db");
  const { applySignupLanguage, getRecipientLanguage, normalizeSignupLanguage } = await import("./signup-language.js");
  const orgs: string[] = []; const users: string[] = []; const tokens: string[] = [];

  async function seedOrg(lang: string | null): Promise<{ orgId: string; userId: string }> {
    const userId = randomUUID(); const orgId = randomUUID();
    const email = `lang-${orgs.length}-${RUN}@example.test`;
    await pool.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [userId, email]);
    await pool.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, language)
       VALUES ($1, 'Lang', $2, $3, 'active', 'standard', $4, $5)`,
      [orgId, `lang-${orgId}`, userId, email, lang]);
    await pool.query(`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES ($1,$2,'owner','active')`, [orgId, userId]);
    orgs.push(orgId); users.push(userId);
    return { orgId, userId };
  }
  async function inTx(fn: (c: any) => Promise<void>) {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await fn(c); await c.query("COMMIT"); } finally { c.release(); }
  }

  beforeAll(async () => {
    await pool.query(`ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS language TEXT`);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM pending_signups WHERE token = ANY($1)`, [tokens]);
    await pool.query(`DELETE FROM user_prefs WHERE org_id = ANY($1)`, [orgs]);
    await pool.query(`DELETE FROM organization_members WHERE organization_id::text = ANY($1)`, [orgs]);
    await pool.query(`DELETE FROM organizations WHERE id::text = ANY($1)`, [orgs]);
    await pool.query(`DELETE FROM users WHERE id::text = ANY($1)`, [users]);
  });

  it("pending_signups.language stocke la valeur normalisee (valide / invalide / absente -> en)", async () => {
    for (const [raw, want] of [["de", "de"], ["xx", "en"], [undefined, "en"]] as const) {
      const t = `lang-${RUN}-${tokens.length}`; tokens.push(t);
      await pool.query(
        `INSERT INTO pending_signups (token, email, first_name, last_name, company_name, language)
         VALUES ($1, $2, 'A', 'B', '', $3)`, [t, `${t}@example.test`, normalizeSignupLanguage(raw)]);
      const r = await pool.query(`SELECT language FROM pending_signups WHERE token = $1`, [t]);
      expect(r.rows[0].language).toBe(want);
    }
  });

  it("activation : copie dans user_prefs et organizations vides ; relu apres reconnexion", async () => {
    const { orgId, userId } = await seedOrg(null);
    await inTx(c => applySignupLanguage(c, { orgId, language: "es" }));
    const r = await pool.query(`SELECT settings->>'language' AS l FROM user_prefs WHERE org_id = $1`, [orgId]);
    expect(r.rows[0].l).toBe("es");
    expect((await pool.query(`SELECT language FROM organizations WHERE id = $1`, [orgId])).rows[0].language).toBe("es");
    expect(await getRecipientLanguage({ orgId })).toBe("es");
    expect(await getRecipientLanguage({ userId })).toBe("es");
  });

  it("n'ecrase ni un choix explicite ni la langue d'une organisation existante", async () => {
    const { orgId } = await seedOrg("it");
    await pool.query(`INSERT INTO user_prefs (org_id, settings) VALUES ($1, '{"language":"nl","timezone":"UTC"}'::jsonb)`, [orgId]);
    await inTx(c => applySignupLanguage(c, { orgId, language: "de" }));
    const r = await pool.query(`SELECT settings FROM user_prefs WHERE org_id = $1`, [orgId]);
    expect(r.rows[0].settings).toEqual({ language: "nl", timezone: "UTC" });
    expect((await pool.query(`SELECT language FROM organizations WHERE id = $1`, [orgId])).rows[0].language).toBe("it");
  });

  it("compte existant sans preference : resolution inchangee (org -> en)", async () => {
    const { orgId } = await seedOrg(null);
    expect(await getRecipientLanguage({ orgId })).toBe("en");
  });
});
