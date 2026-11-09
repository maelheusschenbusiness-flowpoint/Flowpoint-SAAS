/**
 * Faux client Stripe, EN MEMOIRE, injecte via `setStripeForTesting`.
 *
 * Aucun appel reseau. Il reproduit le contrat que le tunnel public utilise
 * (customers, setupIntents, paymentIntents, paymentMethods, subscriptions) avec
 * un etat reel : un SetupIntent passe de `requires_payment_method` a `succeeded`
 * uniquement quand le navigateur le « confirme » (voir stripe-js-stub.js), et
 * refuse quand la carte saisie est une carte de refus.
 *
 * Toute methode non implementee leve `FAKE_STRIPE_UNIMPLEMENTED:<chemin>` : un
 * appel inattendu doit se voir, pas etre avale.
 */
export interface FakeCustomer { id: string; email?: string; name?: string; metadata: Record<string, string>; deleted?: false; invoice_settings?: Record<string, unknown> }
export interface FakeIntent {
  id: string; object: "setup_intent" | "payment_intent"; client_secret: string; status: string;
  customer?: string | null; payment_method?: string | null; metadata: Record<string, string>; created: number;
  last_setup_error?: { message: string; code: string } | null;
}
export interface FakeSubscription {
  id: string; status: string; customer: string; cancel_at_period_end: boolean; created: number;
  trial_end: number | null; current_period_end: number; start_date: number;
  items: { data: Array<{ id: string; price: { id: string }; quantity: number; metadata: Record<string, string> }> };
  metadata: Record<string, string>; default_payment_method?: string;
}

export const CARDS = {
  OK: "4242424242424242",
  DECLINED: "4000000000000002",
  INSUFFICIENT: "4000000000009995",
} as const;

const DECLINE_MESSAGES: Record<string, { code: string; message: string }> = {
  [CARDS.DECLINED]: { code: "card_declined", message: "Votre carte a été refusée." },
  [CARDS.INSUFFICIENT]: { code: "card_declined", message: "Votre carte n'a pas les fonds nécessaires." },
};

export class FakeStripeState {
  seq = 0;
  /** Identifiant propre a ce demarrage : evite toute collision avec des lignes d'une base qui survit au serveur. */
  readonly run = Math.random().toString(36).slice(2, 6);
  customers = new Map<string, FakeCustomer>();
  intents = new Map<string, FakeIntent>();
  methods = new Map<string, { id: string; customer: string | null; billing_details: { email?: string; name?: string } }>();
  subscriptions = new Map<string, FakeSubscription>();
  calls: string[] = [];
  /** Echecs a injecter : « sous.chemin » -> message (une seule fois). */
  failNext = new Map<string, string>();
  next(prefix: string): string { this.seq += 1; return `${prefix}_fake${this.run}${String(this.seq).padStart(5, "0")}`; }
  reset(): void {
    this.customers.clear(); this.intents.clear(); this.methods.clear(); this.subscriptions.clear();
    this.calls.length = 0; this.failNext.clear();
  }
  snapshot() {
    return {
      customers: [...this.customers.values()],
      intents: [...this.intents.values()].map((i) => ({ ...i, client_secret: "[masque]" })),
      subscriptions: [...this.subscriptions.values()],
      calls: [...this.calls],
    };
  }

  /** Confirmation faite par le navigateur (stub de Stripe.js). */
  confirmSetup(clientSecret: string, card: string): { error?: { message: string; code: string }; setupIntent?: { id: string; status: string } } {
    const intent = [...this.intents.values()].find((i) => i.client_secret === clientSecret);
    if (!intent) return { error: { code: "resource_missing", message: "Aucun SetupIntent ne correspond à ce client_secret." } };
    if (intent.status === "succeeded") return { setupIntent: { id: intent.id, status: "succeeded" } };
    const decline = DECLINE_MESSAGES[card.replace(/\s+/g, "")];
    if (decline) {
      intent.status = "requires_payment_method";
      intent.last_setup_error = decline;
      return { error: decline };
    }
    const pm = this.next("pm");
    const owner = intent.customer ?? null;
    this.methods.set(pm, { id: pm, customer: null, billing_details: { email: owner ? this.customers.get(owner)?.email : undefined, name: owner ? this.customers.get(owner)?.name : undefined } });
    intent.payment_method = pm;
    intent.status = "succeeded";
    return { setupIntent: { id: intent.id, status: "succeeded" } };
  }
}

export function createFakeStripe(state: FakeStripeState) {
  const now = () => Math.floor(Date.now() / 1000);
  const track = (p: string) => { state.calls.push(p); const f = state.failNext.get(p); if (f) { state.failNext.delete(p); throw Object.assign(new Error(f), { type: "StripeAPIError" }); } };
  const live = (s: FakeSubscription) => ["active", "trialing", "past_due"].includes(s.status);

  const impl = {
    customers: {
      list: async (p: { email?: string; limit?: number }) => { track("customers.list"); return { data: [...state.customers.values()].filter((c) => !p.email || c.email === p.email) }; },
      search: async () => { track("customers.search"); return { data: [] as FakeCustomer[] }; },
      create: async (p: Partial<FakeCustomer> & { payment_method?: string }) => {
        track("customers.create");
        const c: FakeCustomer = { id: state.next("cus"), email: p.email, name: p.name, metadata: { ...(p.metadata ?? {}) } };
        state.customers.set(c.id, c); return c;
      },
      retrieve: async (id: string) => { track("customers.retrieve"); const c = state.customers.get(id); if (!c) throw Object.assign(new Error(`No such customer: '${id}'`), { code: "resource_missing" }); return c; },
      update: async (id: string, p: Partial<FakeCustomer>) => {
        track("customers.update");
        const c = state.customers.get(id); if (!c) throw Object.assign(new Error(`No such customer: '${id}'`), { code: "resource_missing" });
        Object.assign(c, { ...p, metadata: { ...c.metadata, ...(p.metadata ?? {}) } }); return c;
      },
    },
    setupIntents: {
      create: async (p: { customer?: string; metadata?: Record<string, string> }) => {
        track("setupIntents.create");
        const id = state.next("seti");
        const si: FakeIntent = { id, object: "setup_intent", client_secret: `${id}_secret_${Math.random().toString(36).slice(2, 10)}`, status: "requires_payment_method", customer: p.customer ?? null, payment_method: null, metadata: { ...(p.metadata ?? {}) }, created: now() };
        state.intents.set(id, si); return si;
      },
      retrieve: async (id: string) => { track("setupIntents.retrieve"); const si = state.intents.get(id); if (!si) throw Object.assign(new Error(`No such setupintent: '${id}'`), { code: "resource_missing" }); return si; },
    },
    paymentIntents: {
      create: async (p: { customer?: string; metadata?: Record<string, string> }) => {
        track("paymentIntents.create");
        const id = state.next("pi");
        const pi: FakeIntent = { id, object: "payment_intent", client_secret: `${id}_secret_${Math.random().toString(36).slice(2, 10)}`, status: "requires_payment_method", customer: p.customer ?? null, payment_method: null, metadata: { ...(p.metadata ?? {}) }, created: now() };
        state.intents.set(id, pi); return pi;
      },
      retrieve: async (id: string) => { track("paymentIntents.retrieve"); const pi = state.intents.get(id); if (!pi) throw Object.assign(new Error(`No such payment_intent: '${id}'`), { code: "resource_missing" }); return pi; },
      update: async (id: string, p: { metadata?: Record<string, string> }) => { track("paymentIntents.update"); const pi = state.intents.get(id)!; pi.metadata = { ...pi.metadata, ...(p.metadata ?? {}) }; return pi; },
    },
    paymentMethods: {
      retrieve: async (id: string) => { track("paymentMethods.retrieve"); const m = state.methods.get(id); if (!m) throw Object.assign(new Error(`No such PaymentMethod: '${id}'`), { code: "resource_missing" }); return m; },
      list: async (p: { customer?: string }) => {
        track("paymentMethods.list");
        return { data: [...state.methods.values()].filter((m) => !p.customer || m.customer === p.customer).map((m) => ({ ...m, type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } })) };
      },
      attach: async (id: string, p: { customer: string }) => { track("paymentMethods.attach"); const m = state.methods.get(id); if (!m) throw new Error(`No such PaymentMethod: '${id}'`); m.customer = p.customer; return m; },
    },
    subscriptions: {
      list: async (p: { customer?: string; status?: string; limit?: number }) => { track("subscriptions.list"); return { data: [...state.subscriptions.values()].filter((s) => !p.customer || s.customer === p.customer) }; },
      retrieve: async (id: string) => { track("subscriptions.retrieve"); const s = state.subscriptions.get(id); if (!s) throw Object.assign(new Error(`No such subscription: '${id}'`), { code: "resource_missing" }); return s; },
      create: async (p: { customer: string; items: Array<{ price: string; quantity?: number }>; trial_end?: number; metadata?: Record<string, string>; default_payment_method?: string }) => {
        track("subscriptions.create");
        const t = now();
        const trialing = typeof p.trial_end === "number" && p.trial_end > t;
        const sub: FakeSubscription = {
          id: state.next("sub"), status: trialing ? "trialing" : "active", customer: p.customer, cancel_at_period_end: false, created: t,
          trial_end: trialing ? p.trial_end! : null, start_date: t, current_period_end: trialing ? p.trial_end! : t + 30 * 86400,
          items: { data: p.items.map((i, n) => ({ id: `si_fake${n}`, price: { id: i.price }, quantity: i.quantity ?? 1, metadata: {} })) },
          metadata: { ...(p.metadata ?? {}) }, default_payment_method: p.default_payment_method,
        };
        state.subscriptions.set(sub.id, sub); return sub;
      },
      update: async (id: string, p: Partial<FakeSubscription>) => { track("subscriptions.update"); const s = state.subscriptions.get(id)!; Object.assign(s, p); return s; },
      cancel: async (id: string) => { track("subscriptions.cancel"); const s = state.subscriptions.get(id)!; s.status = "canceled"; return s; },
    },
    invoices: { list: async () => { track("invoices.list"); return { data: [] as unknown[], has_more: false }; } },
    subscriptionItems: { create: async () => { track("subscriptionItems.create"); return {}; } },
    webhooks: undefined as unknown,
  };
  void live;

  // Tout ce qui n'est pas modelise echoue bruyamment.
  const guard = (obj: Record<string, unknown>, path: string): unknown =>
    new Proxy(obj, {
      get(target, prop: string) {
        if (typeof prop !== "string" || prop === "then" || prop === "toJSON") return undefined;
        if (prop in target) {
          const v = target[prop];
          return v && typeof v === "object" ? guard(v as Record<string, unknown>, `${path}${prop}.`) : v;
        }
        return async () => { throw new Error(`FAKE_STRIPE_UNIMPLEMENTED:${path}${prop}`); };
      },
    });
  return guard(impl as unknown as Record<string, unknown>, "");
}
