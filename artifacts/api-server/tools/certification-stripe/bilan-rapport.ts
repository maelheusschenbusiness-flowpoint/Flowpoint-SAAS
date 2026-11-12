#!/usr/bin/env tsx
/**
 * Anti-faux-vert : lit le rapport JSON Playwright et rend NO-GO si un test a echoue OU a ete saute OU si rien n'a passe.
 * tsx tools/certification-stripe/bilan-rapport.ts [chemin/rapport.json]
 */
import { readFileSync } from "node:fs";

export function bilan(rapport: any): { passes: number; echecs: number; sautes: number; go: boolean } {
  let passes = 0, echecs = 0, sautes = 0;
  const parcourir = (s: any) => {
    for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) {
      const st = t.status ?? (t.results?.at?.(-1)?.status);
      if (st === "expected") passes += 1; else if (st === "skipped") sautes += 1; else echecs += 1;
    }
    for (const c of s.suites ?? []) parcourir(c);
  };
  for (const s of rapport.suites ?? []) parcourir(s);
  return { passes, echecs, sautes, go: echecs === 0 && sautes === 0 && passes > 0 };
}

if (process.argv[1]?.endsWith("bilan-rapport.ts")) {
  const f = process.argv[2] ?? "artifacts/api-server/tests/browser/certification-stripe/.out/rapport.json";
  const b = bilan(JSON.parse(readFileSync(f, "utf8")));
  console.log(`passes=${b.passes} echecs=${b.echecs} sautes=${b.sautes}`);
  console.log(b.go ? "VERDICT : GO (aucun echec, aucun test saute)" : "VERDICT : NO-GO (echec, test saute ou aucun test execute)");
  process.exit(b.go ? 0 : 1);
}
