/**
 * ai-tool-gate.test.ts — Régression Phase 3.1
 *
 * Vérifie que la porte d'entrée du tool-calling (hasAnyToolPermission) accepte
 * un utilisateur ayant uniquement calendar.read/write — sans missions.read —
 * et que les outils missions restent bloqués (fail-closed) pour ce même
 * utilisateur.
 *
 * Contexte : avant le correctif Phase 3.1, la porte testait uniquement
 * effectivePerms.has("missions.read"), bloquant silencieusement les
 * utilisateurs calendar-only.  Le correctif utilise désormais :
 *   ALL_TOOLS.some(t => effectivePerms.has(t.requiredPermission))
 */

import { describe, it, expect } from "vitest";
import { CALENDAR_TOOLS } from "./calendar-tools.js";
import { MISSION_TOOLS } from "./mission-tools.js";

// Réplique exacte de la logique de la porte dans routes/ai.ts
// (lignes 1211-1213 — tenue en sync avec le code de production)
function hasAnyToolPermission(
  allTools: Array<{ requiredPermission: string }>,
  effectivePerms: Set<string>
): boolean {
  return allTools.some((t) => effectivePerms.has(t.requiredPermission));
}

const ALL_TOOLS = [...MISSION_TOOLS, ...CALENDAR_TOOLS];

// ──────────────────────────────────────────────────────────────────────────────
// §1 — calendar.read seul → porte ouverte (régression principale)
// ──────────────────────────────────────────────────────────────────────────────
describe("hasAnyToolPermission — régression porte calendar-only", () => {
  it("calendar.read seul → hasAnyToolPermission = true", () => {
    const perms = new Set(["calendar.read"]);
    expect(hasAnyToolPermission(ALL_TOOLS, perms)).toBe(true);
  });

  it("calendar.write seul → hasAnyToolPermission = true", () => {
    const perms = new Set(["calendar.write"]);
    expect(hasAnyToolPermission(ALL_TOOLS, perms)).toBe(true);
  });

  it("calendar.delete seul → hasAnyToolPermission = true", () => {
    const perms = new Set(["calendar.delete"]);
    expect(hasAnyToolPermission(ALL_TOOLS, perms)).toBe(true);
  });

  it("calendar.write + calendar.read (sans missions.read) → hasAnyToolPermission = true", () => {
    // Rôle 'member' : a calendar.write + calendar.read, pas missions.read
    const perms = new Set(["calendar.read", "calendar.write", "overview.read"]);
    expect(hasAnyToolPermission(ALL_TOOLS, perms)).toBe(true);
  });

  it("set vide → hasAnyToolPermission = false", () => {
    expect(hasAnyToolPermission(ALL_TOOLS, new Set())).toBe(false);
  });

  it("permissions sans rapport avec les outils → hasAnyToolPermission = false", () => {
    const perms = new Set(["billing.read", "settings.read", "team.read"]);
    expect(hasAnyToolPermission(ALL_TOOLS, perms)).toBe(false);
  });

  it("missions.read seul → hasAnyToolPermission = true (non-régression Phase 2)", () => {
    expect(hasAnyToolPermission(ALL_TOOLS, new Set(["missions.read"]))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §2 — isolation fail-closed : calendar.read n'ouvre PAS les outils missions
// ──────────────────────────────────────────────────────────────────────────────
describe("fail-closed : outils missions bloqués avec calendar.read uniquement", () => {
  const calendarOnlyPerms = new Set(["calendar.read", "calendar.write"]);

  it("search_mission exige missions.read — bloqué avec calendar.read uniquement", () => {
    const tool = MISSION_TOOLS.find((t) => t.name === "search_mission");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(false);
  });

  it("create_mission exige missions.write — bloqué avec calendar.read uniquement", () => {
    const tool = MISSION_TOOLS.find((t) => t.name === "create_mission");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(false);
  });

  it("delete_mission exige missions.delete — bloqué avec calendar.read uniquement", () => {
    const tool = MISSION_TOOLS.find((t) => t.name === "delete_mission");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(false);
  });

  it("TOUS les outils missions sont bloqués avec calendar.read uniquement", () => {
    const blocked = MISSION_TOOLS.filter(
      (t) => !calendarOnlyPerms.has(t.requiredPermission)
    );
    expect(blocked).toHaveLength(MISSION_TOOLS.length);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §3 — outils calendrier accessibles avec calendar.read
// ──────────────────────────────────────────────────────────────────────────────
describe("outils calendrier accessibles avec calendar.read ou calendar.write", () => {
  const calendarOnlyPerms = new Set(["calendar.read", "calendar.write"]);

  it("search_calendar_event exige calendar.read — autorisé", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "search_calendar_event");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(true);
  });

  it("create_calendar_event exige calendar.write — autorisé", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "create_calendar_event");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(true);
  });

  it("move_calendar_event exige calendar.write — autorisé", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "move_calendar_event");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(true);
  });

  it("delete_calendar_event exige calendar.delete — bloqué sans calendar.delete", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "delete_calendar_event");
    expect(tool).toBeDefined();
    expect(calendarOnlyPerms.has(tool!.requiredPermission)).toBe(false);
  });

  it("delete_calendar_event accessible avec calendar.delete explicite", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "delete_calendar_event");
    const fullPerms = new Set(["calendar.read", "calendar.write", "calendar.delete"]);
    expect(fullPerms.has(tool!.requiredPermission)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §4 — tous les outils déclarés ont un requiredPermission connu
// ──────────────────────────────────────────────────────────────────────────────
describe("intégrité des déclarations d'outils", () => {
  const KNOWN_PERMISSIONS = new Set([
    "overview.read", "missions.read", "missions.write", "missions.delete",
    "calendar.read", "calendar.write", "calendar.delete",
    "audits.read", "monitors.read", "keywords.read", "competitors.read",
    "reports.read", "team.read", "settings.read", "settings.admin",
    "billing.read", "ai.read", "localseo.read", "alerts.read",
    "analytics.read", "conversion.read", "activity.read",
  ]);

  it("tous les CALENDAR_TOOLS ont un requiredPermission dans PERMISSION_CATALOG", () => {
    for (const tool of CALENDAR_TOOLS) {
      expect(
        KNOWN_PERMISSIONS.has(tool.requiredPermission),
        `${tool.name}.requiredPermission="${tool.requiredPermission}" absent du catalogue`
      ).toBe(true);
    }
  });

  it("tous les MISSION_TOOLS ont un requiredPermission dans PERMISSION_CATALOG", () => {
    for (const tool of MISSION_TOOLS) {
      expect(
        KNOWN_PERMISSIONS.has(tool.requiredPermission),
        `${tool.name}.requiredPermission="${tool.requiredPermission}" absent du catalogue`
      ).toBe(true);
    }
  });
});
