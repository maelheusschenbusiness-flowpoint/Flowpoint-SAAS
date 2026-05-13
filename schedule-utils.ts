export const VALID_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type ScheduleFrequency = (typeof VALID_FREQUENCIES)[number];

export function isValidFrequency(f: unknown): f is ScheduleFrequency {
  return VALID_FREQUENCIES.includes(f as ScheduleFrequency);
}

export function computeNextRun(frequency: ScheduleFrequency | string): number {
  const now = Date.now();
  if (frequency === "daily")   return now + 24 * 60 * 60 * 1000;
  if (frequency === "weekly")  return now + 7  * 24 * 60 * 60 * 1000;
  if (frequency === "monthly") return now + 30 * 24 * 60 * 60 * 1000;
  return now + 7 * 24 * 60 * 60 * 1000;
}
