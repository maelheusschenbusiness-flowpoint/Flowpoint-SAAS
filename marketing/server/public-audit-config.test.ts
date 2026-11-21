import assert from "node:assert/strict";
import test, { after } from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:5432/unused";
const {
  getPublicAuditQuotaPool,
  getQuotaLimits,
  isPublicAuditEnabled,
  PublicAuditUnavailableError,
} = await import("./public-audit-quota");
const { pool } = await import("./db");

const limitVariableNames = [
  "PUBLIC_AUDIT_TEST_MODE",
  "PUBLIC_AUDIT_DAILY_LIMIT",
  "PUBLIC_AUDIT_NETWORK_DAILY_LIMIT",
  "PUBLIC_AUDIT_MAX_CONCURRENT",
  "PUBLIC_AUDIT_ENABLED",
  "PUBLIC_AUDIT_DATABASE_URL",
  "SESSION_SECRET",
] as const;

const originalLimits = new Map(
  limitVariableNames.map((name) => [name, process.env[name]]),
);

test("production defaults use the configurable pilot quotas, not commercial limits", () => {
  try {
    process.env.PUBLIC_AUDIT_TEST_MODE = "false";
    delete process.env.PUBLIC_AUDIT_DAILY_LIMIT;
    delete process.env.PUBLIC_AUDIT_NETWORK_DAILY_LIMIT;
    delete process.env.PUBLIC_AUDIT_MAX_CONCURRENT;

    assert.deepEqual(getQuotaLimits(), {
      visitor: 3,
      network: 5,
      global: 10,
      concurrency: 2,
    });

    process.env.PUBLIC_AUDIT_DAILY_LIMIT = "500";
    process.env.PUBLIC_AUDIT_NETWORK_DAILY_LIMIT = "25";
    process.env.PUBLIC_AUDIT_MAX_CONCURRENT = "2";
    assert.deepEqual(getQuotaLimits(), {
      visitor: 3,
      network: 25,
      global: 500,
      concurrency: 2,
    });
  } finally {
    for (const name of limitVariableNames) {
      const value = originalLimits.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("public audit requires an explicit quota database, never the site database", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAuditUrl = process.env.PUBLIC_AUDIT_DATABASE_URL;
  const originalEnabled = process.env.PUBLIC_AUDIT_ENABLED;
  const originalSessionSecret = process.env.SESSION_SECRET;

  try {
    process.env.DATABASE_URL =
      "postgres://site-user:site-password@127.0.0.1:5432/site_database";
    process.env.PUBLIC_AUDIT_ENABLED = "true";
    process.env.SESSION_SECRET = "x".repeat(40);
    delete process.env.PUBLIC_AUDIT_DATABASE_URL;

    assert.equal(isPublicAuditEnabled(), false);
    assert.throws(
      () => getPublicAuditQuotaPool(),
      PublicAuditUnavailableError,
    );
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAuditUrl === undefined) delete process.env.PUBLIC_AUDIT_DATABASE_URL;
    else process.env.PUBLIC_AUDIT_DATABASE_URL = originalAuditUrl;
    if (originalEnabled === undefined) delete process.env.PUBLIC_AUDIT_ENABLED;
    else process.env.PUBLIC_AUDIT_ENABLED = originalEnabled;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
  }
});

after(async () => {
  await pool.end();
});
