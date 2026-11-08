/**
 * A-06 — contrat de source : les DEUX chemins d'activation (finalize-checkout
 * et webhook) doivent prendre le verrou par e-mail, relire le jeton FOR UPDATE
 * et resoudre l'organisation existante AVANT toute ecriture d'utilisateur ou
 * d'organisation, a l'interieur de leur transaction. La preuve de concurrence
 * est dans services/signup-activation-concurrency-db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function order(src: string, markers: string[]): number[] {
  return markers.map((m) => {
    const i = src.indexOf(m);
    expect(i, `marqueur introuvable: ${m}`).toBeGreaterThanOrEqual(0);
    return i;
  });
}

describe("finalize-checkout (public-billing.ts)", () => {
  const src = read("src/routes/public-billing.ts");
  it("verrou + relecture du jeton + reutilisation de l'org, avant l'ecriture de l'utilisateur", () => {
    const idx = order(src, [
      'await _fcActTxC.query("BEGIN");',
      "await lockSignupEmail(_fcActTxC",
      "await lockPendingSignup(_fcActTxC",
      "await resolveOwnerOrgId(_fcActTxC",
      "_fcAOrgId = _fcResolved.orgId;",
      "[FC] step-4a: INSERT INTO users",
    ]);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it("l'identifiant d'organisation n'est plus une constante aleatoire", () => {
    expect(src).toMatch(/let _fcAOrgId: string = _fcRandUUID\(\);/);
    expect(src).not.toMatch(/const _fcAOrgId = _fcRandUUID\(\)/);
  });
});

describe("webhook activateNewSignup (stripe-webhook.ts)", () => {
  const src = read("src/routes/stripe-webhook.ts");
  it("verrou + relecture du jeton + reutilisation de l'org, avant l'ecriture de l'utilisateur", () => {
    const idx = order(src, [
      'await activateClient.query("BEGIN");',
      "await lockSignupEmail(activateClient",
      "await lockPendingSignup(activateClient",
      "await resolveOwnerOrgId(activateClient",
      "orgUUID = _wbResolved.orgId;",
      "const _wbNewUserId = _wbRandUUID();",
    ]);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it("un jeton deja consomme sous verrou arrete l'activation (idempotence avec finalize)", () => {
    expect(src).toMatch(/_wbLocked\.consumed \|\| !_wbLocked\.found[\s\S]{0,200}ROLLBACK/);
  });
  it("la recherche d'organisation par proprietaire ignore la casse", () => {
    expect(src).toMatch(/lower\(owner_email\) = lower\(\$1\) LIMIT 1/);
  });
});
