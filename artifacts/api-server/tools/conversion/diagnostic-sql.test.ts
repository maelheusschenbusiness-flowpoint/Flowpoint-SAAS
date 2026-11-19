/**
 * Le SQL de diagnostic des rejets 400 est en lecture seule et s'execute sur le
 * schema reel (colonnes `organizations.fp_lid`, `conversion_event_outbox.*`).
 * Se saute sans base ou sans `psql`.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FICHIER = join(process.cwd(), "tools/conversion/diagnostic-rejets-outbox-lecture-seule.sql");

describe("diagnostic-rejets-outbox-lecture-seule.sql", () => {
  it("est strictement en lecture seule et ne selectionne jamais fp_lid", () => {
    const sql = readFileSync(FICHIER, "utf8").split("\n").filter(l => !l.trim().startsWith("--") && !l.trim().startsWith("\\echo")).join("\n");
    expect(sql).toMatch(/BEGIN READ ONLY;/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COPY)\b/i);
    // `fp_lid` n'apparait que pour compter les organisations qui en portent un.
    expect(sql.match(/\bfp_lid\b/g)).toHaveLength(1);
    expect(sql).toContain("fp_lid IS NOT NULL");
  });

  it("s'execute sur le schema reel", (ctx) => {
    const url = process.env["DATABASE_URL"];
    if (!url) return ctx.skip();
    try {
      const sortie = execFileSync("psql", [url, "-X", "-q", "-v", "jours=7", "-f", FICHIER], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      expect(sortie).toContain("organisations_avec_fp_lid");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return ctx.skip(); // psql absent
      const msg = String((err as { stderr?: string }).stderr ?? "");
      if (/does not exist|connect|could not/i.test(msg) && !/column/i.test(msg)) return ctx.skip(); // pas de base utilisable
      throw err;
    }
  });
});
