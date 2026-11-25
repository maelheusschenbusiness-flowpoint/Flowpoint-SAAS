/**
 * Garde-fous sans base : toute etape du tunnel a une famille, les deux familles
 * ne se recouvrent pas, la migration du compteur de rejets est idempotente et
 * alignee sur le service.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { ETAPES_TUNNEL, ETAPES_PUBLIQUES } from "./funnel-events.js";
import { FAMILLE_PAR_ETAPE, famille } from "./funnel-counters.js";
import { MOTIFS_REJET } from "./funnel-rejections.js";

describe("familles du tunnel", () => {
  it("toute etape de ETAPES_TUNNEL est classee (une etape ajoutee sans famille fait echouer la CI)", () => {
    for (const e of ETAPES_TUNNEL) expect(famille(e), e).not.toBe("unclassified");
  });
  it("une etape navigateur declarable est toujours soumise au consentement", () => {
    for (const e of ETAPES_PUBLIQUES) expect(famille(e), e).toBe("consent_gated");
  });
  it("les etapes issues de Stripe sont transactionnelles, les autres jamais", () => {
    for (const e of ["trial_activated", "trial_expired", "subscription_activated"]) expect(famille(e)).toBe("transactional");
    for (const e of ["landing_vue", "tarifs_vus", "cta_clique", "signup_form_completed", "checkout_started", "checkout_completed"]) {
      expect(famille(e)).toBe("consent_gated");
    }
    expect(famille("etape_inventee")).toBe("unclassified");
  });
  it("la table de familles ne contient que deux familles reelles", () => {
    expect(new Set(Object.values(FAMILLE_PAR_ETAPE))).toEqual(new Set(["consent_gated", "transactional"]));
  });
});

describe("compteur de rejets : migration 029", () => {
  const sql = readFileSync(join(process.cwd(), "migrations/029_funnel_event_rejections.sql"), "utf8");
  it("est idempotente, active la RLS et ne porte aucune colonne personnelle", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS funnel_event_rejections/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    const colonnes = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf(");"));
    expect(colonnes).not.toMatch(/visiteur|email|ip\b|fp_lid|org/i);
  });
  it("a la meme definition que celle du service", () => {
    const service = readFileSync(join(process.cwd(), "src/services/funnel-rejections.ts"), "utf8");
    for (const c of ["jour   DATE   NOT NULL", "motif  TEXT   NOT NULL", "total  BIGINT NOT NULL DEFAULT 0", "PRIMARY KEY (jour, motif)"]) {
      expect(sql).toContain(c);
      expect(service).toContain(c);
    }
  });
  it("les motifs sont une liste fermee de quatre valeurs", () => {
    expect(Object.keys(MOTIFS_REJET).sort()).toEqual(["consent_missing", "missing_visitor_id", "storage_error", "unknown_stage"]);
  });
});
