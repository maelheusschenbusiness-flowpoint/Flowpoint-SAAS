/**
 * C-04 — garde d'ecriture par defaut (writeRoleGuard), tests par role.
 *
 * Constat reproduit avant correctif : un viewer obtenait 201 sur
 * POST /integrations/connections (aucune garde de role sur la route).
 *
 * Ici : (1) la politique pure, (2) la garde montee sur des routes synthetiques,
 * (3) la garde montee devant de VRAIS routeurs (integrations, automation), avec
 * leurs dependances de service simulees, pour chaque role.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/integrations-service.js", () => ({
  createIntegration: vi.fn(async () => ({ id: "i1", name: "x", platform: "custom", endpoint_url: "https://example.com/h", events: [], headers: {} })),
  dispatchEvent: vi.fn(), testIntegration: vi.fn(), getIntegrationStats: vi.fn(),
  processIncomingWebhook: vi.fn(async () => ({ processed: true })), getIntegrationLimit: vi.fn(), SUPPORTED_EVENTS: [],
}));
vi.mock("../services/webhook-url-safety.js", () => ({
  validatePublicHttpsWebhook: async (u: string) => ({ ok: true, url: u }),
}));
vi.mock("../services/automation-service.js", () => ({ getWorkflowsData: vi.fn(), executeWorkflow: vi.fn() }));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_r: Request, _s: Response, n: NextFunction) => n(),
  requireFeature: () => (_r: Request, _s: Response, n: NextFunction) => n(),
  // Ajoute par #377/#385 sur POST /automation/workflows ; ce test verifie la garde de role, pas le quota.
  requireQuota: () => (_r: Request, _s: Response, n: NextFunction) => n(),
}));

const { writeRoleGuard, classifyWriteRoute, normalizeRoutePath, routePatternMatches } =
  await import("../middlewares/writeRoleGuard.js");
const integrationsRouter = (await import("../routes/integrations.js")).default;
const automationRouter = (await import("../routes/automation.js")).default;

type Role = "owner" | "admin" | "member" | "viewer";
const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

function appWith(role: string | null, mount: (a: express.Express) => void): express.Express {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      orgId: "org-a",
      orgContext: role ? { orgId: "org-a", userId: "u1", role } : { orgId: "org-a" },
      orgDb: async () => ({ rows: [{ id: "w1" }] }),
    });
    next();
  });
  a.use(writeRoleGuard);
  mount(a);
  return a;
}

describe("classification de la politique d'ecriture", () => {
  it.each([
    ["GET", "/integrations/connections", "read"],
    ["HEAD", "/white-label/templates", "read"],
    ["POST", "/automation/workflows", "member"],
    ["DELETE", "/team/files/abc", "member"],
    ["POST", "/ai/chat", "any-role"],
    ["POST", "/ai/summary", "any-role"],
    ["PATCH", "/notifications/read-all", "any-role"],
    ["POST", "/integrations/connections", "admin"],
    ["DELETE", "/integrations/connections/42", "admin"],
    ["PUT", "/white-label/anything", "admin"],
    ["POST", "/google/disconnect", "admin"],
    ["POST", "/crm/connect/hubspot", "admin"],
    ["POST", "/google/post", "member"],
    ["POST", "/addons/ai-credits/buy", "owner"],
  ])("%s %s -> %s", (m, p, expected) => {
    expect(classifyWriteRoute(m, p)).toBe(expected);
  });

  it("la casse et le slash final ne contournent pas la classe", () => {
    expect(classifyWriteRoute("POST", "/INTEGRATIONS/Connections/")).toBe("admin");
    expect(classifyWriteRoute("POST", "//integrations//connections")).toBe("admin");
    expect(classifyWriteRoute("POST", "/Google/Disconnect/")).toBe("admin");
    expect(normalizeRoutePath("/A//B/?x=1")).toBe("/a/b");
  });

  it("un joker de fin couvre le prefixe lui-meme", () => {
    expect(routePatternMatches("/integrations/*", "/integrations")).toBe(true);
    expect(routePatternMatches("/integrations/*", "/integrations/x/y")).toBe(true);
    expect(routePatternMatches("/integrations/*", "/integration")).toBe(false);
  });

  it("une exception exacte ne s'etend pas aux routes voisines", () => {
    expect(classifyWriteRoute("POST", "/ai/chat")).toBe("any-role");
    expect(classifyWriteRoute("POST", "/ai/chat/extra")).toBe("member");
    expect(classifyWriteRoute("POST", "/ai/actions/abc/undo")).toBe("member");
    expect(classifyWriteRoute("PATCH", "/me")).toBe("member");
  });
});

describe("garde par defaut — routes synthetiques", () => {
  const mount = (a: express.Express) => {
    const ok = (_q: Request, r: Response) => { r.json({ ok: true }); };
    a.post("/things", ok);
    a.get("/things", ok);
    a.delete("/integrations/x", ok);
    a.post("/ai/chat", ok);
    a.post("/addons/ai-credits/buy", ok);
  };
  const statusOf = async (role: string | null, method: "get" | "post" | "delete", path: string) =>
    (await request(appWith(role, mount))[method](path)).status;

  it("lecture : tous les roles passent", async () => {
    for (const r of ROLES) expect(await statusOf(r, "get", "/things")).toBe(200);
  });
  it("ecriture par defaut : owner/admin/member oui, viewer non", async () => {
    expect(await statusOf("owner", "post", "/things")).toBe(200);
    expect(await statusOf("admin", "post", "/things")).toBe(200);
    expect(await statusOf("member", "post", "/things")).toBe(200);
    expect(await statusOf("viewer", "post", "/things")).toBe(403);
  });
  it("admin : owner/admin oui, member et viewer non", async () => {
    expect(await statusOf("owner", "delete", "/integrations/x")).toBe(200);
    expect(await statusOf("admin", "delete", "/integrations/x")).toBe(200);
    expect(await statusOf("member", "delete", "/integrations/x")).toBe(403);
    expect(await statusOf("viewer", "delete", "/integrations/x")).toBe(403);
  });
  it("owner seul", async () => {
    expect(await statusOf("owner", "post", "/addons/ai-credits/buy")).toBe(200);
    for (const r of ["admin", "member", "viewer"]) expect(await statusOf(r, "post", "/addons/ai-credits/buy")).toBe(403);
  });
  it("exception tout role : le chat IA reste ouvert au viewer", async () => {
    for (const r of ROLES) expect(await statusOf(r, "post", "/ai/chat")).toBe(200);
  });
  it("sans role : 401 ; role inconnu : 403 (fail-closed)", async () => {
    expect(await statusOf(null, "post", "/things")).toBe(401);
    expect(await statusOf(null, "post", "/ai/chat")).toBe(401);
    expect(await statusOf("guest", "post", "/things")).toBe(403);
  });
  it("le service interne (role admin) conserve l'acces d'ecriture", async () => {
    expect(await statusOf("service", "post", "/things")).toBe(200);
  });
  it("la reponse 403 est explicite", async () => {
    const r = await request(appWith("viewer", mount)).post("/things");
    expect(r.body).toMatchObject({ code: "WRITE_ROLE_REQUIRED", yourRole: "viewer" });
  });
});

describe("garde par defaut devant les VRAIS routeurs", () => {
  const mount = (a: express.Express) => { a.use(integrationsRouter); a.use(automationRouter); };
  const body = { name: "x", platform: "custom", endpointUrl: "https://example.com/h" };

  it("POST /integrations/connections : viewer et member refuses, admin et owner acceptes", async () => {
    expect((await request(appWith("viewer", mount)).post("/integrations/connections").send(body)).status).toBe(403);
    expect((await request(appWith("member", mount)).post("/integrations/connections").send(body)).status).toBe(403);
    expect((await request(appWith("admin", mount)).post("/integrations/connections").send(body)).status).toBe(201);
    expect((await request(appWith("owner", mount)).post("/integrations/connections").send(body)).status).toBe(201);
  });

  it("le contournement par la casse / slash final reste refuse au viewer", async () => {
    const r = await request(appWith("viewer", mount)).post("/Integrations/connections/").send(body);
    expect(r.status).toBe(403);
  });

  it("POST /automation/workflows : le viewer est refuse AVANT la route, le member l'atteint", async () => {
    const v = await request(appWith("viewer", mount)).post("/automation/workflows").send({});
    expect(v.status).toBe(403);
    const m = await request(appWith("member", mount)).post("/automation/workflows").send({});
    expect(m.status).not.toBe(403); // atteint le handler (400 : corps vide)
    expect(m.status).not.toBe(401);
  });

  it("DELETE /automation/workflows/:id : viewer refuse", async () => {
    expect((await request(appWith("viewer", mount)).delete("/automation/workflows/w1")).status).toBe(403);
  });

  it("le webhook entrant a jeton reste joignable pour un role viewer (cle publique)", async () => {
    const r = await request(appWith("viewer", mount)).post("/integrations/webhook/incoming/tok").send({});
    expect(r.status).toBe(200);
  });

  it("la lecture des integrations n'est pas affectee", async () => {
    const r = await request(appWith("viewer", mount)).get("/integrations/__absent__");
    expect(r.status).not.toBe(403);
  });
});
