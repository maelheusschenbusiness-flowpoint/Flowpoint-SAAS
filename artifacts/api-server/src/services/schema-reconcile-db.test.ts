/**
 * schema-reconcile-db.test.ts
 *
 * La reconciliation du schema touche une base de production qui porte des
 * donnees clients. Ces tests fixent ce qui doit rester vrai pour qu'elle soit
 * sans danger, et pas seulement « verte ».
 *
 * Constat mesure le 14/10/2026 sur une copie restauree de la production :
 * 18 tables interrogees par le code n'etaient creees nulle part dans le depot,
 * 4 tables et 31 colonnes utilisees manquaient, et l'ancien bloc
 * `missing-production-tables-v3` etait deja marque comme applique — donc saute
 * a jamais, y compris pour ce qu'il n'avait pas pose.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_RECONCILE_ID,
  RECONCILE_LEGACY_TABLES,
  RECONCILE_REFERENCE_TABLES,
  reconcileSchema,
  SCHEMA_DEFAULTS_ID,
  RECONCILE_DEFAULTS,
  reconcileDefaults,
} from "./init-schema-reconcile.js";

const src = (): string =>
  fs.readFileSync(path.join(import.meta.dirname ?? __dirname, "init-schema-reconcile.ts"), "utf8");

/** Le DDL seul, extrait par nom de constante : les commentaires en sont exclus. */
const ddlOnly = (): string =>
  [...src().matchAll(/const (?:LEGACY_DDL|REFERENCE_DDL|COLUMN_DDL) = `([\s\S]*?)`;/g)]
    .map((m) => m[1]).join("\n");

beforeAll(async () => {
  const c = await pool.connect();
  try { await reconcileSchema(c as never); } finally { c.release(); }
});

describe("un bloc versionne a part, jamais un rejeu de l'ancien", () => {
  it("le marqueur est distinct de celui du bloc deja applique en production", () => {
    expect(SCHEMA_RECONCILE_ID).toBe("schema-reconcile-v1");
    expect(SCHEMA_RECONCILE_ID).not.toBe("missing-production-tables-v3");
  });

  it("l'ancien marqueur n'est jamais efface — rejouer l'ancien bloc rejouerait tout", () => {
    expect(src()).not.toMatch(/DELETE\s+FROM\s+schema_migrations/i);
  });
});

describe("non destructive — la production porte des donnees clients", () => {
  it("aucun DROP, TRUNCATE ou DELETE dans le DDL", () => {
    const ddl = ddlOnly();
    expect(ddl.length).toBeGreaterThan(2000);
    expect(ddl).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
    expect(ddl).not.toMatch(/\bDELETE\s+FROM\s+public\./i);
  });

  it("toute creation de table est conditionnelle", () => {
    const creates = ddlOnly().match(/CREATE TABLE[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(20);
    for (const c of creates) expect(c).toMatch(/IF NOT EXISTS/i);
  });

  it("tout ajout de colonne est conditionnel", () => {
    const alters = ddlOnly().match(/ALTER TABLE[^;]*ADD COLUMN[^;]*/gi) ?? [];
    expect(alters.length).toBeGreaterThan(20);
    for (const a of alters) expect(a).toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it("aucune colonne NOT NULL sans valeur par defaut", () => {
    // Sur une table qui contient deja des lignes, un tel ALTER echouerait et
    // laisserait la migration a moitie faite.
    const alters = ddlOnly().match(/ALTER TABLE[^;]*ADD COLUMN IF NOT EXISTS[^;]*/gi) ?? [];
    for (const a of alters) {
      if (/NOT NULL/i.test(a)) expect(a, a).toMatch(/DEFAULT/i);
    }
  });

  it("aucune sequence implicite non creee — les identites sont des serial", () => {
    // « bigint DEFAULT nextval('x_id_seq') » echoue sur une base vierge :
    // mesure, « relation "google_tokens_id_seq" does not exist ».
    // L'assertion ne porte que sur le DDL : le commentaire qui explique cette
    // conversion cite forcement le terme.
    expect(ddlOnly()).not.toMatch(/nextval\(/);
  });
});

describe("resultat sur la base de test", () => {
  it("les 18 tables heritees et les 4 tables de reference existent", async () => {
    const attendues = [...RECONCILE_LEGACY_TABLES, ...RECONCILE_REFERENCE_TABLES];
    expect(attendues.length).toBe(22);
    const res = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])`,
      [attendues]
    );
    const presentes = new Set(res.rows.map((r) => r.tablename));
    const manquantes = attendues.filter((t) => !presentes.has(t));
    expect(manquantes).toEqual([]);
  });

  it("les colonnes reellement utilisees par le code sont presentes", async () => {
    const requises: Array<[string, string]> = [
      ["ai_usage_logs", "tokens_used"], ["automation_runs", "workflow_id"],
      ["automation_integrations", "config"], ["incoming_webhooks", "secret"],
      ["mission_ai_logs", "credits_used"], ["seo_forecasts", "scenario"],
      ["org_settings", "logo_url"],
    ];
    for (const [t, c] of requises) {
      const r = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
        [t, c]
      );
      expect(r.rowCount, `${t}.${c}`).toBe(1);
    }
  });

  it("le marqueur est pose une seule fois", async () => {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM schema_migrations WHERE migration_id = $1`, [SCHEMA_RECONCILE_ID]
    );
    expect(Number(r.rows[0]?.n)).toBe(1);
  });

  it("un second passage ne fait rien", async () => {
    const c = await pool.connect();
    try {
      const rec = await reconcileSchema(c as never);
      expect(rec.applied).toBe(false);
      expect(rec.created).toEqual([]);
      expect(rec.columns).toBe(0);
    } finally { c.release(); }
  });
});

describe("le marqueur n'est pose qu'apres verification", () => {
  it("une base qui refuse le DDL ne reçoit pas le marqueur", async () => {
    // C'est precisement le defaut de l'ancien bloc : son marqueur existe en
    // production alors que son contenu n'y a jamais ete entierement applique.
    const inserts: string[] = [];
    const cassee = {
      query: (sql: string, params?: unknown[]) => {
        if (/INSERT INTO schema_migrations/i.test(sql)) { inserts.push(sql); return Promise.resolve({ rows: [], rowCount: 1 }); }
        if (/SELECT 1 FROM schema_migrations/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
        if (/FROM pg_tables/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
        return Promise.reject(new Error("permission denied"));
      },
    };
    const rec = await reconcileSchema(cassee as never);
    expect(rec.applied).toBe(false);
    expect(rec.failures.length).toBeGreaterThan(0);
    expect(inserts).toEqual([]);          // aucun marqueur pose
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   BLOC 2 — les DEFAULT manquants en production

   Mesure du 14/10/2026 : 31 colonnes portent un DEFAULT sur une base vierge
   migree et aucun en production. Deux defauts applicatifs en decoulaient,
   reproduits avant correction :
     - INSERT INTO users (email, ...) sans id        -> 23502 (pre-register)
     - INSERT INTO organizations (id)                -> 23502 (repli org-data)
   ───────────────────────────────────────────────────────────────────────────── */

describe("restauration des defaults — marqueur independant", () => {
  it("le marqueur differe de celui du bloc 1, qui peut etre deja pose", () => {
    expect(SCHEMA_DEFAULTS_ID).not.toBe(SCHEMA_RECONCILE_ID);
    expect(SCHEMA_DEFAULTS_ID).not.toBe("missing-production-tables-v3");
  });

  it("couvre les deux colonnes dont le defaut a ete reproduit", () => {
    const cles = RECONCILE_DEFAULTS.map((d) => `${d.table}.${d.column}`);
    expect(cles).toContain("users.id");
    expect(cles).toContain("organizations.name");
  });

  it("n'effectue que des SET DEFAULT — jamais un DROP DEFAULT ni un ALTER TYPE", () => {
    const bloc = src().slice(src().indexOf("export async function reconcileDefaults"));
    expect(bloc).toMatch(/SET DEFAULT/);
    expect(bloc).not.toMatch(/DROP DEFAULT/i);
    expect(bloc).not.toMatch(/ALTER COLUMN[^;]*TYPE/i);
    expect(bloc).not.toMatch(/\b(DROP|TRUNCATE|UPDATE|DELETE)\s+(TABLE|FROM|public)/i);
  });

  it("aucune expression de default n'est une sous-requete ou un appel hasardeux", () => {
    for (const d of RECONCILE_DEFAULTS) {
      expect(d.expr).not.toMatch(/SELECT|;|--/i);
      expect(d.expr.length).toBeGreaterThan(0);
    }
  });
});

describe("effet reel sur la base de test", () => {
  it("users.id et organizations.name ont un default apres migration", async () => {
    const c = await pool.connect();
    try {
      await reconcileDefaults(c as never);
      const r = await c.query(
        `SELECT table_name || '.' || column_name AS k, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (table_name, column_name) IN (('users','id'), ('organizations','name'))`
      );
      expect(r.rowCount).toBe(2);
      for (const row of r.rows) expect(row["column_default"]).not.toBeNull();
    } finally { c.release(); }
  });

  it("le defaut reproduit disparait : un INSERT sans id passe", async () => {
    const c = await pool.connect();
    try {
      await reconcileDefaults(c as never);
      await c.query("BEGIN");
      const r = await c.query(
        `INSERT INTO users (email, status) VALUES ($1, 'active') RETURNING id`,
        [`reconcile.defaults.${Date.now()}@flowpoint.test`]
      );
      expect(r.rows[0]["id"]).toBeTruthy();
      await c.query("ROLLBACK");
    } finally { c.release(); }
  });

  it("un second passage ne fait rien", async () => {
    const c = await pool.connect();
    try {
      await reconcileDefaults(c as never);
      const deuxieme = await reconcileDefaults(c as never);
      expect(deuxieme.applied).toBe(false);
      expect(deuxieme.defaults).toBe(0);
      expect(deuxieme.failures).toEqual([]);
      const m = await c.query(
        `SELECT count(*)::int AS n FROM schema_migrations WHERE migration_id = $1`,
        [SCHEMA_DEFAULTS_ID]
      );
      expect(m.rows[0]["n"]).toBe(1);
    } finally { c.release(); }
  });
});
