import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const DIAGNOSTIC_PATH = "/api/internal/proxy-ip-diagnostic";
const STAGING_HOST = "flowpoint-marketing-staging.onrender.com";
const TOKEN = "compiled-bundle-diagnostic-token-for-tests-only";
const SESSION_SECRET = "compiled-bundle-session-secret-for-tests-only";
const TEST_CLIENT_IP = "203.0.113.17";

type HttpResult = {
  status: number;
  contentType: string | undefined;
  body: string;
};

function request(
  port: number,
  route: string,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "GET",
        headers: {
          Host: STAGING_HOST,
          ...extraHeaders,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            contentType: res.headers["content-type"],
            body,
          });
        });
      },
    );
    req.once("error", reject);
    req.setTimeout(1_000, () => req.destroy(new Error("HTTP request timed out")));
    req.end();
  });
}

async function getAvailablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitUntilReady(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Compiled server exited before readiness (code ${child.exitCode}).`);
    }
    try {
      const health = await request(port, "/healthz");
      if (health.status === 200) return;
      lastError = new Error(`Health check returned HTTP ${health.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Compiled server did not become ready: ${String(lastError)}`);
}

test("fresh production bundle serves the temporary diagnostic endpoint", async () => {
  const bundlePath = path.resolve("dist/index.cjs");
  assert.ok(existsSync(bundlePath), "production bundle must exist after the build");
  assert.ok(
    readFileSync(bundlePath, "utf8").includes(DIAGNOSTIC_PATH),
    "production bundle must contain the diagnostic route path",
  );

  const port = await getAvailablePort();
  const child = spawn(process.execPath, [bundlePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
      PUBLIC_AUDIT_ENABLED: "false",
      PUBLIC_AUDIT_IP_DIAGNOSTIC: "true",
      PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN: TOKEN,
      SESSION_SECRET,
    },
    stdio: "ignore",
  });

  try {
    await waitUntilReady(child, port);

    const response = await request(port, DIAGNOSTIC_PATH, {
      "X-Proxy-Diagnostic-Token": TOKEN,
      "CF-Connecting-IP": TEST_CLIENT_IP,
      "X-Forwarded-For": TEST_CLIENT_IP,
    });
    assert.equal(response.status, 200);
    assert.match(response.contentType ?? "", /^application\/json\b/);

    const result = JSON.parse(response.body);
    assert.equal(result.requestIpMatchesEdgeClient, true);
    assert.equal(typeof result.requestIpFingerprint, "string");
    assert.equal(result.requestIpFingerprint, result.edgeClientFingerprint);
    assert.doesNotMatch(response.body, new RegExp(TEST_CLIENT_IP.replaceAll(".", "\\.")));
    assert.doesNotMatch(response.body, new RegExp(TOKEN));
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
});
