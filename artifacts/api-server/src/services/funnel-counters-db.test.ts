/**
 * Compteurs agreges du tunnel sur une vraie base : jours, familles separees,
 * ventilation source/plan, absence de toute donnee personnelle, rejets par
 * motif et livraison AI Lab par etape. Se saute sans base.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
import { pool } from "@workspace/db";
import { enregistrerEtape } from "./funnel-events.js";
import { compteursTunnel } from "./funnel-counters.js";
import { compterRejetFunnel } from "./funnel-rejections.js";
import { parseWindow, poolQuery } from "./conversion-dashboards.js";

const W = parseWindow("2001-05-01", "2001-05-02")!; // le passe : aucune autre donnee
const J1 = "2001-05-01T10:00:00Z";
const J2 = "2001-05-02T10:00:00Z";
const VISITEUR_A = "00000000-0000-4000-8000-0000000000a1";
const VISITEUR_B = "00000000-0000-4000-8000-0000000000b2";
const EMAIL = "personne@example.com";
let ok = false;

async function ev(etape: string, visiteur: string | null, source: string | null, plan: string | null, cle: string | null, at: string) {
  await pool.query(
    `INSERT INTO funnel_events (etape, visiteur_id, source, plan, cle_idempotence, created_at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (cle_idempotence) WHERE cle_idempotence IS NOT NULL DO NOTHING`, [etape, visiteur, source, plan, cle, at]);
}

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
    await enregistrerEtape({ etape: "landing_vue", visiteurId: "fp-test-bootstrap-c", cleIdempotence: "cnt-boot" });
    await compterRejetFunnel("unknown_stage"); // cree la table des rejets
    await pool.query("DELETE FROM funnel_events WHERE created_at < '2002-01-01'");
    await pool.query("DELETE FROM funnel_event_rejections WHERE jour < '2002-01-01'");
    await pool.query("DELETE FROM conversion_event_outbox WHERE event_id LIKE 'cnt:%'").catch(() => undefined);
    // Famille consentement : deux visiteurs, deux jours
    await ev("tarifs_vus", VISITEUR_A, "google", "pro", "cnt:t-a1", J1);
    await ev("tarifs_vus", VISITEUR_A, "google", "pro", "cnt:t-a2", J2);       // retour le lendemain : deux evenements, un visiteur
    await ev("tarifs_vus", VISITEUR_B, "smartlead", "<script>alert(1)</script>", "cnt:t-b1", J1); // plan libre : ramene a « other »
    await ev("tarifs_vus", "fp-test-zzz-1", "google", "pro", "cnt:t-test", J1);  // test : exclu
    await ev("signup_started", VISITEUR_A, "google", "pro", "cnt:s-a", J1);
    // Famille transactionnelle : un essai relie a un visiteur consenti, un sans consentement
    await ev("trial_activated", VISITEUR_A, "google", "pro", "trial_activated:cnt_sub_a", J2);
    await ev("trial_activated", null, null, null, "trial_activated:cnt_sub_b", J2);
    await ev("subscription_activated", null, null, null, "subscription_activated:cnt_sub_b", J2);
    // Rejets cote SaaS
    await pool.query(`INSERT INTO funnel_event_rejections (jour, motif, total) VALUES ('2001-05-01','unknown_stage',3),('2001-05-02','consent_missing',7)`);
    // Livraison AI Lab : ni fp_lid ni identifiant lisible dans la sortie
    await pool.query(
      `INSERT INTO conversion_event_outbox (event_id, stage, source, fp_lid, occurred_at, status, attempts, last_status, created_at)
       VALUES ('cnt:1','signup','saas',NULL,$1,'rejected',5,'rejected:400:exhausted',$1),
              ('cnt:2','signup','saas','AbCdEfGhIjKlMnOpQr_-12',$1,'pending',2,'rejected:400',$1),
              ('cnt:3','trial','stripe',NULL,$1,'delivered',1,'sent:202',$1),
              ('cnt:4','checkout','saas',NULL,$1,'rejected',1,'rejected:422',$1)`, [J1]);
    ok = true;
  } catch { ok = false; }
}, 120_000);

afterAll(async () => {
  if (!ok) return;
  await pool.query("DELETE FROM funnel_events WHERE created_at < '2002-01-01'");
  await pool.query("DELETE FROM funnel_event_rejections WHERE jour < '2002-01-01'");
  await pool.query("DELETE FROM conversion_event_outbox WHERE event_id LIKE 'cnt:%'").catch(() => undefined);
});

describe("compteurs du tunnel (SQL reel)", () => {
  it("separe les deux familles et ne les additionne jamais", async (ctx) => {
    if (!ok) return ctx.skip();
    const c = await compteursTunnel(poolQuery, W.from, W.to);
    const gated = Object.fromEntries(c.families.consent_gated.stages.map(s => [s.etape, s]));
    const trans = Object.fromEntries(c.families.transactional.stages.map(s => [s.etape, s]));
    expect(gated["tarifs_vus"]).toMatchObject({ events: 3, visitors: 2 }); // test exclu
    expect(gated["signup_started"]).toMatchObject({ events: 1, visitors: 1 });
    expect(trans["trial_activated"]).toMatchObject({ events: 2, visitors: 1 });
    expect(trans["subscription_activated"]).toMatchObject({ events: 1, visitors: 0 });
    // Aucune etape transactionnelle dans la famille consentement, et inversement.
    expect(Object.keys(gated)).not.toContain("trial_activated");
    expect(Object.keys(trans)).not.toContain("tarifs_vus");
    expect(c.unclassified).toEqual([]);
    expect(c.note).toMatch(/never added together/);
    expect(JSON.stringify(c)).not.toMatch(/"total":/);
  });

  it("compte par jour, par source et par plan ; un plan libre devient « other »", async (ctx) => {
    if (!ok) return ctx.skip();
    const c = await compteursTunnel(poolQuery, W.from, W.to);
    const t = c.daily.filter(l => l.etape === "tarifs_vus");
    expect(t).toEqual([
      expect.objectContaining({ day: "2001-05-01", famille: "consent_gated", events: 2, visitors: 2 }),
      expect.objectContaining({ day: "2001-05-02", events: 1, visitors: 1 }),
    ]);
    expect(c.bySource["google"]!.consent_gated["tarifs_vus"]).toEqual({ events: 2, visitors: 1 });
    expect(c.bySource["smartlead"]!.consent_gated["tarifs_vus"]).toEqual({ events: 1, visitors: 1 });
    expect(c.bySource["unknown"]!.transactional["trial_activated"]).toEqual({ events: 1, visitors: 0 });
    expect(c.byPlan["pro"]!.consent_gated["tarifs_vus"]).toEqual({ events: 2, visitors: 1 });
    expect(c.byPlan["other"]!.consent_gated["tarifs_vus"]).toEqual({ events: 1, visitors: 1 });
    expect(Object.keys(c.byPlan).sort()).toEqual(["other", "pro", "unknown"]);
  });

  it("mesure la couverture du consentement parmi les evenements transactionnels", async (ctx) => {
    if (!ok) return ctx.skip();
    const c = await compteursTunnel(poolQuery, W.from, W.to);
    expect(c.consentCoverage).toMatchObject({ transactionalEvents: 3, withConsentedVisitor: 1, ratio: 0.3333 });
    const vide = await compteursTunnel(poolQuery, new Date("2001-06-01T00:00:00Z"), new Date("2001-06-02T00:00:00Z"));
    expect(vide.consentCoverage.ratio).toBeNull(); // pas de 0 invente
  });

  it("rapporte les rejets SaaS par motif et la livraison AI Lab par etape", async (ctx) => {
    if (!ok) return ctx.skip();
    const c = await compteursTunnel(poolQuery, W.from, W.to);
    expect(c.rejections.saasPublicEndpoint).toMatchObject({ status: "observed", byReason: { unknown_stage: 3, consent_missing: 7 } });
    const liv = c.rejections.aiLabDelivery;
    expect(liv.status).toBe("observed");
    if (liv.status !== "observed") return;
    expect(liv.byStage["signup"]).toEqual({ delivered: 0, pending: 1, retryingAfter400: 1, rejected400Exhausted: 1, rejectedOther: 0 });
    expect(liv.byStage["trial"]).toMatchObject({ delivered: 1 });
    expect(liv.byStage["checkout"]).toMatchObject({ rejectedOther: 1, rejected400Exhausted: 0 });
    expect(liv.reasonRecorded).toBe(false);
  });

  it("ne sort aucun identifiant de visiteur, email, fp_lid ni texte libre", async (ctx) => {
    if (!ok) return ctx.skip();
    const sortie = JSON.stringify(await compteursTunnel(poolQuery, W.from, W.to));
    for (const interdit of [VISITEUR_A, VISITEUR_B, "fp-test-", EMAIL, "AbCdEfGhIjKlMnOpQr_-12", "<script>", "visiteur_id", "cle_idempotence", "fp_lid\""]) {
      expect(sortie).not.toContain(interdit);
    }
  });

  it("une table absente n'est pas une panne : not_initialized, pas des zeros", async () => {
    const q = async (sql: string) => {
      if (/funnel_event_rejections|conversion_event_outbox/.test(sql)) throw Object.assign(new Error("x"), { code: "42P01" });
      return { rows: [] };
    };
    const c = await compteursTunnel(q, W.from, W.to);
    expect(c.rejections.saasPublicEndpoint).toEqual({ status: "not_initialized" });
    expect(c.rejections.aiLabDelivery).toEqual({ status: "not_initialized" });
  });
});
