import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { performance } from "node:perf_hooks";
import express from "express";
import test, { after } from "node:test";
import type { Request, Response } from "express";
import { pool } from "../server/db";
import {
  closePublicAuditQuotaPool,
  PublicAuditBusyError,
  PublicAuditQuotaError,
  getPublicAuditQuota,
  getQuotaLimits,
  releasePublicAuditSlot,
  reservePublicAudit,
  startPublicAuditQuotaCleanup,
} from "../server/public-audit-quota";
import { registerPublicAuditRoutes } from "../server/public-audit-routes";
import { PUBLIC_AUDIT_STANDARD_SIGNUP_URL } from "../server/public-audit-report";
import type { PublicAuditReport } from "../shared/public-audit";

const EXPECTED_DATABASE = "public_audit_release_test";
const SYNTHETIC_URL = "https://example.com/";
const SYNTHETIC_IP = "203.0.113.77";
const auditObjectNames = new Set([
  "public_audit_quota_counters",
  "public_audit_quota_counters_pkey",
  "public_audit_quota_counters_quota_type_check",
  "public_audit_quota_counters_used_check",
  "public_audit_quota_counters_expires_at_idx",
  "public_audit_concurrency_slots",
  "public_audit_concurrency_slots_pkey",
]);

function assertDisposableTarget(): void {
  assert.equal(
    process.env.PUBLIC_AUDIT_RELEASE_TEST,
    "true",
    "Set PUBLIC_AUDIT_RELEASE_TEST=true to opt in to this disposable-database test.",
  );
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL must point at the disposable local cluster.");
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname),
    "Refusing any non-loopback database host.",
  );
  assert.equal(
    decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    EXPECTED_DATABASE,
    `Refusing to use any database except ${EXPECTED_DATABASE}.`,
  );
  const quotaDatabaseUrl = process.env.PUBLIC_AUDIT_DATABASE_URL;
  assert.ok(
    quotaDatabaseUrl,
    "PUBLIC_AUDIT_DATABASE_URL must point at the same disposable local quota database.",
  );
  const quotaParsed = new URL(quotaDatabaseUrl);
  assert.ok(
    ["127.0.0.1", "::1", "localhost"].includes(quotaParsed.hostname),
    "Refusing any non-loopback quota database host.",
  );
  assert.equal(quotaParsed.hostname, parsed.hostname);
  assert.equal(quotaParsed.port, parsed.port);
  assert.equal(
    decodeURIComponent(quotaParsed.pathname.replace(/^\//, "")),
    EXPECTED_DATABASE,
    `Refusing to use any quota database except ${EXPECTED_DATABASE}.`,
  );
  assert.ok(
    (process.env.SESSION_SECRET ?? "").length >= 32,
    "Set a synthetic SESSION_SECRET of at least 32 characters.",
  );
}

function fakeRequest(cookie?: string, ip = SYNTHETIC_IP): Request {
  return {
    headers: cookie ? { cookie } : {},
    secure: true,
    ip,
  } as unknown as Request;
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  const response = {
    headers,
    append(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
  };
  return response as unknown as Response & {
    headers: Record<string, string>;
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readPublicObjects(): Promise<Array<{ kind: string; name: string }>> {
  const result = await pool.query<{ kind: string; name: string }>(`
    SELECT 'table' AS kind, relation.relname AS name
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
    UNION ALL
    SELECT 'index' AS kind, relation.relname AS name
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relkind = 'i'
    UNION ALL
    SELECT 'constraint' AS kind, constraint_row.conname AS name
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.connamespace = 'public'::regnamespace
     ORDER BY kind, name
  `);
  return result.rows;
}

function nonAuditObjects(
  objects: Array<{ kind: string; name: string }>,
): Array<{ kind: string; name: string }> {
  return objects
    .filter((object) => !auditObjectNames.has(object.name))
    .sort((left, right) =>
      `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`),
    );
}

async function requestJson(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await fetch(new URL(path, baseUrl), options);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

function percentile(values: number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

test(
  "isolated release validation covers schema, controls, quotas, and local-fixture capacity",
  { timeout: 120_000 },
  async (context) => {
    assertDisposableTarget();
    const schemaSql = readFileSync(
      "scripts/public-audit-release-schema.sql",
      "utf8",
    );
    const fixtureState = { requests: 0, active: 0, peakActive: 0 };
    const fixtureServer = createServer((_request, response) => {
      fixtureState.requests += 1;
      fixtureState.active += 1;
      fixtureState.peakActive = Math.max(
        fixtureState.peakActive,
        fixtureState.active,
      );
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"fixture":"local","ok":true}');
        fixtureState.active -= 1;
      }, 8);
    });
    let appServer: Server | undefined;

    try {
      await pool.query(`
        DROP TABLE IF EXISTS public_audit_quota_counters CASCADE;
        DROP TABLE IF EXISTS public_audit_concurrency_slots CASCADE;
        DROP TABLE IF EXISTS release_witness CASCADE;
        CREATE TABLE release_witness (
          id integer PRIMARY KEY,
          marker text NOT NULL
        );
        INSERT INTO release_witness (id, marker)
        VALUES (1, 'synthetic-row-must-stay-unchanged');
      `);
      const beforeObjects = await readPublicObjects();
      const beforeExtensions = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_extension",
      );
      const beforeWitness = await pool.query(
        "SELECT id, marker FROM release_witness ORDER BY id",
      );

      const fixturePort = await listen(fixtureServer);
      const fixtureUrl = `http://127.0.0.1:${fixturePort}/fixture`;
      const app = express();
      app.set("trust proxy", 1);
      app.use(express.json());
      process.env.PUBLIC_AUDIT_ENABLED = "false";
      process.env.PUBLIC_AUDIT_TEST_MODE = "false";

      registerPublicAuditRoutes(app, {
        createReport: async (_url, quota, signal): Promise<PublicAuditReport> => {
          const response = await fetch(fixtureUrl, { signal });
          assert.equal(response.status, 200);
          await response.text();
          return {
            url: SYNTHETIC_URL,
            finalUrl: SYNTHETIC_URL,
            checkedAt: new Date().toISOString(),
            overallScore: 100,
            categories: [],
            actionPlan: [],
            recommendation: {
              plan: "Standard",
              priceEur: 29,
              reason: "Synthetic release validation fixture.",
              href: PUBLIC_AUDIT_STANDARD_SIGNUP_URL,
            },
            quota,
          };
        },
      });
      const appPort = await listen((appServer = createServer(app)));
      const appUrl = `http://127.0.0.1:${appPort}`;
      const postOptions: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": SYNTHETIC_IP,
        },
        body: JSON.stringify({
          url: "https://example.com/?query-canary=not-stored",
        }),
      };

      const disabledQuota = await requestJson(
        appUrl,
        "/api/public-audit/quota",
        { headers: { "X-Forwarded-For": SYNTHETIC_IP } },
      );
      const disabledAudit = await requestJson(
        appUrl,
        "/api/public-audit",
        postOptions,
      );
      assert.equal(disabledQuota.status, 503);
      assert.equal(disabledAudit.status, 503);
      assert.equal(await pool.query<{ name: string | null }>(
        "SELECT to_regclass('public.public_audit_quota_counters') AS name",
      ).then((result) => result.rows[0]?.name), null, "route registration must not create tables");

      process.env.PUBLIC_AUDIT_ENABLED = "true";
      const missingQuota = await requestJson(
        appUrl,
        "/api/public-audit/quota",
        { headers: { "X-Forwarded-For": SYNTHETIC_IP } },
      );
      const missingAudit = await requestJson(
        appUrl,
        "/api/public-audit",
        postOptions,
      );
      assert.equal(missingQuota.status, 503);
      assert.equal(missingAudit.status, 503);
      assert.equal(missingAudit.body.code, "PUBLIC_AUDIT_UNAVAILABLE");
      assert.equal(
        missingAudit.body.message,
        "The public website audit is temporarily unavailable.",
      );
      assert.doesNotMatch(
        JSON.stringify([missingQuota.body, missingAudit.body]),
        /public_audit_quota_counters|query-canary|example\.com|203\.0\.113/,
      );

      const incompatibleClient = await pool.connect();
      try {
        await incompatibleClient.query(
          "CREATE TABLE public_audit_quota_counters (wrong_column text)",
        );
        await assert.rejects(
          () => incompatibleClient.query(schemaSql),
          /incompatible column set/i,
        );
        await incompatibleClient.query("ROLLBACK");
        const stillIncompatible = await incompatibleClient.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'public_audit_quota_counters'",
        );
        assert.deepEqual(stillIncompatible.rows.map((row) => row.column_name), [
          "wrong_column",
        ]);
        assert.equal(
          await incompatibleClient
            .query("SELECT to_regclass('public.public_audit_concurrency_slots') AS name")
            .then((result) => result.rows[0]?.name),
          null,
          "failed DDL must roll back the other audit table too",
        );
        await incompatibleClient.query(
          "DROP TABLE public_audit_quota_counters",
        );
      } finally {
        incompatibleClient.release();
      }

      const incompatibleShapeClient = await pool.connect();
      try {
        await incompatibleShapeClient.query(`
          CREATE TABLE public_audit_quota_counters (
            quota_type text NOT NULL,
            quota_key char(64) NOT NULL,
            day_utc date NOT NULL,
            used integer NOT NULL DEFAULT 0,
            expires_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT public_audit_quota_counters_pkey
              PRIMARY KEY (quota_type, quota_key, day_utc),
            CONSTRAINT public_audit_quota_counters_quota_type_check
              CHECK (quota_type IN ('visitor', 'network', 'global')),
            CONSTRAINT public_audit_quota_counters_used_check
              CHECK (used >= 0 OR used < 0)
          )
        `);
        await assert.rejects(
          () => incompatibleShapeClient.query(schemaSql),
          /incompatible constraints/i,
          "a same-named but weaker check constraint must be rejected",
        );
        await incompatibleShapeClient.query("ROLLBACK");
        assert.match(
          await incompatibleShapeClient
            .query<{ definition: string }>(
              `SELECT pg_get_constraintdef(oid) AS definition
                 FROM pg_constraint
                WHERE conrelid = 'public_audit_quota_counters'::regclass
                  AND conname = 'public_audit_quota_counters_used_check'`,
            )
            .then((result) => result.rows[0]?.definition ?? ""),
          /used\s*>=\s*0[\s\S]*used\s*<\s*0/,
        );
        assert.equal(
          await incompatibleShapeClient
            .query(
              "SELECT to_regclass('public.public_audit_concurrency_slots') AS name",
            )
            .then((result) => result.rows[0]?.name),
          null,
          "rejected schema must not leave the other audit table behind",
        );
        await incompatibleShapeClient.query(
          "DROP TABLE public_audit_quota_counters",
        );

        await incompatibleShapeClient.query(`
          CREATE TABLE public_audit_quota_counters (
            quota_type text NOT NULL,
            quota_key char(64) NOT NULL,
            day_utc date NOT NULL,
            used integer DEFAULT 0,
            expires_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT public_audit_quota_counters_pkey
              PRIMARY KEY (quota_type, quota_key, day_utc),
            CONSTRAINT public_audit_quota_counters_quota_type_check
              CHECK (quota_type IN ('visitor', 'network', 'global')),
            CONSTRAINT public_audit_quota_counters_used_check
              CHECK (used >= 0)
          )
        `);
        await assert.rejects(
          () => incompatibleShapeClient.query(schemaSql),
          /incompatible column set/i,
          "a nullable counter column must be rejected",
        );
        await incompatibleShapeClient.query("ROLLBACK");
        assert.equal(
          await incompatibleShapeClient
            .query<{ is_nullable: string }>(
              `SELECT is_nullable
                 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'public_audit_quota_counters'
                  AND column_name = 'used'`,
            )
            .then((result) => result.rows[0]?.is_nullable),
          "YES",
        );
        await incompatibleShapeClient.query(
          "DROP TABLE public_audit_quota_counters",
        );
      } finally {
        incompatibleShapeClient.release();
      }

      await pool.query(schemaSql);
      const afterFirstApply = await readPublicObjects();
      const firstDiff = afterFirstApply.filter(
        (object) => !beforeObjects.some(
          (before) => before.kind === object.kind && before.name === object.name,
        ),
      );
      const expectedDiff = [
        { kind: "constraint", name: "public_audit_concurrency_slots_pkey" },
        { kind: "constraint", name: "public_audit_quota_counters_pkey" },
        { kind: "constraint", name: "public_audit_quota_counters_quota_type_check" },
        { kind: "constraint", name: "public_audit_quota_counters_used_check" },
        { kind: "index", name: "public_audit_concurrency_slots_pkey" },
        { kind: "index", name: "public_audit_quota_counters_expires_at_idx" },
        { kind: "index", name: "public_audit_quota_counters_pkey" },
        { kind: "table", name: "public_audit_concurrency_slots" },
        { kind: "table", name: "public_audit_quota_counters" },
      ];
      assert.deepEqual(firstDiff, expectedDiff);
      assert.deepEqual(
        nonAuditObjects(afterFirstApply),
        nonAuditObjects(beforeObjects),
        "unrelated schema objects must remain byte-for-byte equivalent by catalog identity",
      );
      assert.deepEqual(
        (await pool.query("SELECT id, marker FROM release_witness ORDER BY id")).rows,
        beforeWitness.rows,
        "synthetic witness data must remain unchanged",
      );
      assert.deepEqual(
        await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_extension",
        ).then((result) => result.rows),
        beforeExtensions.rows,
        "the DDL must not add or change extensions",
      );
      assert.equal(
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM pg_constraint
            WHERE conrelid IN (
              'public_audit_quota_counters'::regclass,
              'public_audit_concurrency_slots'::regclass
            ) AND contype = 'f'`,
        ).then((result) => result.rows[0]?.count),
        "0",
      );

      await pool.query(schemaSql);
      assert.deepEqual(await readPublicObjects(), afterFirstApply);

      const testSchemaSql = readFileSync(
        "scripts/public-audit-test-schema.sql",
        "utf8",
      );
      for (const namedConstraint of [
        "public_audit_quota_counters_quota_type_check",
        "public_audit_quota_counters_used_check",
      ]) {
        assert.ok(testSchemaSql.includes(namedConstraint));
      }

      const quotaResponse = await requestJson(
        appUrl,
        "/api/public-audit/quota",
        { headers: { "X-Forwarded-For": SYNTHETIC_IP } },
      );
      assert.equal(quotaResponse.status, 200);
      assert.equal(quotaResponse.body.limit, 3);
      assert.equal(quotaResponse.body.remaining, 3);

      const successfulAudit = await requestJson(
        appUrl,
        "/api/public-audit",
        postOptions,
      );
      assert.equal(successfulAudit.status, 200);
      assert.equal(
        (successfulAudit.body.recommendation as { href: string }).href,
        "https://app.flowpoint.pro/signin.html?plan=standard",
      );
      assert.equal(PUBLIC_AUDIT_STANDARD_SIGNUP_URL, "https://app.flowpoint.pro/signin.html?plan=standard");
      assert.equal(fixtureState.requests, 1, "the route must use the local fixture only");
      assert.doesNotMatch(
        JSON.stringify(successfulAudit.body),
        /query-canary|203\.0\.113|@/,
      );

      await pool.query(`
        INSERT INTO public_audit_quota_counters
          (quota_type, quota_key, day_utc, used, expires_at, updated_at)
        VALUES ('global', repeat('a', 64), CURRENT_DATE, 1, now() - interval '1 second', now())
      `);
      startPublicAuditQuotaCleanup();
      let expiredCount = 1;
      const cleanupDeadline = Date.now() + 1_000;
      while (expiredCount > 0 && Date.now() < cleanupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expiredCount = Number(
          (await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM public_audit_quota_counters WHERE expires_at < now()",
          )).rows[0]?.count ?? 0,
        );
      }
      assert.equal(expiredCount, 0, "expired counters should be cleaned");

      const consoleOutput: string[] = [];
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
      };
      console.log = (...values: unknown[]) => consoleOutput.push(values.join(" "));
      console.warn = (...values: unknown[]) => consoleOutput.push(values.join(" "));
      console.error = (...values: unknown[]) => consoleOutput.push(values.join(" "));
      try {
        process.env.PUBLIC_AUDIT_ENABLED = "false";
        const emergencyQuota = await requestJson(
          appUrl,
          "/api/public-audit/quota",
          { headers: { "X-Forwarded-For": SYNTHETIC_IP } },
        );
        const emergencyAudit = await requestJson(
          appUrl,
          "/api/public-audit",
          postOptions,
        );
        assert.equal(emergencyQuota.status, 503);
        assert.equal(emergencyAudit.status, 503);
        assert.equal(fixtureState.requests, 1, "disable must stop fixture work immediately");
      } finally {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
      }
      assert.deepEqual(consoleOutput, [], "audit routes must not write request data to the console");

      process.env.PUBLIC_AUDIT_ENABLED = "true";
      process.env.PUBLIC_AUDIT_TEST_MODE = "false";
      process.env.PUBLIC_AUDIT_DAILY_LIMIT = "500";
      process.env.PUBLIC_AUDIT_NETWORK_DAILY_LIMIT = "25";
      process.env.PUBLIC_AUDIT_MAX_CONCURRENT = "2";
      assert.deepEqual(getQuotaLimits(), {
        visitor: 3,
        network: 25,
        global: 500,
        concurrency: 2,
      });

      await pool.query(
        "TRUNCATE public_audit_quota_counters, public_audit_concurrency_slots",
      );
      const visitorResponse = fakeResponse();
      const visitorQuota = await getPublicAuditQuota(
        fakeRequest(),
        visitorResponse,
      );
      assert.equal(visitorQuota.limit, 3);
      const visitorCookie = visitorResponse.headers["set-cookie"]?.split(";")[0];
      assert.ok(visitorCookie);
      for (let count = 0; count < 3; count += 1) {
        const reservation = await reservePublicAudit(
          fakeRequest(visitorCookie, "198.51.100.44"),
          fakeResponse(),
        );
        await releasePublicAuditSlot(reservation.slotId, reservation.leaseId);
      }
      await assert.rejects(
        () =>
          reservePublicAudit(
            fakeRequest(visitorCookie, "198.51.100.44"),
            fakeResponse(),
          ),
        (error) =>
          error instanceof PublicAuditQuotaError && error.kind === "visitor",
      );
      await pool.query(
        "TRUNCATE public_audit_quota_counters, public_audit_concurrency_slots",
      );
      const networkReservations = [];
      for (let count = 0; count < 25; count += 1) {
        const reservation = await reservePublicAudit(
          fakeRequest(undefined, "198.51.100.45"),
          fakeResponse(),
        );
        networkReservations.push(reservation);
        await releasePublicAuditSlot(
          reservation.slotId,
          reservation.leaseId,
        );
      }
      await assert.rejects(
        () =>
          reservePublicAudit(
            fakeRequest(undefined, "198.51.100.45"),
            fakeResponse(),
          ),
        (error) =>
          error instanceof PublicAuditQuotaError && error.kind === "network",
      );
      assert.equal(
        networkReservations.length,
        25,
        "all 25 reservations from one exact IP should be allowed",
      );

      await pool.query(
        "TRUNCATE public_audit_quota_counters, public_audit_concurrency_slots",
      );
      const simultaneous = await Promise.allSettled(
        Array.from({ length: 3 }, (_, index) =>
          reservePublicAudit(
            fakeRequest(undefined, `198.51.100.${50 + index}`),
            fakeResponse(),
          ),
        ),
      );
      const concurrentSuccesses = simultaneous.filter(
        (result): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof reservePublicAudit>>
        > => result.status === "fulfilled",
      );
      const busyFailures = simultaneous.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof PublicAuditBusyError,
      );
      assert.equal(concurrentSuccesses.length, 2);
      assert.equal(busyFailures.length, 1);
      await Promise.all(
        concurrentSuccesses.map((result) =>
          releasePublicAuditSlot(result.value.slotId, result.value.leaseId),
        ),
      );

      await pool.query(
        "TRUNCATE public_audit_quota_counters, public_audit_concurrency_slots",
      );
      fixtureState.requests = 0;
      fixtureState.peakActive = 0;
      const latencies: number[] = [];
      let peakRssBytes = process.memoryUsage().rss;
      let nextIndex = 0;
      const startedAt = performance.now();
      const worker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= 500) return;
          const started = performance.now();
          const ipGroup = Math.floor(index / 25) + 1;
          const reservation = await reservePublicAudit(
            fakeRequest(undefined, `198.51.100.${ipGroup}`),
            fakeResponse(),
          );
          try {
            const fixtureResponse = await fetch(`${fixtureUrl}?sample=${index}`);
            assert.equal(fixtureResponse.status, 200);
            assert.match(await fixtureResponse.text(), /"fixture":"local"/);
          } finally {
            await releasePublicAuditSlot(
              reservation.slotId,
              reservation.leaseId,
            );
          }
          latencies.push(performance.now() - started);
          peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        }
      };
      await Promise.all([worker(), worker()]);
      const durationMs = performance.now() - startedAt;
      assert.equal(latencies.length, 500);
      assert.equal(fixtureState.requests, 500);
      assert.equal(fixtureState.peakActive, 2);
      assert.equal(fixtureState.active, 0);

      await assert.rejects(
        () =>
          reservePublicAudit(
            fakeRequest(undefined, "198.51.100.250"),
            fakeResponse(),
          ),
        (error) =>
          error instanceof PublicAuditQuotaError && error.kind === "global",
      );

      const report = {
        fixture: "127.0.0.1 local HTTP endpoint; 8 ms synthetic response delay",
        attempts: 500,
        successful: latencies.length,
        expectedLimitRefusals: {
          visitorFourthAttempt: 1,
          sameIpTwentySixthAttempt: 1,
          globalFiveHundredFirstAttempt: 1,
          concurrencyThirdSimultaneousReservation: 1,
        },
        distribution: "20 synthetic test IPs × 25 successful audits per IP; one new signed visitor cookie per audit",
        concurrency: {
          configured: getQuotaLimits().concurrency,
          observedFixturePeak: fixtureState.peakActive,
        },
        latencyMs: {
          p50: Number(percentile(latencies, 0.5).toFixed(2)),
          p95: Number(percentile(latencies, 0.95).toFixed(2)),
          p99: Number(percentile(latencies, 0.99).toFixed(2)),
        },
        throughputAuditsPerSecond: Number(
          (latencies.length / (durationMs / 1_000)).toFixed(2),
        ),
        durationMs: Number(durationMs.toFixed(2)),
        fixtureRequests: fixtureState.requests,
        operationalErrors: 0,
        peakProcessRssMiB: Number(
          (peakRssBytes / 1024 / 1024).toFixed(2),
        ),
        configuredLimits: getQuotaLimits(),
      };
      context.diagnostic(JSON.stringify(report));
    } finally {
      process.env.PUBLIC_AUDIT_ENABLED = "false";
      if (appServer) await close(appServer);
      await close(fixtureServer);
    }
  },
);

after(async () => {
  await closePublicAuditQuotaPool();
  await pool.end();
});
