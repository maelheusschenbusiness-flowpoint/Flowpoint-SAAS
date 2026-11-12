/**
 * SLA Monitoring Avancé — cibles de disponibilité et conformité.
 *
 * NE RIEN FABRIQUER. La disponibilité vient exclusivement de Better Stack. Sans
 * cible définie, ou sans mesure exploitable, le statut le dit
 * (`no_target`, `insufficient_data`) au lieu de conclure « conforme ».
 */

/** Bornes d'une cible : en dessous de 90 % ce n'est plus un SLA, 100 % est inatteignable. */
export const SLA_TARGET_MIN = 90;
export const SLA_TARGET_MAX = 99.999;

export type SlaComplianceStatus = "met" | "breached" | "no_target" | "insufficient_data";

export interface SlaCompliance {
  status: SlaComplianceStatus;
  targetPct: number | null;
  availabilityPct: number | null;
  /** availability - target, en points de pourcentage, arrondi à 3 décimales. */
  marginPct: number | null;
}

/** Une cible valide : nombre fini (ou chaîne numérique stricte) dans les bornes. */
export function parseSlaTarget(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\d{2,3}(\.\d{1,3})?$/.test(value.trim())) n = Number(value);
  else return null;
  if (!Number.isFinite(n) || n < SLA_TARGET_MIN || n > SLA_TARGET_MAX) return null;
  return Math.round(n * 1000) / 1000;
}

/** La disponibilité d'une réponse Better Stack (JSON:API), ou null si absente/incohérente. */
export function extractAvailability(report: unknown): number | null {
  const attrs = (report as { data?: { attributes?: Record<string, unknown> } } | null)?.data?.attributes;
  const raw = attrs?.["availability"];
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function evaluateSla(availability: number | null, target: number | null): SlaCompliance {
  if (target === null) return { status: "no_target", targetPct: null, availabilityPct: availability, marginPct: null };
  if (availability === null) return { status: "insufficient_data", targetPct: target, availabilityPct: null, marginPct: null };
  const margin = Math.round((availability - target) * 1000) / 1000;
  return { status: margin >= 0 ? "met" : "breached", targetPct: target, availabilityPct: availability, marginPct: margin };
}

/** Une cellule CSV : guillemets échappés, et aucune formule exécutable à l'ouverture dans un tableur. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function slaReportCsv(input: {
  monitorId: string; from?: string; to?: string; report: unknown; compliance: SlaCompliance;
}): string {
  const a = (input.report as { data?: { attributes?: Record<string, unknown> } } | null)?.data?.attributes ?? {};
  const header = ["monitor_id", "from", "to", "availability_pct", "target_pct", "status", "margin_pct",
    "total_downtime_seconds", "incidents", "longest_incident_seconds", "average_incident_seconds"];
  const row = [input.monitorId, input.from ?? "", input.to ?? "", input.compliance.availabilityPct,
    input.compliance.targetPct, input.compliance.status, input.compliance.marginPct,
    a["total_downtime"], a["number_of_incidents"], a["longest_incident"], a["average_incident"]];
  return `${header.join(",")}\r\n${row.map(csvCell).join(",")}\r\n`;
}
