import { describe, it, expect } from "vitest";
import { csvCell, evaluateSla, extractAvailability, parseSlaTarget, slaReportCsv } from "./sla-compliance.js";

describe("parseSlaTarget", () => {
  it("accepte les cibles dans les bornes, nombre ou chaîne stricte", () => {
    expect(parseSlaTarget(99.9)).toBe(99.9);
    expect(parseSlaTarget("99.95")).toBe(99.95);
    expect(parseSlaTarget(90)).toBe(90);
    expect(parseSlaTarget(99.999)).toBe(99.999);
  });
  it("refuse tout le reste", () => {
    for (const bad of [89.99, 100, 101, -1, 0, NaN, Infinity, "abc", "99,9", "99.9999", "", null, undefined, {}, [], "1e2", " 99 x"]) {
      expect(parseSlaTarget(bad)).toBeNull();
    }
  });
});

describe("evaluateSla", () => {
  it("sans cible : no_target, jamais conforme par défaut", () => {
    expect(evaluateSla(99.99, null).status).toBe("no_target");
  });
  it("sans mesure : insufficient_data, jamais conforme ni dépassé", () => {
    expect(evaluateSla(null, 99.9)).toMatchObject({ status: "insufficient_data", marginPct: null });
  });
  it("conforme exactement à la cible, dépassé juste en dessous", () => {
    expect(evaluateSla(99.9, 99.9)).toMatchObject({ status: "met", marginPct: 0 });
    expect(evaluateSla(99.899, 99.9)).toMatchObject({ status: "breached", marginPct: -0.001 });
  });
  it("une disponibilité de 0 % est une mesure, pas une absence", () => {
    expect(evaluateSla(0, 99.9).status).toBe("breached");
  });
});

describe("extractAvailability", () => {
  it("lit la disponibilité JSON:API et rejette l'incohérent", () => {
    expect(extractAvailability({ data: { attributes: { availability: 99.98 } } })).toBe(99.98);
    expect(extractAvailability({ data: { attributes: { availability: "100" } } })).toBe(100);
    for (const bad of [null, {}, { data: {} }, { data: { attributes: { availability: null } } },
      { data: { attributes: { availability: "" } } }, { data: { attributes: { availability: 120 } } },
      { data: { attributes: { availability: -3 } } }, { data: { attributes: { availability: "x" } } }]) {
      expect(extractAvailability(bad)).toBeNull();
    }
  });
});

describe("export CSV", () => {
  it("neutralise les formules et échappe les guillemets", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
  it("produit une ligne d'en-tête et une ligne de mesures, sans rien inventer", () => {
    const compliance = evaluateSla(99.98, 99.9);
    const csv = slaReportCsv({ monitorId: "m1", from: "2026-09-01", to: "2026-09-30", compliance,
      report: { data: { attributes: { availability: 99.98, total_downtime: 600, number_of_incidents: 3, longest_incident: 300, average_incident: 200 } } } });
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toBe("monitor_id,from,to,availability_pct,target_pct,status,margin_pct,total_downtime_seconds,incidents,longest_incident_seconds,average_incident_seconds");
    expect(row).toBe("m1,2026-09-01,2026-09-30,99.98,99.9,met,0.08,600,3,300,200");
    const empty = slaReportCsv({ monitorId: "m2", compliance: evaluateSla(null, null), report: {} });
    expect(empty.trim().split("\r\n")[1]).toBe("m2,,,,,no_target,,,,,");
  });
});
