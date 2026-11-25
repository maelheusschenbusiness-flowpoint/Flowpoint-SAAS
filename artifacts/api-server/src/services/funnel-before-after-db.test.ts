/**
 * Comparaison avant/apres sur une vraie base : fenetres, deduplication par
 * visiteur et par jour, cohorte, fenetre incomplete, petits echantillons, famille
 * transactionnelle a part, et accord avec le SQL de lecture seule. Se saute sans base.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
import { pool } from "@workspace/db";
import { enregistrerEtape } from "./funnel-events.js";
import { poolQuery } from "./conversion-dashboards.js";
import { avantApres, parseJour, wilson, MIN_DENOMINATEUR } from "./funnel-before-after.js";

const CHANGE = parseJour("2001-05-10")!;
const v = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
let ok = false;
let cle = 0;

async function ev(etape: string, visiteur: string | null, at: string, cleIdem: string | null = `ba:${++cle}`) {
  await pool.query(
    `INSERT INTO funnel_events (etape, visiteur_id, cle_idempotence, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (cle_idempotence) WHERE cle_idempotence IS NOT NULL DO NOTHING`, [etape, visiteur, cleIdem, at]);
}

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
    await enregistrerEtape({ etape: "landing_vue", visiteurId: "fp-test-bootstrap-ba", cleIdempotence: "ba-boot" });
    await pool.query("DELETE FROM funnel_events WHERE created_at < '2002-01-01'");
    // AVANT : [2001-05-07, 2001-05-10)
    for (const i of [1, 2, 3, 4]) await ev("tarifs_vus", v(i), "2001-05-08T10:00:00Z");
    await ev("tarifs_vus", v(1), "2001-05-09T10:00:00Z");          // v1 revient : un visiteur, deux visiteur-jours
    await ev("tarifs_vus", "fp-test-x-1", "2001-05-08T10:00:00Z"); // test : exclu
    for (const i of [1, 2, 9]) await ev("cta_clique", v(i), "2001-05-08T11:00:00Z"); // v9 sans tarifs : hors cohorte
    await ev("signup_started", v(1), "2001-05-08T12:00:00Z");
    await ev("trial_activated", null, "2001-05-09T12:00:00Z", "trial_activated:ba_sub_1");
    await ev("trial_activated", v(1), "2001-05-09T13:00:00Z", "trial_activated:ba_sub_2");
    // Hors fenetre : la veille de la fenetre « avant » et le jour du changement (appartient a « apres »)
    await ev("tarifs_vus", v(50), "2001-05-06T23:59:59Z");
    // APRES : [2001-05-10, 2001-05-13)
    for (const i of [1, 2]) await ev("tarifs_vus", v(i), "2001-05-10T00:00:00Z");
    await ev("cta_clique", v(1), "2001-05-11T10:00:00Z");
    await ev("signup_started", v(1), "2001-05-11T11:00:00Z");
    await ev("tarifs_vus", v(60), "2001-05-13T00:00:00Z");         // apres la fin : exclu
    ok = true;
  } catch { ok = false; }
}, 120_000);

afterAll(async () => { if (ok) await pool.query("DELETE FROM funnel_events WHERE created_at < '2002-01-01'"); });

const find = <T extends { etape: string }>(l: T[], e: string) => l.find(x => x.etape === e)!;

describe("avant/apres (SQL reel)", () => {
  it("compte visiteurs, visiteur-jours et cohorte dans des fenetres de meme longueur", async (ctx) => {
    if (!ok) return ctx.skip();
    const r = await avantApres(poolQuery, CHANGE, 3, new Date("2001-06-01T00:00:00Z"));
    expect(r.before.window).toMatchObject({ from: "2001-05-07T00:00:00.000Z", to: "2001-05-10T00:00:00.000Z", days: 3, complete: true });
    expect(r.after.window).toMatchObject({ from: "2001-05-10T00:00:00.000Z", to: "2001-05-13T00:00:00.000Z", days: 3, complete: true });
    expect(find(r.before.consentGated, "tarifs_vus")).toMatchObject({ visitors: 4, visitorDays: 5 });
    expect(find(r.before.consentGated, "cta_clique")).toMatchObject({ visitors: 3, paired: 2 }); // v9 n'est pas de la cohorte
    expect(find(r.after.consentGated, "tarifs_vus")).toMatchObject({ visitors: 2 });
    expect(find(r.after.consentGated, "cta_clique")).toMatchObject({ visitors: 1, paired: 1 });
  });

  it("marque un petit echantillon au lieu de conclure, avec un intervalle de Wilson", async (ctx) => {
    if (!ok) return ctx.skip();
    const r = await avantApres(poolQuery, CHANGE, 3, new Date("2001-06-01T00:00:00Z"));
    const t = r.rates.find(x => x.from === "tarifs_vus" && x.to === "cta_clique")!;
    expect(t.before).toMatchObject({ numerator: 2, denominator: 4, ratio: 0.5 });
    expect(t.after).toMatchObject({ numerator: 1, denominator: 2, ratio: 0.5 });
    expect(t.deltaPoints).toBe(0);
    expect(t.verdict).toBe("insufficient_sample");
    expect(t.before.ci95!.low).toBeLessThan(0.5);
    expect(t.before.ci95!.high).toBeGreaterThan(0.5);
    expect(r.minDenominator).toBe(MIN_DENOMINATEUR);
    // Aucune etape sans visiteur ne fabrique un taux
    expect(r.rates.find(x => x.from === "checkout_started")!.verdict).toBe("no_data");
  });

  it("declare la fenetre apres incomplete, sans la completer par des zeros", async (ctx) => {
    if (!ok) return ctx.skip();
    const r = await avantApres(poolQuery, CHANGE, 3, new Date("2001-05-11T12:00:00Z"));
    expect(r.after.window).toMatchObject({ complete: false, days: 2, to: "2001-05-11T12:00:00.000Z" });
    const avant = await avantApres(poolQuery, CHANGE, 3, new Date("2001-05-09T00:00:00Z")); // changement pas encore en production
    expect(avant.after.window.days).toBe(0);
    expect(avant.after.window.complete).toBe(false);
    expect(avant.after.consentGated.every(s => s.visitors === 0)).toBe(true);
  });

  it("garde la famille transactionnelle a part, avec sa couverture", async (ctx) => {
    if (!ok) return ctx.skip();
    const r = await avantApres(poolQuery, CHANGE, 3, new Date("2001-06-01T00:00:00Z"));
    expect(find(r.before.transactional, "trial_activated")).toMatchObject({ events: 2, withConsentedVisitor: 1 });
    expect(r.rates.every(x => !["trial_activated", "subscription_activated"].includes(x.to))).toBe(true);
    expect(r.notInstrumented).toContain("signup_submitted");
    expect(JSON.stringify(r)).not.toContain("00000000-0000-4000");
  });

  it("le SQL de lecture seule donne les memes comptes que l'endpoint", async (ctx) => {
    if (!ok) return ctx.skip();
    const sql = join(process.cwd(), "tools/conversion/avant-apres-lecture-seule.sql");
    let sortie: string;
    try {
      sortie = execFileSync("psql", [process.env["DATABASE_URL"]!, "-X", "-A", "-F", ";", "-t", "-v", "change='2001-05-10'", "-v", "days=3", "-f", sql],
        { encoding: "utf8" });
    } catch { return ctx.skip(); } // psql absent
    const r = await avantApres(poolQuery, CHANGE, 3, new Date("2001-06-01T00:00:00Z"));
    const lignes = sortie.split("\n").filter(l => /^(avant|apres);/.test(l)).map(l => l.split(";"));
    const avant = lignes.find(l => l[0] === "avant" && l.length > 6)!;
    // colonnes : fenetre;debut;fin;tarifs_vus;cta_clique;cta_apres_tarifs;...
    expect(Number(avant[3])).toBe(find(r.before.consentGated, "tarifs_vus").visitors);
    expect(Number(avant[4])).toBe(find(r.before.consentGated, "cta_clique").visitors);
    expect(Number(avant[5])).toBe(find(r.before.consentGated, "cta_clique").paired);
    const trial = lignes.find(l => l[0] === "avant" && l[1] === "trial_activated")!;
    expect(Number(trial[2])).toBe(2);
    expect(Number(trial[3])).toBe(1);
  });
});

describe("outils purs", () => {
  it("wilson : null sans denominateur, borne dans [0,1], plus etroit quand n grandit", () => {
    expect(wilson(0, 0)).toBeNull();
    const petit = wilson(1, 2)!, grand = wilson(50, 100)!;
    expect(petit.low).toBeGreaterThanOrEqual(0);
    expect(petit.high).toBeLessThanOrEqual(1);
    expect(grand.high - grand.low).toBeLessThan(petit.high - petit.low);
    expect(wilson(0, 10)!.low).toBe(0);
  });
  it("parseJour refuse les dates invalides", () => {
    expect(parseJour("2026-02-30")).toBeNull();
    expect(parseJour("2026-1-1")).toBeNull();
    expect(parseJour(undefined)).toBeNull();
    expect(parseJour("2026-02-28")!.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
  it("le SQL fourni est strictement en lecture seule", () => {
    const sql = readFileSync(join(process.cwd(), "tools/conversion/avant-apres-lecture-seule.sql"), "utf8")
      .split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sql).toMatch(/BEGIN READ ONLY;/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COPY)\b/i);
  });
});
