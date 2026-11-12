import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../services/custom-domain-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/custom-domain-service.js")>();
  return {
    ...actual,
    isQaCustomDomainCertificationEnabled: vi.fn(async () => false),
  };
});

import { pool } from "@workspace/db";
import * as customDomainService from "../services/custom-domain-service.js";
import { customDomainHost } from "./customDomainHost.js";

const mockQuery = vi.mocked(pool.query);
const QA_ORG_ID = "10000000-0000-4000-8000-000000000002";

function buildApp(orgId = "org-a") {
  const app = express();
  app.set("trust proxy", true);
  app.use((req, _res, next) => {
    req.orgId = orgId;
    req.userId = "user-a";
    next();
  });
  app.use(customDomainHost);
  app.use((req, res) => {
    res.json({ orgId: req.orgId, domainContext: req.customDomainContext ?? null });
  });
  return app;
}

describe("custom-domain tenant routing", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.mocked(customDomainService.isQaCustomDomainCertificationEnabled).mockReset().mockResolvedValue(false);
    vi.stubEnv("STRIPE_TEST_MODE", "true");
    vi.stubEnv("STRIPE_TEST_KEY", "sk_test_custom_domain_fixture");
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "true");
    vi.stubEnv("RENDER_API_KEY", "render-test-fixture");
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_SERVICE_ID", "srv-testfixture");
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME", "flowpoint-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the matching workspace on its verified HTTPS host", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: "org-a" }] } as never);
    const res = await request(buildApp())
      .get("/dashboard")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toEqual({ domain: "portal.example.com", orgId: "org-a" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects a session from a different organization", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: "org-b" }] } as never);
    const res = await request(buildApp())
      .get("/api/me")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(421);
    expect(res.body.error).toMatch(/workspace/i);
  });

  it("does not query the database for FlowPoint platform hosts", async () => {
    const res = await request(buildApp())
      .get("/dashboard")
      .set("Host", "flowpoint-test.onrender.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keeps the exact QA hostname reserved when the server-side Test identity gate is off", async () => {
    vi.stubEnv("CUSTOM_DOMAIN_QA_CERT_EXCEPTION_ENABLED", "true");
    const res = await request(buildApp(QA_ORG_ID))
      .get("/dashboard")
      .set("Host", "custom-test.flowpoint.pro")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/disabled/i);
    expect(customDomainService.isQaCustomDomainCertificationEnabled).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not fall through to the normal app when the exact host has no active QA route", async () => {
    vi.mocked(customDomainService.isQaCustomDomainCertificationEnabled).mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await request(buildApp(QA_ORG_ID))
      .get("/dashboard")
      .set("Host", "custom-test.flowpoint.pro")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/route is not active/i);
  });

  it("routes the exact hostname only through the active internal QA organization", async () => {
    vi.mocked(customDomainService.isQaCustomDomainCertificationEnabled).mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: QA_ORG_ID }] } as never);
    const res = await request(buildApp(QA_ORG_ID))
      .get("/dashboard")
      .set("Host", "custom-test.flowpoint.pro")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toEqual({
      domain: "custom-test.flowpoint.pro",
      orgId: QA_ORG_ID,
    });
    const [sql, values] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("o.is_internal_qa=true");
    expect(sql).toContain("d.org_id=$2");
    expect(values).toEqual(["custom-test.flowpoint.pro", QA_ORG_ID]);
  });

  it("rejects a non-QA session on the exact reserved QA hostname", async () => {
    vi.mocked(customDomainService.isQaCustomDomainCertificationEnabled).mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: QA_ORG_ID }] } as never);
    const res = await request(buildApp("org-other"))
      .get("/api/me")
      .set("Host", "custom-test.flowpoint.pro")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(421);
    expect(res.body.error).toMatch(/workspace/i);
  });

  it("continues to treat every other flowpoint.pro subdomain as a platform host", async () => {
    const res = await request(buildApp(QA_ORG_ID))
      .get("/dashboard")
      .set("Host", "client.custom-test.flowpoint.pro")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toBeNull();
    expect(customDomainService.isQaCustomDomainCertificationEnabled).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not resolve or route custom hosts when the Test beta is disabled", async () => {
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "false");
    const res = await request(buildApp())
      .get("/dashboard")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fails closed on the exact reserved host when the global Test beta is disabled", async () => {
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "false");
    const res = await request(buildApp(QA_ORG_ID))
      .get("/dashboard")
      .set("Host", "custom-test.flowpoint.pro")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/disabled/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("serves the one-time TLS routing probe only for Render-confirmed domains", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "cd_test", domain: "portal.example.com" }],
    } as never);
    const res = await request(buildApp())
      .get("/api/.well-known/flowpoint-domain-proof")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: "cd_test", domain: "portal.example.com" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
