import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(join(process.cwd(), "../flowpoint-export/admin-conversion.html"), "utf8");
const SCRIPT = PAGE.slice(PAGE.indexOf("<script>"), PAGE.indexOf("</script>"));

describe("admin-conversion.html", () => {
  it("n'est pas indexable et ne stocke jamais la clé d'administration", () => {
    expect(PAGE).toContain('name="robots" content="noindex, nofollow"');
    expect(SCRIPT).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    expect(SCRIPT).toContain("headers: { 'x-admin-key': key }");
    expect(PAGE).toContain('type="password"');
  });
  it("n'insère aucune donnée reçue comme HTML", () => {
    expect(SCRIPT).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(SCRIPT).toContain("textContent");
  });
  it("affiche une mesure absente par « — », jamais par 0", () => {
    expect(SCRIPT).toContain("v === null || v === undefined ? '—'");
  });
  it("lit uniquement les deux routes de lecture", () => {
    expect([...SCRIPT.matchAll(/\/api\/[a-z/-]+/g)].map(m => m[0])).toEqual(["/api/admin/conversion/"]);
    expect(SCRIPT).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });
});
