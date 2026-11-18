/**
 * D6 : les visiteurs des parcours de certification portent le prefixe `fp-test-`
 * pour etre exclus des chiffres commerciaux (TEST_FILTER de conversion-dashboards).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREFIXE_VISITEUR_TEST, visiteurCertification } from "../../tests/browser/certification/support/visiteur.js";
import { normaliserAttributionFunnel } from "../services/funnel-events.js";

const lire = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("visiteur de certification", () => {
  it("commence par fp-test-, est unique et reste un identifiant valide pour le tunnel", () => {
    const a = visiteurCertification(), b = visiteurCertification();
    expect(a.startsWith("fp-test-")).toBe(true);
    expect(PREFIXE_VISITEUR_TEST).toBe("fp-test-");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(120);
    expect(normaliserAttributionFunnel("accepted", a, "direct")?.visiteurId).toBe(a);
  });

  it("le filtre des tableaux de bord est inchange et correspond a ce prefixe", () => {
    const src = lire("src/services/conversion-dashboards.ts");
    expect(src).toContain("visiteur_id NOT LIKE 'fp-test-%'");
  });

  it("la fixture de consentement et la certification Stripe utilisent ce helper", () => {
    expect(lire("tests/browser/certification/support/fixtures.ts")).toContain("visiteurCertification()");
    const contrat = lire("tests/browser/certification-stripe/support/contrat.ts");
    expect(contrat).toContain("vid: visiteurCertification()");
    expect(contrat).not.toContain("randomUUID");
  });
});
