/**
 * A-06 — comptes en double : finalize-checkout et le webhook Stripe activent le
 * meme signup en parallele. PostgreSQL reel (comme la CI) ; aucune donnee
 * existante n'est lue ni modifiee : e-mails uniques de test, nettoyes ensuite.
 *
 * Couvre :
 *  - deux `activateNewSignup` (webhook) concurrents -> une seule organisation ;
 *  - un webhook et une activation "finalize-checkout" concurrents -> une seule
 *    organisation, quel que soit l'ordre ;
 *  - temoin : SANS le verrou ni la reutilisation, le meme scenario cree deux
 *    organisations (le test echoue donc sans le correctif) ;
 *  - migration 025 : creee seulement sans doublon, jamais d'echec ni de
 *    modification de donnees quand des doublons existent (tout est annule).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { pool } = await import("@workspace/db");
const { activateNewSignup } = await import("../routes/stripe-webhook.js");
const { lockSignupEmail, lockPendingSignup, resolveOwnerOrgId } = await import("./signup-activation-lock.js");

const RUN = Date.now().toString(36);
const emails: string[] = [];
function newEmail(tag: string): string {
  const e = `a06-${tag}-${RUN}@example.test`;
  emails.push(e);
  return e;
}

async function seedPending(email: string, token: string): Promise<void> {
  await pool.query(
    `INSERT INTO pending_signups (token, email, first_name, last_name, company_name)
     VALUES ($1, $2, 'Test', 'Signup', 'Societe A06')`,
    [token, email],
  );
}
async function countOrgs(email: string): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int AS n FROM organizations WHERE lower(owner_email) = lower($1)`, [email]);
  return r.rows[0].n;
}

/** Activation telle que finalize-checkout (etape FC-4) : meme SQL, memes appels de verrou. */
async function finalizeLikeActivation(email: string, token: string): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await lockSignupEmail(c, email);
    await lockPendingSignup(c, token);
    const { orgId } = await resolveOwnerOrgId(c, email, randomUUID());
    const u = await c.query<{ id: string }>(
      `INSERT INTO users (id, email, first_name, last_name, auth_provider, email_verified, status)
       VALUES ($4,$1,$2,$3,'magic_link',TRUE,'active')
       ON CONFLICT (email) DO UPDATE SET status='active', email_verified=TRUE, updated_at=NOW()
       RETURNING id`,
      [email, "Test", "Signup", randomUUID()],
    );
    await c.query(
      `INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,subscription_status,owner_email)
       VALUES($1,$2,$3,$4,'active','standard','trialing',$5)
       ON CONFLICT (id) DO UPDATE SET status='active', plan=EXCLUDED.plan, updated_at=NOW()`,
      [orgId, "Societe A06", orgId.slice(0, 12), u.rows[0]!.id, email],
    );
    await c.query(
      `INSERT INTO organization_members (organization_id,user_id,role,status) VALUES($1,$2,'owner','active')
       ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',role='owner',updated_at=NOW()`,
      [orgId, u.rows[0]!.id],
    );
    await c.query(`UPDATE pending_signups SET consumed_at=NOW() WHERE token=$1 AND consumed_at IS NULL`, [token]);
    await c.query("COMMIT");
    return orgId;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Contrat #410 (conserve a la fusion avec #390) : l'activation exige une
// souscription Stripe reelle — ce banc fournit un identifiant factice, comme
// conversion-b-fp-lid.test.ts. Seules les entrees changent, pas les assertions.
const webhook = (email: string, token: string) =>
  activateNewSignup({
    preRegToken: token, orgId: email, selectedPlan: "standard", isTrial: true,
    subscriptionId: `sub_a06_${token.slice(4, 12)}`,
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterAll(async () => {
  for (const e of emails) {
    await pool.query(
      `DELETE FROM organization_members WHERE organization_id IN (SELECT id::text FROM organizations WHERE lower(owner_email)=lower($1))`, [e]);
    const orgIds = (await pool.query(`SELECT id::text AS id FROM organizations WHERE lower(owner_email)=lower($1)`, [e])).rows.map((r) => r.id);
    await pool.query(`DELETE FROM organizations WHERE lower(owner_email)=lower($1)`, [e]);
    for (const id of orgIds) await pool.query(`DELETE FROM org_settings WHERE org_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM org_settings WHERE lower(org_id::text)=lower($1)`, [e]).catch(() => {});
    await pool.query(`DELETE FROM magic_link_tokens WHERE lower(email)=lower($1)`, [e]).catch(() => {});
    await pool.query(`DELETE FROM pending_signups WHERE lower(email)=lower($1)`, [e]);
    await pool.query(`DELETE FROM users WHERE lower(email)=lower($1)`, [e]);
  }
});

describe("A-06 — une seule organisation par proprietaire", () => {
  it("deux webhooks activateNewSignup concurrents (meme jeton) : une organisation", async () => {
    const email = newEmail("wh-wh");
    const token = `tok-${randomUUID()}`;
    await seedPending(email, token);
    await Promise.all([webhook(email, token), webhook(email, token)]);
    expect(await countOrgs(email)).toBe(1);
    const consumed = await pool.query(`SELECT consumed_at FROM pending_signups WHERE token=$1`, [token]);
    expect(consumed.rows[0].consumed_at).not.toBeNull();
    const members = await pool.query(
      `SELECT count(*)::int AS n FROM organization_members WHERE organization_id IN (SELECT id::text FROM organizations WHERE lower(owner_email)=lower($1))`, [email]);
    expect(members.rows[0].n).toBe(1);
  });

  it("finalize-checkout et webhook concurrents : une organisation, dans les deux ordres", async () => {
    for (const order of ["finalize-first", "webhook-first"] as const) {
      const email = newEmail(order);
      const token = `tok-${randomUUID()}`;
      await seedPending(email, token);
      const f = () => finalizeLikeActivation(email, token);
      const w = () => webhook(email, token);
      if (order === "finalize-first") await Promise.all([f(), w()]);
      else await Promise.all([w(), f()]);
      expect(await countOrgs(email), order).toBe(1);
    }
  });

  it("repetition : 12 paires concurrentes finalize + webhook, jamais deux organisations", async () => {
    const jobs: Promise<unknown>[] = [];
    const list: string[] = [];
    for (let i = 0; i < 12; i++) {
      const email = newEmail(`loop${i}`);
      const token = `tok-${randomUUID()}`;
      list.push(email);
      await seedPending(email, token);
      jobs.push(Promise.all([finalizeLikeActivation(email, token), webhook(email, token)]));
    }
    await Promise.all(jobs);
    for (const e of list) expect(await countOrgs(e), e).toBe(1);
  });

  it("temoin : sans verrou ni reutilisation, le meme scenario cree DEUX organisations", async () => {
    const email = newEmail("control");
    const token = `tok-${randomUUID()}`;
    await seedPending(email, token);
    const unsafe = async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT pg_sleep(0.2)`); // laisse l'autre transaction demarrer : pas de verrou
        const orgId = randomUUID(); // l'ancien comportement : toujours un nouvel identifiant
        const u = await c.query<{ id: string }>(
          `INSERT INTO users (id, email, first_name, last_name, auth_provider, email_verified, status)
           VALUES ($4,$1,$2,$3,'magic_link',TRUE,'active')
           ON CONFLICT (email) DO UPDATE SET status='active' RETURNING id`,
          [email, "T", "S", randomUUID()],
        );
        await c.query(
          `INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,subscription_status,owner_email)
           VALUES($1,'X',$2,$3,'active','standard','trialing',$4)`,
          [orgId, orgId.slice(0, 12), u.rows[0]!.id, email],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };
    await Promise.all([unsafe(), unsafe()]);
    expect(await countOrgs(email)).toBe(2);
  });

  it("la casse de l'e-mail ne cree pas une seconde organisation", async () => {
    const email = newEmail("case");
    const token = `tok-${randomUUID()}`;
    await seedPending(email, token);
    const first = await finalizeLikeActivation(email, token);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await resolveOwnerOrgId(c, email.toUpperCase(), randomUUID());
      await c.query("ROLLBACK");
      expect(r).toEqual({ orgId: first, reused: true });
    } finally {
      c.release();
    }
  });
});

describe("migration 025 — index unique partiel, non destructive", () => {
  const sql = readFileSync(resolve(process.cwd(), "migrations/025_organizations_owner_email_unique.sql"), "utf8");
  const INDEX = "organizations_owner_email_active_uniq";

  async function indexExists(c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }) {
    return (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [INDEX])).rows.length > 0;
  }

  it("sans doublon : l'index est cree (puis annule par le test)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`DROP INDEX IF EXISTS ${INDEX}`);
      await c.query(sql);
      // Rejouable (idempotent).
      await c.query(sql);
      // Test de l'invariant : deux organisations non supprimees pour le meme e-mail sont refusees.
      const e = `idx-${RUN}@example.test`;
      const mk = (id: string, status: string, email: string) => c.query(
        `INSERT INTO organizations (id,name,slug,status,plan,owner_email) VALUES ($1,'x',$2,$3,'standard',$4)`,
        [id, id.slice(0, 12), status, email]);
      const dupBefore = (await c.query(
        `SELECT count(*)::int AS n FROM (SELECT 1 FROM organizations WHERE owner_email IS NOT NULL AND owner_email <> ''
           AND status IS DISTINCT FROM 'deleted' GROUP BY lower(owner_email) HAVING count(*) > 1) d`)).rows[0].n as number;
      if (dupBefore === 0) {
        expect(await indexExists(c)).toBe(true);
        await mk(randomUUID(), "active", e);
        await c.query("SAVEPOINT s1");
        await expect(mk(randomUUID(), "active", e.toUpperCase())).rejects.toMatchObject({ code: "23505" });
        await c.query("ROLLBACK TO SAVEPOINT s1");
        await mk(randomUUID(), "deleted", e); // une organisation supprimee ne bloque pas
      }
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("avec doublons : aucune erreur, aucun index, aucune ligne modifiee ni supprimee", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`DROP INDEX IF EXISTS ${INDEX}`);
      const e = `dup-${RUN}@example.test`;
      const a = randomUUID();
      const b = randomUUID();
      for (const id of [a, b]) {
        await c.query(`INSERT INTO organizations (id,name,slug,status,plan,owner_email) VALUES ($1,'x',$2,'active','standard',$3)`,
          [id, id.slice(0, 12), id === a ? e : e.toUpperCase()]);
      }
      const before = (await c.query(`SELECT count(*)::int AS n FROM organizations`)).rows[0].n;
      await expect(c.query(sql)).resolves.toBeDefined();
      expect(await indexExists(c)).toBe(false);
      const after = (await c.query(`SELECT count(*)::int AS n FROM organizations`)).rows[0].n;
      expect(after).toBe(before);
      const diag = readFileSync(resolve(process.cwd(), "migrations/diagnostics/025_detect_duplicate_org_owner_email.sql"), "utf8");
      const found = await c.query(diag);
      expect((found.rows as { owner_email_normalise: string }[]).map((r) => r.owner_email_normalise)).toContain(e);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});
