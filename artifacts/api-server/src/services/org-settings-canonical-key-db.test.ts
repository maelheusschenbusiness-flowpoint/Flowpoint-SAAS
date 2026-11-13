/**
 * org-settings-canonical-key-db.test.ts
 *
 * org_settings est clee par org_id, mais deux cles coexistent pour une meme
 * organisation : l'UUID de `organizations` et, pour les comptes crees avant
 * l'existence de cet UUID, l'adresse e-mail. L'activation de compte ecrit
 * explicitement les deux, puis les lignes derivent.
 *
 * Divergence mesuree sur une organisation reelle avant correction :
 *   ligne e-mail : plan standard, statut canceled, ville Paris, adresse
 *   ligne UUID   : plan pro,      statut active,   ville NULL,  adresse NULL
 * L'adresse saisie a l'inscription etait invisible du chemin principal (qui
 * lit par UUID), et un chemin encore clee e-mail lisait un plan perime.
 *
 * Ces tests verrouillent la correction sur PostgreSQL reel :
 *   - les ecritures convergent vers la cle canonique (UUID) ;
 *   - les lectures par l'une ou l'autre cle rendent le meme etat ;
 *   - AUCUNE donnee client n'est fusionnee en base ni supprimee : la ligne
 *     legacy garde ses valeurs d'origine apres lecture ET apres ecriture ;
 *   - la fenetre d'avant creation du compte (aucune organisation) continue de
 *     fonctionner sur la cle e-mail.
 *
 * Sans PostgreSQL, la suite s'ignore proprement.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { loadOrgSettings, upsertOrgSettings, canonicalOrgSettingsKey } from "./org-settings.js";

const ORG = randomUUID();                                  // organisation avec les deux lignes
const ORG_LEGACY_ONLY = randomUUID();                      // seule la ligne e-mail existe
const EMAIL = `ocs-${Date.now()}@example.test`;
const EMAIL_LEGACY = `ocs-legacy-${Date.now()}@example.test`;
const ORPHAN_EMAIL = `ocs-orphan-${Date.now()}@example.test`;  // aucune organisation
const ALL_ORGS = [ORG, ORG_LEGACY_ONLY];
const ALL_KEYS = [ORG, ORG_LEGACY_ONLY, EMAIL, EMAIL_LEGACY, ORPHAN_EMAIL];
let dbUp = false;

async function rawRow(key: string): Promise<Record<string, unknown> | null> {
  const c = await pool.connect();
  try {
    const r = await c.query(`SELECT * FROM org_settings WHERE org_id = $1 LIMIT 1`, [key]);
    return (r.rows[0] as Record<string, unknown>) ?? null;
  } finally { c.release(); }
}

beforeAll(async () => {
  let c: PoolClient;
  try { c = (await pool.connect()) as unknown as PoolClient; }
  catch { dbUp = false; return; }
  try {
    for (const [id, email] of [[ORG, EMAIL], [ORG_LEGACY_ONLY, EMAIL_LEGACY]] as const) {
      await c.query(
        `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
         VALUES ($1,$2,$3,'test-user','active','pro',$4) ON CONFLICT (id) DO NOTHING`,
        [id, `OCS ${id.slice(0, 8)}`, `ocs-${id.slice(0, 8)}`, email]);
    }
    // L'etat exact mesure : deux lignes divergentes pour ORG.
    await c.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status, city, address)
       VALUES ($1,'standard','canceled','Paris','1 rue Auth')
       ON CONFLICT (org_id) DO UPDATE SET plan='standard', subscription_status='canceled',
                                          city='Paris', address='1 rue Auth'`, [EMAIL]);
    await c.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status)
       VALUES ($1,'pro','active')
       ON CONFLICT (org_id) DO UPDATE SET plan='pro', subscription_status='active'`, [ORG]);
    // ORG_LEGACY_ONLY : uniquement la ligne e-mail.
    await c.query(
      `INSERT INTO org_settings (org_id, plan, city) VALUES ($1,'ultra','Lyon')
       ON CONFLICT (org_id) DO UPDATE SET plan='ultra', city='Lyon'`, [EMAIL_LEGACY]);
    dbUp = true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM org_settings WHERE org_id = ANY($1::text[])`, [ALL_KEYS]);
    await c.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ALL_ORGS]);
  } finally { c.release(); }
});

describe("org_settings — cle canonique", () => {
  it("une cle e-mail est resolue vers l'UUID de l'organisation", async () => {
    if (!dbUp) return;
    const c = await pool.connect();
    try {
      expect(await canonicalOrgSettingsKey(EMAIL, c as unknown as PoolClient)).toBe(ORG);
      // Deja canonique, ou introuvable : inchangee.
      expect(await canonicalOrgSettingsKey(ORG, c as unknown as PoolClient)).toBe(ORG);
      expect(await canonicalOrgSettingsKey(ORPHAN_EMAIL, c as unknown as PoolClient)).toBe(ORPHAN_EMAIL);
      expect(await canonicalOrgSettingsKey("default", c as unknown as PoolClient)).toBe("default");
    } finally { c.release(); }
  });

  it("les deux cles rendent le MEME plan et le MEME statut d'abonnement", async () => {
    if (!dbUp) return;
    const byUuid  = await loadOrgSettings(ORG);
    const byEmail = await loadOrgSettings(EMAIL);
    expect(byUuid?.plan).toBe("pro");
    expect(byUuid?.subscriptionStatus).toBe("active");
    // Avant correction, cette lecture rendait standard/canceled.
    expect(byEmail?.plan).toBe(byUuid?.plan);
    expect(byEmail?.subscriptionStatus).toBe(byUuid?.subscriptionStatus);
  });

  it("l'adresse d'inscription restee sur la ligne legacy devient visible par UUID", async () => {
    if (!dbUp) return;
    const byUuid = await loadOrgSettings(ORG);
    // Completion en lecture : la ligne canonique n'a ni ville ni adresse.
    expect(byUuid?.city).toBe("Paris");
    expect(byUuid?.address).toBe("1 rue Auth");
  });

  it("la completion n'ecrit RIEN : la ligne canonique reste vide en base", async () => {
    if (!dbUp) return;
    await loadOrgSettings(ORG);
    const canon = await rawRow(ORG);
    expect(canon?.["city"]).toBeNull();
    expect(canon?.["address"]).toBeNull();
  });

  it("un upsert par e-mail ecrit sur la ligne canonique et laisse la ligne legacy intacte", async () => {
    if (!dbUp) return;
    const legacyBefore = await rawRow(EMAIL);
    await upsertOrgSettings(EMAIL, { timezone: "Europe/Paris" });
    const canon  = await rawRow(ORG);
    const legacy = await rawRow(EMAIL);
    expect(canon?.["timezone"]).toBe("Europe/Paris");
    // Aucune donnee client modifiee ni supprimee sur la ligne legacy.
    expect(legacy?.["timezone"]).toBe(legacyBefore?.["timezone"] ?? null);
    expect(legacy?.["plan"]).toBe("standard");
    expect(legacy?.["city"]).toBe("Paris");
  });

  it("un upsert par UUID reste sur la ligne canonique", async () => {
    if (!dbUp) return;
    // `vat` n'a pas de valeur par defaut en base, contrairement a language et
    // timezone — c'est donc un temoin fiable de la ligne reellement ecrite.
    await upsertOrgSettings(ORG, { vat: "FR123CANON" });
    expect((await rawRow(ORG))?.["vat"]).toBe("FR123CANON");
    expect((await rawRow(EMAIL))?.["vat"]).toBeNull();
  });

  it("aucune ligne canonique : la lecture par UUID sert la ligne legacy", async () => {
    if (!dbUp) return;
    expect(await rawRow(ORG_LEGACY_ONLY)).toBeNull();
    const byUuid = await loadOrgSettings(ORG_LEGACY_ONLY);
    expect(byUuid?.plan).toBe("ultra");
    expect(byUuid?.city).toBe("Lyon");
    // Et toujours aucune ecriture.
    expect(await rawRow(ORG_LEGACY_ONLY)).toBeNull();
  });

  it("fenetre d'avant creation du compte : la cle e-mail fonctionne seule", async () => {
    if (!dbUp) return;
    await upsertOrgSettings(ORPHAN_EMAIL, { plan: "standard", city: "Nantes" });
    const row = await rawRow(ORPHAN_EMAIL);
    expect(row).not.toBeNull();
    expect(row?.["city"]).toBe("Nantes");
    expect((await loadOrgSettings(ORPHAN_EMAIL))?.city).toBe("Nantes");
  });
});
