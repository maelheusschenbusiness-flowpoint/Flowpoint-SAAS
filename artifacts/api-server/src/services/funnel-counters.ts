/**
 * funnel-counters.ts — compteurs AGREGES et ANONYMES du tunnel, en lecture seule.
 *
 * Ce que la lecture rend : des COMPTES, par jour, par etape, par source et par
 * plan, separes en deux familles qui ne s'additionnent jamais ; le compteur des
 * evenements refuses cote SaaS (par motif) ; la sante de la livraison vers AI
 * Lab par etape. Jamais un identifiant de visiteur, un email, un `fp_lid` ni un
 * identifiant Stripe : les requetes ne SELECTionnent que des agregats, et les
 * valeurs libres (`plan`, `source`) sont ramenees a une liste fermee.
 *
 * DEUX FAMILLES, A NE JAMAIS ADDITIONNER.
 *  - `consent_gated` : evenements soumis au consentement analytique
 *    (`fp_analytics_consent=accepted`, `fp_vid`, source). Un visiteur qui refuse
 *    n'y laisse AUCUNE trace : ces comptes sont un MINIMUM, pas la population.
 *  - `transactional` : evenements issus des webhooks Stripe signes (essai,
 *    abonnement, paiement). Comptes pour tout le monde, sans consentement.
 * Une etape appartient a une seule famille (`FAMILLE_PAR_ETAPE`), et un test
 * verifie que toute etape de `ETAPES_TUNNEL` est classee : une etape ajoutee
 * sans famille fait echouer la CI au lieu de glisser dans la mauvaise.
 *
 * Doublons : on compte des evenements DISTINCTS (cle d'idempotence, a defaut la
 * ligne) et des visiteurs distincts ; les visiteurs de test (`fp-test-*`) sont
 * exclus, comme dans `conversion-dashboards.ts`.
 */
import type { Query } from "./conversion-dashboards.js";

export type Famille = "consent_gated" | "transactional" | "unclassified";

/**
 * Etapes soumises au consentement : navigateur, et etapes serveur qui ne sont
 * ecrites que si le visiteur a consenti. Etapes transactionnelles : Stripe signe.
 * Les noms de la branche de production (`signup_submitted`, `signup_failed`,
 * `payment_*`) sont classes d'avance ; une etape inconnue est `unclassified`.
 */
export const FAMILLE_PAR_ETAPE: Readonly<Record<string, Famille>> = {
  landing_vue: "consent_gated",
  tarifs_vus: "consent_gated",
  cta_clique: "consent_gated",
  signup_started: "consent_gated",
  signup_form_engaged: "consent_gated",
  signup_submitted: "consent_gated",
  signup_failed: "consent_gated",
  signup_form_completed: "consent_gated",
  checkout_started: "consent_gated",
  checkout_completed: "consent_gated",
  checkout_payment_failed: "consent_gated",
  trial_activated: "transactional",
  trial_expired: "transactional",
  subscription_activated: "transactional",
  payment_succeeded: "transactional",
  payment_failed: "transactional",
};

export const PLANS = ["standard", "pro", "ultra"] as const;
export const SOURCES = ["smartlead", "google", "direct", "social", "other_campaign"] as const;

export const famille = (etape: string): Famille => FAMILLE_PAR_ETAPE[etape] ?? "unclassified";

/** Meme exclusion que les tableaux de bord : les visiteurs de test ne comptent pas. */
export const FILTRE_TEST = `(visiteur_id IS NULL OR visiteur_id NOT LIKE 'fp-test-%')`;
/** Une valeur libre ramenee a une liste fermee : jamais de texte d'appelant en sortie. */
const casePlan = `CASE WHEN plan IS NULL THEN 'unknown' WHEN plan IN ('standard','pro','ultra') THEN plan ELSE 'other' END`;
const caseSource = `CASE WHEN source IS NULL THEN 'unknown'
  WHEN source IN ('smartlead','google','direct','social','other_campaign') THEN source ELSE 'other' END`;
const EVENTS = `count(DISTINCT COALESCE(cle_idempotence, id::text))::int`;

export interface Cellule { etape: string; famille: Famille; events: number; visitors: number }
export interface LigneJour extends Cellule { day: string }

const n = (v: unknown): number => Number(v ?? 0);
const jour = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

const estTableAbsente = (err: unknown): boolean => (err as { code?: string })?.code === "42P01";

async function lireJours(query: Query, from: Date, to: Date): Promise<LigneJour[]> {
  const r = await query(
    `SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, etape,
            ${EVENTS} AS events, count(DISTINCT visiteur_id)::int AS visitors
       FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND ${FILTRE_TEST}
      GROUP BY 1, 2 ORDER BY 1, 2`, [from.toISOString(), to.toISOString()]);
  return r.rows.map(x => ({
    day: jour(x["day"]), etape: String(x["etape"]), famille: famille(String(x["etape"])),
    events: n(x["events"]), visitors: n(x["visitors"]),
  }));
}

async function lireVentilation(query: Query, from: Date, to: Date, colonne: "source" | "plan") {
  const expr = colonne === "source" ? caseSource : casePlan;
  const r = await query(
    `SELECT ${expr} AS valeur, etape, ${EVENTS} AS events, count(DISTINCT visiteur_id)::int AS visitors
       FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND ${FILTRE_TEST}
      GROUP BY 1, 2 ORDER BY 1, 2`, [from.toISOString(), to.toISOString()]);
  return r.rows.map(x => ({
    value: String(x["valeur"]), etape: String(x["etape"]), famille: famille(String(x["etape"])),
    events: n(x["events"]), visitors: n(x["visitors"]),
  }));
}

/**
 * Part des evenements TRANSACTIONNELS qui portent un visiteur consenti
 * (`visiteur_id` non nul). Mesure de couverture du consentement parmi les
 * conversions reelles : si 1 essai sur 4 seulement est relie a un visiteur, les
 * comptes `consent_gated` voient environ un quart du tunnel qui precede.
 * `null` sans evenement. Ne vaut que si la branche conserve le visiteur sur ces
 * lignes (c'est le cas ici) : une branche qui le retire lit 0 %, pas une erreur.
 */
async function lireCouverture(query: Query, from: Date, to: Date) {
  const r = await query(
    `SELECT count(DISTINCT COALESCE(cle_idempotence, id::text))::int AS total,
            count(DISTINCT COALESCE(cle_idempotence, id::text)) FILTER (WHERE visiteur_id IS NOT NULL)::int AS avec_visiteur
       FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND ${FILTRE_TEST}
        AND etape = ANY($3::text[])`,
    [from.toISOString(), to.toISOString(),
      Object.entries(FAMILLE_PAR_ETAPE).filter(([, f]) => f === "transactional").map(([e]) => e)]);
  const total = n(r.rows[0]?.["total"]);
  const lie = n(r.rows[0]?.["avec_visiteur"]);
  return {
    transactionalEvents: total,
    withConsentedVisitor: lie,
    ratio: total === 0 ? null : Math.round((lie / total) * 10000) / 10000,
    meaning: "Share of transactional events (Stripe-signed trial/subscription/payment) linked to a consenting visitor. "
      + "consent_gated counts only see that share of the funnel upstream.",
  };
}

async function lireRejetsSaaS(query: Query, from: Date, to: Date) {
  try {
    const r = await query(
      `SELECT to_char(jour, 'YYYY-MM-DD') AS day, motif, total::bigint AS total
         FROM funnel_event_rejections WHERE jour >= $1::date AND jour < $2::date ORDER BY jour, motif`,
      [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]);
    const parMotif: Record<string, number> = {};
    for (const x of r.rows) parMotif[String(x["motif"])] = (parMotif[String(x["motif"])] ?? 0) + n(x["total"]);
    return {
      status: "observed" as const,
      byReason: parMotif,
      daily: r.rows.map(x => ({ day: jour(x["day"]), reason: String(x["motif"]), count: n(x["total"]) })),
      note: "unknown_stage and missing_visitor_id answered HTTP 400; consent_missing (no 'accepted' consent or invalid visitor id) "
        + "and storage_error (valid event, write failed) answered 204. Counting started when this counter was deployed.",
    };
  } catch (err) {
    return { status: estTableAbsente(err) ? ("not_initialized" as const) : ("unavailable" as const) };
  }
}

interface LivraisonEtape {
  delivered: number; pending: number; retryingAfter400: number;
  rejected400Exhausted: number; rejectedOther: number;
}

/**
 * Livraison vers AI Lab, PAR ETAPE. La file ne garde pas le motif du 400 (AI
 * Lab ne le restitue pas) : `rejected400Exhausted` regroupe donc tous les 400
 * epuises, dont `unknown_fp_lid` selon le journal du moteur d'acquisition.
 */
async function lireLivraison(query: Query, from: Date, to: Date) {
  try {
    const r = await query(
      `SELECT stage, status, coalesce(last_status, '') AS last_status, count(*)::int AS n
         FROM conversion_event_outbox WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [from.toISOString(), to.toISOString()]);
    const parEtape: Record<string, LivraisonEtape> = {};
    for (const x of r.rows) {
      const e = (parEtape[String(x["stage"])] ??= {
        delivered: 0, pending: 0, retryingAfter400: 0, rejected400Exhausted: 0, rejectedOther: 0,
      });
      const c = n(x["n"]);
      const st = String(x["status"]);
      const last = String(x["last_status"]);
      if (st === "delivered") e.delivered += c;
      else if (st === "pending") { e.pending += c; if (last === "rejected:400") e.retryingAfter400 += c; }
      else if (st === "rejected") { if (last === "rejected:400:exhausted") e.rejected400Exhausted += c; else e.rejectedOther += c; }
    }
    return {
      status: "observed" as const,
      byStage: parEtape,
      reasonRecorded: false,
      note: "AI Lab stages (visit, signup_page, signup_started, signup, checkout, trial, paid), not funnel_events stages. "
        + "The outbox does not store the 400 reason; fp_lid is erased when a row closes.",
    };
  } catch (err) {
    return { status: estTableAbsente(err) ? ("not_initialized" as const) : ("unavailable" as const) };
  }
}

export interface CompteursTunnel {
  view: "counters";
  families: Record<Exclude<Famille, "unclassified">, { definition: string; stages: Array<{ etape: string; events: number; visitors: number }> }>;
  unclassified: Array<{ etape: string; events: number; visitors: number }>;
  daily: LigneJour[];
  bySource: ReturnType<typeof ventiler>;
  byPlan: ReturnType<typeof ventiler>;
  dimensionsUnavailable: { campaign: string; language: string };
  consentCoverage: Awaited<ReturnType<typeof lireCouverture>>;
  rejections: { saasPublicEndpoint: Awaited<ReturnType<typeof lireRejetsSaaS>>; aiLabDelivery: Awaited<ReturnType<typeof lireLivraison>> };
  note: string;
}

type Ventilation = Awaited<ReturnType<typeof lireVentilation>>;
function ventiler(lignes: Ventilation) {
  const sortie: Record<string, Record<Famille, Record<string, { events: number; visitors: number }>>> = {};
  for (const l of lignes) {
    const v = (sortie[l.value] ??= { consent_gated: {}, transactional: {}, unclassified: {} });
    v[l.famille][l.etape] = { events: l.events, visitors: l.visitors };
  }
  return sortie;
}

/**
 * Les comptes par etape sur TOUTE la fenetre viennent d'une requete dediee :
 * additionner les visiteurs distincts de chaque jour compterait deux fois celui
 * qui revient.
 */
async function lireEtapesFenetre(query: Query, from: Date, to: Date) {
  const r = await query(
    `SELECT etape, ${EVENTS} AS events, count(DISTINCT visiteur_id)::int AS visitors
       FROM funnel_events WHERE created_at >= $1 AND created_at < $2 AND ${FILTRE_TEST}
      GROUP BY etape ORDER BY etape`, [from.toISOString(), to.toISOString()]);
  return r.rows.map(x => ({ etape: String(x["etape"]), events: n(x["events"]), visitors: n(x["visitors"]) }));
}

export async function compteursTunnel(query: Query, from: Date, to: Date): Promise<CompteursTunnel> {
  const [daily, etapes, source, plan, couverture, rejetsSaaS, livraison] = await Promise.all([
    lireJours(query, from, to),
    lireEtapesFenetre(query, from, to),
    lireVentilation(query, from, to, "source"),
    lireVentilation(query, from, to, "plan"),
    lireCouverture(query, from, to),
    lireRejetsSaaS(query, from, to),
    lireLivraison(query, from, to),
  ]);
  const de = (f: Famille) => etapes.filter(e => famille(e.etape) === f);
  return {
    view: "counters",
    families: {
      consent_gated: {
        definition: "Events subject to analytics consent (cookie fp_analytics_consent=accepted, visitor id fp_vid, source). "
          + "Visitors who decline leave no trace: these counts are a lower bound of real traffic.",
        stages: de("consent_gated"),
      },
      transactional: {
        definition: "Events from signed Stripe webhooks (trial, subscription, payment). Counted for everyone, without consent.",
        stages: de("transactional"),
      },
    },
    unclassified: de("unclassified"),
    daily,
    bySource: ventiler(source),
    byPlan: ventiler(plan),
    dimensionsUnavailable: {
      campaign: "not stored in funnel_events on this branch (UTM campaign attribution lives on the production branch only)",
      language: "not stored in funnel_events on any branch",
    },
    consentCoverage: couverture,
    rejections: { saasPublicEndpoint: rejetsSaaS, aiLabDelivery: livraison },
    note: "The two families are never added together: they have different coverage. Every figure is a count; "
      + "no visitor identifier, email or fp_lid is read or returned.",
  };
}
