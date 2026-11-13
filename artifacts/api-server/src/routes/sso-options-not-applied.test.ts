/**
 * sso-options-not-applied.test.ts — constat C-11 de l'audit du 08/11/2026.
 *
 * Les options SSO (obligation de SSO, provisionnement automatique) etaient
 * enregistrees mais appliquees nulle part : l'API affirmait donc une protection
 * inexistante. L'etat doit etre explicite : jamais « actif ».
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));
vi.mock("../middlewares/requireAdmin.js", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const svc = vi.hoisted(() => ({
  getSSODashboard: vi.fn(),
  updateSSOProvider: vi.fn(),
  getOrgAuthConfig: vi.fn(),
}));
vi.mock("../services/sso-service.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, ...svc };
});

import ssoRouter from "./sso.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { orgId: "org-a" }); next(); });
  app.use("/api", ssoRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.updateSSOProvider.mockResolvedValue({});
  svc.getSSODashboard.mockResolvedValue({ policies: { requireMFA: true, enforceSSO: true, sessionTimeout: 30 } });
  svc.getOrgAuthConfig.mockResolvedValue({ enforceSso: true });
});

describe("C-11 : options SSO non appliquees", () => {
  it.each([{ enforce_sso: true }, { auto_provision: true }, { enabled: true }])(
    "PATCH /sso/providers/:id refuse %j (501) au lieu de l'enregistrer",
    async (corps) => {
      const r = await request(makeApp()).patch("/api/sso/providers/p1").send(corps);
      expect(r.status).toBe(501);
      expect(r.body.error).toBe("SSO_NOT_IMPLEMENTED");
      expect(svc.updateSSOProvider).not.toHaveBeenCalled();
    },
  );

  it("PATCH /sso/providers/:id reste possible pour desactiver une option ou changer le domaine", async () => {
    const r = await request(makeApp()).patch("/api/sso/providers/p1").send({ enforce_sso: false, domain: "exemple.fr" });
    expect(r.status).toBe(200);
    expect(svc.updateSSOProvider).toHaveBeenCalledTimes(1);
  });

  it("GET /sso/policies n'affirme jamais que le SSO est impose", async () => {
    const r = await request(makeApp()).get("/api/sso/policies");
    expect(r.status).toBe(200);
    expect(r.body.enforceSSO).toBe(false);
    expect(r.body.applied).toBe(false);
    expect(r.body.status).toBe("not_implemented");
    expect(r.body.sessionTimeout).toBe(30);
  });

  it("GET /sso/auth-config porte un etat explicite « non applique »", async () => {
    const r = await request(makeApp()).get("/api/sso/auth-config");
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(false);
    expect(r.body.status).toBe("not_implemented");
  });
});
