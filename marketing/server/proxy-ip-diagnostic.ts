import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import ipaddr from "ipaddr.js";

const DIAGNOSTIC_PATH = "/api/internal/proxy-ip-diagnostic";
const STAGING_HOST = "flowpoint-marketing-staging.onrender.com";
const SPOOF_CANARY_IP = "198.51.100.77";
const MAX_DIAGNOSTIC_REQUESTS = 16;
let diagnosticRequestCount = 0;

function normalizedIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return ipaddr.process(value.trim()).toString();
  } catch {
    return undefined;
  }
}

function matchesToken(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || expected.length < 32 || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function fingerprint(secret: string, address: string): string {
  return createHmac("sha256", secret)
    .update(`render-proxy-diagnostic:${address}`)
    .digest("hex")
    .slice(0, 24);
}

function diagnosticIsAvailable(req: Request): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC === "true" &&
    req.hostname.toLowerCase() === STAGING_HOST
  );
}

export function registerProxyIpDiagnostic(app: Express): void {
  app.get(DIAGNOSTIC_PATH, (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    if (!diagnosticIsAvailable(req)) {
      res.sendStatus(404);
      return;
    }

    if (!matchesToken(
      process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN,
      req.get("x-proxy-diagnostic-token"),
    )) {
      res.sendStatus(404);
      return;
    }

    diagnosticRequestCount += 1;
    if (diagnosticRequestCount > MAX_DIAGNOSTIC_REQUESTS) {
      res.status(429).json({ code: "DIAGNOSTIC_REQUEST_LIMIT" });
      return;
    }

    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret || sessionSecret.length < 32) {
      res.status(503).json({ code: "DIAGNOSTIC_UNAVAILABLE" });
      return;
    }

    const requestIp = normalizedIp(req.ip);
    const edgeClientIp = normalizedIp(req.get("cf-connecting-ip"));
    if (!requestIp || !edgeClientIp) {
      res.status(400).json({ code: "DIAGNOSTIC_INVALID_INPUT" });
      return;
    }

    const forwardedFor = (req.get("x-forwarded-for") ?? "")
      .split(",")
      .map(normalizedIp)
      .filter((address): address is string => Boolean(address));

    res.json({
      requestIpMatchesEdgeClient: requestIp === edgeClientIp,
      requestIpFingerprint: fingerprint(sessionSecret, requestIp),
      edgeClientFingerprint: fingerprint(sessionSecret, edgeClientIp),
      spoofedForwardedForSelected: requestIp === SPOOF_CANARY_IP,
      spoofCanaryPresentInForwardedFor: forwardedFor.includes(SPOOF_CANARY_IP),
    });
  });
}
