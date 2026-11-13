/**
 * Tableaux de bord de conversion sur une vraie base : definitions, doublons,
 * consentement, visiteurs de test, vue outbound. Se saute sans base.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
import { pool } from "@workspace/db";
import { enregistrerEtape } from "./funnel-events.js";
import { globalConversion, outboundConversion, poolQuery, parseWindow } from "./conversion-dashboards.js";
import { queueConversionEvent } from "../lib/conversion-outbox.js";

const W = parseWindow("2001-03-01", "2001-03-02")!; // fenetre dans le passe : aucune autre donnee
const AT = "2001-03-01T12:00:00Z";
let ok = false;
const v = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

async function ev(etape: string, visiteur: string | null, source: string | null, cle: string | null) {
  await pool.query(
    `INSERT INTO funnel_events (etape, visiteur_id, source, cle_idempotence, created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (cle_idempotence) WHERE cle_idempotence IS NOT NULL DO NOTHING`, [etape, visiteur, source, cle, AT]);
}

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
    await enregistrerEtape({ etape: "landing_vue", visiteurId: "fp-test-bootstrap-x", cleIdempotence: "dash-boot" }); // cree la table
    await pool.query("DELETE FROM funnel_events WHERE created_at < '2002-01-01'");
    // Visiteurs consentants (navigateur)
    await ev("tarifs_vus", v(1), "google", "dash:t1");
    await ev("tarifs_vus", v(2), "smartlead", "dash:t2");
    await ev("tarifs_vus", v(2), "smartlead", "dash:t2"); // rejeu : meme cle -> un seul evenement
    await ev("tarifs_vus", v(3), "smartlead", null);
    await ev("tarifs_vus", v(3), "smartlead", null);       // sans cle : deux lignes, un seul visiteur
    await ev("tarifs_vus", "fp-test-abc-123", "smartlead", "dash:test"); // visiteur de test : exclu
    await ev("cta_clique", v(2), "smartlead", "dash:c2");
    await ev("cta_clique", v(1), "google", "dash:c1");
    await ev("signup_started", v(2), "smartlead", "dash:s2");
    await ev("signup_started", v(1), "google", "dash:s1");
    // Serveur : couvre aussi les non-consentants (sans visiteur)
    await ev("signup_form_completed", v(1), "google", "dash:f1");
    await ev("signup_form_completed", v(2), "smartlead", "dash:f2");
    await ev("checkout_started", v(1), "google", "dash:k1");
    await ev("trial_activated", v(2), "smartlead", "trial_activated:sub_a");
    await ev("trial_activated", null, null, "trial_activated:sub_b");
    await ev("subscription_activated", v(2), "smartlead", "subscription_activated:sub_a");
    ok = true;
  } catch { ok = false; }
}, 120_000);
afterAll(async () => { if (ok) await pool.query("DELETE FROM funnel_events WHERE created_at < '2002-01-01'"); });

describe("conversion globale (SQL réel)", () => {
  it("compte des événements distincts et des visiteurs distincts, sans visiteurs de test", async (ctx) => {
    if (!ok) return ctx.skip();
    const g = await globalConversion(poolQuery, W.from, W.to);
    const s = Object.fromEntries(g.stages.map(x => [x.key, x]));
    expect(s["tarifs_vus"]).toMatchObject({ events: 4, uniqueVisitors: 3 }); // v1, v2 (x1), v3 (x2) ; test exclu ; rejeu dédoublonné
    expect(s["cta_clique"]).toMatchObject({ events: 2, uniqueVisitors: 2 });
    expect(s["signup_form_completed"]).toMatchObject({ events: 2, uniqueVisitors: 2 }); // enregistrée seulement avec consentement
    expect(s["checkout_started"]).toMatchObject({ events: 1, uniqueVisitors: 1 });
    expect(s["trial_activated"]).toMatchObject({ events: 2, uniqueVisitors: 1 });         // essai sans consentement : compté, visiteur non identifié (null côté visiteurs, pas 0)
    expect(s["landing_vue"]).toMatchObject({ events: 0, uniqueVisitors: null });
    expect(g.measurableVisitors).toBe(3);
    expect(s["trial_activated"]!.coverage).toBe("all");
    expect(s["signup_form_completed"]!.coverage).toBe("consented");
  });
  it("calcule un taux seulement entre étapes de même couverture", async (ctx) => {
    if (!ok) return ctx.skip();
    const g = await globalConversion(poolQuery, W.from, W.to);
    const r = Object.fromEntries(g.rates.map(x => [`${x.from}>${x.to}`, x]));
    expect(r["tarifs_vus>cta_clique"]).toEqual({ from: "tarifs_vus", to: "cta_clique", ratio: 0.5, reason: "ok" });
    expect(r["signup_started>signup_form_completed"]).toMatchObject({ ratio: 1, reason: "ok" });             // consenti -> consenti
    expect(r["signup_form_completed>checkout_started"]).toMatchObject({ ratio: 0.5, reason: "ok" });
    expect(r["checkout_started>trial_activated"]).toMatchObject({ ratio: null, reason: "mixed_coverage" }); // consenti -> tous : jamais de taux
    expect(r["trial_activated>subscription_activated"]).toMatchObject({ ratio: 0.5, reason: "ok" });
  });
  it("une fenêtre sans donnée renvoie des zéros d'événements et des null, jamais d'invention", async (ctx) => {
    if (!ok) return ctx.skip();
    const w = parseWindow("2001-04-01", "2001-04-02")!;
    const g = await globalConversion(poolQuery, w.from, w.to);
    expect(g.measurableVisitors).toBe(0);
    expect(g.stages.every(x => x.events === 0 && x.uniqueVisitors === null)).toBe(true);
    expect(g.rates.every(x => x.ratio === null)).toBe(true);
  });
});

describe("conversion outbound (SQL réel)", () => {
  it("ne retient que la source Smartlead, essais et paiements confirmés compris", async (ctx) => {
    if (!ok) return ctx.skip();
    const o = await outboundConversion(poolQuery, W.from, W.to);
    const s = Object.fromEntries(o.stages.map(x => [x.key, x]));
    expect(o.source).toBe("smartlead");
    expect(s["tarifs_vus"]).toMatchObject({ events: 3, uniqueVisitors: 2 }); // v2, v3 ; v1 (google) et le visiteur de test exclus
    expect(s["trial_activated"]).toMatchObject({ events: 1, uniqueVisitors: 1 }); // l'essai sans attribution n'est pas compté ici
    expect(s["subscription_activated"]).toMatchObject({ events: 1 });
    expect(o.measurableVisitors).toBe(2);
  });
  it("ne fabrique pas ce qui vit dans le moteur d'acquisition", async (ctx) => {
    if (!ok) return ctx.skip();
    const o = await outboundConversion(poolQuery, W.from, W.to);
    expect(o.external.prospectsContacted).toEqual({ status: "not_available_in_saas", owner: "flowpoint-acquisition-engine" });
    expect(JSON.stringify(o)).not.toMatch(/fp_lid|fpLid|@|sub_a/);
  });
  it("la santé de la livraison vient de la file durable, sans identifiant ni fp_lid", async (ctx) => {
    if (!ok) return ctx.skip();
    process.env["AI_LAB_CONVERSION_URL"] = "https://ai-lab.internal/events/conversion";
    process.env["CONVERSION_EVENT_SECRET"] = "dashboard-test-secret-at-least-32-characters";
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    await queueConversionEvent({ eventId: "dash:pending:1", stage: "visit", source: "marketing", fpLid: "DashLeadFp_000000000A1", occurredAt: AT });
    await pool.query(`UPDATE conversion_event_outbox SET created_at = $1 WHERE event_id LIKE 'dash:%'`, [AT]);
    await pool.query(`INSERT INTO conversion_event_outbox (event_id, stage, source, occurred_at, status, last_status, created_at)
      VALUES ('dash:gone:1','paid','stripe',$1,'rejected','rejected:400:exhausted',$1),('dash:ok:1','trial','stripe',$1,'delivered','sent:202',$1)`, [AT]);
    const o = await outboundConversion(poolQuery, W.from, W.to);
    expect(o.delivery).toMatchObject({ status: "observed", pending: 1, delivered: 1, rejected: 1, abandonedAfterRetries: 1 });
    expect((o.delivery as { oldestPendingSeconds: number }).oldestPendingSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(o.delivery)).not.toContain("DashLeadFp");
    await pool.query(`DELETE FROM conversion_event_outbox WHERE event_id LIKE 'dash:%'`);
    vi.unstubAllGlobals();
  });
});

describe("parseWindow", () => {
  it("valide les dates et borne la fenêtre", () => {
    expect(parseWindow("2026-02-30", "2026-03-01")).toBeNull();
    expect(parseWindow("2026-03-02", "2026-03-01")).toBeNull();
    expect(parseWindow("2026-01-01", "2027-12-31")).toBeNull(); // > 366 jours
    expect(parseWindow("abc", "2026-03-01")).toBeNull();
    expect(parseWindow(undefined, undefined)).toBeNull();
    const w = parseWindow("2026-03-01", "2026-03-01")!;
    expect(w.to.getTime() - w.from.getTime()).toBe(86_400_000); // `to` inclus
  });
});
