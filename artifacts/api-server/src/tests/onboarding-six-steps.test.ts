/**
 * L'onboarding officiel de la V1 compte SIX etapes, et les deux copies du
 * tableau de bord disent la meme chose.
 *
 * Le fichier servi annoncait cinq etapes avec les anciennes videos
 * (`onboarding-video-N-flowpoint.mp4`), la source six avec les nouvelles
 * (`stepN-*.mp4`). Les deux divergeaient aussi sur 21 autres zones, ou le
 * fichier servi etait EN AVANCE — d'ou l'echec permanent des deux tests
 * d'egalite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXPORT = join(root, "artifacts/flowpoint-export/dashboard.js");
const SOURCE = join(root, "src/frontend/dashboard.js");
const js = readFileSync(EXPORT, "utf8");

/** Les etapes declarees, extraites de la table livree. */
const steps = (() => {
  const start = js.indexOf("const FP_ONBOARDING_STEPS");
  if (start < 0) throw new Error("FP_ONBOARDING_STEPS introuvable");
  const bloc = js.slice(start, js.indexOf("\n];", start));
  return [...bloc.matchAll(/videoUrl:\s*'([^']+)'/g)].map((m) => m[1]);
})();

describe("l onboarding compte six etapes", () => {
  it("exactement six videos sont declarees", () => {
    expect(steps).toHaveLength(6);
  });

  it("l en-tete annonce bien six etapes", () => {
    expect(js).toContain("ONBOARDING — Visite guidée vidéo (6 étapes)");
  });

  it.each([1, 2, 3, 4, 5, 6])("l etape %s reference une video stepN", (n) => {
    expect(steps[n - 1]).toMatch(new RegExp(`^/onboarding/step${n}-`));
  });

  it("aucune ancienne video a cinq etapes ne subsiste", () => {
    expect(js).not.toContain("onboarding-video-1-flowpoint.mp4");
    expect(js).not.toMatch(/ONBOARDING — Visite guidée vidéo \(5 étapes\)/);
  });
});

describe("chaque video existe reellement sur disque", () => {
  it.each(steps.map((v, i) => [i + 1, v]))("etape %s : %s", (_n, url) => {
    const p = join(root, "artifacts/flowpoint-export", String(url));
    expect(existsSync(p), `${url} introuvable`).toBe(true);
    expect(statSync(p).size, `${url} est vide`).toBeGreaterThan(1024);
  });
});

describe("la navigation est bornee", () => {
  it("l index est borne aux deux extremites", () => {
    // Sans cette borne, « precedent » depuis la premiere etape ou « suivant »
    // depuis la derniere sortirait du tableau.
    expect(js).toContain("Math.max(0, Math.min(idx, FP_ONBOARDING_STEPS.length - 1))");
  });

  it("la premiere et la derniere etape sont reconnues", () => {
    expect(js).toContain("const isFirst = idx === 0");
    expect(js).toContain("const isLast  = idx === total - 1");
    // Et la derniere etape termine au lieu d'avancer dans le vide.
    expect(js).toContain("const nextAction = isLast ? 'window._fpObComplete()'");
  });

  it("la fermeture et la reprise existent", () => {
    expect(js).toContain("function completeOnboarding()");
    expect(js).toContain("function openOnboardingManually(");
  });
});

describe("les deux copies sont alignees", () => {
  it("le fichier servi et la source sont identiques", () => {
    // C'est ce que mesurent `keeps production export synchronized` et
    // `ships the same dashboard source that production export serves`.
    expect(readFileSync(SOURCE, "utf8")).toBe(js);
  });

  it("la source a recu les zones qui n existaient que dans le fichier servi", () => {
    const src = readFileSync(SOURCE, "utf8");
    // Deux temoins de ces 21 zones : la garde anti-doublon de creation de
    // mission, et le rafraichissement de la liste des concurrents.
    expect(src).toContain("_fpMissionCreated");
    expect(src).toContain("fpRefreshCompetitorList");
  });
});
