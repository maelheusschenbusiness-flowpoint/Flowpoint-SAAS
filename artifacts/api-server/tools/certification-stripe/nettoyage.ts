/** Planification et execution du nettoyage (logique pure, testable avec un faux client Stripe). */
export interface PlanClient { customerId: string; email: string; souscriptions: Array<{ id: string; status: string }> }

interface ClientNettoyage {
  customers: { list(p: Record<string, unknown>): AsyncIterable<any>; del(id: string): Promise<unknown> };
  subscriptions: { list(p: Record<string, unknown>): AsyncIterable<any>; cancel(id: string): Promise<unknown> };
}

/** `cible` : motif d'adresses de campagne, ou liste d'adresses EXACTES (ex. compte Google de test). */
export async function planifierNettoyage(stripe: ClientNettoyage, cible: RegExp | string[], depuis: number): Promise<PlanClient[]> {
  const plan: PlanClient[] = [];
  for await (const c of stripe.customers.list({ created: { gte: depuis }, limit: 100 })) {
    const email = String(c.email ?? "");
    const exacts = Array.isArray(cible) ? cible.map((x) => x.toLowerCase()) : null;
    if (Array.isArray(cible) ? !exacts!.includes(email.toLowerCase()) : !cible.test(email)) continue;   // JAMAIS un customer hors campagne
    const subs: Array<{ id: string; status: string }> = [];
    for await (const s of stripe.subscriptions.list({ customer: c.id, status: "all", limit: 100 })) {
      if (!["canceled", "incomplete_expired"].includes(s.status)) subs.push({ id: s.id, status: s.status });
    }
    plan.push({ customerId: c.id, email, souscriptions: subs });
  }
  return plan;
}

export async function executerNettoyage(stripe: ClientNettoyage, plan: PlanClient[]): Promise<{ souscriptionsAnnulees: number; customersSupprimes: number }> {
  let sa = 0, cs = 0;
  for (const p of plan) {
    for (const s of p.souscriptions) { await stripe.subscriptions.cancel(s.id); sa += 1; }
    await stripe.customers.del(p.customerId); cs += 1;
  }
  return { souscriptionsAnnulees: sa, customersSupprimes: cs };
}
