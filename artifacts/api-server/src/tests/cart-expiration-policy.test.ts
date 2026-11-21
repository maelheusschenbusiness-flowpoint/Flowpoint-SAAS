import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const policy = require(path.resolve(here, "../../../flowpoint-export/fp-cart-policy.js")) as {
  evaluate: (c: unknown, ctx?: Record<string, unknown>) => { action: string; reason: string; restamp?: boolean };
  restoreFromPending: (p: unknown, ctx?: Record<string, unknown>) => Record<string, unknown> | null;
  TTL_MS: number;
};

const NOW = 1_800_000_000_000;
const H = 3_600_000;
const v1 = (over: Record<string, unknown> = {}) => ({ _v: 1, _updatedAt: NOW - 1000, plan: "pro", addons: {}, ...over });

describe("politique d'expiration du panier (spécification, non branchée)", () => {
  it("garde un panier versionné frais", () => {
    expect(policy.evaluate(v1(), { now: NOW })).toMatchObject({ action: "keep", reason: "fresh" });
  });
  it("expire au-delà d'1 h, garde pile à 1 h", () => {
    expect(policy.evaluate(v1({ _updatedAt: NOW - H }), { now: NOW }).action).toBe("keep");
    expect(policy.evaluate(v1({ _updatedAt: NOW - H - 1 }), { now: NOW })).toMatchObject({ action: "drop", reason: "expired" });
  });
  it("refuse un horodatage futur au-delà de la tolérance", () => {
    expect(policy.evaluate(v1({ _updatedAt: NOW + 6 * 60_000 }), { now: NOW }).reason).toBe("future_timestamp");
    expect(policy.evaluate(v1({ _updatedAt: NOW + 60_000 }), { now: NOW }).action).toBe("keep");
  });
  it("refuse un panier versionné sans horodatage", () => {
    expect(policy.evaluate({ _v: 1, plan: "pro" }, { now: NOW }).reason).toBe("unstamped");
  });
  it("refuse une autre organisation, accepte la même", () => {
    expect(policy.evaluate(v1({ _orgId: "a" }), { now: NOW, orgId: "b" }).reason).toBe("org_mismatch");
    expect(policy.evaluate(v1({ _orgId: "a" }), { now: NOW, orgId: "a" }).action).toBe("keep");
  });
  it("rejette plan inconnu, add-ons invalides, panier vide ou non-objet", () => {
    expect(policy.evaluate(v1({ plan: "gold" }), { now: NOW }).reason).toBe("plan_unknown");
    expect(policy.evaluate(v1({ addons: [] }), { now: NOW }).reason).toBe("addons_invalid");
    expect(policy.evaluate(v1({ plan: null, addons: {} }), { now: NOW }).reason).toBe("empty");
    for (const bad of [null, undefined, "x", 3, []]) expect(policy.evaluate(bad, { now: NOW }).reason).toBe("absent_or_invalid");
  });
  it("ancien panier sans version avec plan : abandonné", () => {
    expect(policy.evaluate({ plan: "pro", addons: {} }, { now: NOW })).toMatchObject({ action: "drop", reason: "unversioned_legacy" });
  });
  it("relais tableau de bord (add-ons sans plan) : conservé et ré-horodaté", () => {
    expect(policy.evaluate({ plan: null, addons: { x: 1 }, fromDashboard: true }, { now: NOW }))
      .toMatchObject({ action: "keep", restamp: true });
  });
  it("relais tableau de bord avec plan ou sans add-on : abandonné", () => {
    expect(policy.evaluate({ plan: "pro", addons: { x: 1 }, fromDashboard: true }, { now: NOW }).action).toBe("drop");
    expect(policy.evaluate({ plan: null, addons: {}, fromDashboard: true }, { now: NOW }).action).toBe("drop");
  });
  it("reprise d'intention : expirée ou invalide → null ; valide → panier ré-horodaté", () => {
    expect(policy.restoreFromPending({ exp: NOW - 1, cart: v1() }, { now: NOW })).toBeNull();
    expect(policy.restoreFromPending({ exp: NOW + 1000 }, { now: NOW })).toBeNull();
    expect(policy.restoreFromPending(null, { now: NOW })).toBeNull();
    const r = policy.restoreFromPending({ exp: NOW + 1000, cart: v1({ _updatedAt: NOW - 5 * H }) }, { now: NOW });
    expect(r).toMatchObject({ _v: 1, _updatedAt: NOW, plan: "pro" });
  });
});
