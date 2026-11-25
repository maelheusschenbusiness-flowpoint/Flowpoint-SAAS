/**
 * resolveOrgAddonEntitlement : meme regle que requireAddon (inclus dans le plan OU add-on actif),
 * mais par identifiant d'organisation (ingestion publique), avec cache court.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ plan: "standard" as string | null, addonRows: [] as Array<{ active: boolean }>, addonErr: false, calls: 0 }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({
      query: async (sql: string) => {
        st.calls++;
        if (/FROM organizations/.test(sql)) {
          if (st.plan === null) throw new Error("db down");
          return { rows: [{ plan: st.plan }] };
        }
        if (/FROM org_addons/.test(sql)) {
          if (st.addonErr) throw new Error("addons down");
          return { rows: st.addonRows };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  },
}));

import { resolveOrgAddonEntitlement, clearAddonEntitlementCache } from "./planGate.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const env = process.env["NODE_ENV"];
beforeEach(() => {
  st.plan = "standard"; st.addonRows = []; st.addonErr = false; st.calls = 0;
  clearAddonEntitlementCache();
  process.env["NODE_ENV"] = env;
});

describe("resolveOrgAddonEntitlement", () => {
  it("inclus dans le plan (ultra) : granted sans lire org_addons", async () => {
    st.plan = "ultra";
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("granted");
  });
  it("plan standard sans add-on : denied", async () => {
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("denied");
  });
  it("add-on actif : granted ; add-on inactif : denied", async () => {
    st.addonRows = [{ active: true }];
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("granted");
    clearAddonEntitlementCache();
    st.addonRows = [{ active: false }];
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("denied");
  });
  it("cache court : une seconde resolution ne relit pas la base ; la revocation prend effet apres vidage", async () => {
    st.addonRows = [{ active: true }];
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("granted");
    const calls = st.calls;
    st.addonRows = [{ active: false }];
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("granted");
    expect(st.calls).toBe(calls);
    clearAddonEntitlementCache();
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("denied");
  });
  it("le cache est par organisation et par add-on", async () => {
    st.addonRows = [{ active: true }];
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("granted");
    st.addonRows = [];
    expect(await resolveOrgAddonEntitlement("22222222-2222-4222-8222-222222222222", "behavioralAI")).toBe("denied");
    expect(await resolveOrgAddonEntitlement(ORG, "revenueLeak")).toBe("denied");
  });
  it("production : erreur base -> unavailable (jamais granted) et rien n'est mis en cache", async () => {
    process.env["NODE_ENV"] = "production";
    st.plan = null;
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("unavailable");
    st.plan = "ultra";
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("granted");
    clearAddonEntitlementCache();
    st.addonErr = true; st.plan = "standard";
    expect(await resolveOrgAddonEntitlement(ORG, "behavioralAI")).toBe("unavailable");
  });
  it("organisation 'default' : refuse en production", async () => {
    process.env["NODE_ENV"] = "production";
    expect(await resolveOrgAddonEntitlement("default", "behavioralAI")).toBe("denied");
  });
});
