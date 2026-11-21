import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import ipaddr from "ipaddr.js";
import pg, { type Pool, type PoolClient } from "pg";
import type { Request, Response } from "express";
import type { PublicAuditQuota } from "@shared/public-audit";

const { Pool: PostgresPool } = pg;
const VISITOR_COOKIE = "fp_public_audit_visitor";
const VISITOR_DAILY_LIMIT = 3;
let publicAuditPool: Pool | undefined;

export class PublicAuditQuotaError extends Error {
  constructor(
    public readonly kind: "visitor" | "network" | "global",
    public readonly resetAt: string,
  ) {
    super("The daily public audit limit has been reached.");
  }
}

export class PublicAuditBusyError extends Error {
  constructor() {
    super("The public audit service is busy. Please try again shortly.");
  }
}

export class PublicAuditUnavailableError extends Error {
  constructor() {
    super("The public audit is temporarily unavailable.");
  }
}

export function getPublicAuditQuotaPool(): Pool {
  const connectionString = process.env.PUBLIC_AUDIT_DATABASE_URL;
  if (!connectionString) throw new PublicAuditUnavailableError();
  publicAuditPool ??= new PostgresPool({
    connectionString,
    max: 4,
  });
  return publicAuditPool;
}

export async function closePublicAuditQuotaPool(): Promise<void> {
  if (!publicAuditPool) return;
  const poolToClose = publicAuditPool;
  publicAuditPool = undefined;
  await poolToClose.end();
}

export type PublicAuditReservation = {
  quota: PublicAuditQuota;
  slotId: number;
  leaseId: string;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isPublicAuditEnabled(): boolean {
  return (
    process.env.PUBLIC_AUDIT_ENABLED === "true" &&
    Boolean(process.env.PUBLIC_AUDIT_DATABASE_URL) &&
    Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)
  );
}

function getHmacSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new PublicAuditUnavailableError();
  }
  return secret;
}

function hmac(value: string): string {
  return createHmac("sha256", getHmacSecret()).update(value).digest("hex");
}

function requestDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetAtForDay(day: string): string {
  const midnight = new Date(`${day}T00:00:00.000Z`);
  midnight.setUTCDate(midnight.getUTCDate() + 1);
  return midnight.toISOString();
}

function counterExpiryForDay(day: string): string {
  const expiry = new Date(`${day}T00:00:00.000Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 2);
  return expiry.toISOString();
}

function requestCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function validVisitorCookie(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/i.exec(value);
  if (!match) return undefined;
  const [, id, signature] = match;
  const expected = Buffer.from(hmac(`public-audit-visitor:${id}`), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return undefined;
  }
  return id;
}

function getVisitorKey(req: Request, res: Response): string {
  let id = validVisitorCookie(requestCookie(req, VISITOR_COOKIE));
  if (!id) {
    id = randomUUID();
    const signature = hmac(`public-audit-visitor:${id}`);
    const attributes = [
      `${VISITOR_COOKIE}=${id}.${signature}`,
      "Path=/",
      "Max-Age=172800",
      "HttpOnly",
      "SameSite=Lax",
    ];
    if (req.secure) attributes.push("Secure");
    res.append("Set-Cookie", attributes.join("; "));
  }
  return hmac(`visitor:${id}`);
}

function getNetworkKey(req: Request): string {
  if (!req.ip) throw new PublicAuditUnavailableError();
  try {
    const normalizedIp = ipaddr.process(req.ip).toString();
    return hmac(`network:${normalizedIp}`);
  } catch {
    throw new PublicAuditUnavailableError();
  }
}

export function getQuotaLimits() {
  const isTestMode = process.env.PUBLIC_AUDIT_TEST_MODE === "true";
  const configuredDailyLimit = positiveInteger(
    process.env.PUBLIC_AUDIT_DAILY_LIMIT,
    10,
  );
  const configuredNetworkLimit = positiveInteger(
    process.env.PUBLIC_AUDIT_NETWORK_DAILY_LIMIT,
    5,
  );
  const configuredConcurrency = positiveInteger(
    process.env.PUBLIC_AUDIT_MAX_CONCURRENT,
    2,
  );

  return {
    visitor: VISITOR_DAILY_LIMIT,
    network: Math.min(configuredNetworkLimit, isTestMode ? 5 : 500),
    global: Math.min(configuredDailyLimit, isTestMode ? 10 : 10_000),
    concurrency: Math.min(configuredConcurrency, 4),
  };
}

export async function getPublicAuditQuota(
  req: Request,
  res: Response,
): Promise<PublicAuditQuota> {
  const visitorKey = getVisitorKey(req, res);
  const day = requestDay();
  const result = await getPublicAuditQuotaPool().query<{ used: number }>(
    `SELECT used
       FROM public_audit_quota_counters
      WHERE quota_type = 'visitor'
        AND quota_key = $1
        AND day_utc = $2::date`,
    [visitorKey, day],
  );
  const used = Number(result.rows[0]?.used ?? 0);
  return {
    remaining: Math.max(0, VISITOR_DAILY_LIMIT - used),
    limit: VISITOR_DAILY_LIMIT,
    resetAt: resetAtForDay(day),
  };
}

async function incrementCounter(
  client: PoolClient,
  kind: "visitor" | "network" | "global",
  key: string,
  day: string,
  expiry: string,
  limit: number,
): Promise<number> {
  const result = await client.query<{ used: number }>(
    `INSERT INTO public_audit_quota_counters
       (quota_type, quota_key, day_utc, used, expires_at, updated_at)
     VALUES ($1, $2, $3::date, 1, $4::timestamptz, now())
     ON CONFLICT (quota_type, quota_key, day_utc)
     DO UPDATE SET
       used = public_audit_quota_counters.used + 1,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
     WHERE public_audit_quota_counters.used < $5
     RETURNING used`,
    [kind, key, day, expiry, limit],
  );
  if (!result.rows[0]) {
    throw new PublicAuditQuotaError(kind, resetAtForDay(day));
  }
  return Number(result.rows[0].used);
}

async function acquireConcurrencySlot(
  client: PoolClient,
  leaseId: string,
  maximum: number,
): Promise<number> {
  await ensurePublicAuditConcurrencySlots(client, maximum);
  const result = await client.query<{ slot_id: number }>(
    `WITH candidate AS (
       SELECT slot_id
         FROM public_audit_concurrency_slots
        WHERE slot_id <= $2
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
        ORDER BY slot_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE public_audit_concurrency_slots AS slots
        SET lease_id = $1::uuid,
            lease_expires_at = now() + interval '75 seconds'
       FROM candidate
      WHERE slots.slot_id = candidate.slot_id
      RETURNING slots.slot_id`,
    [leaseId, maximum],
  );
  if (!result.rows[0]) throw new PublicAuditBusyError();
  return Number(result.rows[0].slot_id);
}

export async function ensurePublicAuditConcurrencySlots(
  client: PoolClient,
  maximum: number,
): Promise<void> {
  await client.query(
    `INSERT INTO public_audit_concurrency_slots (slot_id)
     SELECT generated.slot_id::smallint
       FROM generate_series(1, $1::integer) AS generated(slot_id)
     ON CONFLICT (slot_id) DO NOTHING`,
    [maximum],
  );
}

export async function reservePublicAudit(
  req: Request,
  res: Response,
  testScope?: string,
): Promise<PublicAuditReservation> {
  if (testScope && process.env.PUBLIC_AUDIT_TEST_MODE !== "true") {
    throw new PublicAuditUnavailableError();
  }
  const visitorKey = getVisitorKey(req, res);
  const networkKey = getNetworkKey(req);
  const day = requestDay();
  const expiry = counterExpiryForDay(day);
  const limits = getQuotaLimits();
  const globalKey = testScope ? hmac(`global:test:${testScope}`) : hmac("global");
  const leaseId = randomUUID();
  const client = await getPublicAuditQuotaPool().connect();

  try {
    await client.query("BEGIN");
    // Expired pseudonymous counters are purged as part of normal traffic.
    await client.query(
      "DELETE FROM public_audit_quota_counters WHERE expires_at < now()",
    );

    await incrementCounter(client, "global", globalKey, day, expiry, limits.global);
    await incrementCounter(client, "network", networkKey, day, expiry, limits.network);
    const visitorUsed = await incrementCounter(
      client,
      "visitor",
      visitorKey,
      day,
      expiry,
      limits.visitor,
    );
    const slotId = await acquireConcurrencySlot(
      client,
      leaseId,
      limits.concurrency,
    );
    await client.query("COMMIT");

    return {
      slotId,
      leaseId,
      quota: {
        remaining: Math.max(0, limits.visitor - visitorUsed),
        limit: limits.visitor,
        resetAt: resetAtForDay(day),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function releasePublicAuditSlot(
  slotId: number,
  leaseId: string,
): Promise<void> {
  await getPublicAuditQuotaPool().query(
    `UPDATE public_audit_concurrency_slots
        SET lease_id = NULL, lease_expires_at = NULL
      WHERE slot_id = $1 AND lease_id = $2::uuid`,
    [slotId, leaseId],
  );
}

let quotaCleanupTimer: ReturnType<typeof setInterval> | undefined;

export function startPublicAuditQuotaCleanup(): void {
  if (!isPublicAuditEnabled() || quotaCleanupTimer) return;
  const cleanup = () =>
    getPublicAuditQuotaPool()
      .query("DELETE FROM public_audit_quota_counters WHERE expires_at < now()")
      .catch(() => undefined);
  void cleanup();
  quotaCleanupTimer = setInterval(cleanup, 60 * 60 * 1000);
  quotaCleanupTimer.unref();
}
