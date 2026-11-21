import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import ipaddr from "ipaddr.js";
import type { Request, Response } from "express";
import {
  closePublicAuditQuotaPool,
  getPublicAuditQuotaPool,
  PublicAuditBusyError,
  PublicAuditQuotaError,
  ensurePublicAuditConcurrencySlots,
  getQuotaLimits,
  getPublicAuditQuota,
  releasePublicAuditSlot,
  reservePublicAudit,
} from "./public-audit-quota";

const runDatabaseTest = process.env.RUN_PUBLIC_AUDIT_DB_TESTS === "true";
const expectedDatabase = "public_audit_quota_test";

function getTestPool() {
  assert.equal(
    runDatabaseTest,
    true,
    "Set RUN_PUBLIC_AUDIT_DB_TESTS=true to opt in to this disposable-database test.",
  );
  const connectionString = process.env.PUBLIC_AUDIT_DATABASE_URL;
  assert.ok(
    connectionString,
    "PUBLIC_AUDIT_DATABASE_URL must point at the disposable local quota database.",
  );
  const parsed = new URL(connectionString);
  assert.ok(
    ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname),
    "Refusing any non-loopback quota database host.",
  );
  assert.equal(
    decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    expectedDatabase,
    `Refusing to use any database except ${expectedDatabase}.`,
  );
  return getPublicAuditQuotaPool();
}

test(
  "empty concurrency slot tables are initialized idempotently",
  { skip: !runDatabaseTest },
  async () => {
    const client = await getTestPool().connect();
    try {
      await client.query(
        `CREATE TEMP TABLE public_audit_concurrency_slots (
           slot_id smallint PRIMARY KEY,
           lease_id uuid,
           lease_expires_at timestamptz
         )`,
      );

      await ensurePublicAuditConcurrencySlots(client, 2);
      const firstRead = await client.query<{ slot_id: number }>(
        "SELECT slot_id FROM public_audit_concurrency_slots ORDER BY slot_id",
      );
      assert.deepEqual(firstRead.rows.map((row) => Number(row.slot_id)), [1, 2]);

      await ensurePublicAuditConcurrencySlots(client, 2);
      const secondRead = await client.query<{ slot_id: number }>(
        "SELECT slot_id FROM public_audit_concurrency_slots ORDER BY slot_id",
      );
      assert.deepEqual(secondRead.rows.map((row) => Number(row.slot_id)), [1, 2]);
    } finally {
      await client
        .query("DROP TABLE IF EXISTS pg_temp.public_audit_concurrency_slots")
        .catch(() => undefined);
      client.release();
    }
  },
);

function fakeRequest(
  cookie?: string,
  ip = "198.51.100.42",
): Request {
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
  return response as unknown as Response & { headers: Record<string, string> };
}

function digest(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for the database test.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

test(
  "daily visitor quota allows exactly three concurrent reservations",
  { skip: !runDatabaseTest },
  async (context) => {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      context.skip("A configured session secret is required.");
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(`${day}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayDay = yesterday.toISOString().slice(0, 10);
    const testScope = randomUUID();
    const globalKey = digest(`global:test:${testScope}`);
    const networkKey = digest(
      `network:${ipaddr.process("198.51.100.42").toString()}`,
    );
    const response = fakeResponse();
    const initialQuota = await getPublicAuditQuota(
      fakeRequest(),
      response,
    );
    const cookie = response.headers["set-cookie"]?.split(";")[0];
    assert.ok(cookie, "a signed visitor cookie should be returned");
    assert.equal(initialQuota.limit, 3);
    assert.equal(initialQuota.remaining, 3);
    const visitorId = cookie.split("=")[1].split(".")[0];
    const visitorKey = digest(`visitor:${visitorId}`);
    await getTestPool().query(
      `INSERT INTO public_audit_quota_counters
         (quota_type, quota_key, day_utc, used, expires_at, updated_at)
       VALUES ('visitor', $1, $2::date, 3, now() + interval '1 day', now())`,
      [visitorKey, yesterdayDay],
    );
    const resetQuota = await getPublicAuditQuota(
      fakeRequest(cookie),
      fakeResponse(),
    );
    const expectedReset = new Date(`${day}T00:00:00.000Z`);
    expectedReset.setUTCDate(expectedReset.getUTCDate() + 1);
    assert.equal(resetQuota.remaining, 3, "yesterday's uses must not count today");
    assert.equal(resetQuota.resetAt, expectedReset.toISOString());

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        const reservation = await reservePublicAudit(
          fakeRequest(cookie),
          fakeResponse(),
          testScope,
        );
        return reservation;
      }),
    );
    const reservations = attempts
      .filter(
        (attempt): attempt is PromiseFulfilledResult<
          Awaited<ReturnType<typeof reservePublicAudit>>
        > => attempt.status === "fulfilled",
      )
      .map((attempt) => attempt.value);

    try {
      const quotaFailures = attempts.filter(
        (attempt) =>
          attempt.status === "rejected" &&
          attempt.reason instanceof PublicAuditQuotaError &&
          attempt.reason.kind === "visitor",
      );
      assert.equal(reservations.length, 3);
      assert.equal(quotaFailures.length, 1);

      const visitorRow = await getTestPool().query<{ used: number }>(
        `SELECT used
           FROM public_audit_quota_counters
          WHERE quota_type = 'visitor' AND quota_key = $1 AND day_utc = $2::date`,
        [visitorKey, day],
      );
      assert.equal(Number(visitorRow.rows[0]?.used), 3);

      const remaining = await getPublicAuditQuota(
        fakeRequest(cookie),
        fakeResponse(),
      );
      assert.equal(remaining.remaining, 0);
      assert.equal(remaining.resetAt, expectedReset.toISOString());

      const initialReservationCount = reservations.length;
      await Promise.all(
        reservations.map((reservation) =>
          releasePublicAuditSlot(reservation.slotId, reservation.leaseId),
        ),
      );

      // A visitor can clear or forge its cookie, but the separate network
      // limit must still cap simple attempts to obtain fresh visitor IDs.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const forgedCookie =
          `fp_public_audit_visitor=${randomUUID()}.${"0".repeat(64)}`;
        const reservation = await reservePublicAudit(
          fakeRequest(forgedCookie),
          fakeResponse(),
          testScope,
        );
        reservations.push(reservation);
        await releasePublicAuditSlot(reservation.slotId, reservation.leaseId);
      }
      assert.equal(reservations.length - initialReservationCount, 2);

      await assert.rejects(
        () =>
          reservePublicAudit(
            fakeRequest(
              `fp_public_audit_visitor=${randomUUID()}.${"0".repeat(64)}`,
            ),
            fakeResponse(),
            testScope,
          ),
        (error) =>
          error instanceof PublicAuditQuotaError &&
          error.kind === "network",
      );
    } finally {
      await Promise.all(
        reservations.map((reservation) =>
          releasePublicAuditSlot(reservation.slotId, reservation.leaseId),
        ),
      );

      await getTestPool().query(
        `DELETE FROM public_audit_quota_counters
          WHERE quota_type IN ('visitor', 'network', 'global')
            AND quota_key IN ($1, $2, $3)
            AND day_utc IN ($4::date, $5::date)`,
        [visitorKey, networkKey, globalKey, day, yesterdayDay],
      );
    }
  },
);

test(
  "maximum concurrent audits reject extra reservations without charging quotas",
  { skip: !runDatabaseTest },
  async (context) => {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      context.skip("A configured session secret is required.");
      return;
    }

    const previousConcurrency = process.env.PUBLIC_AUDIT_MAX_CONCURRENT;
    process.env.PUBLIC_AUDIT_MAX_CONCURRENT = "2";
    const day = new Date().toISOString().slice(0, 10);
    const testScope = randomUUID();
    const ip = "198.51.100.43";
    const globalKey = digest(`global:test:${testScope}`);
    const networkKey = digest(`network:${ipaddr.process(ip).toString()}`);
    const reservations: Awaited<ReturnType<typeof reservePublicAudit>>[] = [];
    const visitorKeys: string[] = [];

    try {
      assert.equal(getQuotaLimits().concurrency, 2);
      const attempts = await Promise.allSettled(
        Array.from({ length: 3 }, async () => {
          const response = fakeResponse();
          const reservation = await reservePublicAudit(
            fakeRequest(undefined, ip),
            response,
            testScope,
          );
          reservations.push(reservation);
          const cookie = response.headers["set-cookie"]?.split(";")[0];
          assert.ok(cookie);
          const visitorId = cookie.split("=")[1].split(".")[0];
          visitorKeys.push(digest(`visitor:${visitorId}`));
          return reservation;
        }),
      );

      const busyFailures = attempts.filter(
        (attempt) =>
          attempt.status === "rejected" &&
          attempt.reason instanceof PublicAuditBusyError,
      );
      assert.equal(reservations.length, 2);
      assert.equal(busyFailures.length, 1);

      const counters = await getTestPool().query<{ quota_type: string; used: number }>(
        `SELECT quota_type, SUM(used)::int AS used
           FROM public_audit_quota_counters
          WHERE day_utc = $1::date
            AND quota_key = ANY($2::text[])
          GROUP BY quota_type`,
        [day, [globalKey, networkKey, ...visitorKeys]],
      );
      assert.deepEqual(
        Object.fromEntries(counters.rows.map((row) => [row.quota_type, Number(row.used)])),
        { global: 2, network: 2, visitor: 2 },
      );
    } finally {
      await Promise.all(
        reservations.map((reservation) =>
          releasePublicAuditSlot(reservation.slotId, reservation.leaseId),
        ),
      );
      await getTestPool().query(
        `DELETE FROM public_audit_quota_counters
          WHERE quota_type IN ('visitor', 'network', 'global')
            AND quota_key = ANY($1::text[])
            AND day_utc = $2::date`,
        [[globalKey, networkKey, ...visitorKeys], day],
      );
      if (previousConcurrency === undefined) {
        delete process.env.PUBLIC_AUDIT_MAX_CONCURRENT;
      } else {
        process.env.PUBLIC_AUDIT_MAX_CONCURRENT = previousConcurrency;
      }
    }
  },
);

after(async () => {
  await closePublicAuditQuotaPool();
});
