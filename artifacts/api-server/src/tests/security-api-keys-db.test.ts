/**
 * Cles API d'organisation (fp_pub_ / fp_sec_) : garanties de securite.
 *
 * Verifie, application complete montee (orgContext → requireAuth → routes) sur une base
 * isolee, avec des organisations, sessions et cles de TEST uniquement :
 *   - aucune cle ne s'ecrit par les preferences, aucune valeur de cle n'est relue ;
 *   - les anciennes cles par defaut ne sont ni proposees ni acceptees ;
 *   - perimetre des cles (lecture seule / admin, routes interdites) et isolation entre
 *     organisations ;
 *   - revocation, interrupteur d'urgence, aucune cle dans les journaux.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Journal reel (pino-http l'exige) dont la sortie est capturee : on y cherche les cles.
const journal: string[] = [];
vi.mock("../lib/logger.js", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "debug" }, { write: (ligne: string) => { journal.push(ligne); } }) };
});
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());

import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import type { Express } from "express";
import { pool } from "@workspace/db";

let app: Express;
let dbOk = false;

type Org = { id: string; tokens: Record<"owner" | "admin" | "member" | "viewer", string> };
const orgs: Org[] = [];
const ROLES = ["owner", "admin", "member", "viewer"] as const;
const cleTest = (prefixe: "fp_pub_" | "fp_sec_") => `${prefixe}${randomBytes(20).toString("hex")}`;
const deterministe = (orgId: string) =>
  `fp_pub_${Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22)}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function creerOrg(): Promise<Org> {
  const { createSession } = await import("../services/sessions.js");
  const id = randomUUID();
  // Organisation payante active : les barrieres d'abonnement laissent passer, seule la
  // securite des cles est mesuree.
  await pool.query(
    `INSERT INTO organizations (id, name, plan, subscription_status, owner_email, stripe_customer_id, stripe_subscription_id)
     VALUES ($1, 'Test securite cles', 'pro', 'active', $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [id, `owner-${id.slice(0, 8)}@test.invalid`, `cus_test_${id.slice(0, 8)}`, `sub_test_${id.slice(0, 8)}`],
  );
  // Colonne absente de certaines branches : best effort.
  await pool.query(`UPDATE organizations SET current_period_end = now() + interval '30 days' WHERE id = $1`, [id]).catch(() => undefined);
  const tokens = {} as Org["tokens"];
  for (const role of ROLES) {
    tokens[role] = await createSession({ userId: randomUUID(), userUuid: randomUUID(), orgId: id, email: `${role}-${id.slice(0, 8)}@test.invalid`, role });
  }
  return { id, tokens };
}

/** Pose directement une cle en base, comme l'aurait fait une regeneration. */
async function poserCle(orgId: string, champ: "publicApiKey" | "secretApiKey", valeur: string) {
  await pool.query(
    `INSERT INTO user_prefs (org_id, settings, updated_at) VALUES ($1, jsonb_build_object($2::text, $3::text), now())
     ON CONFLICT (org_id) DO UPDATE SET settings = COALESCE(user_prefs.settings,'{}'::jsonb) || jsonb_build_object($2::text, $3::text)`,
    [orgId, champ, valeur],
  );
}

const contient = (corps: unknown, secret: string) => JSON.stringify(corps ?? null).includes(secret);

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; return; }
  process.env["API_SECRET_KEY"] = `test-service-${randomBytes(16).toString("hex")}`;
  ({ default: app } = await import("../app.js"));
  orgs.push(await creerOrg(), await creerOrg());
});

afterAll(async () => {
  if (!dbOk) return;
  const ids = orgs.map((o) => o.id);
  await pool.query(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ids]).catch(() => undefined);
  await pool.query(`DELETE FROM user_prefs WHERE org_id = ANY($1)`, [ids]).catch(() => undefined);
  await pool.query(`DELETE FROM organizations WHERE id::text = ANY($1)`, [ids]).catch(() => undefined);
});

describe("A — aucune ecriture de cle par les preferences", () => {
  for (const role of ["viewer", "member", "admin"] as const) it(`un ${role} ne peut pas choisir la cle secrete via PATCH /me/prefs`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const forgee = cleTest("fp_sec_");
    await request(app).patch("/api/me/prefs").set(bearer(a.tokens[role])).send({ settings: { secretApiKey: forgee, publicApiKey: cleTest("fp_pub_") } });
    // Temoin d'authentification : /me/settings repond 200 a toute identite valide.
    const r = await request(app).get("/api/me/settings").set(bearer(forgee));
    expect(r.status).toBe(401);
    const enBase = await pool.query(`SELECT settings->>'secretApiKey' AS s FROM user_prefs WHERE org_id=$1`, [a.id]);
    expect(enBase.rows[0]?.s ?? null).not.toBe(forgee);
  });

  it("les autres reglages passent toujours par PATCH /me/prefs (compatibilite)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const r = await request(app).patch("/api/me/prefs").set(bearer(a.tokens.member)).send({ settings: { wlBranding: { agencyName: "Agence Test" } } });
    expect(r.status).toBe(200);
    const enBase = await pool.query(`SELECT settings->'wlBranding'->>'agencyName' AS n FROM user_prefs WHERE org_id=$1`, [a.id]);
    expect(enBase.rows[0]?.n).toBe("Agence Test");
  });
});

describe("B — la cle secrete n'est jamais relue", () => {
  const lectures = [["GET", "/api/me/settings"], ["GET", "/api/me/prefs"], ["GET", "/api/preferences"], ["GET", "/api/settings/api-keys"], ["GET", "/api/me"]] as const;

  for (const role of ROLES) for (const [, chemin] of lectures) it(`${role} : ${chemin} ne contient pas la cle secrete`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const secrete = cleTest("fp_sec_");
    await poserCle(a.id, "secretApiKey", secrete);
    const r = await request(app).get(chemin).set(bearer(a.tokens[role]));
    expect(contient(r.body, secrete)).toBe(false);
  });

  it("PATCH /me/settings (administrateur) ne renvoie pas la cle secrete", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const secrete = cleTest("fp_sec_");
    await poserCle(a.id, "secretApiKey", secrete);
    const r = await request(app).patch("/api/me/settings").set(bearer(a.tokens.admin)).send({ timezone: "Europe/Paris" });
    expect(r.status).toBe(200);
    expect(contient(r.body, secrete)).toBe(false);
  });

  it("avec une cle publique valide, aucune route de reglages ne livre la cle secrete", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const pub = cleTest("fp_pub_"), secrete = cleTest("fp_sec_");
    await poserCle(a.id, "publicApiKey", pub);
    await poserCle(a.id, "secretApiKey", secrete);
    for (const [, chemin] of lectures) {
      const r = await request(app).get(chemin).set(bearer(pub));
      expect(contient(r.body, secrete), chemin).toBe(false);
    }
  });

  it("la regeneration montre la nouvelle cle une seule fois, au proprietaire", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const r = await request(app).post("/api/settings/api-keys/regenerate").set(bearer(a.tokens.owner)).send({ type: "secret" });
    expect(r.status).toBe(200);
    expect(String(r.body.key)).toMatch(/^fp_sec_[0-9a-f]{40}$/);
    const relu = await request(app).get("/api/settings/api-keys").set(bearer(a.tokens.owner));
    expect(contient(relu.body, r.body.key)).toBe(false);
    expect(relu.body.hasSecret).toBe(true);
    // La cle montree une fois fonctionne.
    expect((await request(app).get("/api/me/settings").set(bearer(r.body.key))).status).toBe(200);
  });

  for (const role of ["admin", "member", "viewer"] as const) it(`un ${role} ne peut pas regenerer les cles`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app).post("/api/settings/api-keys/regenerate").set(bearer(orgs[0].tokens[role])).send({ type: "secret" });
    expect(r.status).toBe(403);
  });
});

describe("C — la cle publique n'est plus calculable", () => {
  it("la cle deterministe n'est ni proposee ni enregistree", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const b = orgs[1];
    await pool.query(`DELETE FROM user_prefs WHERE org_id=$1`, [b.id]);
    const me = await request(app).get("/api/me").set(bearer(b.tokens.owner));
    expect(contient(me.body, deterministe(b.id))).toBe(false);
    const k = await request(app).get("/api/settings/api-keys").set(bearer(b.tokens.owner));
    expect(contient(k.body, deterministe(b.id))).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    const enBase = await pool.query(`SELECT settings->>'publicApiKey' AS p FROM user_prefs WHERE org_id=$1`, [b.id]);
    expect(enBase.rows[0]?.p ?? null).not.toBe(deterministe(b.id));
  });

  it("une cle deterministe deja enregistree est refusee (401)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const b = orgs[1];
    await poserCle(b.id, "publicApiKey", deterministe(b.id));
    expect((await request(app).get("/api/me/settings").set(bearer(deterministe(b.id)))).status).toBe(401);
  });
});

describe("D — perimetre des cles API", () => {
  it("cle publique : lecture seule, rien d'autre", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const pub = cleTest("fp_pub_");
    await poserCle(a.id, "publicApiKey", pub);
    expect((await request(app).get("/api/me/settings").set(bearer(pub))).status).toBe(200);
    expect((await request(app).patch("/api/me/prefs").set(bearer(pub)).send({ settings: { x: 1 } })).status).toBe(403);
  });

  it("cle secrete : pas de privileges proprietaire (purge des donnees refusee)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const sec = cleTest("fp_sec_");
    await poserCle(a.id, "secretApiKey", sec);
    expect((await request(app).delete("/api/settings/data").set(bearer(sec))).status).toBe(403);
    expect((await request(app).post("/api/settings/api-keys/regenerate").set(bearer(sec)).send({ type: "secret" })).status).toBe(403);
  });

  for (const chemin of ["/api/settings/api-keys", "/api/billing/payment-methods", "/api/behavioral/snippet", "/api/google/connect", "/api/google/oauth/start"]) {
    it(`aucune cle API sur ${chemin} (secrets, paiement ou effet de bord)`, async (ctx) => {
      if (!dbOk) return ctx.skip();
      const [a] = orgs;
      const pub = cleTest("fp_pub_"), sec = cleTest("fp_sec_");
      await poserCle(a.id, "publicApiKey", pub);
      await poserCle(a.id, "secretApiKey", sec);
      for (const k of [pub, sec]) expect((await request(app).get(chemin).set(bearer(k))).status, `${chemin} ${k.slice(0, 7)}`).toBe(403);
    });
  }
});

describe("E — isolation entre organisations", () => {
  it("la cle d'une organisation ne donne acces qu'a cette organisation", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a, b] = orgs;
    const secB = cleTest("fp_sec_");
    await poserCle(b.id, "secretApiKey", secB);
    await pool.query(`UPDATE user_prefs SET settings = settings || '{"wlBranding":{"agencyName":"Secret A"}}'::jsonb WHERE org_id=$1`, [a.id]);
    const r = await request(app).get("/api/me/prefs").set(bearer(secB));
    expect(contient(r.body, "Secret A")).toBe(false);
    const me = await request(app).get("/api/me").set(bearer(secB));
    expect(contient(me.body, a.id)).toBe(false);
  });

  it("une session d'une organisation ne lit pas les reglages d'une autre", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a, b] = orgs;
    const r = await request(app).get("/api/me/prefs").set(bearer(b.tokens.owner)).set("X-Org-Id", a.id);
    expect(contient(r.body, "Secret A")).toBe(false);
  });
});

describe("G — revocation des cles exposees (rotation)", () => {
  it("la simulation compte sans rien modifier ni reveler ; l'application revoque tout", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const { planApiKeyRotation, applyApiKeyRotation } = await import("../services/api-key-rotation.js");
    const [a, b] = orgs;
    const pub = cleTest("fp_pub_"), sec = cleTest("fp_sec_");
    await pool.query(`DELETE FROM user_prefs WHERE org_id = ANY($1)`, [[a.id, b.id]]);
    await poserCle(a.id, "publicApiKey", pub);
    await poserCle(a.id, "secretApiKey", sec);
    await pool.query(`UPDATE user_prefs SET settings = settings || '{"timezone":"Europe/Paris"}'::jsonb WHERE org_id=$1`, [a.id]);
    await poserCle(b.id, "publicApiKey", deterministe(b.id));

    const client = await pool.connect();
    try {
      const plan = await planApiKeyRotation(client);
      expect(plan.applied).toBe(false);
      expect(plan.affectedOrgIds).toContain(a.id);
      expect(plan.affectedOrgIds).not.toContain(b.id); // cle calculee seule : rien a regenerer
      expect(plan.deterministicPublicKeys).toBeGreaterThanOrEqual(1);
      expect(contient(plan, pub) || contient(plan, sec)).toBe(false);
      expect((await request(app).get("/api/me/settings").set(bearer(sec))).status).toBe(200);

      const fait = await applyApiKeyRotation(client);
      expect(fait.applied).toBe(true);
      expect(contient(fait, pub) || contient(fait, sec)).toBe(false);
    } finally { client.release(); }

    for (const k of [pub, sec, deterministe(b.id)]) expect((await request(app).get("/api/me/settings").set(bearer(k))).status).toBe(401);
    const reste = await pool.query(`SELECT settings FROM user_prefs WHERE org_id=$1`, [a.id]);
    expect(reste.rows[0].settings.timezone).toBe("Europe/Paris");
    expect(reste.rows[0].settings.apiKeysRevokedAt).toBeTruthy();
    // Le proprietaire regenere : la nouvelle cle fonctionne.
    const r = await request(app).post("/api/settings/api-keys/regenerate").set(bearer(a.tokens.owner)).send({ type: "secret" });
    expect((await request(app).get("/api/me/settings").set(bearer(r.body.key))).status).toBe(200);
  });
});

describe("H — interrupteur d'urgence", () => {
  it("API_KEYS_DISABLED=true refuse toute cle, sans toucher aux sessions", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a] = orgs;
    const sec = cleTest("fp_sec_");
    await poserCle(a.id, "secretApiKey", sec);
    expect((await request(app).get("/api/me/settings").set(bearer(sec))).status).toBe(200);
    process.env["API_KEYS_DISABLED"] = "true";
    try {
      expect((await request(app).get("/api/me/settings").set(bearer(sec))).status).toBe(401);
      expect((await request(app).get("/api/me/settings").set(bearer(a.tokens.member))).status).toBe(200);
    } finally { delete process.env["API_KEYS_DISABLED"]; }
    expect((await request(app).get("/api/me/settings").set(bearer(sec))).status).toBe(200);
  });
});

describe("F — aucune cle dans les journaux", () => {
  it("les journaux produits pendant ces tests ne contiennent aucune cle fp_", (ctx) => {
    if (!dbOk) return ctx.skip();
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.join("\n")).not.toMatch(/fp_(pub|sec)_[0-9a-z]{16,}/);
  });
});
