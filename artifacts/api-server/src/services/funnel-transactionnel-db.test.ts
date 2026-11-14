/**
 * Comptage transactionnel : les essais, abonnements et paiements sont comptes sans consentement, sans aucune donnee
 * marketing, une seule fois par objet Stripe, jamais pour un compte de test ni un evenement non LIVE.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Vraie base : le setup global substitue le pool, comme pour les autres tests *-db.
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());

import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  enregistrerEtapeTransactionnelle, emailEstSynthetique, agregerAttribution, assurerEtapesTunnel, enregistrerEtape, ETAPES_TUNNEL,
} from "./funnel-events.js";

const RUN = `txn-${randomUUID().slice(0, 8)}`;
let dbOk = false;
const orgs: string[] = [];

async function creerOrg(email: string, nom = "Societe cliente"): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO organizations (id, name, owner_email, created_at) VALUES ($1::uuid, $2, $3, NOW())`, [id, nom, email]);
  orgs.push(id);
  return id;
}
const lignes = (cle: string) => pool.query(
  `SELECT etape, visiteur_id, org_ref, source, utm_source, utm_medium, utm_campaign, plan FROM funnel_events WHERE cle_idempotence = $1`, [cle]);

beforeAll(async () => {
  try {
    await pool.query("SELECT 1 FROM organizations LIMIT 1");
    await assurerEtapesTunnel();
    dbOk = true;
  } catch { dbOk = false; }
});
afterAll(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE cle_idempotence LIKE $1`, [`%${RUN}%`]).catch(() => undefined);
  for (const id of orgs) await pool.query(`DELETE FROM organizations WHERE id = $1::uuid`, [id]).catch(() => undefined);
});

describe("detection des comptes synthetiques", () => {
  it("reconnait les domaines et prefixes de test, jamais un vrai client", () => {
    for (const e of ["a@flowpoint.test", "fp-cert-x-1@flowpoint.test", "a@flowpoint-test.internal", "x@example.com", "cert-abc@gmail.com"]) {
      expect(emailEstSynthetique(e), e).toBe(true);
    }
    for (const e of ["marie@societe-reelle.fr", "contact@flowpoint.pro", "client@gmail.com", null, undefined, 42]) {
      expect(emailEstSynthetique(e as never), String(e)).toBe(false);
    }
  });
});

describe("comptage sans consentement (SQL reel)", () => {
  it("compte un essai LIVE sans consentement : aucune donnee marketing, ni organisation, ni visiteur", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = await creerOrg("marie@societe-reelle.fr");
    const cle = `trial_activated:sub_${RUN}_a`;
    expect(await enregistrerEtapeTransactionnelle({ etape: "trial_activated", livemode: true, attribution: null, orgId: org, plan: "standard", cleIdempotence: cle })).toBe(true);
    const r = await lignes(cle);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ etape: "trial_activated", visiteur_id: null, org_ref: null, source: null, utm_source: null, utm_medium: null, utm_campaign: null, plan: "standard" });
  });

  it("un rejeu, ou un second evenement Stripe pour le meme abonnement, n'ajoute aucune ligne", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = await creerOrg("paul@societe-reelle.fr");
    const cle = `subscription_activated:sub_${RUN}_b`;
    const ev = { etape: "subscription_activated" as const, livemode: true, orgId: org, plan: "pro", cleIdempotence: cle };
    expect(await enregistrerEtapeTransactionnelle(ev)).toBe(true);
    expect(await enregistrerEtapeTransactionnelle(ev)).toBe(false);
    expect(await enregistrerEtapeTransactionnelle({ ...ev, plan: "ultra" })).toBe(false);
    expect((await lignes(cle)).rows).toHaveLength(1);
  });

  it("n'ecrit rien pour un evenement non LIVE ou de mode inconnu", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = await creerOrg("jean@societe-reelle.fr");
    for (const livemode of [false, undefined]) {
      const cle = `trial_activated:sub_${RUN}_c_${String(livemode)}`;
      expect(await enregistrerEtapeTransactionnelle({ etape: "trial_activated", livemode, orgId: org, cleIdempotence: cle })).toBe(false);
      expect((await lignes(cle)).rows).toHaveLength(0);
    }
  });

  it("exclut les comptes synthetiques et les certifications", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const parEmail = await creerOrg("fp-cert-plan-1@flowpoint.test");
    const parNom = await creerOrg("vraie.adresse@gmail.com", "FP-CERT Societe d'essai");
    for (const [i, org] of [parEmail, parNom].entries()) {
      const cle = `trial_activated:sub_${RUN}_d${i}`;
      expect(await enregistrerEtapeTransactionnelle({ etape: "trial_activated", livemode: true, orgId: org, cleIdempotence: cle })).toBe(false);
      expect((await lignes(cle)).rows).toHaveLength(0);
    }
  });

  it("paiements : un par facture, une ligne par tentative echouee, rejeu sans doublon", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = await creerOrg("claire@societe-reelle.fr");
    const ok = `payment_succeeded:in_${RUN}`;
    expect(await enregistrerEtapeTransactionnelle({ etape: "payment_succeeded", livemode: true, orgId: org, cleIdempotence: ok })).toBe(true);
    expect(await enregistrerEtapeTransactionnelle({ etape: "payment_succeeded", livemode: true, orgId: org, cleIdempotence: ok })).toBe(false);
    for (const tentative of [1, 2, 2]) {
      await enregistrerEtapeTransactionnelle({ etape: "payment_failed", livemode: true, orgId: org, cleIdempotence: `payment_failed:in_${RUN}:${tentative}` });
    }
    const echecs = await pool.query(`SELECT count(*)::int n FROM funnel_events WHERE cle_idempotence LIKE $1`, [`payment_failed:in_${RUN}:%`]);
    expect(echecs.rows[0].n).toBe(2);
  });
});

describe("avec consentement : attribution inchangee", () => {
  it("garde visiteur, source et organisation, y compris pour un evenement non LIVE", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = await creerOrg("emma@societe-reelle.fr");
    const cle = `trial_activated:sub_${RUN}_e`;
    const vid = `fp-test-${RUN.replace(/[^a-z0-9]/g, "")}x`;
    await enregistrerEtapeTransactionnelle({
      etape: "trial_activated", livemode: false, attribution: { visiteurId: vid, source: "smartlead" }, orgId: org, plan: "pro", cleIdempotence: cle,
    });
    const r = await lignes(cle);
    expect(r.rows[0]).toMatchObject({ visiteur_id: vid, source: "smartlead", org_ref: org });
  });
});

describe("separation operationnel / marketing dans l'export agrege", () => {
  it("les essais sans consentement forment une ligne sans source (0 visiteur identifie), comptee dans `evenements`", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const org = await creerOrg("lea@societe-reelle.fr");
    await enregistrerEtapeTransactionnelle({ etape: "trial_activated", livemode: true, orgId: org, cleIdempotence: `trial_activated:sub_${RUN}_f` });
    const jour = new Date().toISOString().slice(0, 10);
    const rows = await agregerAttribution(jour, jour);
    const sansSource = rows.find((l) => l.etape === "trial_activated" && l.source === null && l.utm_campaign === null);
    expect(sansSource).toBeDefined();
    expect(sansSource!.evenements).toBeGreaterThanOrEqual(1);
    expect(sansSource!.visiteurs).toBe(0);
    expect(Object.keys(sansSource!).sort()).toEqual(["etape", "evenements", "jour", "source", "utm_campaign", "utm_medium", "utm_source", "visiteurs"]);
  });
});

describe("schema : la base accepte TOUTES les etapes du tunnel", () => {
  it("chaque etape de ETAPES_TUNNEL s'ecrit (une contrainte en retard perd les mesures sans bruit)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    for (const etape of ETAPES_TUNNEL) {
      const cle = `${etape}:schema_${RUN}`;
      expect(await enregistrerEtape({ etape, cleIdempotence: cle }), etape).toBe(true);
    }
  });
  it("assurerEtapesTunnel est idempotente", async (ctx) => {
    if (!dbOk) return ctx.skip();
    expect((await assurerEtapesTunnel()).etat).toMatch(/deja_a_jour|sans_contrainte/);
  });
  it("la migration 021 liste exactement les etapes du tunnel", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../migrations/021_funnel_events_etapes_transactionnelles.sql", import.meta.url), "utf8");
    const liste = [...sql.slice(sql.indexOf("CHECK (etape IN")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(liste).toEqual([...ETAPES_TUNNEL].sort());
  });
});
