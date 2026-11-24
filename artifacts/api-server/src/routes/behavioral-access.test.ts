/**
 * Droits d'acces Behavioral AI : generation du jeton (snippet) reservee aux roles d'ecriture
 * ET a l'entitlement ; ingestion publique verifiant l'entitlement de l'organisation du jeton
 * a chaque appel ; statut lisible mais coherent. Fait des vraies routes, planGate/requireRole
 * remplaces par des doubles pilotables, nonces dans un faux magasin partage.
 */
import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  entitlement: "granted" as "granted" | "denied" | "unavailable",
  role: "owner",
  nonces: new Set<string>(),
  tokenRow: [] as Array<{ siteUrl: string; orgId: string }>,
  dbFail: false,
}));

vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "from", "where", "orderBy"]) c[m] = () => c;
    c["limit"] = async () => st.tokenRow;
    return c;
  };
  return {
    db: { select: chain },
    behaviorSiteTokensTable: {}, behaviorEventsTable: {}, croExperimentsTable: {},
    pool: {
      query: async (sql: string, v: unknown[] = []) => {
        if (st.dbFail) throw new Error("down");
        if (/INSERT INTO behavior_nonces/.test(sql)) {
          const k = `${v[0]}|${v[1]}`;
          if (st.nonces.has(k)) return { rowCount: 0, rows: [] };
          st.nonces.add(k); return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
    },
  };
});
vi.mock("../middlewares/rateLimiter.js", () => ({ behavioralRateLimit: () => (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (st.entitlement === "granted") next();
    else res.status(402).json({ code: "ADDON_REQUIRED", addonKey: "behavioralAI" });
  },
  resolveOrgAddonEntitlement: async () => st.entitlement,
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (["owner", "admin", "member"].includes(st.role)) next(); else res.status(403).json({ error: "Forbidden" });
  },
}));
const track = vi.hoisted(() => ({ trackBehaviorEvent: vi.fn(), upsertSession: vi.fn() }));
vi.mock("../services/behavioral-service.js", () => ({
  trackBehaviorEvent: track.trackBehaviorEvent, upsertSession: track.upsertSession,
  generateBehaviorInsights: vi.fn(), getBehaviorInsights: vi.fn(), analyzeBehaviorFunnel: vi.fn(), ALLOWED_BEHAVIOR_FUNNEL_EVENTS: new Set(),
}));

import router, { publicBehavioralRouter } from "./behavioral.js";
import { issueSessionToken } from "../services/behavioral-session-auth.js";

const SITE = "https://shop.example.test";
const hdr = { Origin: SITE, "Sec-Fetch-Site": "cross-site" };
let n = 0;
const nonce = () => `acc-${Date.now()}-${n++}`;
const orgDbCalls: string[] = [];

function app() {
  const a = express();
  a.use(express.json());
  a.use(publicBehavioralRouter);
  a.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: async (sql: string) => { orgDbCalls.push(sql); return { rows: [] }; } });
    next();
  });
  a.use(router);
  return a;
}

beforeEach(() => {
  st.entitlement = "granted"; st.role = "owner"; st.nonces.clear(); st.tokenRow = []; st.dbFail = false;
  orgDbCalls.length = 0; track.trackBehaviorEvent.mockReset().mockResolvedValue(true); track.upsertSession.mockReset().mockResolvedValue(true);
});

describe("generation du jeton (GET /behavioral/snippet)", () => {
  it("sans add-on : 402 ADDON_REQUIRED, aucun jeton ecrit ni origine CORS ajoutee", async () => {
    st.entitlement = "denied";
    const r = await request(app()).get("/behavioral/snippet").query({ siteUrl: SITE });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("ADDON_REQUIRED");
    expect(orgDbCalls).toEqual([]);
  });
  it("role lecture seule (viewer) : 403 meme avec l'add-on", async () => {
    st.role = "viewer";
    const r = await request(app()).get("/behavioral/snippet").query({ siteUrl: SITE });
    expect(r.status).toBe(403);
    expect(orgDbCalls).toEqual([]);
  });
  it("add-on actif + role d'ecriture : 200 et jeton enregistre", async () => {
    const r = await request(app()).get("/behavioral/snippet").query({ siteUrl: SITE });
    expect(r.status).toBe(200);
    expect(orgDbCalls.some(q => /INSERT INTO behavior_site_tokens/.test(q))).toBe(true);
  });
});

describe("ingestion publique : entitlement verifie a chaque appel", () => {
  function signedExchange(plain = "t".repeat(64)) {
    const ts = Date.now(), nn = nonce();
    const sig = createHmac("sha256", plain).update(`${SITE}|${SITE}|${ts}|${nn}`).digest("hex");
    return { siteKey: SITE, siteToken: plain, ts, nonce: nn, sig };
  }
  // lookupSiteToken compare le hash : on renvoie une ligne quelconque pour ce site.
  const registered = () => { st.tokenRow = [{ siteUrl: SITE, orgId: "org-a" }]; };

  it("echange de jeton : add-on perdu -> 403 BEHAVIORAL_INACTIVE generique, aucun jeton emis", async () => {
    registered(); st.entitlement = "denied";
    const r = await request(app()).post("/behavioral/token").set(hdr).send(signedExchange());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("BEHAVIORAL_INACTIVE");
    expect(r.body.sessionToken).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/plan|standard|pro|ultra|stripe|org-a/i);
  });
  it("echange de jeton : entitlement indisponible -> 503 ; accorde -> 200", async () => {
    registered(); st.entitlement = "unavailable";
    expect((await request(app()).post("/behavioral/token").set(hdr).send(signedExchange())).status).toBe(503);
    st.entitlement = "granted";
    const ok = await request(app()).post("/behavioral/token").set(hdr).send(signedExchange());
    expect(ok.status).toBe(200);
    expect(typeof ok.body.sessionToken).toBe("string");
  });

  const body = (tok: string, extra: Record<string, unknown> = {}) => ({
    sessionId: "s1", siteUrl: SITE, page: "/", eventType: "click", sessionToken: tok, ts: Date.now(), nonce: nonce(), ...extra,
  });

  it("evenement / session / assignation : jeton de session valide mais add-on revoque -> 403, rien n'est ecrit", async () => {
    const { token } = issueSessionToken(SITE, SITE, "org-a");
    st.entitlement = "denied";
    const ev = await request(app()).post("/behavioral/event").set(hdr).send(body(token));
    const se = await request(app()).post("/behavioral/session").set(hdr).send({ ...body(token), id: "s1" });
    const as = await request(app()).post("/behavioral/experiments/assign").set(hdr).send(body(token));
    for (const r of [ev, se, as]) { expect(r.status).toBe(403); expect(r.body.code).toBe("BEHAVIORAL_INACTIVE"); }
    expect(track.trackBehaviorEvent).not.toHaveBeenCalled();
    expect(track.upsertSession).not.toHaveBeenCalled();
    // Le refus d'entitlement ne consomme pas de nonce (pas de pollution de la table).
    expect(st.nonces.size).toBe(0);
  });
  it("evenement avec add-on actif : 201 ; jeton fabrique pour une autre org : refuse", async () => {
    const { token } = issueSessionToken(SITE, SITE, "org-a");
    expect((await request(app()).post("/behavioral/event").set(hdr).send(body(token))).status).toBe(201);
    expect(track.trackBehaviorEvent).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a" }));
    expect((await request(app()).post("/behavioral/event").set(hdr).send(body(token + "x"))).status).toBe(403);
  });
  it("nonce rejoue -> 403 ; base indisponible -> 503 (jamais d'acceptation par defaut)", async () => {
    const { token } = issueSessionToken(SITE, SITE, "org-a");
    const fixed = nonce();
    expect((await request(app()).post("/behavioral/event").set(hdr).send(body(token, { nonce: fixed }))).status).toBe(201);
    expect((await request(app()).post("/behavioral/event").set(hdr).send(body(token, { nonce: fixed }))).status).toBe(403);
    st.dbFail = true;
    const r = await request(app()).post("/behavioral/event").set(hdr).send(body(token));
    expect(r.status).toBe(503);
    expect(track.trackBehaviorEvent).toHaveBeenCalledTimes(1);
  });
});

describe("GET /behavioral/status", () => {
  it("lisible sans add-on, mais indique que la collecte est suspendue", async () => {
    st.entitlement = "denied";
    const a = express(); a.use((req, _r, nx) => {
      Object.assign(req, { orgId: "org-a", orgDb: async (sql: string) => ({ rows: /COUNT/.test(sql) ? [{ total: "3", last_event: null }] : [{ org_id: "org-a" }] }) }); nx();
    }); a.use(router);
    const r = await request(a).get("/behavioral/status").query({ siteUrl: SITE });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "addon_inactive", entitled: false, ingesting: false, totalEvents: 3 });
  });
  it("avec add-on : statut actif et ingesting=true", async () => {
    const a = express(); a.use((req, _r, nx) => {
      Object.assign(req, { orgId: "org-a", orgDb: async (sql: string) => ({ rows: /COUNT/.test(sql) ? [{ total: "3", last_event: null }] : [{ org_id: "org-a" }] }) }); nx();
    }); a.use(router);
    const r = await request(a).get("/behavioral/status").query({ siteUrl: SITE });
    expect(r.body).toMatchObject({ status: "active", entitled: true, ingesting: true });
  });
});
