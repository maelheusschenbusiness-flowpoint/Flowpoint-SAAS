export type Frequency = "hourly" | "daily" | "weekly" | "monthly";

const VALID: Frequency[] = ["hourly", "daily", "weekly", "monthly"];

export function isValidFrequency(f: string): f is Frequency {
  return VALID.includes(f as Frequency);
}

export function computeNextRun(frequency: Frequency, from = new Date()): Date {
  const d = new Date(from);
  switch (frequency) {
    case "hourly":  d.setHours(d.getHours() + 1); break;
    case "daily":   d.setDate(d.getDate() + 1); break;
    case "weekly":  d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}
