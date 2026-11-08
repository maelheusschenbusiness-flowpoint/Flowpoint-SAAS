/**
 * D-05 — rapports : aucune reponse de succes sans ligne persistee, et lien de
 * partage reellement lisible (POST /reports/:id/share -> GET /reports/share/:token).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock, poolConnectMock, checkQuotaMock, poolQueryMock } = vi.hoisted(() => ({
  orgDbMock: vi.fn(),
  poolConnectMock: vi.fn(),
  checkQuotaMock: vi.fn(),
  poolQueryMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: poolConnectMock, query: poolQueryMock },
  db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn(),
}));
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_q: any, _s: any, n: any) => n() }));
vi.mock("../middlewares/rateLimiter.js", () => ({ reportRateLimit: (_q: any, _s: any, n: any) => n() }));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_q: any, _s: any, n: any) => n(),
  canAdmin: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../services/pdf.js", () => ({ streamReportPdf: vi.fn() }));
vi.mock("../services/store.js", () => ({ store: { logActivity: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../services/billing-service.js", () => ({ checkQuota: checkQuotaMock }));
vi.mock("../services/ai-provider.js", () => ({ aiChat: vi.fn() }));
vi.mock("../services/ai-prefs.js", () => ({ loadOrgAIPrefs: vi.fn(), resolveAIModel: vi.fn() }));
vi.mock("../services/ai-engine.js", () => ({ checkAIQuota: vi.fn(), recordCompletedUsageDeferred: vi.fn() }));
vi.mock("../services/ai-quota.js", () => ({ buildQuotaGuidance: vi.fn() }));
vi.mock("../services/usage-events.js", () => ({ recordUsageEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/org-data.js", () => ({ loadOrgData: vi.fn().mockResolvedValue(null) }));
vi.mock("../services/mailer.js", () => ({ mailer: { sendReportGenerated: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import reportsRouter from "./reports.js";
import shareRouter from "./share.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  // Le routeur public est monte AVANT l'authentification, comme dans routes/index.ts.
  app.use("/api", shareRouter);
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: orgDbMock, orgContext: { userId: "user-a", email: "owner@example.test" } });
    next();
  });
  app.use("/api", reportsRouter);
  return app;
}

function pgClient(opts: { failOn?: RegExp; } = {}) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (opts.failOn && opts.failOn.test(sql)) throw new Error("db down");
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  poolConnectMock.mockResolvedValue(client);
  return client;
}

describe("POST /reports — jamais de rapport fantome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkQuotaMock.mockResolvedValue({ allowed: true, limit: 20, used: 0 });
  });

  it("renvoie 503 (pas 201) si l'INSERT echoue", async () => {
    const client = pgClient({ failOn: /INSERT INTO reports/ });
    const res = await request(makeApp()).post("/api/reports").send({ name: "Rapport A" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("REPORT_CREATION_UNAVAILABLE");
    expect(res.body.id).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("renvoie 503 (pas 201) si la verification du quota leve une exception", async () => {
    pgClient();
    checkQuotaMock.mockRejectedValue(new Error("billing down"));
    const res = await request(makeApp()).post("/api/reports").send({ name: "Rapport A" });
    expect(res.status).toBe(503);
    expect(res.body.id).toBeUndefined();
  });

  it("renvoie 402 si le quota est depasse", async () => {
    pgClient();
    checkQuotaMock.mockResolvedValue({ allowed: false, limit: 5, used: 5 });
    const res = await request(makeApp()).post("/api/reports").send({ name: "Rapport A" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("QUOTA_EXCEEDED");
  });

  it("renvoie 503 si le verrou consultatif echoue", async () => {
    pgClient({ failOn: /pg_advisory_xact_lock/ });
    const res = await request(makeApp()).post("/api/reports").send({ name: "Rapport A" });
    expect(res.status).toBe(503);
    expect(res.body.id).toBeUndefined();
  });

  it("renvoie 500 REPORT_NOT_PERSISTED si la ligne est introuvable apres COMMIT (pas de {id,name} fabrique)", async () => {
    pgClient();
    orgDbMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).post("/api/reports").send({ name: "Rapport A" });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("REPORT_NOT_PERSISTED");
    expect(res.body.id).toBeUndefined();
  });

  it("renvoie 201 avec la ligne reellement lue en base", async () => {
    pgClient();
    orgDbMock.mockResolvedValue({ rows: [{ id: "r_db", org_id: "org-a", name: "Rapport A" }] });
    const res = await request(makeApp()).post("/api/reports").send({ name: "Rapport A" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("r_db");
  });
});

describe("POST /reports/approve — pas de faux succes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 si le rapport n'appartient pas a l'organisation", async () => {
    orgDbMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).post("/api/reports/approve").send({ reportId: "r_other" });
    expect(res.status).toBe(404);
    expect(orgDbMock).toHaveBeenCalledWith(expect.stringContaining("org_id=$2"), ["r_other", "org-a"]);
  });

  it("500 si la base echoue", async () => {
    orgDbMock.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp()).post("/api/reports/approve").send({ reportId: "r_1" });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe("POST /reports/:id/share — jeton reellement cree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 pour un rapport d'une autre organisation (requete bornee par org_id)", async () => {
    orgDbMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).post("/api/reports/r_foreign/share").send({});
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
    expect(orgDbMock).toHaveBeenCalledWith(expect.stringContaining("org_id=$2"), ["r_foreign", "org-a"]);
  });

  it("500 SHARE_CREATE_FAILED sans jeton si l'INSERT echoue", async () => {
    orgDbMock.mockImplementation(async (sql: string) => {
      if (/INSERT INTO share_tokens/.test(sql)) throw new Error("db down");
      return { rows: [{ id: "r_1", name: "R", audit_id: "", meeting_notes_json: "[]" }] };
    });
    const res = await request(makeApp()).post("/api/reports/r_1/share").send({});
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("SHARE_CREATE_FAILED");
    expect(res.body.token).toBeUndefined();
  });

  it("201 : jeton persiste pour l'org, expiration a 30 jours, chemin /report/:token", async () => {
    orgDbMock.mockImplementation(async (sql: string) => {
      if (/INSERT INTO share_tokens/.test(sql)) return { rows: [] };
      if (/UPDATE reports/.test(sql)) return { rows: [] };
      return { rows: [{ id: "r_1", name: "R", audit_id: "", meeting_notes_json: "[{\"secret\":1}]" }] };
    });
    const res = await request(makeApp()).post("/api/reports/r_1/share").send({});
    expect(res.status).toBe(201);
    expect(res.body.path).toBe(`/report/${res.body.token}`);
    const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const insert = orgDbMock.mock.calls.find(c => /INSERT INTO share_tokens/.test(c[0]))!;
    expect(insert[1][0]).toBe(res.body.token);
    expect(insert[1][2]).toBe("org-a");
    expect(insert[1][3]).not.toContain("secret"); // notes de reunion jamais copiees
  });
});

describe("GET /reports/share/:token — lecture publique (URL appelee par report-view.html)", () => {
  function tokenRow(over: Record<string, unknown> = {}) {
    return {
      token: "tok", orgId: "org-a",
      expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(),
      views: 0,
      reportJson: JSON.stringify({ id: "r_1", name: "R", meetingNotesJson: "x", audit_id: "a1" }),
      auditsJson: JSON.stringify([{ id: "a1", url: "https://x.test" }, { id: "other" }]),
      brandingJson: "{}",
      ...over,
    };
  }
  function mockToken(row: Record<string, unknown> | null) {
    const client = { query: vi.fn(async () => ({ rows: row ? [row] : [] })), release: vi.fn() };
    poolConnectMock.mockResolvedValue(client);
    return client;
  }
  beforeEach(() => vi.clearAllMocks());

  it("la route /api/reports/share/:token existe et sert le rapport", async () => {
    mockToken(tokenRow());
    const res = await request(makeApp()).get("/api/reports/share/tok");
    expect(res.status).toBe(200);
    expect(res.body.report.name).toBe("R");
    expect(res.body.report.meetingNotesJson).toBeUndefined();
    expect(res.body.audits).toEqual([{ id: "a1", url: "https://x.test" }]);
    expect(res.body.meetingNotes).toEqual([]);
  });

  it("l'ancienne route /api/share/:token reste servie", async () => {
    mockToken(tokenRow());
    const res = await request(makeApp()).get("/api/share/tok");
    expect(res.status).toBe(200);
  });

  it("404 si le jeton n'existe pas", async () => {
    mockToken(null);
    const res = await request(makeApp()).get("/api/reports/share/nope");
    expect(res.status).toBe(404);
  });

  it("410 si le jeton est expire", async () => {
    mockToken(tokenRow({ expiresAt: new Date(Date.now() - 1000) }));
    const res = await request(makeApp()).get("/api/reports/share/tok");
    expect(res.status).toBe(410);
  });

  it("503 explicite (pas de blocage) si la base echoue", async () => {
    const client = { query: vi.fn(async () => { throw new Error("db down"); }), release: vi.fn() };
    poolConnectMock.mockResolvedValue(client);
    const res = await request(makeApp()).get("/api/reports/share/tok");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SHARE_UNAVAILABLE");
    expect(client.release).toHaveBeenCalled();
  });
});
