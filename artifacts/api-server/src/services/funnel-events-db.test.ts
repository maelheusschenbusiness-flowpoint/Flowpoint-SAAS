/**
 * funnel-events-db.test.ts
 *
 * Mesure du tunnel commercial, sur un VRAI PostgreSQL.
 *
 * POURQUOI CE SERVICE EXISTE — mesure du 18/10/2026. Sur un mois de
 * commercialisation, il etait impossible de dire combien de personnes avaient
 * commence une inscription : aucune balise analytique sur le site vitrine,
 * `pending_signups` purgee toutes les heures, et `recordUsageEvent` refusant
 * tout appel sans `orgId` — or les premieres etapes du tunnel precedent
 * l'existence d'une organisation.
 *
 * Ces tests verrouillent les trois proprietes qui comptent : les doublons ne
 * s'accumulent pas, une etape inconnue est refusee, et aucune donnee
 * personnelle ne peut entrer dans la table.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  enregistrerEtape, compterParEtape, ETAPES_TUNNEL, ETAPES_PUBLIQUES,
} from "./funnel-events.js";

let dbOk = false;
const marque = `test-${randomUUID()}`;

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});

beforeEach(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id LIKE 'test-%' OR cle_idempotence LIKE '%test-%'`)
    .catch(() => undefined);
});

afterAll(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id LIKE 'test-%' OR cle_idempotence LIKE '%test-%'`)
    .catch(() => undefined);
});

describe("enregistrement des etapes", () => {
  it("une etape connue est ecrite", async (ctx) => {
    if (!dbOk) return ctx.skip();
    expect(await enregistrerEtape({ etape: "signup_started", visiteurId: marque })).toBe(true);
    const r = await pool.query(`SELECT etape FROM funnel_events WHERE visiteur_id = $1`, [marque]);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]?.etape).toBe("signup_started");
  });

  it("une etape INCONNUE est refusee et n'ecrit rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    expect(await enregistrerEtape({ etape: "etape_inventee", visiteurId: marque })).toBe(false);
    const r = await pool.query(`SELECT 1 FROM funnel_events WHERE visiteur_id = $1`, [marque]);
    expect(r.rowCount).toBe(0);
  });

  it("LES DOUBLONS NE S'ACCUMULENT PAS — meme cle d'idempotence", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const cle = `signup_started:${marque}:2026-10-18`;
    expect(await enregistrerEtape({ etape: "signup_started", visiteurId: marque, cleIdempotence: cle })).toBe(true);
    expect(await enregistrerEtape({ etape: "signup_started", visiteurId: marque, cleIdempotence: cle })).toBe(false);
    const r = await pool.query(`SELECT count(*)::int AS n FROM funnel_events WHERE cle_idempotence = $1`, [cle]);
    expect(r.rows[0]?.n).toBe(1);
  });

  it("sans cle d'idempotence, deux passages comptent deux fois", async (ctx) => {
    if (!dbOk) return ctx.skip();
    // C'est voulu : une page vue deux fois dans deux sessions est deux visites.
    await enregistrerEtape({ etape: "landing_vue", visiteurId: marque });
    await enregistrerEtape({ etape: "landing_vue", visiteurId: marque });
    const r = await pool.query(`SELECT count(*)::int AS n FROM funnel_events WHERE visiteur_id = $1`, [marque]);
    expect(r.rows[0]?.n).toBe(2);
  });

  it("les valeurs libres sont bornees a 120 caracteres", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await enregistrerEtape({ etape: "cta_clique", visiteurId: marque, source: "x".repeat(500) });
    const r = await pool.query<{ source: string }>(`SELECT source FROM funnel_events WHERE visiteur_id = $1`, [marque]);
    expect(r.rows[0]?.source.length).toBe(120);
  });

  it("le comptage par etape rend des totaux exploitables", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await enregistrerEtape({ etape: "landing_vue", visiteurId: marque });
    await enregistrerEtape({ etape: "tarifs_vus",  visiteurId: marque });
    const hier = new Date(Date.now() - 86_400_000);
    const demain = new Date(Date.now() + 86_400_000);
    const c = await compterParEtape(hier, demain);
    expect(c["landing_vue"]).toBeGreaterThanOrEqual(1);
    expect(c["tarifs_vus"]).toBeGreaterThanOrEqual(1);
  });
});

describe("AUCUNE DONNEE PERSONNELLE NE PEUT ENTRER", () => {
  it("la table n'a pas de colonne pouvant porter un email ou une IP", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='funnel_events'`);
    const colonnes = r.rows.map((x) => x.column_name).sort();
    expect(colonnes).toEqual(
      ["cle_idempotence", "created_at", "etape", "id", "org_ref", "plan", "source", "visiteur_id"]);
    // `org_ref` et non `org_id` : cette table n'est pas une table de
    // locataire, et l'invariant de schema qui exige une policy d'isolation sur
    // `org_id` doit continuer de proteger les vraies.
    expect(colonnes).not.toContain("org_id");
    for (const interdit of ["email", "ip", "adresse", "address", "nom", "name", "telephone", "phone", "carte", "card"]) {
      expect(colonnes, `une colonne « ${interdit} » est apparue`).not.toContain(interdit);
    }
  });

  it("RLS est active — aucun client PostgREST n'y accede", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await pool.query<{ rls: boolean }>(
      `SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='funnel_events'`);
    expect(r.rows[0]?.rls).toBe(true);
  });
});

describe("la liste des etapes est fermee, et la frontiere navigateur/serveur tient", () => {
  it("les etapes declarables par le navigateur sont un sous-ensemble strict", () => {
    for (const e of ETAPES_PUBLIQUES) {
      expect(ETAPES_TUNNEL as readonly string[]).toContain(e);
    }
    // Les etapes qui engagent de l'argent ne doivent JAMAIS venir du client.
    for (const serveurUniquement of
         ["checkout_completed", "trial_activated", "subscription_activated", "trial_expired"]) {
      expect(ETAPES_PUBLIQUES.has(serveurUniquement),
        `${serveurUniquement} est declarable depuis le navigateur`).toBe(false);
    }
  });
});
