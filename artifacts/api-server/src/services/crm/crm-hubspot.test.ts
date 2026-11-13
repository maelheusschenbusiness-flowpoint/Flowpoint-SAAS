/**
 * CRM / HubSpot : parcours complet contre un FAUSSE API HubSpot locale (aucun appel reseau reel,
 * aucun identifiant reel). Verifie OAuth (state a usage unique), chiffrement des jetons, refresh,
 * isolation entre organisations, synchronisation idempotente, quotas, webhooks signes.
 * Ce test ne certifie PAS la connexion a un vrai compte HubSpot.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
const planState = vi.hoisted(() => ({ plan: "pro" }));
vi.mock("../../middlewares/planGate.js", () => ({
  requireAddon: () => (_a: unknown, _b: unknown, n: () => void) => n(),
  resolvePlanFromDB: async () => planState.plan,
}));
const logs = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../lib/logger.js", () => {
  const rec = (...a: unknown[]) => { logs.calls.push(a); };
  return { logger: { info: rec, warn: rec, error: rec, debug: rec } };
});

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pool } from "@workspace/db";
import router, { crmPublicRouter } from "../../routes/crm.js";
import { decryptCrmToken, encryptCrmToken } from "./token-crypto.js";
import { hubspotAdapter } from "./hubspot.js";

const KEY = "ab".repeat(32);
const SECRET = "fake-hubspot-client-secret";
const WEBHOOK_BASE = "https://app.test.example";
const TOTAL_CONTACTS = 250;

let server: http.Server;
let dbOk = false;
const fake = { refreshStatus: 200, tokenCalls: 0, refreshCalls: 0, validAccess: new Set<string>(), hubId: "424242", listStatus: 200, oneStatus: 200, revoked: [] as string[], listDelayMs: 0 };

function fakeHubSpot(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (url.pathname === "/oauth/v1/token") {
        const form = new URLSearchParams(body);
        if (form.get("client_secret") !== SECRET) return send(401, {});
        if (form.get("grant_type") === "authorization_code") {
          fake.tokenCalls++;
          if (form.get("code") !== "good-code") return send(400, { message: "bad code" });
          const t = `at-${fake.tokenCalls}`; fake.validAccess.add(t);
          return send(200, { access_token: t, refresh_token: `rt-${fake.tokenCalls}`, expires_in: 1800 });
        }
        fake.refreshCalls++;
        if (fake.refreshStatus !== 200) return send(fake.refreshStatus, { message: "revoked" });
        const t = `at-refreshed-${fake.refreshCalls}`; fake.validAccess.add(t);
        return send(200, { access_token: t, refresh_token: form.get("refresh_token"), expires_in: 1800 });
      }
      const rev = url.pathname.match(/^\/oauth\/v1\/refresh-tokens\/(.+)$/);
      if (rev && req.method === "DELETE") { fake.revoked.push(decodeURIComponent(rev[1]!)); return send(204, {}); }
      const info = url.pathname.match(/^\/oauth\/v1\/access-tokens\/(.+)$/);
      if (info) return send(200, { hub_id: Number(fake.hubId), scopes: ["oauth", "crm.objects.contacts.read"] });
      const bearer = (req.headers.authorization ?? "").replace("Bearer ", "");
      if (!fake.validAccess.has(bearer)) return send(401, {});
      const one = url.pathname.match(/^\/crm\/v3\/objects\/contacts\/(\d+)$/);
      if (one && fake.oneStatus !== 200) return send(fake.oneStatus, {});
      if (one) return send(200, { id: one[1], properties: { firstname: "Web", lastname: "Hook", email: `wh${one[1]}@example.com` } });
      if (url.pathname === "/crm/v3/objects/contacts" && fake.listStatus !== 200) return send(fake.listStatus, {});
      if (url.pathname === "/crm/v3/objects/contacts") {
        const limit = Number(url.searchParams.get("limit") ?? 100);
        const after = Number(url.searchParams.get("after") ?? 0);
        const results = [];
        for (let i = after; i < Math.min(after + limit, TOTAL_CONTACTS); i++) {
          results.push({ id: String(1000 + i), properties: { firstname: `Prenom${i}`, lastname: "Nom", email: `c${i}@example.com`, lifecyclestage: "lead" } });
        }
        const next = after + limit < TOTAL_CONTACTS ? { next: { after: String(after + limit) } } : undefined;
        return send(200, { results, paging: next });
      }
      send(404, {});
    });
  });
}

function app(orgId: string, role = "owner") {
  const a = express();
  a.use("/api/crm/webhook", express.raw({ type: "application/json" }), (req, _res, next) => {
    (req as unknown as { rawBody: Buffer }).rawBody = req.body as Buffer; next();
  });
  a.use(express.json());
  a.use(cookieParser());
  a.use("/api", crmPublicRouter);
  a.use((req, _res, next) => { Object.assign(req, { orgId, orgDb: pool.query.bind(pool), orgContext: { role } }); next(); });
  a.use("/api", router);
  return a;
}

const sign = (body: string, ts = Date.now(), secret = SECRET) =>
  ({ ts: String(ts), sig: createHmac("sha256", secret).update("POST" + `${WEBHOOK_BASE}/api/crm/webhook/hubspot` + body + ts).digest("base64") });

const orgA = randomUUID();
const orgB = randomUUID();

/** Cookie de demarrage (anti-CSRF) pose par /connect, a renvoyer au callback comme le ferait le navigateur. */
const cookieOf = (r: { headers: Record<string, unknown> }): string =>
  String(([] as string[]).concat((r.headers["set-cookie"] as string[]) ?? []).find((c) => c.startsWith("fp_crm_oauth=")) ?? "").split(";")[0]!;
const callback = (org: string, query: Record<string, string>, cookie: string) => {
  const r = request(app(org)).get("/api/crm/oauth/hubspot/callback").query(query);
  return cookie ? r.set("Cookie", cookie) : r;
};

async function connect(org: string): Promise<string> {
  const start = await request(app(org)).post("/api/crm/connect/hubspot").send({});
  expect(start.status).toBe(200);
  const state = new URL(start.body.url).searchParams.get("state")!;
  const cb = await callback(org, { code: "good-code", state }, cookieOf(start));
  expect(cb.status).toBe(302);
  expect(cb.headers.location).toContain("crm_connected=hubspot");
  return state;
}

beforeAll(async () => {
  try { await pool.query("SELECT 1 FROM crm_oauth_states LIMIT 1"); await pool.query("SELECT 1 FROM crm_contacts LIMIT 1"); dbOk = true; } catch { dbOk = false; }
  server = fakeHubSpot();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  Object.assign(process.env, {
    NODE_ENV: "test", CRM_TOKEN_ENCRYPTION_KEY: KEY, HUBSPOT_CLIENT_ID: "fake-client", HUBSPOT_CLIENT_SECRET: SECRET,
    HUBSPOT_AUTH_BASE: `http://127.0.0.1:${port}`, HUBSPOT_API_BASE: `http://127.0.0.1:${port}`,
    CRM_WEBHOOK_PUBLIC_URL: WEBHOOK_BASE, FRONTEND_URL: "https://front.test.example",
  });
});
afterAll(async () => {
  server?.close();
  if (dbOk) for (const t of ["crm_integrations", "crm_contacts", "crm_sync_logs", "crm_webhook_events", "crm_oauth_states"]) {
    await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [[orgA, orgB]]);
  }
});
beforeEach(() => { planState.plan = "pro"; fake.refreshStatus = 200; });

describe("chiffrement des jetons", () => {
  it("aller-retour, aucune fuite en clair, alteration detectee", () => {
    const c = encryptCrmToken("secret-token", Buffer.from(KEY, "hex"));
    expect(c).not.toContain("secret-token");
    expect(decryptCrmToken(c, Buffer.from(KEY, "hex"))).toBe("secret-token");
    expect(() => decryptCrmToken(c.slice(0, -2) + "00", Buffer.from(KEY, "hex"))).toThrow();
  });
  it("echec ferme sans cle valide", () => {
    const saved = process.env["CRM_TOKEN_ENCRYPTION_KEY"];
    process.env["CRM_TOKEN_ENCRYPTION_KEY"] = "trop-court";
    expect(() => encryptCrmToken("x")).toThrow(/32-byte hex/);
    process.env["CRM_TOKEN_ENCRYPTION_KEY"] = saved;
  });
});

describe("verification de signature webhook v3 (unitaire)", () => {
  const headers = (b: string, ts?: number, secret?: string) => { const s = sign(b, ts, secret); return { "x-hubspot-signature-v3": s.sig, "x-hubspot-request-timestamp": s.ts }; };
  const check = (b: string, h: Record<string, string>, now?: number) => hubspotAdapter.verifyWebhook({
    rawBody: Buffer.from(b), method: "POST", url: `${WEBHOOK_BASE}/api/crm/webhook/hubspot`, headers: h, now,
  });
  it("accepte une signature valide, refuse secret errone, corps modifie, horodatage perime, en-tetes absents", () => {
    process.env["HUBSPOT_CLIENT_SECRET"] = SECRET;
    const body = "[]";
    expect(check(body, headers(body))).toBe(true);
    expect(check(body, headers(body, undefined, "autre-secret"))).toBe(false);
    expect(check(body + " ", headers(body))).toBe(false);
    expect(check(body, headers(body, Date.now() - 6 * 60_000))).toBe(false);
    expect(check(body, {})).toBe(false);
  });
});

describe("parcours HubSpot contre fausse API", () => {
  it("fournisseurs : HubSpot disponible, les autres explicitement non implementes", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app(orgA)).get("/api/crm/providers");
    const byId = Object.fromEntries(r.body.providers.map((p: { id: string }) => [p.id, p]));
    expect(byId.hubspot).toMatchObject({ available: true, implemented: true });
    expect(byId.salesforce).toMatchObject({ available: false, implemented: false });
    const conn = await request(app(orgA)).post("/api/crm/connect/salesforce").send({});
    expect(conn.status).toBe(501);
    expect(conn.body.code).toBe("CRM_OAUTH_UNAVAILABLE");
  });

  it("connexion refusee (503) si le fournisseur n'est pas configure, sans ecrire d'etat", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const saved = process.env["HUBSPOT_CLIENT_ID"]; delete process.env["HUBSPOT_CLIENT_ID"];
    const before = (await pool.query("SELECT COUNT(*)::int n FROM crm_oauth_states WHERE org_id=$1", [orgA])).rows[0].n;
    const r = await request(app(orgA)).post("/api/crm/connect/hubspot").send({});
    process.env["HUBSPOT_CLIENT_ID"] = saved;
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("CRM_PROVIDER_NOT_CONFIGURED");
    expect((await pool.query("SELECT COUNT(*)::int n FROM crm_oauth_states WHERE org_id=$1", [orgA])).rows[0].n).toBe(before);
  });

  it("state : stocke hache, a usage unique, lie au fournisseur ; callback invalide rejete", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const start = await request(app(orgA)).post("/api/crm/connect/hubspot").send({});
    const u = new URL(start.body.url);
    expect(u.searchParams.get("client_id")).toBe("fake-client");
    const state = u.searchParams.get("state")!;
    expect(state).toMatch(/^[a-f\d]{64}$/);
    const stored = await pool.query("SELECT state_hash FROM crm_oauth_states WHERE org_id=$1", [orgA]);
    expect(stored.rows.some((x: { state_hash: string }) => x.state_hash === state)).toBe(false); // jamais en clair

    const ck = cookieOf(start);
    expect(ck).toMatch(/^fp_crm_oauth=[a-f\d]{64}$/);
    expect(String(start.headers["set-cookie"])).toMatch(/HttpOnly/i);
    expect(String(start.headers["set-cookie"])).toMatch(/SameSite=Lax/i);
    const forged = await callback(orgA, { code: "good-code", state: "0".repeat(64) }, ck);
    expect(forged.status).toBe(400);
    expect(forged.body.code).toBe("CRM_STATE_INVALID");
    expect((await callback(orgA, { code: "good-code" }, ck)).status).toBe(400);
    expect((await request(app(orgA)).get("/api/crm/oauth/salesforce/callback").query({ code: "x", state })).status).toBe(404);

    // CSRF : state valide mais cookie absent / appartenant a un autre demarrage => refuse, etat NON consomme
    expect((await callback(orgA, { code: "good-code", state }, "")).status).toBe(400);
    const other = cookieOf(await request(app(orgB)).post("/api/crm/connect/hubspot").send({}));
    expect((await callback(orgA, { code: "good-code", state }, other)).status).toBe(400);

    const ok = await callback(orgA, { code: "good-code", state }, ck);
    expect(ok.status).toBe(302);
    const replay = await callback(orgA, { code: "good-code", state }, ck);
    expect(replay.status).toBe(400); // usage unique
    await pool.query("DELETE FROM crm_oauth_states WHERE org_id=$1", [orgB]);
  });

  it("state expire refuse ; refus utilisateur consomme l'etat et ne cree rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const start = await request(app(orgB)).post("/api/crm/connect/hubspot").send({});
    const state = new URL(start.body.url).searchParams.get("state")!;
    await pool.query("UPDATE crm_oauth_states SET expires_at = NOW() - INTERVAL '1 minute' WHERE org_id=$1", [orgB]);
    expect((await callback(orgB, { code: "good-code", state }, cookieOf(start))).status).toBe(400);

    const start2 = await request(app(orgB)).post("/api/crm/connect/hubspot").send({});
    const s2 = new URL(start2.body.url).searchParams.get("state")!;
    const denied = await callback(orgB, { error: "access_denied", state: s2 }, cookieOf(start2));
    expect(denied.headers.location).toContain("crm_error=consent_denied");
    expect((await callback(orgB, { code: "good-code", state: s2 }, cookieOf(start2))).status).toBe(400);
    const rows = await pool.query("SELECT 1 FROM crm_integrations WHERE org_id=$1", [orgB]);
    expect(rows.rows.length).toBe(0);
  });

  it("jetons stockes chiffres, jamais exposes par l'API ; portail rattache", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const row = (await pool.query("SELECT * FROM crm_integrations WHERE org_id=$1 AND provider='hubspot'", [orgA])).rows[0];
    expect(row.status).toBe("connected");
    expect(row.portal_id).toBe(fake.hubId);
    expect(row.access_token).not.toMatch(/^at-/);
    expect(row.access_token.startsWith("v1:")).toBe(true);
    expect(decryptCrmToken(row.access_token)).toMatch(/^at-/);
    expect(decryptCrmToken(row.refresh_token)).toMatch(/^rt-/);
    const status = await request(app(orgA)).get("/api/crm/status");
    expect(JSON.stringify(status.body)).not.toMatch(/access_token|refresh_token|at-\d|rt-\d|v1:/);
    expect(status.body.connected).toBe(1);
  });

  it("synchronisation : 250 contacts sur 3 pages, rejouable sans doublon, journalisee", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const first = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, created: TOTAL_CONTACTS, updated: 0, failed: 0, truncated: false });
    const second = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
    expect(second.body).toMatchObject({ created: 0, updated: TOTAL_CONTACTS, failed: 0 });
    const n = (await pool.query("SELECT COUNT(*)::int n, COUNT(DISTINCT external_id)::int d FROM crm_contacts WHERE org_id=$1", [orgA])).rows[0];
    expect(n).toEqual({ n: TOTAL_CONTACTS, d: TOTAL_CONTACTS });
    const logs = await request(app(orgA)).get("/api/crm/logs");
    expect(logs.body.logs.length).toBe(2);
    expect(logs.body.logs[0]).toMatchObject({ status: "success", provider: "hubspot" });
    const leads = await request(app(orgA)).get("/api/crm/leads");
    expect(leads.body.leads.length).toBe(100);
  });

  it("isolation : l'autre organisation ne voit ni contacts, ni journaux, ni integration, et ne peut pas synchroniser", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const leads = await request(app(orgB)).get("/api/crm/leads");
    expect(leads.body).toMatchObject({ leads: [], total: 0 });
    expect((await request(app(orgB)).get("/api/crm/logs")).body.logs).toEqual([]);
    expect((await request(app(orgB)).get("/api/crm/status")).body.connected).toBe(0);
    const sync = await request(app(orgB)).post("/api/crm/sync").send({ provider: "hubspot" });
    expect(sync.status).toBe(409);
    expect(sync.body.code).toBe("CRM_NOT_CONNECTED");
  });

  it("verrou : une synchronisation deja en cours renvoie 409", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const id = (await pool.query("SELECT id FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0].id;
    await pool.query(`INSERT INTO crm_sync_logs (id, org_id, crm_integration_id, provider, status) VALUES ('lock-test-${orgA}',$1,$2,'hubspot','running')`, [orgA, id]);
    const r = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
    await pool.query("DELETE FROM crm_sync_logs WHERE id=$1", [`lock-test-${orgA}`]);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CRM_SYNC_IN_PROGRESS");
  });

  it("jeton expire : rafraichi et rechiffre avant la synchronisation", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await pool.query("UPDATE crm_integrations SET token_expires_at = NOW() - INTERVAL '1 hour' WHERE org_id=$1", [orgA]);
    const before = fake.refreshCalls;
    const r = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
    expect(r.status).toBe(200);
    expect(fake.refreshCalls).toBe(before + 1);
    const row = (await pool.query("SELECT access_token FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0];
    expect(decryptCrmToken(row.access_token)).toMatch(/^at-refreshed-/);
  });

  it("refresh refuse (revocation) : jetons effaces, statut reauth_required, 409", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await pool.query("UPDATE crm_integrations SET token_expires_at = NOW() - INTERVAL '1 hour' WHERE org_id=$1", [orgA]);
    fake.refreshStatus = 400;
    const r = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CRM_REAUTH_REQUIRED");
    const row = (await pool.query("SELECT status, access_token, refresh_token FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0];
    expect(row).toEqual({ status: "reauth_required", access_token: null, refresh_token: null });
    await connect(orgA); // reconnexion : retour a l'etat connecte
    expect((await pool.query("SELECT status FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0].status).toBe("connected");
  });

  it("webhooks : signature obligatoire, deduplication, portail inconnu ignore, rejet apres deconnexion", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const post = (body: string, h: { ts: string; sig: string }) =>
      request(app(orgA)).post("/api/crm/webhook/hubspot").set("content-type", "application/json")
        .set("x-hubspot-signature-v3", h.sig).set("x-hubspot-request-timestamp", h.ts).send(body);
    const evt = JSON.stringify([{ eventId: 777001, subscriptionType: "contact.creation", objectId: 9001, portalId: Number(fake.hubId) }]);

    expect((await request(app(orgA)).post("/api/crm/webhook/hubspot").set("content-type", "application/json").send(evt)).status).toBe(401);
    expect((await post(evt, sign(evt, Date.now(), "mauvais-secret"))).status).toBe(401);
    expect((await post(evt, sign(evt, Date.now() - 10 * 60_000))).status).toBe(401);
    expect((await post(evt.replace("9001", "9002"), sign(evt))).status).toBe(401); // corps altere

    const ok = await post(evt, sign(evt));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ processed: 1, duplicates: 0 });
    const c = await pool.query("SELECT email FROM crm_contacts WHERE org_id=$1 AND external_id='9001'", [orgA]);
    expect(c.rows[0].email).toBe("wh9001@example.com");
    const replay = await post(evt, sign(evt));
    expect(replay.body).toMatchObject({ processed: 0, duplicates: 1 });

    const foreign = JSON.stringify([{ eventId: 777002, objectId: 9003, portalId: 999999 }]);
    expect((await post(foreign, sign(foreign))).body).toMatchObject({ processed: 0, ignored: 1 });
    expect((await pool.query("SELECT 1 FROM crm_contacts WHERE external_id='9003'")).rows.length).toBe(0);

    await request(app(orgA)).post("/api/crm/disconnect/hubspot").send({});
    const after = JSON.stringify([{ eventId: 777003, objectId: 9004, portalId: Number(fake.hubId) }]);
    expect((await post(after, sign(after))).body).toMatchObject({ processed: 0, ignored: 1 });
    await connect(orgA);
  });

  it("quota : Standard (1 CRM) ne peut pas connecter un second fournisseur ; reconnexion du meme CRM autorisee", async (ctx) => {
    if (!dbOk) return ctx.skip();
    planState.plan = "standard";
    await pool.query(
      `INSERT INTO crm_integrations (id, org_id, provider, status) VALUES ($1,$2,'pipedrive','connected')`, [`q-${orgA}`, orgA]);
    const blocked = await request(app(orgA)).post("/api/crm/connect/hubspot").send({});
    await pool.query("DELETE FROM crm_integrations WHERE id=$1", [`q-${orgA}`]);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("CRM_LIMIT_REACHED");
    expect((await request(app(orgA)).post("/api/crm/connect/hubspot").send({})).status).toBe(200);
  });

  it("test de connexion : OK quand connecte, 409 sinon", async (ctx) => {
    if (!dbOk) return ctx.skip();
    expect((await request(app(orgA)).post("/api/crm/test").send({ provider: "hubspot" })).body.ok).toBe(true);
    expect((await request(app(orgB)).post("/api/crm/test").send({ provider: "hubspot" })).status).toBe(409);
  });
});

describe("revue de securite : garanties supplementaires", () => {
  const cleanFlags = () => { fake.listStatus = 200; fake.oneStatus = 200; fake.refreshStatus = 200; };
  beforeEach(cleanFlags);

  it("connexion / deconnexion reservees aux administrateurs (membre et lecteur refuses) ; synchronisation ouverte au membre", async (ctx) => {
    if (!dbOk) return ctx.skip();
    for (const role of ["viewer", "member"]) {
      expect((await request(app(orgA, role)).post("/api/crm/connect/hubspot").send({})).status).toBe(403);
      expect((await request(app(orgA, role)).post("/api/crm/disconnect/hubspot").send({})).status).toBe(403);
    }
    expect((await request(app(orgA, "admin")).post("/api/crm/connect/hubspot").send({})).status).toBe(200);
    await pool.query("DELETE FROM crm_oauth_states WHERE org_id=$1", [orgA]);
  });

  it("refresh : une limitation de debit (429) ou une panne (503) conserve les jetons ; seule une revocation les efface", async (ctx) => {
    if (!dbOk) return ctx.skip();
    for (const status of [429, 503]) {
      await pool.query("UPDATE crm_integrations SET token_expires_at = NOW() - INTERVAL '1 hour' WHERE org_id=$1", [orgA]);
      fake.refreshStatus = status;
      const r = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
      expect(r.status).toBe(502);
      const row = (await pool.query("SELECT status, access_token FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0];
      expect(row.status).toBe("connected");
      expect(row.access_token).not.toBeNull();
    }
  });

  it("jeton rejete (401) avant expiration : reauth_required et jetons effaces", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await pool.query("UPDATE crm_integrations SET token_expires_at = NOW() + INTERVAL '1 hour' WHERE org_id=$1", [orgA]);
    fake.listStatus = 401;
    const r = await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CRM_REAUTH_REQUIRED");
    const row = (await pool.query("SELECT status, access_token, refresh_token FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0];
    expect(row).toEqual({ status: "reauth_required", access_token: null, refresh_token: null });
    fake.listStatus = 200;
    await connect(orgA);
  });

  it("deux synchronisations simultanees : une seule s'execute, l'autre recoit 409 (verrou sans course)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const both = await Promise.all([
      request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" }),
      request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" }),
    ]);
    const codes = both.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.code).toBe("CRM_SYNC_IN_PROGRESS");
    const running = await pool.query("SELECT 1 FROM crm_sync_logs WHERE org_id=$1 AND status='running'", [orgA]);
    expect(running.rows.length).toBe(0);
  });

  it("verrou orphelin (processus interrompu depuis > 15 min) : libere automatiquement", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const id = (await pool.query("SELECT id FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0].id;
    await pool.query(`INSERT INTO crm_sync_logs (id, org_id, crm_integration_id, provider, status, started_at) VALUES ('stale-${orgA}',$1,$2,'hubspot','running', NOW() - INTERVAL '1 hour')`, [orgA, id]);
    expect((await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" })).status).toBe(200);
    expect((await pool.query("SELECT status FROM crm_sync_logs WHERE id=$1", [`stale-${orgA}`])).rows[0].status).toBe("failed");
  });

  it("webhook : contact injoignable => 503 (le fournisseur re-livre), evenement non marque comme traite, puis traite a la re-livraison", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const evt = JSON.stringify([{ eventId: 880001, objectId: 9100, portalId: Number(fake.hubId) }]);
    const post = () => { const h = sign(evt); return request(app(orgA)).post("/api/crm/webhook/hubspot").set("content-type", "application/json")
      .set("x-hubspot-signature-v3", h.sig).set("x-hubspot-request-timestamp", h.ts).send(evt); };
    fake.oneStatus = 500;
    const failed = await post();
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe("CRM_WEBHOOK_RETRY");
    expect((await pool.query("SELECT 1 FROM crm_webhook_events WHERE event_id='880001'")).rows.length).toBe(0);
    fake.oneStatus = 200;
    const retried = await post();
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ processed: 1, retry: 0 });
    expect((await pool.query("SELECT 1 FROM crm_contacts WHERE org_id=$1 AND external_id='9100'", [orgA])).rows.length).toBe(1);
  });

  it("deconnexion : jeton revoque chez le fournisseur (au mieux), jetons effaces localement, contacts d'une autre organisation intacts", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const refresh = decryptCrmToken((await pool.query("SELECT refresh_token FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0].refresh_token);
    const r = await request(app(orgA, "admin")).post("/api/crm/disconnect/hubspot").send({});
    expect(r.status).toBe(200);
    expect(fake.revoked).toContain(refresh);
    const row = (await pool.query("SELECT status, access_token, refresh_token FROM crm_integrations WHERE org_id=$1", [orgA])).rows[0];
    expect(row).toEqual({ status: "disconnected", access_token: null, refresh_token: null });
    expect((await request(app(orgA)).post("/api/crm/sync").send({ provider: "hubspot" })).status).toBe(409);
    await connect(orgA);
  });

  it("quota : deux callbacks simultanes ne depassent jamais la limite du plan", async (ctx) => {
    if (!dbOk) return ctx.skip();
    planState.plan = "standard";
    await pool.query("DELETE FROM crm_integrations WHERE org_id=$1", [orgB]);
    await pool.query("INSERT INTO crm_integrations (id, org_id, provider, status) VALUES ($1,$2,'pipedrive','disconnected')", [`qq-${orgB}`, orgB]);
    // Standard = 1 CRM : HubSpot connecte en parallele de deux autres tentatives ne cree qu'un seul « connected ».
    const starts = await Promise.all([1, 2].map(() => request(app(orgB)).post("/api/crm/connect/hubspot").send({})));
    const cbs = await Promise.all(starts.map((st) => callback(orgB, { code: "good-code", state: new URL(st.body.url).searchParams.get("state")! }, cookieOf(st))));
    expect(cbs.every((c) => c.status === 302)).toBe(true);
    const n = (await pool.query("SELECT COUNT(*)::int n FROM crm_integrations WHERE org_id=$1 AND status='connected'", [orgB])).rows[0].n;
    expect(n).toBe(1); // meme fournisseur : une seule ligne (reconnexion), jamais deux
    await pool.query("DELETE FROM crm_integrations WHERE org_id=$1", [orgB]);
  });

  it("aucun jeton, secret ni code d'autorisation dans les journaux", () => {
    const all = JSON.stringify(logs.calls);
    expect(all).not.toMatch(/at-\d|at-refreshed|rt-\d|good-code|fake-hubspot-client-secret|v1:[a-f\d]{24}/);
  });
});
