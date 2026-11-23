/**
 * POST /integrations/connections (zapier, make, slack) renvoyait 500 : l'INSERT
 * de createIntegration omettait `provider`, NOT NULL sans defaut sur la base de
 * test (production : DEFAULT 'custom'). Verrouille : provider explicite, et
 * DEFAULT 'custom' pose de facon additive et idempotente par l'init.
 * Isole dans un schema jetable ; sans base joignable, les cas DB sont ignores.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { createIntegration, resolveIntegrationProvider } from "./integrations-service.js";
import { initAutomationTables } from "./init-automation.js";

const SCHEMA = `t_autoint_${process.pid}`;
let dbOk = false;
const realConnect = pool.connect.bind(pool);

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; return; }
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  // Chaque connexion du pool travaille dans le schema jetable.
  // pg.Pool#query rappelle connect(callback) : seul l'appel sans argument est enveloppe.
  (pool as unknown as { connect: unknown }).connect = async (...args: unknown[]) => {
    if (args.length) return (realConnect as (...a: unknown[]) => unknown)(...args);
    const c = await (realConnect as () => Promise<{ query: (q: string) => Promise<unknown> }>)();
    await c.query(`SET search_path TO ${SCHEMA}`);
    return c;
  };
});

afterAll(async () => {
  (pool as unknown as { connect: unknown }).connect = realConnect;
  if (dbOk) await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

const LEGACY_DDL = (providerDef: string) => `
  DROP TABLE IF EXISTS ${SCHEMA}.automation_integrations;
  CREATE TABLE ${SCHEMA}.automation_integrations (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL DEFAULT 'default',
    provider TEXT ${providerDef}, label TEXT, config JSONB DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP DEFAULT NOW(),
    type TEXT NOT NULL DEFAULT 'outgoing', name TEXT NOT NULL DEFAULT 'Integration',
    platform TEXT NOT NULL DEFAULT 'custom', endpoint_url TEXT NOT NULL DEFAULT '',
    secret_key TEXT, events JSONB DEFAULT '[]', headers JSONB DEFAULT '{}',
    timeout_ms INTEGER DEFAULT 10000, max_retries INTEGER DEFAULT 3,
    retry_enabled BOOLEAN DEFAULT true, active BOOLEAN NOT NULL DEFAULT true,
    success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0,
    last_triggered TIMESTAMP, metadata JSONB DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW()
  )`;

async function createAll(orgId: string) {
  for (const platform of ["zapier", "make", "slack"]) {
    const row = await createIntegration(orgId, "agency", {
      name: `c-${platform}`, type: "outgoing", platform, endpointUrl: "https://hooks.example.test/x",
    });
    expect(row["platform"]).toBe(platform);
    expect(row["provider"]).toBe(platform);
  }
  const unknown = await createIntegration(orgId, "agency", { name: "c-none" });
  expect(unknown["provider"]).toBe("custom");
}

describe("resolveIntegrationProvider", () => {
  it("plateforme normalisee, sinon custom", () => {
    expect(resolveIntegrationProvider("Zapier ")).toBe("zapier");
    expect(resolveIntegrationProvider("make")).toBe("make");
    expect(resolveIntegrationProvider("")).toBe("custom");
    expect(resolveIntegrationProvider(undefined)).toBe("custom");
    expect(resolveIntegrationProvider(null)).toBe("custom");
  });
});

describe("createIntegration : provider explicite, quel que soit le schema", () => {
  it("variante A : provider NOT NULL sans defaut (base de test)", async () => {
    if (!dbOk) return;
    await pool.query(LEGACY_DDL("NOT NULL"));
    await createAll("org-a");
  });

  it("variante B : provider NOT NULL DEFAULT 'custom' (production)", async () => {
    if (!dbOk) return;
    await pool.query(LEGACY_DDL("NOT NULL DEFAULT 'custom'"));
    await createAll("org-b");
  });

  it("l'init pose DEFAULT 'custom' sur une table sans defaut, rejouable, sans toucher aux donnees", async () => {
    if (!dbOk) return;
    await pool.query(LEGACY_DDL("NOT NULL"));
    await pool.query(
      `INSERT INTO ${SCHEMA}.automation_integrations (id, org_id, provider) VALUES ('keep','org-c','legacy')`);
    await initAutomationTables();
    await initAutomationTables();
    const d = await pool.query<{ column_default: string | null; is_nullable: string }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='automation_integrations' AND column_name='provider'`, [SCHEMA]);
    expect(d.rows[0]?.column_default).toContain("custom");
    expect(d.rows[0]?.is_nullable).toBe("NO");
    const kept = await pool.query(`SELECT provider FROM ${SCHEMA}.automation_integrations WHERE id='keep'`);
    expect(kept.rows[0]?.provider).toBe("legacy");
    await pool.query(`INSERT INTO ${SCHEMA}.automation_integrations (id, org_id) VALUES ('nodef','org-c')`);
  });

  it("table neuve creee par l'init : defaut present", async () => {
    if (!dbOk) return;
    await pool.query(`DROP TABLE IF EXISTS ${SCHEMA}.automation_integrations`);
    await initAutomationTables();
    await createAll("org-d");
  });
});
