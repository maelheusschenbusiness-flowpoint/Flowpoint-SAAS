export type BillingScheduleItem = {
  price: string;
  quantity?: number | null;
};

type StripeScheduleItem = {
  price?: string | { id?: string };
  quantity?: number | null;
};

type StripeSchedulePhase = {
  start_date?: number;
  items?: StripeScheduleItem[];
};

type StripeSchedule = {
  id: string;
  phases?: StripeSchedulePhase[];
  current_phase?: { start_date?: number } | null;
};

type ScheduleStripeClient = {
  subscriptionSchedules: {
    retrieve: (scheduleId: string) => Promise<unknown>;
    update: (scheduleId: string, params: Record<string, unknown>) => Promise<unknown>;
  };
};

export function billingScheduleItemSignature(items: StripeScheduleItem[]): string {
  return items
    .map((item) => {
      const priceId = typeof item.price === "string" ? item.price : item.price?.id;
      return `${priceId ?? ""}:${item.quantity ?? 1}`;
    })
    .filter((entry) => !entry.startsWith(":"))
    .sort()
    .join("|");
}

export async function ensureStripeScheduleTarget(input: {
  stripe: unknown;
  scheduleId: string;
  knownSchedule?: unknown;
  subscriptionStart?: number;
  periodEnd: number;
  currentItems: BillingScheduleItem[];
  futureItems: BillingScheduleItem[];
  targetPlan: string;
  trialEnd?: number | null;
}): Promise<{ alreadyTarget: boolean }> {
  const client = input.stripe as ScheduleStripeClient;
  const schedule = (
    input.knownSchedule
      ?? await client.subscriptionSchedules.retrieve(input.scheduleId)
  ) as StripeSchedule;
  const phases = schedule.phases ?? [];
  const futurePhase = phases[phases.length - 1];
  const desiredSignature = billingScheduleItemSignature(input.futureItems);
  const alreadyTarget = !!futurePhase
    && billingScheduleItemSignature(futurePhase.items ?? []) === desiredSignature;

  if (alreadyTarget) return { alreadyTarget: true };

  const phase0Start = phases[0]?.start_date
    ?? schedule.current_phase?.start_date
    ?? input.subscriptionStart;
  if (!phase0Start) {
    throw new Error(`downgrade_schedule_start_unresolved:${input.scheduleId}`);
  }

  await client.subscriptionSchedules.update(input.scheduleId, {
    end_behavior: "release",
    phases: [
      {
        start_date: phase0Start,
        end_date: input.periodEnd,
        items: input.currentItems,
        ...(input.trialEnd ? { trial_end: input.trialEnd } : {}),
        proration_behavior: "none",
      },
      {
        items: input.futureItems,
        metadata: { plan: input.targetPlan },
        proration_behavior: "none",
      },
    ],
  });

  return { alreadyTarget: false };
}