export interface AgencyReportPack { id: string; name: string; templateKey: "executive" | "seo" | "local"; description: string; }
export const AGENCY_REPORT_PACKS: readonly AgencyReportPack[] = Object.freeze([
  { id: "executive-monthly", name: "Executive mensuel", templateKey: "executive", description: "Synthèse exécutive mensuelle." },
  { id: "seo-growth", name: "SEO & croissance", templateKey: "seo", description: "Suivi des performances SEO." },
  { id: "local-presence", name: "Présence locale", templateKey: "local", description: "Rapport de visibilité locale." },
]);
