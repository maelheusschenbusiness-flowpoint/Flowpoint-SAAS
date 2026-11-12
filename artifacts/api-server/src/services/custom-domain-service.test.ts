import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomDomainError,
  ensureRenderCustomDomain,
  isExactQaCustomDomainCertificationHost,
  getQaCustomDomainClaimBlockers,
  isQaCustomDomainClaimEnabled,
  isQaCustomDomainCertificationEnabled,
  isRenderDomainProvisioningConfigured,
  isCustomSubdomain,
  normalizeCustomDomain,
  normalizeRequestHost,
  QA_CUSTOM_DOMAIN_CERT_DOMAIN,
  QA_CUSTOM_DOMAIN_CERT_ORG_ID,
  QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_ID,
  QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_NAME,
} from "./custom-domain-service.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const qaCertificationEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  CUSTOM_DOMAIN_QA_CERT_EXCEPTION_ENABLED: "true",
  STRIPE_TEST_MODE: "true",
  STRIPE_TEST_KEY: "sk_test_cert_fixture",
  RENDER_SERVICE_NAME: QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_NAME,
  RENDER_EXTERNAL_URL: "https://flowpoint-test.onrender.com",
  CUSTOM_DOMAIN_RENDER_API_ENABLED: "true",
  RENDER_API_KEY: "render-fixture-not-a-secret",
  CUSTOM_DOMAIN_RENDER_SERVICE_ID: QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_ID,
  CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME: QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_NAME,
};

describe("custom-domain hostname validation", () => {
  it("normalizes case, IDN and trailing dot to one ASCII hostname", () => {
    expect(normalizeCustomDomain("Portal.Example.COM.")).toBe("portal.example.com");
    expect(normalizeCustomDomain("büro.example")).toBe("xn--bro-hoa.example");
  });

  it.each([
    "https://portal.example.com",
    "*.example.com",
    "portal.example.com/path",
    "localhost",
    "127.0.0.1",
    "portal.flowpoint.pro",
  ])("rejects unsafe or reserved host %s", (domain) => {
    expect(() => normalizeCustomDomain(domain)).toThrow(CustomDomainError);
  });

  it.each([
    ["portal.example.com", true],
    ["portal.example.co.uk", true],
    ["example.com", false],
    ["example.co.uk", false],
    ["www.example.com", false],
  ])("classifies %s as a supported subdomain: %s", (domain, supported) => {
    expect(isCustomSubdomain(domain)).toBe(supported);
  });

  it("extracts a hostname from an HTTP Host header without trusting forwarded host", () => {
    expect(normalizeRequestHost("Portal.Example.com:443")).toBe("portal.example.com");
    expect(normalizeRequestHost(undefined)).toBeNull();
  });

  it("recognizes only the exact QA certification hostname without changing the general reserved-host rule", () => {
    expect(isExactQaCustomDomainCertificationHost("Custom-Test.FlowPoint.Pro.")).toBe(true);
    expect(isExactQaCustomDomainCertificationHost("client.custom-test.flowpoint.pro")).toBe(false);
    expect(isExactQaCustomDomainCertificationHost("flowpoint.pro")).toBe(false);
    expect(() => normalizeCustomDomain(QA_CUSTOM_DOMAIN_CERT_DOMAIN)).toThrow(
      expect.objectContaining({ code: "RESERVED_DOMAIN" }),
    );
    expect(QA_CUSTOM_DOMAIN_CERT_ORG_ID).toBe("10000000-0000-4000-8000-000000000002");
  });
});

describe("Render API fail-closed configuration", () => {
  it("recognizes only a complete, valid service configuration without making a request", () => {
    const configured = {
      CUSTOM_DOMAIN_RENDER_API_ENABLED: "true",
      RENDER_API_KEY: "render-test-fixture",
      CUSTOM_DOMAIN_RENDER_SERVICE_ID: "srv-testfixture",
      CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME: "flowpoint-test",
    };
    expect(isRenderDomainProvisioningConfigured(configured)).toBe(true);
    expect(isRenderDomainProvisioningConfigured({
      ...configured,
      CUSTOM_DOMAIN_RENDER_API_ENABLED: "false",
    })).toBe(false);
    expect(isRenderDomainProvisioningConfigured({
      ...configured,
      CUSTOM_DOMAIN_RENDER_SERVICE_ID: "not-a-render-service",
    })).toBe(false);
    expect(isRenderDomainProvisioningConfigured({
      ...configured,
      CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME: "flowpoint-production",
    })).toBe(false);
  });

  it("does not make a network request while provisioning is disabled", async () => {
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "false");
    vi.stubEnv("RENDER_API_KEY", "not-a-real-key");
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_SERVICE_ID", "srv-test");
    vi.stubEnv("CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME", "flowpoint-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureRenderCustomDomain("portal.example.com")).rejects.toMatchObject({
      code: "RENDER_DOMAIN_PROVISIONING_NOT_CONFIGURED",
      statusCode: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the server flag, test runtime identity, exact configured service, and live Render identity", async () => {
    const env = { ...qaCertificationEnv };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_ID,
      name: QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_NAME,
      type: "web_service",
      serviceDetails: { url: "https://flowpoint-test.onrender.com" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(isQaCustomDomainCertificationEnabled(env)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.render.com/v1/services/${QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    ["runtime is not Test", { NODE_ENV: "production" }],
    ["exception toggle is off", { CUSTOM_DOMAIN_QA_CERT_EXCEPTION_ENABLED: "false" }],
    ["runtime service is not Test", { RENDER_SERVICE_NAME: "flowpoint-production" }],
    ["runtime URL is not Test", { RENDER_EXTERNAL_URL: "https://app.flowpoint.pro" }],
    ["configured ID is not the authorized Test service", { CUSTOM_DOMAIN_RENDER_SERVICE_ID: "srv-other" }],
    ["Stripe is not in test mode", { STRIPE_TEST_MODE: "false" }],
  ])("fails closed when %s", async (_reason, override) => {
    const env = { ...qaCertificationEnv, ...override };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(isQaCustomDomainCertificationEnabled(env)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched service identity returned by Render", async () => {
    const env = { ...qaCertificationEnv };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "srv-not-the-authorized-test-service",
      name: QA_CUSTOM_DOMAIN_CERT_RENDER_SERVICE_NAME,
      type: "web_service",
      serviceDetails: { url: "https://flowpoint-test.onrender.com" },
    }), { status: 200 })));

    await expect(isQaCustomDomainCertificationEnabled(env)).resolves.toBe(false);
  });
});

describe("QA custom-domain claim gate", () => {
  it("allows only the database-only claim with exact Test attestations and makes no Render request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(isQaCustomDomainClaimEnabled(qaCertificationEnv)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the legacy Stripe TEST key when the primary test-key variable is empty", () => {
    expect(isQaCustomDomainClaimEnabled({
      ...qaCertificationEnv,
      STRIPE_TEST_KEY: "",
      STRIPE_TEST_SECRET_KEY: "sk_test_legacy_fixture",
    })).toBe(true);
  });

  it("reports safe blocker labels without exposing configured values", () => {
    expect(getQaCustomDomainClaimBlockers({
      ...qaCertificationEnv,
      CUSTOM_DOMAIN_QA_CERT_EXCEPTION_ENABLED: "false",
      CUSTOM_DOMAIN_RENDER_SERVICE_ID: "srv-privatevalue",
    })).toEqual([
      "qa_exception_disabled",
      "render_configured_service_id_mismatch",
      "render_provisioning_target_mismatch",
    ]);
  });

  it.each([
    ["production runtime", { NODE_ENV: "production" }],
    ["development runtime", { NODE_ENV: "development" }],
    ["exception toggle disabled", { CUSTOM_DOMAIN_QA_CERT_EXCEPTION_ENABLED: "false" }],
    ["Stripe test mode disabled", { STRIPE_TEST_MODE: "false" }],
    ["live Stripe key", { STRIPE_TEST_KEY: "sk_live_fixture" }],
    ["non-Test Render service", { RENDER_SERVICE_NAME: "flowpoint-production" }],
    ["non-Test runtime URL", { RENDER_EXTERNAL_URL: "https://app.flowpoint.pro" }],
    ["unauthorized Render service ID", { CUSTOM_DOMAIN_RENDER_SERVICE_ID: "srv-other" }],
    ["non-Test expected service name", { CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME: "flowpoint-production" }],
    ["Render API disabled", { CUSTOM_DOMAIN_RENDER_API_ENABLED: "false" }],
    ["Render API key missing", { RENDER_API_KEY: "" }],
  ])("fails closed for %s", (_reason, override) => {
    expect(isQaCustomDomainClaimEnabled({ ...qaCertificationEnv, ...override })).toBe(false);
  });
});
