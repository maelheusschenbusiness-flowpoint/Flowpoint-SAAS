/**
 * read-only-access-db.test.ts — matrice HTTP statuts x temps du mode lecture seule.
 *
 * Vrai serveur Express + vrai middleware `requirePaidAccess` + vraies gardes
 * planGate, PostgreSQL local jetable, Stripe absent (aucun appel). Horloge
 * simulee (Date seule, aucun sleep reel).
 *
 * Regle : annulation echue / past_due hors grace → GET autorise, toute ecriture
 * 402 SUBSCRIPTION_READ_ONLY ; facturation (portail, reactivation, souscription),
 * connexion, profil et exports de ses propres donnees (GET) restent possibles.
 * Sans abonnement paye (pending_billing, incomplete, essai expire...) → 402
 * SUBSCRIPTION_REQUIRED, comme avant.
 */
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import { requirePaidAccess } from "./requirePaidAccess.js";
import { requirePlan } from "./planGate.js";

const ORG = randomUUID();
const DAY = 86_400_000;
const NOW = new Date("2026-11-08T12:00:00.000Z");
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
let dbUp = false;

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as unknown as { orgId: string }).orgId = ORG; next(); });
  a.use("/api", requirePaidAccess);
  const ok = (_q: express.Request, r: express.Response) => { r.json({ ok: true }); };
  // Routes metier (non exemptees)
  a.get("/api/audits", ok); a.post("/api/audits", ok); a.delete("/api/audits/1", ok);
  a.get("/api/reports/export", ok);                      // export de SES donnees (GET)
  a.post("/api/ai/generate", ok);                        // generation couteuse
  a.get("/api/ai/summary", ok);
  a.post("/api/gated", requirePlan("pro"), ok);          // garde planGate sous prefixe non exempte
  a.get("/api/gated", requirePlan("pro"), ok);
  // Prefixes exemptes du blocage total
  a.post("/api/ai-credits/consume", ok);                 // consommation de credits
  a.post("/api/addons/whiteLabel/activate", ok);
  a.patch("/api/org", ok); a.patch("/api/me/settings", ok);
  a.get("/api/org", ok); a.get("/api/me", ok); a.get("/api/ai-credits", ok);
  // Regularisation / compte
  a.post("/api/billing/portal", ok); a.post("/api/billing/reactivate", ok); a.get("/api/billing/subscription", ok);
  a.post("/api/plans/checkout", ok); a.post("/api/auth/logout", ok);
  a.patch("/api/me", ok); a.patch("/api/me/prefs", ok);
  a.delete("/api/settings/data", ok);
  return a;
}

async function setOrg(o: {
  status: string | null; sub?: string | null; periodEnd?: string | null; since?: string | null;
  cape?: boolean; trialEnds?: string | null; consumed?: boolean;
}) {
  await pool.query(
    `UPDATE organizations SET subscription_status=$2, stripe_subscription_id=$3, stripe_customer_id='cus_ro',
            current_period_end=$4, past_due_since=$5, cancel_at_period_end=$6, trial_ends_at=$7,
            trial_consumed_at = CASE WHEN $8::boolean THEN NOW() - INTERVAL '60 days' ELSE NULL END
      WHERE id=$1::uuid`,
    [ORG, o.status, o.sub === undefined ? "sub_ro" : o.sub, o.periodEnd ?? null, o.since ?? null,
     o.cape ?? false, o.trialEnds ?? null, o.consumed ?? true]);
}

beforeAll(async () => {
  try {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ($1,'RO Org',$2,'u','active','pro',$3) ON CONFLICT (id) DO NOTHING`,
      [ORG, `ro-${Date.now()}`, `ro-${Date.now()}@example.test`]);
    dbUp = true;
  } catch { dbUp = false; }
});
afterAll(async () => {
  vi.useRealTimers();
  if (dbUp) await pool.query(`DELETE FROM organizations WHERE id=$1::uuid`, [ORG]);
});
afterEach(() => { vi.useRealTimers(); });

function clock(d: Date = NOW) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(d); }

type Call = [method: "get" | "post" | "patch" | "delete", path: string];
const BLOCKED_WRITES: Call[] = [
  ["post", "/api/audits"], ["delete", "/api/audits/1"], ["post", "/api/ai/generate"],
  ["post", "/api/gated"], ["post", "/api/ai-credits/consume"], ["post", "/api/addons/whiteLabel/activate"],
  ["patch", "/api/org"], ["patch", "/api/me/settings"],
];
const ALLOWED_READS: Call[] = [
  ["get", "/api/audits"], ["get", "/api/reports/export"], ["get", "/api/ai/summary"], ["get", "/api/gated"],
  ["get", "/api/org"], ["get", "/api/me"], ["get", "/api/ai-credits"], ["get", "/api/billing/subscription"],
];
const ALLOWED_WRITES: Call[] = [
  ["post", "/api/billing/portal"], ["post", "/api/billing/reactivate"], ["post", "/api/plans/checkout"],
  ["post", "/api/auth/logout"], ["patch", "/api/me"], ["patch", "/api/me/prefs"], ["delete", "/api/settings/data"],
];

async function expectFull() {
  for (const [m, p] of [...BLOCKED_WRITES, ...ALLOWED_READS, ...ALLOWED_WRITES]) {
    const r = await request(app())[m](p);
    expect(r.status, `${m} ${p}`).toBe(200);
  }
}
async function expectReadOnly() {
  for (const [m, p] of ALLOWED_READS) {
    const r = await request(app())[m](p);
    expect(r.status, `${m} ${p}`).toBe(200);
  }
  for (const [m, p] of ALLOWED_WRITES) {
    const r = await request(app())[m](p);
    expect(r.status, `${m} ${p}`).toBe(200);
  }
  for (const [m, p] of BLOCKED_WRITES) {
    const r = await request(app())[m](p);
    expect(r.status, `${m} ${p}`).toBe(402);
    expect(r.body.code, `${m} ${p}`).toBe("SUBSCRIPTION_READ_ONLY");
    expect(r.body.readOnly).toBe(true);
    expect(r.body.billingUrl).toBeTruthy();
    expect(r.body.recovery).toBeTruthy();
  }
}
async function expectBlocked() {
  for (const [m, p] of [["get", "/api/audits"], ["post", "/api/audits"], ["get", "/api/ai/summary"]] as Call[]) {
    const r = await request(app())[m](p);
    expect(r.status, `${m} ${p}`).toBe(402);
    expect(r.body.code).toBe("SUBSCRIPTION_REQUIRED");
  }
  // La regularisation reste toujours ouverte.
  for (const [m, p] of ALLOWED_WRITES) expect((await request(app())[m](p)).status, `${m} ${p}`).toBe(200);
}

describe("mode lecture seule — middlewares HTTP", () => {
  it("active : tout passe", async () => {
    if (!dbUp) return;
    clock(); await setOrg({ status: "active", periodEnd: iso(20) });
    await expectFull();
  });

  it("active + cancel_at_period_end=true : acces normal jusqu'a la fin", async () => {
    if (!dbUp) return;
    clock(); await setOrg({ status: "active", periodEnd: iso(2), cape: true });
    await expectFull();
    clock(new Date(NOW.getTime() + 2 * DAY + 1000));           // fin depassee, webhook pas encore recu
    await expectReadOnly();
  });

  it("canceled : acces complet avant current_period_end, lecture seule apres", async () => {
    if (!dbUp) return;
    await setOrg({ status: "canceled", periodEnd: iso(5) });
    clock(NOW); await expectFull();
    clock(new Date(NOW.getTime() + 5 * DAY - 1000)); await expectFull();
    clock(new Date(NOW.getTime() + 5 * DAY + 1000)); await expectReadOnly();
    clock(new Date(NOW.getTime() + 400 * DAY)); await expectReadOnly();   // aucune suppression, aucune expiration
  });

  it("canceled sans date de periode : lecture seule", async () => {
    if (!dbUp) return;
    clock(); await setOrg({ status: "canceled", periodEnd: null });
    await expectReadOnly();
  });

  it("past_due : grace de 3 jours depuis past_due_since, puis lecture seule", async () => {
    if (!dbUp) return;
    await setOrg({ status: "past_due", periodEnd: iso(25), since: iso(0) });
    clock(NOW); await expectFull();
    clock(new Date(NOW.getTime() + 3 * DAY - 1000)); await expectFull();
    clock(new Date(NOW.getTime() + 3 * DAY + 1000)); await expectReadOnly();
  });

  it("past_due : PAST_DUE_GRACE_DAYS configurable (0, 7, invalide → 3)", async () => {
    if (!dbUp) return;
    const saved = process.env["PAST_DUE_GRACE_DAYS"];
    try {
      await setOrg({ status: "past_due", periodEnd: iso(25), since: iso(0) });
      process.env["PAST_DUE_GRACE_DAYS"] = "0";
      clock(new Date(NOW.getTime() + 1000)); await expectReadOnly();
      process.env["PAST_DUE_GRACE_DAYS"] = "7";
      clock(new Date(NOW.getTime() + 6 * DAY)); await expectFull();
      clock(new Date(NOW.getTime() + 8 * DAY)); await expectReadOnly();
      process.env["PAST_DUE_GRACE_DAYS"] = "pas-un-nombre";
      clock(new Date(NOW.getTime() + 2 * DAY)); await expectFull();
      clock(new Date(NOW.getTime() + 4 * DAY)); await expectReadOnly();
    } finally {
      if (saved === undefined) delete process.env["PAST_DUE_GRACE_DAYS"]; else process.env["PAST_DUE_GRACE_DAYS"] = saved;
    }
  });

  it("past_due sans past_due_since (organisation anterieure a la regle) : pas de bascule brutale", async () => {
    if (!dbUp) return;
    await setOrg({ status: "past_due", periodEnd: iso(-30), since: null });
    vi.useRealTimers();                                        // ancre = demarrage du processus : maintenant
    await expectFull();
  });

  it.each(["unpaid", "paused"])("%s : lecture seule", async (status) => {
    if (!dbUp) return;
    clock(); await setOrg({ status, periodEnd: iso(10) });
    await expectReadOnly();
  });

  it.each([
    ["pending_billing", { status: "pending_billing", sub: null, consumed: false }],
    ["incomplete", { status: "incomplete", sub: null }],
    ["essai expire sans abonnement", { status: "trialing", sub: null, trialEnds: iso(-2) }],
    ["expired (statut inconnu)", { status: "expired", sub: null }],
    ["statut nul", { status: null, sub: null, consumed: false }],
  ])("%s : blocage total (402 SUBSCRIPTION_REQUIRED)", async (_n, st) => {
    if (!dbUp) return;
    clock(); await setOrg(st as Parameters<typeof setOrg>[0]);
    await expectBlocked();
  });

  it("l'en-tete X-FP-Access-Mode: read_only accompagne les lectures en lecture seule", async () => {
    if (!dbUp) return;
    clock(); await setOrg({ status: "canceled", periodEnd: iso(-1) });
    const r = await request(app()).get("/api/audits");
    expect(r.status).toBe(200);
    expect(r.headers["x-fp-access-mode"]).toBe("read_only");
    const w = await request(app()).post("/api/audits");
    expect(w.headers["x-fp-access-mode"]).toBe("read_only");
    await setOrg({ status: "active", periodEnd: iso(20) });
    expect((await request(app()).get("/api/audits")).headers["x-fp-access-mode"]).toBeUndefined();
  });

  it("le 402 en lecture seule porte le statut, la raison et la fin de grace", async () => {
    if (!dbUp) return;
    clock(); await setOrg({ status: "past_due", periodEnd: iso(25), since: iso(-4) });
    const w = await request(app()).post("/api/audits");
    expect(w.status).toBe(402);
    expect(w.body).toMatchObject({
      code: "SUBSCRIPTION_READ_ONLY", accessMode: "read_only", accessReason: "past_due_grace_expired",
      subscriptionStatus: "past_due",
    });
    expect(w.body.graceEndsAt).toBe(iso(-1));
  });

  it("reactivation : retour a active → acces complet immediat", async () => {
    if (!dbUp) return;
    clock(); await setOrg({ status: "canceled", periodEnd: iso(-3) });
    await expectReadOnly();
    await setOrg({ status: "active", periodEnd: iso(30) });
    await expectFull();
  });
});
