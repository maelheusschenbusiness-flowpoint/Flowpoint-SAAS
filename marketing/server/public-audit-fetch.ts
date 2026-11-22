import { performance } from "node:perf_hooks";
import { type LookupAddress } from "node:dns";
import { type LookupFunction } from "node:net";
import { promises as dnsPromises } from "node:dns";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";

export class PublicAuditTargetError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "blocked_destination"
      | "cross_origin_redirect"
      | "too_many_redirects"
      | "timeout"
      | "response_too_large"
      | "connection_failed"
      | "http_error"
      | "hosting_placeholder"
      | "empty_response"
      | "unreadable_response"
      | "crawler_blocked"
      | "error_page",
    public readonly httpStatus?: number,
    public readonly finalUrl?: string,
    public readonly contentType?: string,
  ) {
    super(code);
  }
}

export type PublicFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  ttfbMs: number;
  transferBytes: number;
  redirectCount: number;
};

export type PublicFetchOptions = {
  method?: "GET" | "HEAD";
  maxBytes?: number;
  maxRedirects?: number;
  expectedOrigin?: string;
  signal?: AbortSignal;
};

const MAX_REDIRECTS = 4;
const TOTAL_TIMEOUT_MS = 8_000;
const HOP_TIMEOUT_MS = 4_000;
const DNS_TIMEOUT_MS = 2_000;
const USER_AGENT =
  "FlowPointPublicAudit/1.0 (+https://flowpoint.pro; public read-only checks)";

export function resolvePublicAuditRedirect(
  currentUrl: URL,
  location: string,
  redirectCount: number,
  maximumRedirects = MAX_REDIRECTS,
  expectedOrigin?: string,
): URL {
  if (redirectCount >= maximumRedirects) {
    throw new PublicAuditTargetError("too_many_redirects");
  }

  let nextUrl: URL;
  try {
    nextUrl = normalizePublicAuditUrl(new URL(location, currentUrl).toString());
  } catch {
    throw new PublicAuditTargetError("invalid_url");
  }
  if (expectedOrigin && nextUrl.origin !== expectedOrigin) {
    throw new PublicAuditTargetError("cross_origin_redirect");
  }
  return nextUrl;
}

export function isPublicAuditAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6") {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export function validatePublicAuditResolution(
  addresses: LookupAddress[],
): LookupAddress[] {
  if (!addresses.length || addresses.some(({ address }) => !isPublicAuditAddress(address))) {
    throw new PublicAuditTargetError("blocked_destination");
  }
  return addresses;
}

export function createPinnedPublicAuditLookup(
  addresses: LookupAddress[],
): LookupFunction {
  const first = addresses[0];
  if (!first) throw new PublicAuditTargetError("blocked_destination");
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, addresses);
      return;
    }
    callback(null, first.address, first.family);
  };
}

async function resolvePublicAddresses(hostname: string): Promise<LookupAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    host.length === 0 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    throw new PublicAuditTargetError("blocked_destination");
  }

  const literalFamily = isIP(host);
  if (literalFamily) {
    if (!isPublicAuditAddress(host)) {
      throw new PublicAuditTargetError("blocked_destination");
    }
    return [{ address: host, family: literalFamily }];
  }

  const lookupPromise = dnsPromises.lookup(host, {
    all: true,
    verbatim: true,
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new PublicAuditTargetError("timeout")),
      DNS_TIMEOUT_MS,
    );
    timeoutHandle.unref();
  });
  let addresses: LookupAddress[];
  try {
    addresses = await Promise.race([lookupPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof PublicAuditTargetError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new PublicAuditTargetError("connection_failed");
    }
    throw new PublicAuditTargetError("blocked_destination");
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  return validatePublicAuditResolution(addresses);
}

export function normalizePublicAuditUrl(input: string): URL {
  if (input.length > 2048) throw new PublicAuditTargetError("invalid_url");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicAuditTargetError("invalid_url");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.port &&
      !(
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443")
      ))
  ) {
    throw new PublicAuditTargetError("invalid_url");
  }

  url.hash = "";
  // Query strings can contain personal data or trigger unsafe legacy GET actions.
  // The audit checks the public page path, not query-driven variants.
  url.search = "";
  return url;
}

export function sanitizePublicAuditUrlForLog(input: string): string | null {
  let url: URL;
  try {
    url = normalizePublicAuditUrl(input);
  } catch {
    return null;
  }

  // URL path segments can contain names, identifiers, or one-time tokens.
  const path = url.pathname
    .split("/")
    .map((segment) => (segment ? "[redacted]" : segment))
    .join("/");

  return `${url.origin}${path || "/"}`;
}

function performRequest(
  url: URL,
  addresses: LookupAddress[],
  method: "GET" | "HEAD",
  maxBytes: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Omit<PublicFetchResult, "requestedUrl" | "finalUrl" | "redirectCount"> & {
  location?: string;
}> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PublicAuditTargetError("connection_failed"));
      return;
    }

    const startedAt = performance.now();
    const requestModule = url.protocol === "https:" ? https : http;
    let settled = false;
    let bodySize = 0;
    const chunks: Buffer[] = [];

    const finishWithError = (error: PublicAuditTargetError) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };

    const request = requestModule.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname || "/"}${url.search}`,
        method,
        signal,
         lookup: createPinnedPublicAuditLookup(addresses),
        agent:
          url.protocol === "https:"
            ? new https.Agent({ keepAlive: false, maxSockets: 1 })
            : new http.Agent({ keepAlive: false, maxSockets: 1 }),
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            method === "HEAD"
              ? "text/html, text/css, application/xhtml+xml, */*;q=0.1"
              : "text/html, application/xhtml+xml;q=0.9, text/css;q=0.8, */*;q=0.1",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "close",
        },
      },
      (response) => {
        const ttfbMs = Math.max(0, Math.round(performance.now() - startedAt));
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          typeof location === "string"
        ) {
          response.destroy();
          settled = true;
          resolve({
            status,
            headers: response.headers,
            body: Buffer.alloc(0),
            ttfbMs,
            transferBytes: 0,
            location,
          });
          return;
        }

        if (maxBytes === 0) {
          settled = true;
          response.destroy();
          resolve({
            status,
            headers: response.headers,
            body: Buffer.alloc(0),
            ttfbMs,
            transferBytes: 0,
          });
          return;
        }

        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bodySize += buffer.length;
          if (bodySize > maxBytes) {
            finishWithError(new PublicAuditTargetError("response_too_large"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status,
            headers: response.headers,
            body: Buffer.concat(chunks, bodySize),
            ttfbMs,
            transferBytes: bodySize,
          });
        });
        response.on("aborted", () =>
          finishWithError(new PublicAuditTargetError("connection_failed")),
        );
        response.on("error", () =>
          finishWithError(new PublicAuditTargetError("connection_failed")),
        );
        if (method === "HEAD") response.resume();
      },
    );

    const timeout = setTimeout(
      () => finishWithError(new PublicAuditTargetError("timeout")),
      timeoutMs,
    );
    timeout.unref();
    request.once("close", () => clearTimeout(timeout));
    request.once("error", () =>
      finishWithError(new PublicAuditTargetError("connection_failed")),
    );
    request.end();
  });
}

export async function safePublicFetch(
  input: string,
  options: PublicFetchOptions = {},
): Promise<PublicFetchResult> {
  const method = options.method ?? "GET";
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const initialUrl = normalizePublicAuditUrl(input);
  const requestedUrl = initialUrl.toString();
  const maximumRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let currentUrl = initialUrl;
  let redirectCount = 0;

  for (;;) {
    if (options.signal?.aborted || Date.now() >= deadline) {
      throw new PublicAuditTargetError("timeout");
    }

    if (
      options.expectedOrigin &&
      currentUrl.origin !== options.expectedOrigin
    ) {
      throw new PublicAuditTargetError("cross_origin_redirect");
    }

    const hostname = currentUrl.hostname.replace(/^\[|\]$/g, "");
    const addresses = await resolvePublicAddresses(hostname);
    const timeoutMs = Math.max(
      1,
      Math.min(HOP_TIMEOUT_MS, deadline - Date.now()),
    );
    let result;
    try {
      result = await performRequest(
        currentUrl,
        addresses,
        method,
        maxBytes,
        timeoutMs,
        options.signal,
      );
    } catch (error) {
      if (error instanceof PublicAuditTargetError) throw error;
      if (options.signal?.aborted) {
        throw new PublicAuditTargetError("timeout");
      }
      throw new PublicAuditTargetError("connection_failed");
    }

    if (result.location) {
      currentUrl = resolvePublicAuditRedirect(
        currentUrl,
        result.location,
        redirectCount,
        maximumRedirects,
        options.expectedOrigin,
      );
      redirectCount += 1;
      continue;
    }

    return {
      requestedUrl,
      finalUrl: currentUrl.toString(),
      status: result.status,
      headers: result.headers,
      body: result.body,
      ttfbMs: result.ttfbMs,
      transferBytes: result.transferBytes,
      redirectCount,
    };
  }
}
