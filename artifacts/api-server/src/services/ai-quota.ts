import { type OrgAIPrefs } from "./ai-prefs.js";

export function buildQuotaGuidance(
  _creditCheck: { allowed: boolean; remaining: number },
  aiPrefs: OrgAIPrefs,
  plan?: string
): { code: string; error: string; guidance: { action: string; ctaLabel: string; ctaUrl: string } } {
  const intensity = aiPrefs.aiIntensity ?? "Équilibré";
  const p = (plan ?? "standard").toLowerCase();

  let action: string;
  let ctaLabel: string;
  let ctaUrl: string;

  if (intensity !== "Conservateur") {
    action = "change_mode";
    ctaLabel = "Passer en mode Conservateur pour économiser les crédits";
    ctaUrl = "/settings?tab=ai";
  } else if (p === "ultra") {
    action = "buy_credits";
    ctaLabel = "Acheter des crédits IA supplémentaires";
    ctaUrl = "/settings?tab=billing&addon=ai_credits";
  } else if (p === "pro") {
    action = "upgrade_plan";
    ctaLabel = "Passer en Ultra pour des crédits illimités";
    ctaUrl = "/settings?tab=billing";
  } else {
    action = "upgrade_plan";
    ctaLabel = "Passer en Pro pour plus de crédits IA";
    ctaUrl = "/settings?tab=billing";
  }

  return {
    code: "QUOTA_EXCEEDED",
    error: "Crédits IA insuffisants pour ce mois",
    guidance: { action, ctaLabel, ctaUrl },
  };
}
