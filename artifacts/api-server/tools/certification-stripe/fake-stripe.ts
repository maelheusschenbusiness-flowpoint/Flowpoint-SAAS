/** Faux client Stripe EN MEMOIRE (tests unitaires uniquement) : listes iterables, comme les listes auto-paginees du SDK. */
async function* iter<T>(xs: T[]): AsyncGenerator<T> { for (const x of xs) yield x; }
export interface FauxEtat { customers: any[]; subscriptions: any[]; paymentMethods: Record<string, any>; events: any[]; livemode?: boolean; supprimes: string[]; annulees: string[] }
export function fauxStripe(etat: FauxEtat) {
  const filtre = (xs: any[], p: Record<string, any>) => xs.filter((x) => (p["created"]?.gte ? x.created >= p["created"].gte : true));
  return {
    balance: { retrieve: async () => ({ livemode: etat.livemode ?? false }) },
    customers: {
      list: (p: Record<string, any>) => iter(filtre(etat.customers, p).filter((c) => (p["email"] ? c.email === p["email"] : true))),
      del: async (id: string) => { etat.supprimes.push(id); etat.customers = etat.customers.filter((c) => c.id !== id); return { id, deleted: true }; },
    },
    subscriptions: {
      list: (p: Record<string, any>) => iter(etat.subscriptions.filter((s) => s.customer === p["customer"])),
      cancel: async (id: string) => { etat.annulees.push(id); const s = etat.subscriptions.find((x) => x.id === id); if (s) s.status = "canceled"; return s; },
    },
    paymentMethods: { retrieve: async (id: string) => { const m = etat.paymentMethods[id]; if (!m) throw new Error("introuvable"); return m; } },
    events: { list: (p: Record<string, any>) => iter(filtre(etat.events, p)) },
  };
}
