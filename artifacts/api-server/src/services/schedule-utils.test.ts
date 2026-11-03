import { describe, expect, it } from "vitest";
import { computeNextRun } from "./schedule-utils.js";

// Les dates sont construites en heure locale, et relues avec les getters
// locaux : la frequence mensuelle raisonne sur le calendrier civil.
describe("computeNextRun — mensuel : le jour est ramene au dernier du mois", () => {
  it("du 31 janvier d'une annee normale au 28 fevrier", () => {
    const next = computeNextRun("monthly", new Date(2026, 0, 31, 9, 0, 0));

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(1); // fevrier
    expect(next.getDate()).toBe(28);
  });

  it("du 31 janvier d'une annee bissextile au 29 fevrier", () => {
    const next = computeNextRun("monthly", new Date(2028, 0, 31, 9, 0, 0));

    expect(next.getFullYear()).toBe(2028);
    expect(next.getMonth()).toBe(1); // fevrier
    expect(next.getDate()).toBe(29);
  });

  it("du 31 mars au 30 avril", () => {
    const next = computeNextRun("monthly", new Date(2026, 2, 31, 9, 0, 0));

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(3); // avril
    expect(next.getDate()).toBe(30);
  });

  it("du 31 decembre au 31 janvier de l'annee suivante", () => {
    const next = computeNextRun("monthly", new Date(2026, 11, 31, 9, 0, 0));

    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0); // janvier
    expect(next.getDate()).toBe(31);
  });

  it("du 15 d'un mois au 15 du mois suivant", () => {
    const next = computeNextRun("monthly", new Date(2026, 0, 15, 9, 0, 0));

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(1); // fevrier
    expect(next.getDate()).toBe(15);
  });

  it("conserve l'heure, les minutes et les secondes meme quand le jour est ramene", () => {
    const next = computeNextRun("monthly", new Date(2026, 0, 31, 14, 45, 30));

    expect(next.getDate()).toBe(28);
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(45);
    expect(next.getSeconds()).toBe(30);
  });

  it("ne modifie pas la date passee en argument", () => {
    const from = new Date(2026, 0, 31, 14, 45, 30);
    const before = from.getTime();

    const next = computeNextRun("monthly", from);

    expect(from.getTime()).toBe(before);
    expect(next.getTime()).not.toBe(before);
  });
});

// Juin ne porte aucun changement d'heure : ces trois cas restent lisibles
// quel que soit le fuseau de la machine qui execute la suite.
describe("computeNextRun — les autres frequences", () => {
  it("hourly ajoute une heure", () => {
    const next = computeNextRun("hourly", new Date(2026, 5, 15, 10, 30, 15));

    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(11);
    expect(next.getMinutes()).toBe(30);
    expect(next.getSeconds()).toBe(15);
  });

  it("daily ajoute un jour", () => {
    const next = computeNextRun("daily", new Date(2026, 5, 15, 10, 30, 15));

    expect(next.getMonth()).toBe(5); // juin
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(10);
  });

  it("weekly ajoute sept jours", () => {
    const next = computeNextRun("weekly", new Date(2026, 5, 15, 10, 30, 15));

    expect(next.getMonth()).toBe(5); // juin
    expect(next.getDate()).toBe(22);
    expect(next.getHours()).toBe(10);
  });
});
