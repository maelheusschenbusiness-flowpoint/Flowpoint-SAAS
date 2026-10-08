/**
 * Faits commerciaux d'un evenement Stripe verifie, pour le calendrier Croissance.
 *
 * Module pur : aucun acces reseau, aucune base, aucune cle. Il traduit un
 * evenement Stripe DEJA verifie et DEJA traite en un jour ouvre et quelques
 * compteurs. L'appelant les inscrit dans `billing_events.metadata`, qui est
 * unique par `stripe_event_id` : un webhook recu dix fois ne peut donc pas
 * doubler un chiffre, sans qu'aucune table nouvelle soit necessaire.
 *
 * Ce module ne decide RIEN sur la facturation. Il ne cree, ne modifie et
 * n'annule aucun abonnement, aucun paiement, aucune commission. Il compte.
 *
 * Les distinctions qu'il tient, parce que les confondre donnerait un tableau de
 * bord qui ment :
 *
 *   - Une inscription n'est pas un essai, un essai n'est pas un client payant.
 *     `clients_new` ne compte que l'abonnement qui FACTURE. Un abonnement qui
 *     nait en essai donne `trials_started`, et rien d'autre : il ne rapporte pas
 *     encore un euro.
 *   - Une resiliation PROGRAMMEE n'est pas une perte. Stripe la signale par
 *     `cancel_at_period_end` sur un `updated`, et l'abonnement continue de
 *     facturer jusqu'au terme. La perte, c'est `customer.subscription.deleted`,
 *     que Stripe emet au terme effectif.
 *   - Un changement de formule n'est ni un nouveau client ni une perte. C'est un
 *     ecart de revenu, calcule contre `previous_attributes`.
 *   - Le MRR n'est pas l'encaisse. Il se lit sur les lignes de l'abonnement,
 *     jamais sur le montant d'une facture : une facture annuelle encaisse douze
 *     mois d'un coup, et une facture a 0 EUR n'encaisse rien tout en laissant le
 *     revenu recurrent intact. Aucun evenement de facture ne touche donc au MRR,
 *     ce qui ecarte d'un seul coup la facture a 0 EUR, le paiement d'add-on seul
 *     et le paiement echoue.
 *   - Un add-on n'est pas un abonnement principal. L'appelant le reconnait par
 *     les marqueurs deja en place et nous le dit.
 */

/** Les metriques du calendrier. Toute autre cle serait refusee par la base AI Lab. */
export type GrowthMetric =
  | "clients_new" | "clients_churned"
  | "trials_started" | "trials_converted"
  | "mrr_gained_cents" | "mrr_lost_cents";

export interface GrowthFacts {
  /** Jour ouvre, fuseau Europe/Brussels. */
  day: string;
  facts: Partial<Record<GrowthMetric, number>>;
}

export interface GrowthInput {
  type: string;
  obj: Record<string, unknown>;
  /** `event.data.previous_attributes` : ce que Stripe dit avoir change. */
  previousAttributes?: Record<string, unknown> | undefined;
  /** `event.created`, en secondes. La date metier vient de la, pas de l'horloge locale. */
  createdUnix: number;
  /** L'abonnement porte-t-il un marqueur d'add-on ? (decide par l'appelant) */
  isAddon: boolean;
  /** Est-ce un abonnement de PLAN ? (`parsePlanFromSubscription` chez l'appelant) */
  isPlanSub: boolean;
}

/**
 * Les etats dans lesquels un abonnement facture reellement. `trialing` n'en est
 * pas : il facturera, il ne facture pas encore.
 */
const BILLING_STATUSES = new Set(["active", "past_due"]);
/** Les etats dans lesquels un abonnement qui nait est une entree valide. */
const LIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

// Un formateur est couteux a construire : on le garde.
const BRUSSELS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * Le jour ouvre d'un evenement, en Europe/Brussels.
 *
 * C'est la date de l'EVENEMENT, pas celle de sa reception : un webhook rejoue
 * trois jours plus tard doit retomber sur sa journee d'origine, sinon le
 * calendrier raconte une histoire fausse et un rattrapage deplacerait les
 * chiffres.
 */
export function businessDay(createdUnix: number): string | null {
  if (typeof createdUnix !== "number" || !Number.isFinite(createdUnix)) return null;
  const d = new Date(createdUnix * 1000);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA donne AAAA-MM-JJ.
  const day = BRUSSELS.format(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

interface SubItem {
  quantity?: unknown;
  price?: { unit_amount?: unknown; recurring?: { interval?: unknown; interval_count?: unknown } };
}

/**
 * Combien ces lignes d'abonnement rapportent par mois, en centimes.
 *
 * Normalise l'intervalle : un abonnement annuel a 120 EUR vaut 10 EUR de MRR, pas
 * 120. Une ligne sans `recurring` est un achat ponctuel et ne compte pas — c'est
 * la frontiere entre revenu recurrent et paiement unique.
 */
export function monthlyRecurringCents(obj: Record<string, unknown>): number {
  const items = (obj["items"] as { data?: SubItem[] } | undefined)?.data ?? [];
  let total = 0;
  for (const item of items) {
    const price = item?.price;
    const amount = Number(price?.unit_amount ?? NaN);
    const recurring = price?.recurring;
    if (!Number.isFinite(amount) || !recurring) continue;
    const count = Number(recurring.interval_count ?? 1);
    const per = Number.isFinite(count) && count > 0 ? count : 1;
    const quantity = Number(item?.quantity ?? 1);
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    let perMonth: number;
    switch (String(recurring.interval ?? "")) {
      case "month": perMonth = 1 / per; break;
      case "year": perMonth = 1 / (12 * per); break;
      case "week": perMonth = 52 / (12 * per); break;
      case "day": perMonth = 365 / (12 * per); break;
      default: continue; // intervalle inconnu : on ne devine pas
    }
    total += amount * qty * perMonth;
  }
  return Math.round(total);
}

const add = (f: Partial<Record<GrowthMetric, number>>, k: GrowthMetric, v: number) => {
  if (v !== 0) f[k] = (f[k] ?? 0) + v;
};

/** Repartit un ecart de revenu dans la bonne metrique : un MRR ne se saisit jamais en negatif. */
function applyDelta(facts: Partial<Record<GrowthMetric, number>>, deltaCents: number): void {
  if (deltaCents > 0) add(facts, "mrr_gained_cents", deltaCents);
  else if (deltaCents < 0) add(facts, "mrr_lost_cents", -deltaCents);
}

/**
 * Les faits commerciaux que prouve cet evenement, ou `null` quand il n'en prouve
 * aucun. `null` et « zero » ne sont pas la meme chose : une journee sans fait
 * reste vide dans le calendrier, elle n'est jamais affichee a zero.
 */
export function growthFactsFor(input: GrowthInput): GrowthFacts | null {
  const { type, obj, previousAttributes, isAddon, isPlanSub } = input;
  const day = businessDay(input.createdUnix);
  if (!day) return null;
  // Un add-on n'entre dans aucun compteur. Les add-ons recurrents meriteraient
  // leur propre metrique, mais la base AI Lab n'en connait pas : inventer une
  // cle la ferait refuser, et les fondre dans le MRR du plan melangerait deux
  // realites. Ils sont donc exclus, et le rapport le dit.
  if (isAddon) return null;

  const facts: Partial<Record<GrowthMetric, number>> = {};
  const status = String(obj["status"] ?? "");

  if (type === "customer.subscription.created") {
    if (!isPlanSub || !LIVE_STATUSES.has(status)) return null;
    if (status === "trialing") {
      // Un essai commence. Il ne rapporte rien encore, et ce n'est pas un client.
      add(facts, "trials_started", 1);
    } else {
      // Paiement d'emblee : client payant, et le revenu recurrent demarre.
      add(facts, "clients_new", 1);
      applyDelta(facts, monthlyRecurringCents(obj));
    }
    return Object.keys(facts).length ? { day, facts } : null;
  }

  if (type === "customer.subscription.updated") {
    if (!isPlanSub) return null;
    const prev = previousAttributes ?? {};
    const prevStatus = String(prev["status"] ?? "");

    // Un essai qui devient payant : c'est LA conversion commerciale, et le
    // moment ou le revenu recurrent commence. On ne la lit pas sur une facture :
    // une facture annuelle ou a 0 EUR dirait un autre montant.
    if (prevStatus === "trialing" && BILLING_STATUSES.has(status)) {
      add(facts, "trials_converted", 1);
      add(facts, "clients_new", 1);
      applyDelta(facts, monthlyRecurringCents(obj));
      return { day, facts };
    }

    // Changement de formule ou de quantite : un ECART, jamais un client de plus
    // ni un client perdu. On ne le calcule que si Stripe dit que les lignes ont
    // change — sans `previous_attributes.items`, on n'a aucun avant fiable et
    // deviner donnerait un faux ecart.
    if (prev["items"] !== undefined && BILLING_STATUSES.has(status)) {
      const before = monthlyRecurringCents({ items: prev["items"] });
      applyDelta(facts, monthlyRecurringCents(obj) - before);
      return Object.keys(facts).length ? { day, facts } : null;
    }

    // Tout le reste — dont `cancel_at_period_end` qui passe a vrai — ne prouve
    // rien. Une resiliation programmee facture encore ; la perte sera comptee au
    // terme, sur `customer.subscription.deleted`.
    return null;
  }

  if (type === "customer.subscription.deleted") {
    // Le terme effectif. Stripe n'emet cet evenement qu'une fois l'abonnement
    // reellement termine, qu'il ait ete programme ou annule sur le champ.
    if (!isPlanSub) return null;
    add(facts, "clients_churned", 1);
    applyDelta(facts, -monthlyRecurringCents(obj));
    return { day, facts };
  }

  // Aucun evenement de facture ne produit de fait : ni `invoice.payment_succeeded`
  // (encaisse, pas MRR), ni `invoice.payment_failed` (un echec ne convertit rien),
  // ni `payment_intent.*` (ponctuel). La facture a 0 EUR et le paiement d'add-on
  // seul sont ainsi ecartes par construction, pas par une garde a maintenir.
  return null;
}
