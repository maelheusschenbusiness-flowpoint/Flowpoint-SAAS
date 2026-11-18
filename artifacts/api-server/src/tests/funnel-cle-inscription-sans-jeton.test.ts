/**
 * D2 : le jeton pre-register (autorise POST /public/checkout-session et
 * payment-intent) ne doit jamais etre stocke en clair dans funnel_events.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const requetes: Array<{ sql: string; params: unknown[] }> = [];
const cles = new Set<string>();
vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })), release: vi.fn() })),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      requetes.push({ sql, params });
      if (/INSERT INTO funnel_events/.test(sql)) {
        const cle = String(params[5]);
        if (cles.has(cle)) return { rowCount: 0 };
        cles.add(cle);
        return { rowCount: 1 };
      }
      return { rowCount: 0, rows: [] };
    }),
  },
}));
vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { cleIdempotenceInscription, enregistrerEtape } from "../services/funnel-events.js";

const JETON = "a".repeat(32) + "0123456789abcdef".repeat(2);

describe("cle d'idempotence signup_form_completed", () => {
  beforeEach(() => { requetes.length = 0; cles.clear(); });

  it("ne contient jamais le jeton, meme partiellement", () => {
    const cle = cleIdempotenceInscription(JETON);
    expect(cle).not.toContain(JETON);
    expect(cle).not.toContain(JETON.slice(0, 16));
    expect(cle.startsWith("signup_form_completed:")).toBe(true);
    expect(cle.length).toBeLessThanOrEqual(120);
  });

  it("est stable pour un jeton et distincte entre deux jetons", () => {
    expect(cleIdempotenceInscription(JETON)).toBe(cleIdempotenceInscription(JETON));
    expect(cleIdempotenceInscription(JETON)).not.toBe(cleIdempotenceInscription(JETON.replace(/^a/, "b")));
  });

  it("deux envois du meme jeton restent dedoublonnes, sans jeton dans la requete", async () => {
    const ev = { etape: "signup_form_completed", visiteurId: "fp-test-1", cleIdempotence: cleIdempotenceInscription(JETON) };
    expect(await enregistrerEtape(ev)).toBe(true);
    expect(await enregistrerEtape(ev)).toBe(false);
    const inserts = requetes.filter((r) => /INSERT INTO funnel_events/.test(r.sql));
    expect(inserts).toHaveLength(2);
    for (const r of inserts) expect(JSON.stringify(r.params)).not.toContain(JETON);
  });

  it("auth.ts n'ecrit plus la cle en clair", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/auth.ts"), "utf8");
    expect(src).not.toMatch(/signup_form_completed:\$\{/);
    expect(src).toContain("cleIdempotenceInscription(preToken)");
  });
});
