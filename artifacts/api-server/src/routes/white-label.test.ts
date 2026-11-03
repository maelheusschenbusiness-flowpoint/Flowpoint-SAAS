/**
 * white-label.test.ts — entitlement gate integration tests
 *
 * Proves that Pro/Ultra subscribers can access white-label/custom-domain
 * features based solely on their plan (PLAN_INCLUDED_ADDONS overlay in
 * loadBillingContext), without a manually populated legacy addons JSON field.
 *
 * Strategy: mount only the white-label router with a minimal Express app and
 * mock loadBillingContext so no real DB connection is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import * as customDomainService from "../services/custom-domain-service.js";

// ─── Mock billing-context before importing the router ────────────────────────
// The router dynamically imports loadBillingContext; we stub the module so it
// returns the context we choose per test.

type MockCtx = { addons: Record<string, boolean> };
let mockCtx: MockCtx = { addons: {} };

vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: vi.fn().mockImplementation(async () => mockCtx),
}));

// ─── Also mock @workspace/db so the router's orgDb doesn't crash ─────────────
vi.mock("@workspace/db", () => ({
  db: {},
  pool: { connect: vi.fn(), query: vi.fn() },
  orgAddonsTable: {},
}));

// init-data-tables is dynamically imported by the router's self-heal path.
// Stub it so schema-missing tests don't touch a real DB.
const mockInitDataTables = vi.fn(async () => {});
vi.mock("../services/init-data-tables.js", () => ({
  initDataTables: () => mockInitDataTables(),
}));

vi.mock("../services/custom-domain-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/custom-domain-service.js")>();
  return {
    ...actual,
    verifyDomainTxtRecord: vi.fn(async () => ({ verified: true, dnsCode: null })),
    ensureRenderCustomDomain: vi.fn(async (domain: string) => ({
      id: "render-domain-1",
      name: domain,
      verificationStatus: "unverified" as const,
      targetHost: "flowpoint-test.onrender.com",
    })),
    refreshRenderCustomDomain: vi.fn(async (domain: string, id: string) => ({
      id,
      name: domain,
      verificationStatus: "verified" as const,
      targetHost: "flowpoint-test.onrender.com",
    })),
    verifyHttpsDomainRoute: vi.fn(async () => false),
    isQaCustomDomainClaimEnabled: vi.fn(() => false),
    isQaCustomDomainCertificationEnabled: vi.fn(async () => false),
  };
});

let mockOrgId = "test-org";
const QA_ORG_ID = "10000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.stubEnv("STRIPE_TEST_MODE", "true");
  vi.stubEnv("STRIPE_TEST_KEY", "sk_test_custom_domain_fixture");
  vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "true");
  vi.stubEnv("RENDER_API_KEY", "render-test-fixture");
  vi.stubEnv("CUSTOM_DOMAIN_RENDER_SERVICE_ID", "srv-testfixture");
  vi.stubEnv("CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME", "flowpoint-test");
  mockOrgId = "test-org";
  vi.mocked(customDomainService.isQaCustomDomainCertificationEnabled).mockReset().mockResolvedValue(false);
  vi.mocked(customDomainService.isQaCustomDomainClaimEnabled).mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Build minimal Express app with orgId + orgDb stubs ──────────────────────
// orgDbImpl lets a test control what the orgDb query does (rows / throw).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let orgDbImpl: (sql: string, vals?: unknown[]) => Promise<any> =
  async (sql: string, _vals?: unknown[]) => {
    if (sql.includes("custom_domains_domain_unique_idx")) return { rows: [{ domain_index_is_unique: true, org_index_is_unique: true }] };
    return { rows: [] as unknown[] };
  };
let mockRole = "owner";

async function buildApp() {
  const { default: whiteLabelRouter } = await import("./white-label.js");
  const app = express();
  app.use(express.json());

  // Inject orgId + orgDb (delegates to the test-controlled orgDbImpl)
  app.use((req, _res, next) => {
    const contextualReq = req as express.Request & {
      orgId: string;
      orgDb: unknown;
      userId: string;
      orgContext: { orgId: string; role: string };
    };
    contextualReq.orgId = mockOrgId;
    contextualReq.userId = "test-user";
    contextualReq.orgContext = { orgId: mockOrgId, role: mockRole };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as express.Request & { orgDb: any }).orgDb =
      (sql: string, vals?: unknown[]) => orgDbImpl(sql, vals);
    next();
  });

  app.use(whiteLabelRouter);
  return app;
}

function pgErr(code: string): Error & { code: string } {
  const e = new Error(`pg error ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /white-label/templates — entitlement gate", () => {
  let app: express.Express;

  beforeEach(async () => {
    mockRole = "owner";
    orgDbImpl = async (sql: string) => {
      if (sql.includes("custom_domains_domain_unique_idx")) return { rows: [{ domain_index_is_unique: true, org_index_is_unique: true }] };
      return { rows: [] };
    };
    app = await buildApp();
  });

  it("returns 403 for a Standard subscriber (whiteLabel not bundled)", async () => {
    // Standard plan: PLAN_INCLUDED_ADDONS.standard is empty → no whiteLabel
    mockCtx = { addons: {} };
    const res = await request(app)
      .post("/white-label/templates")
      .send({ name: "My Template" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/white.label/i);
  });

  it("returns 201 for a Pro subscriber (whiteLabel bundled — no manual addon row needed)", async () => {
    // Simulate loadBillingContext overlaying Pro plan included addons
    mockCtx = { addons: { whiteLabel: true } };
    const res = await request(app)
      .post("/white-label/templates")
      .send({ name: "Agency Template" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^rt_/);
  });

  it("returns 201 for an Ultra subscriber (whiteLabel bundled — no manual addon row needed)", async () => {
    mockCtx = { addons: { whiteLabel: true, customDomain: true } };
    const res = await request(app)
      .post("/white-label/templates")
      .send({ name: "Ultra Template" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});

describe("POST /white-label/domains — entitlement gate", () => {
  let app: express.Express;

  beforeEach(async () => {
    mockRole = "owner";
    mockCtx = { addons: {} };
    orgDbImpl = async (sql: string) => {
      if (sql.includes("custom_domains_domain_unique_idx")) {
        return { rows: [{ domain_index_is_unique: true, org_index_is_unique: true }] };
      }
      return { rows: [] };
    };
    app = await buildApp();
  });

  it("returns 403 for a Pro subscriber (customDomain NOT bundled in Pro)", async () => {
    // Pro plan does NOT include customDomain → should be denied
    mockCtx = { addons: { whiteLabel: true } };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "example.com" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/custom domain/i);
  });

  it("returns 201 for an Ultra subscriber (customDomain bundled — no manual addon row needed)", async () => {
    mockCtx = { addons: { whiteLabel: true, customDomain: true } };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "portal.myagency.io" });
    // 201 means the gate passed; the route attempts an INSERT into custom_domains.
    // orgDb stub returns empty rows so INSERT "succeeds" (stub returns {rows:[]}).
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.verificationToken).toMatch(/^fpv_/);
    expect(res.body.instructions.record.type).toBe("TXT");
    expect(res.body.instructions.record.host).toBe("_flowpoint-verify.portal.myagency.io");
  });

  it("fails closed before creating a claim when Render Test is not configured", async () => {
    mockCtx = { addons: { customDomain: true } };
    const query = vi.fn(async () => ({ rows: [] as unknown[] }));
    orgDbImpl = query;
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "false");

    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "portal.myagency.io" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("CUSTOM_DOMAIN_NOT_AVAILABLE");
    expect(query).not.toHaveBeenCalled();
  });

  it("requires Ultra entitlement before listing domains", async () => {
    mockCtx = { addons: {} };
    const res = await request(app).get("/white-label/domains");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/entitlement/i);
  });

  it("rejects root and www domains before saving a claim", async () => {
    mockCtx = { addons: { customDomain: true } };
    const apex = await request(app).post("/white-label/domains").send({ domain: "myagency.io" });
    const www = await request(app).post("/white-label/domains").send({ domain: "www.myagency.io" });
    expect(apex.status).toBe(400);
    expect(apex.body.code).toBe("SUBDOMAIN_REQUIRED");
    expect(www.status).toBe(400);
    expect(www.body.code).toBe("SUBDOMAIN_REQUIRED");
  });

  it("continues to reserve platform domains and every subdomain before any database write", async () => {
    mockCtx = { addons: { customDomain: true } };
    const query = vi.fn(async () => ({ rows: [] as unknown[] }));
    orgDbImpl = query;

    const apex = await request(app).post("/white-label/domains").send({ domain: "flowpoint.pro" });
    const child = await request(app).post("/white-label/domains").send({ domain: "client.flowpoint.pro" });
    const flowpointIo = await request(app).post("/white-label/domains").send({ domain: "client.flowpoint.io" });
    const renderPlatform = await request(app).post("/white-label/domains").send({ domain: "client.onrender.com" });
    const replitPlatform = await request(app).post("/white-label/domains").send({ domain: "client.replit.app" });

    expect(apex.status).toBe(400);
    expect(apex.body.code).toBe("RESERVED_DOMAIN");
    expect(child.status).toBe(400);
    expect(child.body.code).toBe("RESERVED_DOMAIN");
    expect(flowpointIo.status).toBe(400);
    expect(flowpointIo.body.code).toBe("RESERVED_DOMAIN");
    expect(renderPlatform.status).toBe(400);
    expect(renderPlatform.body.code).toBe("RESERVED_DOMAIN");
    expect(replitPlatform.status).toBe(400);
    expect(replitPlatform.body.code).toBe("RESERVED_DOMAIN");
    expect(query).not.toHaveBeenCalled();
    expect(customDomainService.ensureRenderCustomDomain).not.toHaveBeenCalled();
  });

  it("allows only the exact QA hostname when the claim gate and QA organization are confirmed", async () => {
    mockOrgId = QA_ORG_ID;
    mockCtx = { addons: { customDomain: true } };
    vi.mocked(customDomainService.isQaCustomDomainClaimEnabled).mockReturnValueOnce(true);
    const writes: string[] = [];
    orgDbImpl = async (sql: string) => {
      if (sql.includes("FROM organizations")) {
        return { rows: [{ id: QA_ORG_ID, is_internal_qa: true, status: "active" }] };
      }
      if (sql.includes("custom_domains_domain_unique_idx")) {
        return { rows: [{ domain_index_is_unique: true, org_index_is_unique: true }] };
      }
      if (sql.includes("SELECT id FROM custom_domains WHERE org_id")) return { rows: [] };
      writes.push(sql);
      return { rows: [] };
    };

    const response = await request(app)
      .post("/white-label/domains")
      .send({ domain: "Custom-Test.FlowPoint.Pro." });

    expect(response.status).toBe(201);
    expect(response.body.domain).toBe("custom-test.flowpoint.pro");
    expect(response.body.instructions.record).toMatchObject({
      host: "_flowpoint-verify.custom-test.flowpoint.pro",
      type: "TXT",
    });
    expect(writes.some((sql) => sql.includes("INSERT INTO custom_domains"))).toBe(true);
    expect(customDomainService.isQaCustomDomainCertificationEnabled).not.toHaveBeenCalled();
    expect(customDomainService.ensureRenderCustomDomain).not.toHaveBeenCalled();
  });

  it("refuses the exact QA hostname when the temporary Test claim gate is disabled", async () => {
    mockOrgId = QA_ORG_ID;
    mockCtx = { addons: { customDomain: true } };
    const query = vi.fn(async () => ({ rows: [] as unknown[] }));
    orgDbImpl = query;

    const response = await request(app)
      .post("/white-label/domains")
      .send({ domain: "custom-test.flowpoint.pro" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("RESERVED_DOMAIN");
    expect(query).not.toHaveBeenCalled();
    expect(customDomainService.isQaCustomDomainCertificationEnabled).not.toHaveBeenCalled();
    expect(customDomainService.ensureRenderCustomDomain).not.toHaveBeenCalled();
  });

  it("does not allow a browser-supplied QA org ID to authorize the reserved hostname", async () => {
    mockOrgId = "another-org";
    mockCtx = { addons: { customDomain: true } };
    vi.mocked(customDomainService.isQaCustomDomainClaimEnabled).mockReturnValueOnce(true);
    const query = vi.fn(async () => ({ rows: [] as unknown[] }));
    orgDbImpl = query;

    const response = await request(app)
      .post("/white-label/domains")
      .send({ domain: "custom-test.flowpoint.pro", orgId: QA_ORG_ID });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("RESERVED_DOMAIN");
    expect(query).not.toHaveBeenCalled();
  });

  it("requires the QA organization database marker before creating its exact test claim", async () => {
    mockOrgId = QA_ORG_ID;
    mockCtx = { addons: { customDomain: true } };
    vi.mocked(customDomainService.isQaCustomDomainClaimEnabled).mockReturnValueOnce(true);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM organizations")) {
        return { rows: [{ id: QA_ORG_ID, is_internal_qa: false, status: "active" }] };
      }
      if (sql.includes("custom_domains_domain_unique_idx")) {
        return { rows: [{ domain_index_is_unique: true, org_index_is_unique: true }] };
      }
      return { rows: [] as unknown[] };
    });
    orgDbImpl = query;

    const response = await request(app)
      .post("/white-label/domains")
      .send({ domain: "custom-test.flowpoint.pro" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("RESERVED_DOMAIN");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("is_internal_qa=true");
  });

  it("does not extend the QA exception to any other FlowPoint subdomain", async () => {
    mockOrgId = QA_ORG_ID;
    mockCtx = { addons: { customDomain: true } };
    const query = vi.fn(async () => ({ rows: [] as unknown[] }));
    orgDbImpl = query;

    const response = await request(app)
      .post("/white-label/domains")
      .send({ domain: "client.custom-test.flowpoint.pro" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("RESERVED_DOMAIN");
    expect(query).not.toHaveBeenCalled();
    expect(customDomainService.isQaCustomDomainClaimEnabled).not.toHaveBeenCalled();
  });

  it("keeps administrator and Ultra entitlement gates ahead of the exact QA exception", async () => {
    mockOrgId = QA_ORG_ID;
    const query = vi.fn(async () => ({ rows: [] as unknown[] }));
    orgDbImpl = query;

    mockRole = "member";
    mockCtx = { addons: { customDomain: true } };
    const roleDenied = await request(app)
      .post("/white-label/domains")
      .send({ domain: "custom-test.flowpoint.pro" });
    expect(roleDenied.status).toBe(403);

    mockRole = "owner";
    mockCtx = { addons: {} };
    const entitlementDenied = await request(app)
      .post("/white-label/domains")
      .send({ domain: "custom-test.flowpoint.pro" });
    expect(entitlementDenied.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(customDomainService.isQaCustomDomainCertificationEnabled).not.toHaveBeenCalled();
  });

  it("fails closed when the global domain uniqueness index is unavailable", async () => {
    mockCtx = { addons: { customDomain: true } };
    orgDbImpl = async () => ({ rows: [{ domain_index_is_unique: true, org_index_is_unique: false }] });
    const res = await request(app).post("/white-label/domains").send({ domain: "portal.myagency.io" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("DOMAIN_UNIQUENESS_GUARD_UNAVAILABLE");
  });

  it("returns 403 for a Standard subscriber (customDomain not bundled)", async () => {
    mockCtx = { addons: {} };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "mysite.com" });
    expect(res.status).toBe(403);
  });

  it("requires an admin-level role for domain management", async () => {
    mockRole = "member";
    const res = await request(app).get("/white-label/domains");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin access required/i);
  });

  it("enforces the one-domain-per-organization limit", async () => {
    mockCtx = { addons: { customDomain: true } };
    orgDbImpl = async (sql: string) => {
      if (sql.includes("custom_domains_domain_unique_idx")) {
        return { rows: [{ domain_index_is_unique: true, org_index_is_unique: true }] };
      }
      if (sql.includes("SELECT id FROM custom_domains WHERE org_id")) {
        return { rows: [{ id: "existing-domain" }] };
      }
      return { rows: [] };
    };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "portal.myagency.io" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DOMAIN_LIMIT_REACHED");
  });
});

describe("POST /white-label/domains/:id/ssl-check — readiness state", () => {
  let app: express.Express;

  beforeEach(async () => {
    mockRole = "owner";
    mockCtx = { addons: { customDomain: true } };
    orgDbImpl = async sql => sql.includes("SELECT id, org_id, domain, status")
      ? { rows: [{
        id: "domain-1",
        org_id: "test-org",
        domain: "portal.myagency.io",
        status: "ownership_verified",
        ssl_active: false,
        verification_token: "fpv_test-token",
        verified_at: null,
        render_domain_id: null,
        render_target_host: null,
        last_error: null,
      }] }
      : { rows: [] };
    app = await buildApp();
  });

  it("does not activate a domain until HTTPS also proves FlowPoint routing", async () => {
    const response = await request(app).post("/white-label/domains/domain-1/ssl-check");

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      status: "tls_pending",
      sslActive: false,
    });
    expect(response.body.message).toContain("successful route check");
    expect(response.body.message).not.toContain("active");
  });

  it("does not contact Render unless the ownership TXT record is verified", async () => {
    vi.clearAllMocks();
    vi.mocked(customDomainService.verifyDomainTxtRecord).mockResolvedValueOnce({
      verified: false,
      dnsCode: "ENODATA",
    });

    const response = await request(app).post("/white-label/domains/domain-1/verify");

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "DOMAIN_TXT_NOT_VERIFIED",
      status: "pending_dns",
      required: {
        host: "_flowpoint-verify.portal.myagency.io",
        type: "TXT",
        value: "fpv_test-token",
      },
    });
    expect(customDomainService.ensureRenderCustomDomain).not.toHaveBeenCalled();
    expect(customDomainService.refreshRenderCustomDomain).not.toHaveBeenCalled();
  });

  it("scopes verification lookup to the current organization", async () => {
    vi.clearAllMocks();
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    orgDbImpl = async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [] };
    };

    const response = await request(app).post("/white-label/domains/domain-1/verify");

    expect(response.status).toBe(404);
    expect(queries[0]?.sql).toContain("WHERE id=$1 AND org_id=$2");
    expect(queries[0]?.values).toEqual(["domain-1", "test-org"]);
    expect(customDomainService.verifyDomainTxtRecord).not.toHaveBeenCalled();
    expect(customDomainService.ensureRenderCustomDomain).not.toHaveBeenCalled();
  });

  it("rechecks the QA org marker before verifying the reserved certification hostname", async () => {
    vi.clearAllMocks();
    mockOrgId = QA_ORG_ID;
    vi.mocked(customDomainService.isQaCustomDomainCertificationEnabled).mockResolvedValueOnce(true);
    const queries: string[] = [];
    orgDbImpl = async (sql) => {
      queries.push(sql);
      if (sql.includes("SELECT id, org_id, domain, status")) {
        return { rows: [{
          id: "domain-qa",
          org_id: QA_ORG_ID,
          domain: "custom-test.flowpoint.pro",
          status: "ownership_verified",
          ssl_active: false,
          verification_token: "fpv_test-token",
          verified_at: null,
          render_domain_id: null,
          render_target_host: null,
          last_error: null,
        }] };
      }
      return { rows: [] };
    };

    const response = await request(app).post("/white-label/domains/domain-qa/verify");

    expect(response.status).toBe(404);
    expect(queries[0]).toContain("WHERE id=$1 AND org_id=$2");
    expect(queries[1]).toContain("is_internal_qa=true");
    expect(customDomainService.verifyDomainTxtRecord).not.toHaveBeenCalled();
    expect(customDomainService.ensureRenderCustomDomain).not.toHaveBeenCalled();
  });
});

describe("GET /white-label/templates — reliability contract", () => {
  let app: express.Express;

  beforeEach(async () => {
    // default: genuine empty org
    orgDbImpl = async () => ({ rows: [] });
    mockInitDataTables.mockClear();
    app = await buildApp();
  });

  it("returns a stable {templates:[]} for a genuinely empty org", async () => {
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ templates: [] });
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("returns org-scoped persisted templates on success", async () => {
    const rows = [{ id: "rt_1", org_id: "test-org", name: "Agency" }];
    orgDbImpl = async () => ({ rows });
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual(rows);
  });

  it("returns 500 (not {templates:[]}) on a real SQL failure so the client can retry", async () => {
    orgDbImpl = async () => { throw pgErr("40001"); }; // serialization_failure
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch templates/i);
    expect(res.body).not.toHaveProperty("templates");
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("self-heals once and retries on missing table (42P01)", async () => {
    let calls = 0;
    orgDbImpl = async () => {
      calls += 1;
      if (calls === 1) throw pgErr("42P01");
      return { rows: [{ id: "rt_healed" }] };
    };
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([{ id: "rt_healed" }]);
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
  });

  it("returns 500 if the query still fails after self-heal (never a silent [])", async () => {
    orgDbImpl = async () => { throw pgErr("42P01"); };
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("templates");
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
  });
});
