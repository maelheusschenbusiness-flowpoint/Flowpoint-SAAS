import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => query(...args) },
}));

import {
  ETAPES_PUBLIQUES,
  enregistrerEtape,
  horodatageEtape,
  lireAttributionFunnel,
  metadataAttributionFunnel,
  normaliserAttributionFunnel,
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

  it("returns the persisted timestamp for an idempotent funnel event", async () => {
    const createdAt = new Date("2026-10-21T08:15:30.123Z");
    query.mockResolvedValue({ rows: [{ created_at: createdAt }] });

    await expect(horodatageEtape("landing_vue:visitor:2026-10-21")).resolves.toBe(
      createdAt.toISOString(),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT created_at FROM funnel_events"),
      ["landing_vue:visitor:2026-10-21"],
    );
  });
});
