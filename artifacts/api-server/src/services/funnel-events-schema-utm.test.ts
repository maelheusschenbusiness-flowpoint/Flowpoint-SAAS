/**
 * Migration 020 appliquee au demarrage (assurerColonnesUtm) et cause explicite cote
 * route d'attribution : le service Render n'a pas d'etape Pre-Deploy, si bien que
 * 020 n'etait appliquee nulle part (HTTP 500 constate le 29/10).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn(async () => ({ query, release })) },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assurerColonnesUtm, estSchemaUtmAbsent } from "./funnel-events.js";

function reponses(table: string | null, presentes: string[]) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ t: table }] };
    if (sql.includes("information_schema.columns")) return { rows: presentes.map((column_name) => ({ column_name })) };
    return { rows: [] };
  });
}
const alters = () => query.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith("ALTER TABLE"));

describe("assurerColonnesUtm", () => {
  beforeEach(() => { query.mockReset(); release.mockReset(); });

  it("ajoute les trois colonnes absentes, dans une transaction bornee par lock_timeout", async () => {
    reponses("funnel_events", []);
    expect(await assurerColonnesUtm()).toEqual({ etat: "ajoutees", colonnes: ["utm_source", "utm_medium", "utm_campaign"] });
    expect(alters()).toEqual([
      "ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_source TEXT NULL",
      "ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_medium TEXT NULL",
      "ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_campaign TEXT NULL",
    ]);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sqls.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("n'ajoute que la colonne manquante", async () => {
    reponses("funnel_events", ["utm_source", "utm_medium"]);
    expect(await assurerColonnesUtm()).toEqual({ etat: "ajoutees", colonnes: ["utm_campaign"] });
    expect(alters()).toHaveLength(1);
  });

  it("colonnes deja presentes : aucun ALTER, donc aucun verrou", async () => {
    reponses("funnel_events", ["utm_source", "utm_medium", "utm_campaign"]);
    expect(await assurerColonnesUtm()).toEqual({ etat: "deja_presentes" });
    expect(alters()).toEqual([]);
    expect(query.mock.calls.map((c) => String(c[0]))).not.toContain("BEGIN");
  });

  it("table absente : rien n'est cree", async () => {
    reponses(null, []);
    expect(await assurerColonnesUtm()).toEqual({ etat: "table_absente" });
    expect(alters()).toEqual([]);
  });

  it("echec (verrou indisponible) : ROLLBACK, erreur remontee, connexion rendue", async () => {
    reponses("funnel_events", []);
    const base = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, p?: unknown) => {
      if (sql.startsWith("ALTER TABLE")) throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      return base(sql, p);
    });
    await expect(assurerColonnesUtm()).rejects.toThrow("lock timeout");
    expect(query.mock.calls.map((c) => String(c[0]))).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("estSchemaUtmAbsent", () => {
  it("reconnait seulement la colonne absente (42703)", () => {
    expect(estSchemaUtmAbsent({ code: "42703" })).toBe(true);
    expect(estSchemaUtmAbsent({ code: "42P01" })).toBe(false);
    expect(estSchemaUtmAbsent(new Error("x"))).toBe(false);
    expect(estSchemaUtmAbsent(null)).toBe(false);
  });
});
