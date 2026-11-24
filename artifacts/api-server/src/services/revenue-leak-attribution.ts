export const REVENUE_LEAK_ATTRIBUTION = {
  status: "insufficient_data" as const,
  reason: "no_shared_identifier" as const,
  message: "Les événements comportementaux utilisent un identifiant de session du tracker, tandis que les revenus GA4 disponibles sont agrégés et ne partagent aucune clé événementielle pour une jointure exacte.",
};

export function revenueLeakFinancials() {
  return {
    status: REVENUE_LEAK_ATTRIBUTION.status,
    observedLoss: null,
    estimatedLoss: null,
    currency: null,
  } as const;
}
