import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import express from "express";
import test, { after, before } from "node:test";
import { registerProxyIpDiagnostic } from "./proxy-ip-diagnostic";

const TOKEN = "staging-only-diagnostic-token-for-tests";
const SESSION_SECRET = "synthetic-session-secret-used-only-by-tests";
const SPOOFED_IP = "198.51.100.77";
const FIRST_OBSERVED_IP = "203.0.113.9";
const SECOND_OBSERVED_IP = "192.0.2.44";

let server: Server | undefined;
let baseUrl: string;
const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  enabled: process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC,
  token: process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN,
  sessionSecret: process.env.SESSION_SECRET,
};

async function listen(target: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    target.once("error", reject);
    target.listen(0, "127.0.0.1", resolve);
  });
  const address = target.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(target: Server): Promise<void> {
  if (!target.listening) return;
  await new Promise<void>((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestDiagnostic(options: {
  host?: string;
  token?: string;
  edgeClientIp?: string;
  forwardedFor?: string;
} = {}) {
  const headers: Record<string, string> = {
    Host: options.host ?? "flowpoint-marketing-staging.onrender.com",
  };
  if (options.token) headers["X-Proxy-Diagnostic-Token"] = options.token;
  if (options.edgeClientIp) headers["CF-Connecting-IP"] = options.edgeClientIp;
  if (options.forwardedFor) headers["X-Forwarded-For"] = options.forwardedFor;
  const target = new URL(baseUrl);
  const response = await new Promise<{
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      path: "/api/internal/proxy-ip-diagnostic",
      method: "GET",
      headers,
    }, (incoming) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => { body += chunk; });
      incoming.on("end", () => resolve({
        statusCode: incoming.statusCode,
        headers: incoming.headers,
        body,
      }));
    });
    request.once("error", reject);
    request.end();
  });
  return {
    status: response.statusCode ?? 0,
    body: response.body,
    cacheControl: response.headers["cache-control"]?.toString() ?? null,
    setCookie: response.headers["set-cookie"]?.toString() ?? null,
  };
}

before(async () => {
  const app = express();
  app.set("trust proxy", 1);
  registerProxyIpDiagnostic(app);
  server = createServer(app);
  const port = await listen(server);
  baseUrl = `http://127.0.0.1:${port}`;
});

test("diagnostic is unavailable unless staging production mode is explicitly enabled", async () => {
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC = "false";
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN = TOKEN;
  process.env.SESSION_SECRET = SESSION_SECRET;

  const response = await requestDiagnostic({
    token: TOKEN,
    edgeClientIp: FIRST_OBSERVED_IP,
    forwardedFor: SPOOFED_IP,
  });

  assert.equal(response.status, 404);
  assert.equal(response.setCookie, null);
  assert.doesNotMatch(response.body, /198\.51\.100\.77|203\.0\.113\.9|diagnostic-token/);
});

test("diagnostic rejects other hosts and unauthenticated requests without revealing observations", async () => {
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC = "true";
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN = TOKEN;

  const wrongHost = await requestDiagnostic({
    host: "flowpoint.pro",
    token: TOKEN,
    edgeClientIp: FIRST_OBSERVED_IP,
    forwardedFor: SPOOFED_IP,
  });
  const wrongToken = await requestDiagnostic({
    token: "wrong-token",
    edgeClientIp: FIRST_OBSERVED_IP,
    forwardedFor: SPOOFED_IP,
  });

  assert.equal(wrongHost.status, 404);
  assert.equal(wrongToken.status, 404);
  assert.equal(wrongHost.setCookie, null);
  assert.equal(wrongToken.setCookie, null);
  assert.doesNotMatch(`${wrongHost.body}${wrongToken.body}`, /198\.51\.100\.77|203\.0\.113\.9/);
});

test("diagnostic returns only comparisons and keyed fingerprints for controlled proxy cases", async () => {
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC = "true";
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN = TOKEN;
  process.env.SESSION_SECRET = SESSION_SECRET;

  const spoofedRequest = await requestDiagnostic({
    token: TOKEN,
    edgeClientIp: FIRST_OBSERVED_IP,
    forwardedFor: SPOOFED_IP,
  });
  const appendedClientRequest = await requestDiagnostic({
    token: TOKEN,
    edgeClientIp: FIRST_OBSERVED_IP,
    forwardedFor: `${SPOOFED_IP}, ${FIRST_OBSERVED_IP}`,
  });
  const secondVisitorRequest = await requestDiagnostic({
    token: TOKEN,
    edgeClientIp: SECOND_OBSERVED_IP,
    forwardedFor: `${SPOOFED_IP}, ${SECOND_OBSERVED_IP}`,
  });

  assert.equal(spoofedRequest.status, 200);
  assert.equal(appendedClientRequest.status, 200);
  assert.equal(secondVisitorRequest.status, 200);
  assert.equal(spoofedRequest.cacheControl, "no-store, max-age=0");
  assert.equal(spoofedRequest.setCookie, null);

  const spoofed = JSON.parse(spoofedRequest.body);
  const appendedClient = JSON.parse(appendedClientRequest.body);
  const secondVisitor = JSON.parse(secondVisitorRequest.body);

  assert.equal(spoofed.spoofCanaryPresentInForwardedFor, true);
  assert.equal(spoofed.spoofedForwardedForSelected, true);
  assert.equal(spoofed.requestIpMatchesEdgeClient, false);
  assert.equal(appendedClient.spoofCanaryPresentInForwardedFor, true);
  assert.equal(appendedClient.spoofedForwardedForSelected, false);
  assert.equal(appendedClient.requestIpMatchesEdgeClient, true);
  assert.equal(
    appendedClient.requestIpFingerprint,
    appendedClient.edgeClientFingerprint,
  );
  assert.notEqual(
    appendedClient.requestIpFingerprint,
    secondVisitor.requestIpFingerprint,
  );

  const exposedBody = [
    spoofedRequest.body,
    appendedClientRequest.body,
    secondVisitorRequest.body,
  ].join(" ");
  assert.doesNotMatch(
    exposedBody,
    /198\.51\.100\.77|203\.0\.113\.9|192\.0\.2\.44|diagnostic-token-for-tests/,
  );
});

test("diagnostic fails closed for malformed observed addresses", async () => {
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC = "true";
  process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN = TOKEN;

  const response = await requestDiagnostic({
    token: TOKEN,
    edgeClientIp: "not-an-ip-address",
    forwardedFor: SPOOFED_IP,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body, '{"code":"DIAGNOSTIC_INVALID_INPUT"}');
  assert.equal(response.setCookie, null);
});

after(async () => {
  if (server) await close(server);
  if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment.nodeEnv;
  if (originalEnvironment.enabled === undefined) delete process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC;
  else process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC = originalEnvironment.enabled;
  if (originalEnvironment.token === undefined) delete process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN;
  else process.env.PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN = originalEnvironment.token;
  if (originalEnvironment.sessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalEnvironment.sessionSecret;
});
