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
    case "monthly": {
      // setMonth deborde quand le jour n'existe pas dans le mois suivant
      // (31 janvier donnait le 3 mars). On ramene au dernier jour du mois cible.
      const year  = d.getFullYear();
      const month = d.getMonth();
      // Jour 0 du mois suivant la cible = dernier jour de la cible.
      const lastDayOfTarget = new Date(year, month + 2, 0).getDate();
      // Les trois champs sont poses ensemble : aucun etat intermediaire ne deborde.
      d.setFullYear(year, month + 1, Math.min(d.getDate(), lastDayOfTarget));
      break;
    }
  }
  return d;
}
