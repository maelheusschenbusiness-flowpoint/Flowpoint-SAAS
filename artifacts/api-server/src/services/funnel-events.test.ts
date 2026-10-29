import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => query(...args) },
}));

import {
  ETAPES_PUBLIQUES,
  enregistrerEtape,
  lireAttributionFunnel,
  metadataAttributionFunnel,
  metadataDepuisAttribution,
  normaliserAttributionFunnel,
  normaliserCampagne,
  validerPlageAttribution,
} from "./funnel-events.js";

const visitorId = "22222222-2222-4222-8222-222222222222";

describe("funnel event consent and privilege boundaries", () => {
  beforeEach(() => query.mockReset());

  it("requires explicit consent and a valid anonymous visitor id", () => {
    expect(normaliserAttributionFunnel("denied", visitorId, "google")).toBeNull();
    expect(normaliserAttributionFunnel("accepted", "user@example.com", "google")).toBeNull();
    expect(normaliserAttributionFunnel("accepted", visitorId, "google")).toEqual({
      visiteurId: visitorId,
      source: "google",
    });
  });

  it("does not allow the browser to declare server-side payment events", () => {
    expect(ETAPES_PUBLIQUES.has("signup_started")).toBe(true);
    expect(ETAPES_PUBLIQUES.has("checkout_completed")).toBe(false);
    expect(ETAPES_PUBLIQUES.has("trial_activated")).toBe(false);
    expect(ETAPES_PUBLIQUES.has("trial_expired")).toBe(false);
    expect(ETAPES_PUBLIQUES.has("subscription_activated")).toBe(false);
  });

  it("copies attribution into Stripe metadata only after consent", () => {
    expect(metadataAttributionFunnel("denied", visitorId, "google")).toEqual({});
    const metadata = metadataAttributionFunnel("accepted", visitorId, "google");
    expect(lireAttributionFunnel(metadata)).toEqual({
      visiteurId: visitorId,
      source: "google",
    });
  });

  it("uses an idempotent insert and accepts only known server events", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    expect(
      await enregistrerEtape({
        etape: "checkout_completed",
        visiteurId: visitorId,
        cleIdempotence: "checkout_completed:evt_123",
      }),
    ).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (cle_idempotence)"),
      expect.any(Array),
    );
    query.mockClear();
    expect(await enregistrerEtape({ etape: "privileged_fake_event" })).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("campagne UTM : normalisation, consentement, metadonnees Stripe", () => {
  beforeEach(() => query.mockReset());

  const instagram = { utm_source: "Instagram", utm_medium: "social", utm_campaign: "reel_oct-2026.v1" };

  it("met en minuscules et garde les valeurs conformes", () => {
    expect(normaliserCampagne("accepted", instagram)).toEqual({
      utmSource: "instagram", utmMedium: "social", utmCampaign: "reel_oct-2026.v1",
    });
  });

  it("ignore chaque valeur invalide, sans tronquer ni rejeter les autres", () => {
    expect(normaliserCampagne("accepted", {
      utm_source: "instagram",
      utm_medium: "a".repeat(65),
      utm_campaign: "jean.dupont@example.com",
    })).toEqual({ utmSource: "instagram", utmMedium: null, utmCampaign: null });
    expect(normaliserCampagne("accepted", { utm_source: "été", utm_medium: "", utm_campaign: ["x"] })).toBeNull();
    expect(normaliserCampagne("accepted", { utm_source: "a b" })).toBeNull();
    expect(normaliserCampagne("accepted", { utm_source: "a".repeat(64) })?.utmSource).toBe("a".repeat(64));
    expect(normaliserCampagne("accepted", null)).toBeNull();
  });

  it("sans consentement accepte, aucune campagne", () => {
    expect(normaliserCampagne("refused", instagram)).toBeNull();
    expect(normaliserCampagne(undefined, instagram)).toBeNull();
    expect(normaliserAttributionFunnel("refused", visitorId, "social", instagram)).toBeNull();
    expect(metadataAttributionFunnel("refused", visitorId, "social", instagram)).toEqual({});
  });

  it("metadonnees Stripe exactes : fp_utm_* et rien d'autre", () => {
    expect(metadataAttributionFunnel("accepted", visitorId, "social", instagram)).toStrictEqual({
      fp_analytics_consent: "accepted",
      fp_visitor_id: visitorId,
      fp_source: "social",
      fp_utm_source: "instagram",
      fp_utm_medium: "social",
      fp_utm_campaign: "reel_oct-2026.v1",
    });
    // Une valeur invalide n'ajoute pas de cle vide.
    expect(metadataAttributionFunnel("accepted", visitorId, "social", { utm_source: "instagram", utm_campaign: "!!" }))
      .toStrictEqual({
        fp_analytics_consent: "accepted",
        fp_visitor_id: visitorId,
        fp_source: "social",
        fp_utm_source: "instagram",
      });
  });

  it("compatibilite : un appel sans campagne produit exactement l'ancien resultat", () => {
    expect(normaliserAttributionFunnel("accepted", visitorId, "google")).toStrictEqual({
      visiteurId: visitorId, source: "google",
    });
    expect(metadataAttributionFunnel("accepted", visitorId, "google", {})).toStrictEqual({
      fp_analytics_consent: "accepted", fp_visitor_id: visitorId, fp_source: "google",
    });
    expect(lireAttributionFunnel({ fp_analytics_consent: "accepted", fp_visitor_id: visitorId })).toStrictEqual({
      visiteurId: visitorId, source: null,
    });
  });

  it("aller-retour Stripe : la campagne relue des metadonnees est identique, et re-ecrite a l'identique", () => {
    const meta = metadataAttributionFunnel("accepted", visitorId, "social", instagram);
    const relue = lireAttributionFunnel(meta);
    expect(relue?.campagne).toEqual({ utmSource: "instagram", utmMedium: "social", utmCampaign: "reel_oct-2026.v1" });
    expect(metadataDepuisAttribution(relue)).toStrictEqual(meta);
    // Une metadonnee falsifiee hors motif n'est pas relue.
    expect(lireAttributionFunnel({ ...meta, fp_utm_campaign: "<script>" })?.campagne?.utmCampaign).toBeNull();
  });

  it("enregistrerEtape : sans campagne, la requete d'origine a 6 parametres", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    await enregistrerEtape({ etape: "landing_vue", visiteurId: visitorId, source: "social" });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).not.toContain("utm_");
    expect(params).toHaveLength(6);
  });

  it("enregistrerEtape : avec campagne, les trois colonnes utm sont ecrites", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    await enregistrerEtape({
      etape: "trial_activated", visiteurId: visitorId, source: "social",
      campagne: { utmSource: "instagram", utmMedium: null, utmCampaign: "reel_oct" },
    });
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("utm_source, utm_medium, utm_campaign");
    expect(params).toEqual(["trial_activated", visitorId, null, null, "social", null, "instagram", null, "reel_oct"]);
  });

  it("enregistrerEtape : colonnes absentes (migration non appliquee) -> l'etape est gardee sans campagne", async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error('column "utm_source" does not exist'), { code: "42703" }))
      .mockResolvedValueOnce({ rowCount: 1 });
    expect(await enregistrerEtape({
      etape: "subscription_activated", visiteurId: visitorId,
      campagne: { utmSource: "instagram", utmMedium: null, utmCampaign: null },
    })).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![1]).toHaveLength(6);
  });
});

describe("plage de l'endpoint admin d'attribution", () => {
  it("exige from et to valides", () => {
    expect(validerPlageAttribution(undefined, "2026-10-01").ok).toBe(false);
    expect(validerPlageAttribution("2026-10-01", undefined).ok).toBe(false);
    expect(validerPlageAttribution("2026-02-30", "2026-03-01").ok).toBe(false);
    expect(validerPlageAttribution("2026-10-1", "2026-10-02").ok).toBe(false);
    expect(validerPlageAttribution(["2026-10-01"], "2026-10-02").ok).toBe(false);
    expect(validerPlageAttribution("2026-10-02", "2026-10-01").ok).toBe(false);
  });

  it("accepte 400 jours bornes incluses, refuse 401", () => {
    expect(validerPlageAttribution("2026-10-01", "2026-10-01")).toEqual({ ok: true, du: "2026-10-01", au: "2026-10-01" });
    expect(validerPlageAttribution("2025-01-01", "2026-02-04").ok).toBe(true);   // 400 jours
    expect(validerPlageAttribution("2025-01-01", "2026-02-05").ok).toBe(false);  // 401 jours
  });
});
