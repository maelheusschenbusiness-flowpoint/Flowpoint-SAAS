export type ConversionEvent = {
  page: unknown;
  sessionId: unknown;
  eventType: unknown;
  scrollDepth?: unknown;
};

export type ConversionObservation = {
  page: string;
  eventType: string;
  observedEvents: number;
  affectedSessions: number;
  confidence: "low" | "medium" | "high";
  source: "behavior_events";
  recommendation: string;
};

const recommendations: Record<string, string> = {
  form_abandon: "Réduire les frictions du formulaire et vérifier les champs où les visiteurs abandonnent.",
  rage_click: "Inspecter les éléments cliqués de façon répétée et corriger les interactions bloquées.",
  dead_click: "Rendre les éléments visuellement cliquables réellement interactifs, ou retirer leur style de bouton.",
  exit: "Examiner le contenu et le prochain pas proposé sur cette page de sortie.",
  low_scroll: "Rendre la proposition de valeur et l’action principale visibles plus tôt dans la page.",
};

export function deriveConversionObservations(events: ConversionEvent[]): ConversionObservation[] {
  const groups = new Map<string, { count: number; sessions: Set<string> }>();
  for (const event of events) {
    const page = String(event.page ?? "").trim();
    let eventType = String(event.eventType ?? "");
    if ((eventType === "scroll" || eventType === "scroll_depth") && Number(event.scrollDepth) < 30) eventType = "low_scroll";
    if (eventType === "session_end") eventType = "exit";
    if (!page || !recommendations[eventType]) continue;
    const key = `${page}\u0000${eventType}`;
    const group = groups.get(key) ?? { count: 0, sessions: new Set<string>() };
    group.count += 1;
    const sessionId = String(event.sessionId ?? "");
    if (sessionId) group.sessions.add(sessionId);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [page, eventType] = key.split("\u0000") as [string, string];
      const affectedSessions = group.sessions.size;
      return {
        page,
        eventType,
        observedEvents: group.count,
        affectedSessions,
        confidence: affectedSessions >= 30 ? "high" as const : affectedSessions >= 10 ? "medium" as const : "low" as const,
        source: "behavior_events" as const,
        recommendation: recommendations[eventType]!,
      };
    })
    .filter(item => item.affectedSessions > 0)
    .sort((a, b) => b.affectedSessions - a.affectedSessions || b.observedEvents - a.observedEvents);
}

export type ExperimentArm = { exposures: number; conversions: number };
export type ExperimentResult = {
  status: "insufficient_data" | "inconclusive" | "significant";
  controlRate: number | null;
  variantRate: number | null;
  relativeLift: number | null;
  pValue: number | null;
  confidence: number | null;
  winner: "control" | "variant" | null;
  minimumExposuresPerArm: number;
};

function normalCdf(z: number): number {
  const x = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const probability = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - probability : probability;
}

export function calculateExperimentResult(control: ExperimentArm, variant: ExperimentArm): ExperimentResult {
  const minimumExposuresPerArm = 30;
  const valid = (arm: ExperimentArm) =>
    Number.isInteger(arm.exposures) && Number.isInteger(arm.conversions) &&
    arm.exposures >= 0 && arm.conversions >= 0 && arm.conversions <= arm.exposures;
  if (!valid(control) || !valid(variant)) throw new Error("Invalid experiment counts");
  if (control.exposures < minimumExposuresPerArm || variant.exposures < minimumExposuresPerArm) {
    return {
      status: "insufficient_data", controlRate: null, variantRate: null,
      relativeLift: null, pValue: null, confidence: null, winner: null, minimumExposuresPerArm,
    };
  }
  const p1 = control.conversions / control.exposures;
  const p2 = variant.conversions / variant.exposures;
  const pooled = (control.conversions + variant.conversions) / (control.exposures + variant.exposures);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / control.exposures + 1 / variant.exposures));
  const z = standardError > 0 ? (p2 - p1) / standardError : 0;
  const pValue = Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
  const significant = pValue < 0.05;
  return {
    status: significant ? "significant" : "inconclusive",
    controlRate: p1,
    variantRate: p2,
    relativeLift: p1 > 0 ? (p2 - p1) / p1 : null,
    pValue,
    confidence: 1 - pValue,
    winner: significant ? (p2 > p1 ? "variant" : "control") : null,
    minimumExposuresPerArm,
  };
}
