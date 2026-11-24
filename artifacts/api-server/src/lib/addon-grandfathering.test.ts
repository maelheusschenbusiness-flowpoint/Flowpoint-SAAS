/**
 * Droits acquis (grandfathering) de keywordDomination sur Ultra.
 *
 * La matrice officielle n'inclut plus keywordDomination dans Ultra (achat separe
 * Pro/Ultra) ; une organisation creee AVANT GRANDFATHER_CUTOFF_ISO conserve ce droit
 * (jamais retire a un abonne existant), les nouvelles suivent la matrice.
 * Le test exerce la vraie fonction d'entitlement (loadBillingContext) : c'est elle
 * qui alimente /api/me et les gardes de fonctionnalite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadOrgDataMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
  },
}));
vi.mock("../services/org-data.js", () => ({ loadOrgData: loadOrgDataMock }));

import { loadBillingContext } from "../services/billing-context.js";

const ORG = "0d9e2f6a-1b3c-4d5e-8f70-123456789abc";

function orgRow(plan: string, createdAt: string | null) {
  return {
    plan,
    subscriptionStatus: "active",
    stripeCustomerId: "cus_x",
    stripeSubscriptionId: "sub_x",
    trialEndsAt: null,
    trialConsumedAt: "2025-01-01T00:00:00.000Z",
    trialStartedAt: null,
    addons: {},
    pendingPlan: null,
    pendingPlanDate: null,
    email: "o@example.com",
    firstName: "O",
    orgName: "Org",
    isInternalQa: false,
    createdAt,
  };
}

describe("grandfathering des inclusions (loadBillingContext)", () => {
  beforeEach(() => loadOrgDataMock.mockReset());

  it("Ultra cree avant la bascule : conserve keywordDomination, herite de retention90d", async () => {
    loadOrgDataMock.mockResolvedValue(orgRow("ultra", "2026-06-01T00:00:00.000Z"));
    const ctx = await loadBillingContext(ORG);
    expect(ctx.addons["keywordDomination"]).toBe(true);
    expect(ctx.addons["retention90d"]).toBe(true);
    expect(ctx.addons["retention365d"]).toBe(true);
  });

  it("Ultra cree apres la bascule : matrice officielle (pas de keywordDomination inclus)", async () => {
    loadOrgDataMock.mockResolvedValue(orgRow("ultra", "2026-11-26T09:00:00.000Z"));
    const ctx = await loadBillingContext(ORG);
    expect(ctx.addons["keywordDomination"]).toBeUndefined();
    expect(ctx.addons["retention90d"]).toBe(true);
  });

  it("Pro et Standard anciens : aucun droit ajoute", async () => {
    for (const plan of ["pro", "standard"]) {
      loadOrgDataMock.mockResolvedValue(orgRow(plan, "2026-01-01T00:00:00.000Z"));
      const ctx = await loadBillingContext(ORG);
      expect(ctx.addons["keywordDomination"], plan).toBeUndefined();
    }
  });

  it("un droit achete (org_addons / JSONB) n'est jamais retire par la bascule", async () => {
    loadOrgDataMock.mockResolvedValue({
      ...orgRow("ultra", "2026-11-26T09:00:00.000Z"),
      addons: { keywordDomination: true },
    });
    const ctx = await loadBillingContext(ORG);
    expect(ctx.addons["keywordDomination"]).toBe(true);
  });
});
