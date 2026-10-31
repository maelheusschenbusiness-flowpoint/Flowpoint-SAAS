import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import https from "node:https";
import { domainToASCII } from "node:url";
import { isPrivateIpv4Address, isPrivateIpv6Address } from "./url-fetcher.js";

const RENDER_API = "https://api.render.com/v1";
const RENDER_API_TIMEOUT_MS = 10_000;
const DOMAIN_PROOF_PATH = "/api/.well-known/flowpoint-domain-proof";
const RESERVED_SUFFIXES = [
  "onrender.com",
  "flowpoint.pro",
  "flowpoint.io",
  "replit.dev",
  "replit.app",
];
// Beta accepts hostnames below a registrable domain, not the zone apex. This
// covers common two-label public suffixes without depending on a stale PSL
// snapshot; Render remains the final authority for DNS verification.
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "edu.au",
  "co.nz", "org.nz", "co.jp", "co.kr", "co.in",
  "com.br", "com.cn", "com.sg", "com.hk", "com.my",
  "com.ph", "com.mx", "com.tr", "com.tw", "com.ar",
  "co.za", "co.id", "com.pl", "com.ua",
]);

export class CustomDomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "CustomDomainError";
  }
}

export interface RenderDomainInfo {
  id: string;
  name: string;
  verificationStatus: "verified" | "unverified";
  targetHost: string;
}

function normalizeHostname(value: string): string {
  const ascii = domainToASCII(value.trim().replace(/\.$/, "").toLowerCase());
  if (!ascii || ascii.length > 253 || isIP(ascii)) {
    throw new CustomDomainError("Invalid domain name", "INVALID_DOMAIN", 400);
  }
  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => label.length < 1 || label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new CustomDomainError("Invalid domain name", "INVALID_DOMAIN", 400);
  }
  return ascii;
}

export function normalizeCustomDomain(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CustomDomainError("A domain is required", "INVALID_DOMAIN", 400);
  }
  const raw = value.trim();
  if (/[\s/@?#:*\\]/.test(raw) || raw.includes("://")) {
    throw new CustomDomainError("Enter a hostname, not a URL or wildcard", "INVALID_DOMAIN", 400);
  }
  const domain = normalizeHostname(raw);
  if (RESERVED_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) {
    throw new CustomDomainError("This platform domain cannot be claimed", "RESERVED_DOMAIN", 400);
  }
  return domain;
}

export function isCustomSubdomain(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 3 || labels[0] === "www") return false;
  return !MULTI_LABEL_PUBLIC_SUFFIXES.has(labels.slice(-2).join(".")) || labels.length >= 4;
}

export function normalizeRequestHost(hostHeader: string | undefined): string | null {
  if (!hostHeader || hostHeader.length > 300) return null;
  const first = hostHeader.split(",", 1)[0]?.trim();
  if (!first) return null;
  let host = first;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return null;
    host = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0 && host.indexOf(":") === colon) host = host.slice(0, colon);
  }
  try {
    return normalizeHostname(host);
  } catch {
    return null;
  }
}

type RenderConfig = {
  apiKey: string;
  serviceId: string;
  expectedServiceName: string;
};

function renderConfig(env: NodeJS.ProcessEnv = process.env): RenderConfig {
  if (env["CUSTOM_DOMAIN_RENDER_API_ENABLED"] !== "true") {
    throw new CustomDomainError(
      "Render domain provisioning is not enabled for this service",
      "RENDER_DOMAIN_PROVISIONING_NOT_CONFIGURED",
      503,
    );
  }
  const apiKey = env["RENDER_API_KEY"]?.trim();
  const serviceId = env["CUSTOM_DOMAIN_RENDER_SERVICE_ID"]?.trim();
  const expectedServiceName = env["CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME"]?.trim();
  if (!apiKey || !serviceId || !expectedServiceName) {
    throw new CustomDomainError(
      "Render domain provisioning is missing server configuration",
      "RENDER_DOMAIN_PROVISIONING_NOT_CONFIGURED",
      503,
    );
  }
  if (!/^srv-[a-zA-Z0-9]+$/.test(serviceId)) {
    throw new CustomDomainError("Invalid Render service configuration", "RENDER_CONFIGURATION_INVALID", 503);
  }
  return { apiKey, serviceId, expectedServiceName };
}

async function renderRequest<T>(
  config: RenderConfig,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RENDER_API}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(RENDER_API_TIMEOUT_MS),
    });
  } catch {
    throw new CustomDomainError("Render API is temporarily unavailable", "RENDER_API_UNAVAILABLE", 502);
  }

  if (response.status === 404) {
    throw new CustomDomainError("Render domain was not found", "RENDER_DOMAIN_NOT_FOUND", 404);
  }
  if (response.status === 401 || response.status === 403) {
    throw new CustomDomainError("Render API rejected the configured credentials", "RENDER_API_FORBIDDEN", 503);
  }
  if (response.status === 409) {
    throw new CustomDomainError("The domain is already attached to another Render service", "RENDER_DOMAIN_CONFLICT", 409);
  }
  if (!response.ok && !(method === "DELETE" && response.status === 410)) {
    throw new CustomDomainError("Render could not complete the domain request", "RENDER_API_ERROR", 502);
  }
  if (method === "DELETE" && (response.status === 204 || response.status === 410)) {
    return undefined as T;
  }

  try {
    const text = await response.text();
    if (text.length > 32_000) {
      throw new Error("Render response too large");
    }
    return (text ? JSON.parse(text) : undefined) as T;
  } catch {
    throw new CustomDomainError("Render returned an invalid response", "RENDER_API_INVALID_RESPONSE", 502);
  }
}

type RenderServiceResponse = {
  id?: string;
  name?: string;
  type?: string;
  serviceDetails?: { url?: string };
};

async function getCurrentRenderService(config: RenderConfig): Promise<{ targetHost: string }> {
  const service = await renderRequest<RenderServiceResponse>(
    config,
    `/services/${encodeURIComponent(config.serviceId)}`,
    "GET",
  );
  if (
    service.id !== config.serviceId ||
    service.name !== config.expectedServiceName ||
    service.type !== "web_service"
  ) {
    throw new CustomDomainError(
      "The configured Render service does not match the expected test service",
      "RENDER_SERVICE_MISMATCH",
      503,
    );
  }
  let targetHost = "";
  try {
    targetHost = new URL(service.serviceDetails?.url ?? "").hostname.toLowerCase();
  } catch {
    // Report a safe configuration error below.
  }
  if (!targetHost.endsWith(".onrender.com")) {
    throw new CustomDomainError("Render service URL is unavailable", "RENDER_SERVICE_URL_UNAVAILABLE", 503);
  }
  return { targetHost };
}

type RenderDomainResponse = {
  id?: string;
  name?: string;
  verificationStatus?: "verified" | "unverified";
};

function extractRenderDomain(value: RenderDomainResponse | RenderDomainResponse[]): RenderDomainResponse | null {
  if (Array.isArray(value)) return value.find((entry) => typeof entry?.id === "string") ?? null;
  return value && typeof value === "object" ? value : null;
}

export async function ensureRenderCustomDomain(domain: string): Promise<RenderDomainInfo> {
  const config = renderConfig();
  const { targetHost } = await getCurrentRenderService(config);
  const domainPath = `/services/${encodeURIComponent(config.serviceId)}/custom-domains/${encodeURIComponent(domain)}`;

  let record: RenderDomainResponse | null = null;
  try {
    record = extractRenderDomain(await renderRequest<RenderDomainResponse | RenderDomainResponse[]>(config, domainPath, "GET"));
  } catch (err) {
    if (!(err instanceof CustomDomainError) || err.code !== "RENDER_DOMAIN_NOT_FOUND") throw err;
  }

  if (!record) {
    try {
      const created = await renderRequest<RenderDomainResponse | RenderDomainResponse[]>(
        config,
        `/services/${encodeURIComponent(config.serviceId)}/custom-domains`,
        "POST",
        { name: domain },
      );
      record = extractRenderDomain(created);
    } catch (err) {
      // A request may have succeeded at Render while its response was lost.
      // Re-read the exact domain on this same service before returning a conflict.
      if (!(err instanceof CustomDomainError) || err.code !== "RENDER_DOMAIN_CONFLICT") throw err;
      record = extractRenderDomain(await renderRequest<RenderDomainResponse | RenderDomainResponse[]>(config, domainPath, "GET"));
    }
  }

  if (!record?.id || record.name?.toLowerCase() !== domain) {
    throw new CustomDomainError("Render did not confirm the requested domain", "RENDER_DOMAIN_INVALID_RESPONSE", 502);
  }
  return {
    id: record.id,
    name: domain,
    verificationStatus: record.verificationStatus === "verified" ? "verified" : "unverified",
    targetHost,
  };
}

export async function refreshRenderCustomDomain(domain: string, domainId: string): Promise<RenderDomainInfo> {
  const config = renderConfig();
  const { targetHost } = await getCurrentRenderService(config);
  const domainPath = `/services/${encodeURIComponent(config.serviceId)}/custom-domains/${encodeURIComponent(domainId)}`;
  await renderRequest<unknown>(config, `${domainPath}/verify`, "POST");
  const record = extractRenderDomain(
    await renderRequest<RenderDomainResponse | RenderDomainResponse[]>(config, domainPath, "GET"),
  );
  if (!record?.id || record.id !== domainId || record.name?.toLowerCase() !== domain) {
    throw new CustomDomainError("Render domain identity did not match", "RENDER_DOMAIN_IDENTITY_MISMATCH", 502);
  }
  return {
    id: record.id,
    name: domain,
    verificationStatus: record.verificationStatus === "verified" ? "verified" : "unverified",
    targetHost,
  };
}

export async function deleteRenderCustomDomain(domainId: string): Promise<void> {
  const config = renderConfig();
  const path = `/services/${encodeURIComponent(config.serviceId)}/custom-domains/${encodeURIComponent(domainId)}`;
  try {
    await renderRequest<unknown>(config, path, "DELETE");
  } catch (err) {
    if (err instanceof CustomDomainError && err.code === "RENDER_DOMAIN_NOT_FOUND") return;
    throw err;
  }
}

export async function verifyDomainTxtRecord(
  domain: string,
  token: string,
): Promise<{ verified: boolean; dnsCode: string | null }> {
  try {
    const records = await dns.resolveTxt(`_flowpoint-verify.${domain}`);
    const verified = records.some((chunks) => chunks.join("") === token);
    return { verified, dnsCode: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return { verified: false, dnsCode: typeof code === "string" ? code : "DNS_LOOKUP_FAILED" };
  }
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !isPrivateIpv4Address(address);
  if (family === 6) return !isPrivateIpv6Address(address);
  return false;
}

async function resolvePublicAddresses(host: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  const safe = addresses.filter((entry) => isPublicAddress(entry.address));
  if (safe.length === 0 || safe.length !== addresses.length) {
    throw new Error("Domain resolved to a non-public or invalid address");
  }
  return safe.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
}

export async function verifyHttpsDomainRoute(
  domain: string,
  expectedId: string,
  targetHost: string,
): Promise<boolean> {
  try {
    const [domainAddresses, targetAddresses] = await Promise.all([
      resolvePublicAddresses(domain),
      resolvePublicAddresses(targetHost),
    ]);
    const targetSet = new Set(targetAddresses.map((entry) => entry.address));
    const pinned = domainAddresses.find((entry) => targetSet.has(entry.address));
    if (!pinned) return false;

    // Pin the outbound TLS connection to the already validated public address.
    // This prevents DNS rebinding from turning the probe into an SSRF primitive.
    const responseBody = await new Promise<string | null>((resolve) => {
      let body = "";
      const request = https.request({
        hostname: domain,
        port: 443,
        path: DOMAIN_PROOF_PATH,
        method: "GET",
        servername: domain,
        rejectUnauthorized: true,
        timeout: 8_000,
        headers: { host: domain, accept: "application/json" },
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      }, (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 4096) request.destroy(new Error("Probe response too large"));
        });
        response.on("end", () => resolve(response.statusCode === 200 ? body : null));
      });
      request.on("timeout", () => request.destroy(new Error("Probe timed out")));
      request.on("error", () => resolve(null));
      request.end();
    });
    if (!responseBody) return false;
    const result = JSON.parse(responseBody) as { ok?: boolean; id?: string; domain?: string };
    return result.ok === true && result.id === expectedId && result.domain === domain;
  } catch {
    return false;
  }
}
