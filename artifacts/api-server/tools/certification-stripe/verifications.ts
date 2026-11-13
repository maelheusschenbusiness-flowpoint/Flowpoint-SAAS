/**
 * Calcul des verifications cote Stripe (TEST) pour UN e-mail de campagne.
 * Fonctions pures + un collecteur qui n'utilise qu'un sous-ensemble minimal du client Stripe
 * (donc remplacable par un faux client en memoire dans les tests unitaires).
 */

export const JOURS_ESSAI = 14;

export interface Verdict { nom: string; ok: boolean; detail: string }

export interface DonneesStripe {
  email: string;
  /** customers.list({ email }) : clients NON supprimes portant exactement cet e-mail. */
  clients: Array<{ id: string; email?: string | null; livemode?: boolean; invoice_settings?: { default_payment_method?: string | { id: string } | null } }>;
  /** Souscriptions (status: all) de ces clients. */
  souscriptions: Array<{
    id: string; customer: string; status: string; created: number; trial_end?: number | null; livemode?: boolean;
    default_payment_method?: string | { id: string } | null;
    items: { data: Array<{ price: { id: string }; quantity?: number | null }> };
    metadata?: Record<string, string>;
  }>;
  /** Souscriptions creees pendant la campagne dont le client porte (ou portait) cet e-mail, y compris autres clients. */
  souscriptionsRecentesDeLEmail: Array<{ id: string; customer: string; status: string }>;
  /** Moyen de paiement par defaut retrouve par l'API (id -> client rattache). */
  moyensDePaiement: Record<string, { id: string; customer?: string | null } | null>;
  /** Evenements de la campagne relatifs a ce client / ses intents. */
  evenements: Array<{ id: string; type: string; livemode?: boolean; pending_webhooks?: number; created: number }>;
}

export interface AttendusStripe {
  prixAttendu?: string;       // price_...
  quantiteAttendue?: number;  // 1 par defaut
  maintenant?: number;        // secondes unix (injectable pour les tests)
  toleranceEssaiSecondes?: number;
  evenementsRequis?: string[];
  /** Exiger pending_webhooks = 0 (endpoint enregistre cote Stripe : Mode R). Mode L : les evenements passent par `stripe listen`, non comptes ici ; preuve = journal du listener. */
  livraisonEndpoint?: boolean;
}

const EVENEMENTS_REQUIS_DEFAUT = ["setup_intent.succeeded", "customer.subscription.created"];

const idDe = (x: string | { id: string } | null | undefined): string | null => (typeof x === "string" ? x : x?.id ?? null);

export function calculerVerifications(d: DonneesStripe, a: AttendusStripe = {}): Verdict[] {
  const v: Verdict[] = [];
  const tol = a.toleranceEssaiSecondes ?? 6 * 3600;

  v.push({ nom: "mode TEST uniquement", ok: ![...d.clients, ...d.souscriptions, ...d.evenements].some((o) => o.livemode === true), detail: "aucun objet livemode=true" });

  v.push({ nom: "exactement UN customer pour l'e-mail", ok: d.clients.length === 1, detail: `${d.clients.length} customer(s) non supprime(s)` });
  const client = d.clients[0];
  const subs = client ? d.souscriptions.filter((s) => s.customer === client.id) : [];
  const vivantes = subs.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
  v.push({ nom: "exactement UNE souscription (non annulee)", ok: vivantes.length === 1, detail: `${vivantes.length} vivante(s) sur ${subs.length} au total (${subs.map((s) => s.status).join(",") || "aucune"})` });
  const sub = vivantes[0];

  if (sub) {
    v.push({ nom: "status = trialing", ok: sub.status === "trialing", detail: `status=${sub.status}` });
    const maintenant = a.maintenant ?? Math.floor(Date.now() / 1000);
    const attendu = sub.created + JOURS_ESSAI * 86400;
    const ecart = sub.trial_end ? Math.abs(sub.trial_end - attendu) : Number.POSITIVE_INFINITY;
    v.push({ nom: `trial_end ~ creation + ${JOURS_ESSAI} j`, ok: ecart <= tol, detail: sub.trial_end ? `ecart ${Math.round(ecart / 60)} min (tolerance ${Math.round(tol / 60)} min)` : "trial_end absent" });
    v.push({ nom: "trial_end dans le futur", ok: !!sub.trial_end && sub.trial_end > maintenant, detail: sub.trial_end ? `fin ${new Date(sub.trial_end * 1000).toISOString()}` : "absent" });
    const items = sub.items.data;
    v.push({ nom: "une seule ligne (plan)", ok: items.length === 1, detail: `${items.length} ligne(s)` });
    if (a.prixAttendu) v.push({ nom: "price attendu", ok: items.some((i) => i.price.id === a.prixAttendu), detail: `attendu ${a.prixAttendu}, present ${items.map((i) => i.price.id).join(",") || "aucun"}` });
    const q = a.quantiteAttendue ?? 1;
    v.push({ nom: "quantite attendue", ok: items.every((i) => (i.quantity ?? 1) === q), detail: `attendue ${q}, presente ${items.map((i) => i.quantity ?? 1).join(",")}` });
    const pmId = idDe(sub.default_payment_method) ?? idDe(client?.invoice_settings?.default_payment_method);
    const pm = pmId ? d.moyensDePaiement[pmId] ?? null : null;
    v.push({ nom: "moyen de paiement par defaut attache au customer", ok: !!pmId && !!pm && pm.customer === client!.id, detail: pmId ? (pm ? `pm rattache a ${pm.customer ?? "personne"}` : "pm introuvable") : "aucun moyen de paiement par defaut" });
  }

  const orphelines = d.souscriptionsRecentesDeLEmail.filter((s) => !client || s.customer !== client.id).filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
  v.push({ nom: "aucune souscription orpheline", ok: orphelines.length === 0, detail: orphelines.length ? orphelines.map((s) => `${s.id}(${s.status},${s.customer})`).join(" ") : "aucune" });

  const requis = a.evenementsRequis ?? EVENEMENTS_REQUIS_DEFAUT;
  for (const t of requis) {
    const presents = d.evenements.filter((e) => e.type === t);
    v.push({ nom: `evenement ${t} emis`, ok: presents.length > 0, detail: `${presents.length} evenement(s)` });
  }
  const enAttente = d.evenements.filter((e) => (e.pending_webhooks ?? 0) > 0);
  if (a.livraisonEndpoint !== false) v.push({
    nom: "evenements livres (pending_webhooks = 0)",
    ok: d.evenements.length > 0 && enAttente.length === 0,
    detail: d.evenements.length === 0 ? "aucun evenement trouve" : enAttente.length ? `${enAttente.length} en attente/echec : ${enAttente.map((e) => e.id).join(",")}` : `${d.evenements.length} evenement(s) tous livres`,
  });
  return v;
}

export const toutEstOk = (vs: Verdict[]): boolean => vs.every((x) => x.ok);

/** Sous-ensemble du client Stripe utilise (le vrai SDK ou un faux en memoire). */
export interface ClientStripeMinimal {
  balance: { retrieve(): Promise<{ livemode?: boolean }> };
  customers: { list(p: Record<string, unknown>): AsyncIterable<any> & PromiseLike<any> };
  subscriptions: { list(p: Record<string, unknown>): AsyncIterable<any> & PromiseLike<any> };
  paymentMethods: { retrieve(id: string): Promise<any> };
  events: { list(p: Record<string, unknown>): AsyncIterable<any> & PromiseLike<any> };
}

async function toutLire<T>(it: AsyncIterable<T>, max = 1000): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) { out.push(x); if (out.length >= max) break; }
  return out;
}

/** Evenement relatif au client : son objet, ou une propriete `customer`, ou ses intents/souscriptions. */
function evenementConcerne(e: any, clientIds: Set<string>, intentIds: Set<string>): boolean {
  const o = e?.data?.object ?? {};
  if (clientIds.has(o.id) || clientIds.has(typeof o.customer === "string" ? o.customer : o.customer?.id)) return true;
  if (intentIds.has(o.id)) return true;
  return false;
}

export async function collecterDonnees(stripe: ClientStripeMinimal, email: string, depuis: number, intentsExplicites: string[] = []): Promise<DonneesStripe> {
  const clients = await toutLire<any>(stripe.customers.list({ email, limit: 100 }) as AsyncIterable<any>);
  // Anciens clients du meme e-mail (y compris autres clients) : listing recent filtre cote client.
  const recents = await toutLire<any>(stripe.customers.list({ created: { gte: depuis }, limit: 100 }) as AsyncIterable<any>);
  const memeEmail = recents.filter((c) => (c.email ?? "").toLowerCase() === email.toLowerCase());
  const tousClients = new Map<string, any>([...clients, ...memeEmail].map((c) => [c.id, c]));
  const souscriptions: any[] = [];
  for (const c of tousClients.values()) {
    souscriptions.push(...(await toutLire<any>(stripe.subscriptions.list({ customer: c.id, status: "all", limit: 100 }) as AsyncIterable<any>)));
  }
  const moyens: Record<string, any> = {};
  for (const s of souscriptions) {
    const id = idDe(s.default_payment_method);
    if (id && !(id in moyens)) moyens[id] = await stripe.paymentMethods.retrieve(id).catch(() => null);
  }
  for (const c of clients) {
    const id = idDe(c.invoice_settings?.default_payment_method);
    if (id && !(id in moyens)) moyens[id] = await stripe.paymentMethods.retrieve(id).catch(() => null);
  }
  const events = await toutLire<any>(stripe.events.list({ created: { gte: depuis }, limit: 100 }) as AsyncIterable<any>, 2000);
  const clientIds = new Set([...tousClients.keys()]);
  // Un SetupIntent cree avant le customer (inscription) n'a pas toujours `customer` : on le rattache aussi
  // par son moyen de paiement (le meme que la souscription), ou par un id passe explicitement (--intent).
  const pmIds = new Set(Object.keys(moyens));
  const intentIds = new Set<string>(intentsExplicites);
  for (const e of events) {
    const o = e?.data?.object;
    if (!o || typeof o.id !== "string" || !/^seti_/.test(o.id)) continue;
    const cus = typeof o.customer === "string" ? o.customer : o.customer?.id;
    const pm = typeof o.payment_method === "string" ? o.payment_method : o.payment_method?.id;
    if ((cus && clientIds.has(cus)) || (pm && pmIds.has(pm))) intentIds.add(o.id);
  }
  const concernes = events.filter((e) => evenementConcerne(e, clientIds, intentIds));
  return {
    email,
    clients: clients as DonneesStripe["clients"],
    souscriptions,
    souscriptionsRecentesDeLEmail: souscriptions.map((s) => ({ id: s.id, customer: s.customer, status: s.status })),
    moyensDePaiement: moyens,
    evenements: concernes.map((e) => ({ id: e.id, type: e.type, livemode: e.livemode, pending_webhooks: e.pending_webhooks, created: e.created })),
  };
}

/** Cas negatif (3DS abandonne, carte refusee) : aucune souscription vivante, au plus un customer. */
export function calculerAbsenceSouscription(d: DonneesStripe): Verdict[] {
  const vivantes = d.souscriptions.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
  return [
    { nom: "mode TEST uniquement", ok: ![...d.clients, ...d.souscriptions].some((o) => o.livemode === true), detail: "aucun objet livemode=true" },
    { nom: "aucune souscription vivante", ok: vivantes.length === 0, detail: `${vivantes.length} vivante(s) : ${vivantes.map((s) => `${s.id}(${s.status})`).join(",") || "aucune"}` },
    { nom: "au plus un customer pour l'e-mail", ok: d.clients.length <= 1, detail: `${d.clients.length} customer(s)` },
  ];
}
