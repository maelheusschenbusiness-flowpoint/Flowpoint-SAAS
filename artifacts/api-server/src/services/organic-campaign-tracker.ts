export type OrganicCampaignGoal = {
  keyword: string;
  targetPosition: number;
  minimumClicks: number;
};

export type OrganicCampaignObservation = {
  keyword: string;
  clicks: number;
  impressions: number;
  averagePosition: number;
  observedAt: string;
};

export function evaluateOrganicCampaignGoal(
  goal: OrganicCampaignGoal,
  observation: OrganicCampaignObservation | null,
) {
  if (!goal.keyword.trim()) throw new Error("Campaign keyword is required");
  if (!Number.isFinite(goal.targetPosition) || goal.targetPosition <= 0) {
    throw new RangeError("Target position must be greater than zero");
  }
  if (!Number.isFinite(goal.minimumClicks) || goal.minimumClicks < 0) {
    throw new RangeError("Minimum clicks cannot be negative");
  }

  if (!observation) {
    return {
      keyword: goal.keyword,
      status: "no_data" as const,
      observedAt: null,
      clicks: null,
      impressions: null,
      averagePosition: null,
      positionGap: null,
      clicksGap: null,
    };
  }

  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  if (normalize(observation.keyword) !== normalize(goal.keyword)) {
    return {
      keyword: goal.keyword,
      status: "no_data" as const,
      observedAt: null,
      clicks: null,
      impressions: null,
      averagePosition: null,
      positionGap: null,
      clicksGap: null,
    };
  }
  if (
    !Number.isFinite(observation.clicks) || observation.clicks < 0
    || !Number.isFinite(observation.impressions) || observation.impressions < 0
    || !Number.isFinite(observation.averagePosition) || observation.averagePosition <= 0
  ) {
    throw new RangeError("Organic observations must contain valid measured metrics");
  }

  const positionGap = observation.averagePosition - goal.targetPosition;
  const clicksGap = goal.minimumClicks - observation.clicks;
  return {
    keyword: goal.keyword,
    status: positionGap <= 0 && clicksGap <= 0 ? "goal_met" as const : "needs_attention" as const,
    observedAt: observation.observedAt,
    clicks: observation.clicks,
    impressions: observation.impressions,
    averagePosition: observation.averagePosition,
    positionGap,
    clicksGap,
  };
}
