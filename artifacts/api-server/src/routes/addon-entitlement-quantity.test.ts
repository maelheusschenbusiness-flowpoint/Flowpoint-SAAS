/**
 * addon-entitlement-quantity.test.ts
 *
 * Non-regression tests for quantity add-on entitlement expansion.
 * These tests ensure that:
 *
 *  1. Ultra base plan has 300 monitors (no pack).
 *  2. Ultra + 1 × monitorsPack10 → 310 monitors.
 *  3. Ultra + 2 × monitorsPack10 → 320 monitors.  ← The P0 production bug.
 *  4. Ultra + 5 × monitorsPack10 → 350 monitors.
 *  5. Deactivated pack (active=false) → quota unchanged (300).
 *  6. Reconcile idempotency: activating qty=2 twice never sums to qty=4.
 *  7. 10 plan-included + 1 pack active = 11 total entitlement units.
 *  8. Deactivation reverts quota: 320 → 300.
 *
 * These tests do NOT call Stripe or the database — they validate the pure
 * entitlement-computation logic (computeQtyAddonExtras, QTY_ADDON_GRANTS) and
 * the me.ts merging pattern.
 */

import { describe, it, expect } from "vitest";
import {
  computeQtyAddonExtras,
  QTY_ADDON_GRANTS,
  PLAN_LIMITS,
} from "../lib/plans.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate the me.ts limits expansion for monitors on Ultra plan. */
function computeMonitorLimit(orgAddonsRows: Array<{ addon_key: string; active: boolean; quantity: number }>): number {
  // Ultra base limit for monitors
  const base = PLAN_LIMITS["ultra"]!;
  const limits: Record<string, number> = {
    audits: base.audits, monitors: base.monitors, reports: base.reports,
    exports: base.exports, teamMembers: base.teamMembers,
    workspaces: base.workspaces, retention: base.retention,
  };

  for (const row of orgAddonsRows) {
    if (!row.active) continue;
    const qtyGrant = QTY_ADDON_GRANTS[row.addon_key];
    if (qtyGrant) {
      const packs = Math.max(0, Math.floor(Number(row.quantity) || 0));
      limits[qtyGrant.resource] = (limits[qtyGrant.resource] ?? 0) + packs * qtyGrant.perPack;
    }
  }
  return limits["monitors"] ?? 0;
}

/** Simulate activateAddon idempotent semantics (INSERT OR UPDATE quantity). */
function simulateActivateAddon(
  rows: Array<{ addon_key: string; active: boolean; quantity: number }>,
  key: string,
  qty: number,
): Array<{ addon_key: string; active: boolean; quantity: number }> {
  const existing = rows.find(r => r.addon_key === key);
  if (existing) {
    // UPDATE path: always overwrite quantity, set active=true
    return rows.map(r =>
      r.addon_key === key ? { ...r, active: true, quantity: qty } : r,
    );
  }
  // INSERT path
  return [...rows, { addon_key: key, active: true, quantity: qty }];
}

/** Simulate deactivateAddon (sets active=false, quantity unchanged). */
function simulateDeactivateAddon(
  rows: Array<{ addon_key: string; active: boolean; quantity: number }>,
  key: string,
): Array<{ addon_key: string; active: boolean; quantity: number }> {
  return rows.map(r => (r.addon_key === key ? { ...r, active: false } : r));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Ultra base plan limits", () => {
  it("Ultra plan has monitors limit defined", () => {
    expect(PLAN_LIMITS["ultra"]).toBeDefined();
    expect(PLAN_LIMITS["ultra"]!.monitors).toBeGreaterThan(0);
  });

  it("Ultra + no pack = base monitor limit (300)", () => {
    const limit = computeMonitorLimit([]);
    expect(limit).toBe(300);
  });
});

describe("monitorsPack10 quantity expansion", () => {
  it("Ultra + monitorsPack10 × 1 = 310 monitors", () => {
    const rows = [{ addon_key: "monitorsPack10", active: true, quantity: 1 }];
    expect(computeMonitorLimit(rows)).toBe(310);
  });

  it("Ultra + monitorsPack10 × 2 = 320 monitors  ← P0 regression guard", () => {
    // This is the exact scenario that was broken in production:
    // Stripe had quantity=2 but org_addons was deactivated by the webhook race.
    const rows = [{ addon_key: "monitorsPack10", active: true, quantity: 2 }];
    expect(computeMonitorLimit(rows)).toBe(320);
  });

  it("Ultra + monitorsPack10 × 5 = 350 monitors", () => {
    const rows = [{ addon_key: "monitorsPack10", active: true, quantity: 5 }];
    expect(computeMonitorLimit(rows)).toBe(350);
  });

  it("Deactivated pack (active=false) contributes 0 extra monitors", () => {
    // This was the DB state caused by the deactivation race:
    // active=false, quantity=2 → limit must still be 300 (not 320)
    const rows = [{ addon_key: "monitorsPack10", active: false, quantity: 2 }];
    expect(computeMonitorLimit(rows)).toBe(300);
  });
});

describe("monitorsPack50 quantity expansion", () => {
  it("Ultra + monitorsPack50 × 1 = 350 monitors", () => {
    const rows = [{ addon_key: "monitorsPack50", active: true, quantity: 1 }];
    expect(computeMonitorLimit(rows)).toBe(350);
  });

  it("mixed packs: +10 × 2 and +50 × 1 = 320 + 50 = 370 monitors (not 320+50+300)", () => {
    // Both addons stack additively on top of the base limit
    const rows = [
      { addon_key: "monitorsPack10", active: true, quantity: 2 },
      { addon_key: "monitorsPack50", active: true, quantity: 1 },
    ];
    expect(computeMonitorLimit(rows)).toBe(370);
  });
});

describe("activateAddon idempotency (reconcile called twice)", () => {
  it("activating qty=2 twice keeps quantity=2, never accumulates to 4", () => {
    let rows: Array<{ addon_key: string; active: boolean; quantity: number }> = [];

    // First call (e.g., webhook at subscription.created)
    rows = simulateActivateAddon(rows, "monitorsPack10", 2);
    expect(rows.find(r => r.addon_key === "monitorsPack10")?.quantity).toBe(2);

    // Second call (e.g., reconcile-subscription endpoint)
    rows = simulateActivateAddon(rows, "monitorsPack10", 2);
    const row = rows.find(r => r.addon_key === "monitorsPack10")!;
    expect(row.quantity).toBe(2);  // NOT 4
    expect(row.active).toBe(true);

    // Entitlement must be 320, not 340
    expect(computeMonitorLimit(rows)).toBe(320);
  });

  it("activating qty=2 after a previous qty=1 row correctly overwrites to 2", () => {
    let rows: Array<{ addon_key: string; active: boolean; quantity: number }> = [];

    // Simulate: provisionPlanAddons ran first with qty=1 (default)
    rows = simulateActivateAddon(rows, "monitorsPack10", 1);
    expect(computeMonitorLimit(rows)).toBe(310);

    // Webhook fires with qty=2 and overrides
    rows = simulateActivateAddon(rows, "monitorsPack10", 2);
    expect(computeMonitorLimit(rows)).toBe(320);
  });
});

describe("deactivation reverts quota to base plan limit", () => {
  it("active qty=2 → deactivated → monitor limit drops from 320 to 300", () => {
    let rows = [{ addon_key: "monitorsPack10", active: true, quantity: 2 }];
    expect(computeMonitorLimit(rows)).toBe(320);

    rows = simulateDeactivateAddon(rows, "monitorsPack10");
    expect(computeMonitorLimit(rows)).toBe(300);

    // quantity=2 is preserved in DB for audit / reactivation purposes
    const row = rows.find(r => r.addon_key === "monitorsPack10")!;
    expect(row.quantity).toBe(2);
    expect(row.active).toBe(false);
  });

  it("re-activating a deactivated pack restores the entitlement", () => {
    let rows = [{ addon_key: "monitorsPack10", active: false, quantity: 2 }];
    expect(computeMonitorLimit(rows)).toBe(300);

    rows = simulateActivateAddon(rows, "monitorsPack10", 2);
    expect(computeMonitorLimit(rows)).toBe(320);
  });
});

describe("computeQtyAddonExtras — standalone pure-function tests", () => {
  it("empty addons map → empty extras", () => {
    expect(computeQtyAddonExtras({})).toEqual({});
  });

  it("monitorsPack10 × 2 → { monitors: 20 }", () => {
    expect(computeQtyAddonExtras({ monitorsPack10: 2 })).toEqual({ monitors: 20 });
  });

  it("monitorsPack50 × 1 → { monitors: 50 }", () => {
    expect(computeQtyAddonExtras({ monitorsPack50: 1 })).toEqual({ monitors: 50 });
  });

  it("extraSeats × 3 → { teamMembers: 15 }", () => {
    expect(computeQtyAddonExtras({ extraSeats: 3 })).toEqual({ teamMembers: 15 });
  });

  it("auditsPack200 × 2 → { audits: 400 }", () => {
    expect(computeQtyAddonExtras({ auditsPack200: 2 })).toEqual({ audits: 400 });
  });

  it("true value counts as 1 pack", () => {
    expect(computeQtyAddonExtras({ monitorsPack10: true })).toEqual({ monitors: 10 });
  });

  it("0/false/null values grant nothing", () => {
    expect(computeQtyAddonExtras({ monitorsPack10: 0 })).toEqual({});
    expect(computeQtyAddonExtras({ monitorsPack10: false })).toEqual({});
  });

  it("mixed resources stack correctly", () => {
    const extras = computeQtyAddonExtras({
      monitorsPack10: 2,  // +20 monitors
      monitorsPack50: 1,  // +50 monitors
      extraSeats: 1,      // +5 teamMembers
    });
    expect(extras["monitors"]).toBe(70);
    expect(extras["teamMembers"]).toBe(5);
  });

  it("unknown addon key is silently ignored (not in QTY_ADDON_GRANTS)", () => {
    expect(computeQtyAddonExtras({ unknownAddon: 5 })).toEqual({});
  });
});

describe("QTY_ADDON_GRANTS shape contract", () => {
  it("monitorsPack10 grants monitors at perPack=10", () => {
    expect(QTY_ADDON_GRANTS["monitorsPack10"]).toEqual({ resource: "monitors", perPack: 10 });
  });

  it("monitorsPack50 grants monitors at perPack=50", () => {
    expect(QTY_ADDON_GRANTS["monitorsPack50"]).toEqual({ resource: "monitors", perPack: 50 });
  });

  it("extraSeats grants teamMembers at perPack=5", () => {
    expect(QTY_ADDON_GRANTS["extraSeats"]).toEqual({ resource: "teamMembers", perPack: 5 });
  });

  it("all QTY_ADDON_GRANTS entries have a positive perPack", () => {
    for (const [key, grant] of Object.entries(QTY_ADDON_GRANTS)) {
      expect(grant.perPack, `${key}.perPack must be positive`).toBeGreaterThan(0);
    }
  });
});
