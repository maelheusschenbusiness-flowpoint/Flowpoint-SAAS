/**
 * addons-provisioning.test.ts — provisionPlanAddons integration tests
 *
 * Proves that the webhook provisioning helper activates every addon bundled
 * in a plan (PLAN_INCLUDED_ADDONS) without a manually populated org_addons row.
 *
 * Strategy: pass a stub activator via dependency injection (the optional 3rd
 * argument of provisionPlanAddons) so no real DB connection is required. The
 * stub records which keys were requested, letting us assert the full inclusion
 * set is provisioned for each plan.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLAN_INCLUDED_ADDONS } from "../lib/plans.js";
import { provisionPlanAddons } from "../services/addons-service.js";

// ── Shared stub activator ─────────────────────────────────────────────────────

let activatedKeys: string[];
let activatorStub: (key: string, orgId: string) => Promise<boolean>;

beforeEach(() => {
  activatedKeys = [];
  activatorStub = vi.fn().mockImplementation(async (key: string) => {
    activatedKeys.push(key);
    return true;
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("provisionPlanAddons — Pro plan", () => {
  it("provisions all bundled addons for Pro without manual org_addons rows", async () => {
    await provisionPlanAddons("pro", "org-pro", activatorStub);
    const expected = Array.from(PLAN_INCLUDED_ADDONS["pro"] ?? []);
    for (const key of expected) {
      expect(activatedKeys, `Expected '${key}' to be provisioned for Pro`).toContain(key);
    }
  });

  it("provisions whiteLabel for Pro (key part of the entitlement fix)", async () => {
    await provisionPlanAddons("pro", "org-pro", activatorStub);
    expect(activatedKeys).toContain("whiteLabel");
  });

  it("does not provision prioritySupport for Pro because it is not bundled", async () => {
    await provisionPlanAddons("pro", "org-pro", activatorStub);
    expect(activatedKeys).not.toContain("prioritySupport");
  });

  it("provisions advancedWebhooks + retention90d for Pro", async () => {
    await provisionPlanAddons("pro", "org-pro", activatorStub);
    expect(activatedKeys).toContain("advancedWebhooks");
    expect(activatedKeys).toContain("retention90d");
  });

  it("does NOT provision customDomain for Pro (Ultra-only bundled addon)", async () => {
    await provisionPlanAddons("pro", "org-pro", activatorStub);
    expect(activatedKeys).not.toContain("customDomain");
  });

  it("calls the activator exactly once per bundled key (no duplicates)", async () => {
    await provisionPlanAddons("pro", "org-pro", activatorStub);
    const unique = new Set(activatedKeys);
    expect(unique.size).toBe(activatedKeys.length);
  });
});

describe("provisionPlanAddons — Ultra plan", () => {
  it("provisions all bundled addons for Ultra (complete set)", async () => {
    await provisionPlanAddons("ultra", "org-ultra", activatorStub);
    const expected = Array.from(PLAN_INCLUDED_ADDONS["ultra"] ?? []);
    for (const key of expected) {
      expect(activatedKeys, `Expected '${key}' to be provisioned for Ultra`).toContain(key);
    }
  });

  it("provisions customDomain for Ultra (Ultra-only bundled addon)", async () => {
    await provisionPlanAddons("ultra", "org-ultra", activatorStub);
    expect(activatedKeys).toContain("customDomain");
  });

  it("provisions retention365d for Ultra", async () => {
    await provisionPlanAddons("ultra", "org-ultra", activatorStub);
    expect(activatedKeys).toContain("retention365d");
  });

  it("provisions keywordDomination, behavioralAI, aiForecasting for Ultra", async () => {
    await provisionPlanAddons("ultra", "org-ultra", activatorStub);
    expect(activatedKeys).toContain("keywordDomination");
    expect(activatedKeys).toContain("behavioralAI");
    expect(activatedKeys).toContain("aiForecasting");
  });

  it("provisions Pro inclusions while upgrading retention90d to retention365d", async () => {
    await provisionPlanAddons("ultra", "org-ultra", activatorStub);
    const proKeys = Array.from(PLAN_INCLUDED_ADDONS["pro"] ?? []);
    for (const key of proKeys) {
      if (key === "retention90d") continue;
      expect(activatedKeys, `Expected Pro key '${key}' in Ultra activation`).toContain(key);
    }
    expect(activatedKeys).not.toContain("retention90d");
    expect(activatedKeys).toContain("retention365d");
  });
});

describe("provisionPlanAddons — Standard plan", () => {
  it("provisions the canonical Standard inclusion set", async () => {
    await provisionPlanAddons("standard", "org-std", activatorStub);
    expect(activatedKeys).toEqual(Array.from(PLAN_INCLUDED_ADDONS["standard"] ?? []));
  });

  it("provisions whiteLabel for Standard", async () => {
    await provisionPlanAddons("standard", "org-std", activatorStub);
    expect(activatedKeys).toContain("whiteLabel");
  });
});

describe("provisionPlanAddons — activator called with correct orgId", () => {
  it("passes the orgId to every activator call", async () => {
    const calls: Array<[string, string]> = [];
    const trackingActivator = vi.fn().mockImplementation(async (key: string, orgId: string) => {
      calls.push([key, orgId]);
      return true;
    });
    await provisionPlanAddons("pro", "org-uuid-xyz", trackingActivator);
    for (const [, orgId] of calls) {
      expect(orgId).toBe("org-uuid-xyz");
    }
  });
});
