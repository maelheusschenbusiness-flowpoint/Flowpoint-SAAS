import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomDomainError,
  ensureRenderCustomDomain,
  isRenderDomainProvisioningConfigured,
  isCustomSubdomain,
  normalizeCustomDomain,
  normalizeRequestHost,
} from "./custom-domain-service.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
});
