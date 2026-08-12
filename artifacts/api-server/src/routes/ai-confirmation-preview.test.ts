import { describe, it, expect } from "vitest";
import { buildConfirmationPreview } from "./ai.js";
import { MISSION_TOOLS } from "../agent/mission-tools.js";
import { CALENDAR_TOOLS } from "../agent/calendar-tools.js";
import { AUDIT_TOOLS } from "../agent/audit-tools.js";
import { MONITOR_TOOLS } from "../agent/monitor-tools.js";
import { RECOMMENDATION_TOOLS } from "../agent/recommendation-tools.js";

/**
 * Task #515 — la carte de confirmation doit afficher un libellé lisible pour
 * TOUS les outils confirmables, jamais un nom brut comme « run_audit ».
 */
describe("buildConfirmationPreview — libellés humains", () => {
  it("run_audit FR : phrase claire avec l'URL, pas de nom d'outil brut", () => {
    const p = buildConfirmationPreview("run_audit", { url: "https://example.com" }, "fr");
    expect(p).toContain("Lancer un audit SEO complet");
    expect(p).toContain("https://example.com");
    expect(p).not.toContain("run_audit");
  });

  it("run_audit EN : clear sentence with the URL", () => {
    const p = buildConfirmationPreview("run_audit", { url: "https://example.com" }, "en-US");
    expect(p).toContain("Run a full SEO audit");
    expect(p).toContain("https://example.com");
    expect(p).not.toContain("run_audit");
  });

  it("run_audit ES : frase clara", () => {
    const p = buildConfirmationPreview("run_audit", { url: "https://example.com" }, "es");
    expect(p).toContain("auditoría SEO completa");
    expect(p).not.toContain("run_audit");
  });

  it("run_audit sans URL : fallback « votre site »", () => {
    const p = buildConfirmationPreview("run_audit", {}, "fr");
    expect(p).toContain("votre site");
  });

  it("rerun_audit FR : libellé humain", () => {
    const p = buildConfirmationPreview("rerun_audit", { auditId: "a1" }, "fr");
    expect(p).toContain("Relancer l'audit");
    expect(p).not.toContain("rerun_audit");
  });

  it("TOUS les outils confirmables (preview/full) du registre : jamais de nom brut, en fr/en/es", () => {
    const allConfirmable = [
      ...MISSION_TOOLS, ...CALENDAR_TOOLS, ...AUDIT_TOOLS,
      ...MONITOR_TOOLS, ...RECOMMENDATION_TOOLS,
    ].filter((t) => t.confirmationLevel === "preview" || t.confirmationLevel === "full");
    expect(allConfirmable.length).toBeGreaterThan(20); // sanity: le registre est bien chargé
    for (const tool of allConfirmable) {
      for (const lang of ["fr", "en", "es"]) {
        const p = buildConfirmationPreview(tool.name, {}, lang);
        // Le fallback brut est « Exécuter l'action "<tool>" » (et variantes en/es) —
        // aucun outil enregistré ne doit y retomber.
        expect(p, `${tool.name} (${lang})`).not.toContain(`"${tool.name}"`);
        expect(p, `${tool.name} (${lang})`).not.toMatch(/Exécuter l'action|Run the "|Ejecutar la acción/);
      }
    }
  });

  it("configure_monitor : création vs modification, avec détails", () => {
    const create = buildConfirmationPreview("configure_monitor", { url: "https://x.com", name: "Prod" }, "fr");
    expect(create).toContain("Créer un nouveau monitor");
    expect(create).toContain("https://x.com");
    const update = buildConfirmationPreview("configure_monitor", { monitor_id: "m1", name: "Prod" }, "en");
    expect(update).toContain("Update the monitor settings");
    expect(update).toContain('"Prod"');
    expect(buildConfirmationPreview("configure_monitor", {}, "es")).toContain("monitor");
  });

  it("outil totalement inconnu : fallback générique conservé", () => {
    const p = buildConfirmationPreview("some_unknown_tool", {}, "fr");
    expect(p).toContain("some_unknown_tool"); // fallback explicite, acceptable
  });

  it("missions : libellés existants inchangés", () => {
    expect(buildConfirmationPreview("delete_mission", { id: "m1" }, "fr")).toContain("Supprimer définitivement");
    expect(buildConfirmationPreview("create_mission", { title: "T" }, "en")).toContain('Create a mission titled "T"');
  });
});
