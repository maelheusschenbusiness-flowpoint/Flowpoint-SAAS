/**
 * addon-ai-workspace-launch-removed.test.ts — TEST BLOQUANT (route)
 *
 * AI Workspace Launch (aiWorkspaceLaunch) est retire definitivement de l'offre
 * (arbitrage du proprietaire, 24/11/2026). La cle reste reconnue comme retiree :
 *   - POST /addons/aiWorkspaceLaunch/activate -> 410 ADDON_REMOVED (comme prioritySupport),
 *     jamais 503 « coming soon » ; ni Stripe ni la base ne sont appeles ;
 *   - GET /addons ne la publie ni dans `definitions` ni dans `addons`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let stripeSyncCalls: unknown[];
let activateCalls: unknown[];

vi.mock("../services/addon-stripe-sync.js", () => ({
  syncAddonWithStripe: vi.fn(async (...args: unknown[]) => {
    stripeSyncCalls.push(args);
    return { synced: true, reason: "item_added" };
  }),
}));

vi.mock("../services/addons-service.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/plans.js")>("../lib/plans.js");
  return {
    activateAddon: vi.fn(async (...args: unknown[]) => {
      activateCalls.push(args);
      return true;
    }),
    deactivateAddon: vi.fn(async () => true),
    getOrgAddons: vi.fn(async () => ({ aiWorkspaceLaunch: true, monitorsPack10: 1 })),
    addExtraAICredits: vi.fn(async () => true),
    getQuotaLimits: vi.fn(() => ({ audits: 0, monitors: 0, reports: 0, exports: 0, seats: 0, retention: 30 })),
    ADDON_DEFINITIONS: Object.fromEntries(
      Object.entries(actual.ADDON_DEFINITIONS).map(([k, d]) => [k, { name: d.name }]),
    ),
  };
});

vi.mock("../services/org-data.js", () => ({
  loadOrgData: vi.fn(async () => ({ plan: "ultra", addons: { aiWorkspaceLaunch: true } })),
}));

vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn(async () => {}), broadcast: vi.fn() },
}));

vi.mock("../middlewares/requireRole.js", () => ({
  ownerOnly: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
  orgAddonsTable: {},
}));

async function buildApp() {
  const { default: addonsRouter } = await import("./addons.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { orgId: string }).orgId = "org-awl-removed";
    next();
  });
  app.use(addonsRouter);
  return app;
}

beforeEach(() => {
  stripeSyncCalls = [];
  activateCalls = [];
});

describe("aiWorkspaceLaunch : retire (410 comme prioritySupport)", () => {
  it.each(["aiWorkspaceLaunch", "prioritySupport"])("POST /addons/%s/activate -> 410 ADDON_REMOVED, aucun effet de bord", async (key) => {
    const app = await buildApp();
    const res = await request(app).post(`/addons/${key}/activate`).send({});
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("ADDON_REMOVED");
    expect(res.body.code).not.toBe("ADDON_COMING_SOON");
    expect(stripeSyncCalls).toEqual([]);
    expect(activateCalls).toEqual([]);
  });

  it("GET /addons ne publie pas la cle retiree (definitions ni droits affiches)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/addons");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.definitions)).not.toContain("aiWorkspaceLaunch");
    expect(Object.keys(res.body.addons)).not.toContain("aiWorkspaceLaunch");
    expect(Object.keys(res.body.orgAddons ?? {})).toContain("monitorsPack10");
  });
});
