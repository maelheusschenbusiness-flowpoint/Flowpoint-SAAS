import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { betaSchedulerEnabled } from "../lib/beta-activation.js";

const src = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8");

describe("planificateurs de la bêta : aucune activation implicite en production", () => {
  for (const flag of ["GBP_POST_SCHEDULER_ENABLED", "WORKFLOW_SCHEDULER_ENABLED"] as const) {
    it(`${flag} : désactivé en production sauf valeur exactement « true »`, () => {
      expect(betaSchedulerEnabled(flag, { NODE_ENV: "production" })).toBe(false);
      for (const v of ["", "1", "TRUE", "True", "yes", "false", " true", "true "]) {
        expect(betaSchedulerEnabled(flag, { NODE_ENV: "production", [flag]: v })).toBe(false);
      }
      expect(betaSchedulerEnabled(flag, { NODE_ENV: "production", [flag]: "true" })).toBe(true);
    });
    it(`${flag} : hors production, comportement inchangé (actif)`, () => {
      for (const NODE_ENV of ["development", "test", undefined]) {
        expect(betaSchedulerEnabled(flag, { NODE_ENV } as NodeJS.ProcessEnv)).toBe(true);
      }
    });
  }
  it("le démarrage de chaque planificateur de la bêta passe par l'interrupteur", () => {
    const idx = src("index.ts");
    expect(idx).toContain('betaSchedulerEnabled("GBP_POST_SCHEDULER_ENABLED")) startGBPPostScheduler()');
    expect(idx).not.toMatch(/\n\s*if \(env\.NODE_ENV === "production"\) startGBPPostScheduler\(\);/);
    const cron = src("services/monitor-cron.ts");
    expect(cron).toContain('betaSchedulerEnabled("WORKFLOW_SCHEDULER_ENABLED")');
    // chaque appel au planificateur de workflows est dans le bloc garde
    const start = cron.indexOf('if (betaSchedulerEnabled("WORKFLOW_SCHEDULER_ENABLED"))');
    const block = cron.slice(start, cron.indexOf("} else {", start));
    const call = /runScheduledWorkflowsTickSafe\(\)(?!:)/g;
    const total = (cron.match(call) ?? []).length;
    expect(total).toBe(2);
    expect((block.match(call) ?? []).length).toBe(total);
  });

  it("Agency Reporting : aucune livraison planifiée sans interrupteur ET URL publique explicites", async () => {
    const saved = { flag: process.env["AGENCY_REPORT_SCHEDULER_ENABLED"], a: process.env["PUBLIC_URL"], b: process.env["PUBLIC_BASE_URL"] };
    try {
      const { isAgencyReportDeliveryReady } = await import("../services/agency-reporting.js");
      delete process.env["AGENCY_REPORT_SCHEDULER_ENABLED"]; delete process.env["PUBLIC_URL"]; delete process.env["PUBLIC_BASE_URL"];
      expect(isAgencyReportDeliveryReady()).toBe(false);
      process.env["AGENCY_REPORT_SCHEDULER_ENABLED"] = "true"; // interrupteur seul : sans URL publique, toujours inactif
      expect(isAgencyReportDeliveryReady()).toBe(false);
    } finally {
      for (const [k, v] of [["AGENCY_REPORT_SCHEDULER_ENABLED", saved.flag], ["PUBLIC_URL", saved.a], ["PUBLIC_BASE_URL", saved.b]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
