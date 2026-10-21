import test from "node:test";
import assert from "node:assert/strict";
import {
  getAddonCertDatabaseConfig,
  assertAddonCertDatabaseIsDisposable,
} from "./addon-cert-db-guard.mjs";

const env = {
  FLOWPOINT_ADDON_CERT_DATABASE_URL: "postgres://test-user:test-pass@db.test.invalid/flowpoint_e2e_disposable",
  FLOWPOINT_ADDON_CERT_EXPECTED_DB: "flowpoint_e2e_disposable",
  FLOWPOINT_ADDON_CERT_EXPECTED_HOST: "db.test.invalid",
  DATABASE_URL: "postgres://test-user:test-pass@db.test.invalid/flowpoint_e2e_disposable",
};

test("requires an explicit disposable DB identity and matching app DB URL", () => {
  assert.throws(() => getAddonCertDatabaseConfig({}), /Refusing certification/);
  assert.throws(() => getAddonCertDatabaseConfig({ ...env, DATABASE_URL: "postgres://elsewhere" }), /differs/);
  assert.throws(() => getAddonCertDatabaseConfig({ ...env, FLOWPOINT_ADDON_CERT_EXPECTED_HOST: "other.invalid" }), /host/);
  assert.equal(getAddonCertDatabaseConfig(env).expectedDatabase, "flowpoint_e2e_disposable");
});

test("requires database name and disposable marker to match exactly", async () => {
  const goodPool = {
    query: async (sql) => sql.includes("current_database")
      ? { rows: [{ database_name: "flowpoint_e2e_disposable" }] }
      : { rows: [{ database_name: "flowpoint_e2e_disposable", classification: "disposable" }] },
  };
  await assertAddonCertDatabaseIsDisposable(goodPool, "flowpoint_e2e_disposable");

  const badNamePool = {
    ...goodPool,
    query: async () => ({ rows: [{ database_name: "production" }] }),
  };
  await assert.rejects(
    assertAddonCertDatabaseIsDisposable(badNamePool, "flowpoint_e2e_disposable"),
    /Refusing certification/
  );

  const unmarkedPool = {
    query: async (sql) => sql.includes("current_database")
      ? { rows: [{ database_name: "flowpoint_e2e_disposable" }] }
      : { rows: [] },
  };
  await assert.rejects(
    assertAddonCertDatabaseIsDisposable(unmarkedPool, "flowpoint_e2e_disposable"),
    /Refusing certification/
  );
});
