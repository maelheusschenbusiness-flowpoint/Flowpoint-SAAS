/**
 * funnel-before-after.ts — comparaison AVANT/APRES d'un changement, en lecture seule.
 *
 * METHODE (detaillee dans docs/CONVERSION-COMPARAISON-AVANT-APRES.md).
 *  - Fenetres de MEME longueur : `days` jours avant la date de mise en production
 *    (`[change-days, change)`) et `days` jours apres (`[change, change+days)`),
 *    bornes UTC. La fenetre « apres » est tronquee a l'instant de la lecture et
 *    declaree incomplete (`complete: false`), jamais completee par des zeros.
 *  - Famille `consent_gated` : deduplication par VISITEUR (un visiteur compte une
 *    fois par etape sur la fenetre) et par visiteur-jour. Un taux d'une etape a
 *    la suivante est une COHORTE : visiteurs ayant les deux etapes / visiteurs
 *    ayant la premiere, dans la meme fenetre. Un visiteur qui n'a vu qu'une
 *    etape plus loin (arrivee directe, sans clic tarifs) n'entre pas dans le
 *    numerateur.
 *  - Famille `transactional` : evenements Stripe distincts (cle d'idempotence),
 *    comptes pour tout le monde. Jamais additionnee a l'autre famille, jamais
 *    divisee par elle : couvertures differentes.
 *  - Petits echantillons : chaque taux porte un intervalle de Wilson a 95 % et
 *    est marque `insufficient_sample` sous `MIN_DENOMINATEUR` visiteurs ; on ne
 *    conclut jamais a une amelioration dont les intervalles se recouvrent.
 *  - Aucun identifiant : seuls des comptes sortent. Visiteurs de test exclus.
 */
import type { Query } from "./conversion-dashboards.js";
import { ETAPES_TUNNEL } from "./funnel-events.js";
import { FILTRE_TEST } from "./funnel-counters.js";

/** Chaine du tunnel navigateur, dans l'ordre. Une etape absente de `ETAPES_TUNNEL` est declaree non instrumentee. */
export const CHAINE_CONSENTEMENT = [
  "tarifs_vus", "cta_clique", "signup_started", "signup_submitted",
  "signup_form_completed", "checkout_started", "checkout_completed",
] as const;

/** Etapes transactionnelles lues (comptes distincts, sans visiteur). */
export const ETAPES_TRANSACTIONNELLES = ["trial_activated", "subscription_activated", "payment_succeeded"] as const;

/** Sous ce nombre de visiteurs au denominateur, un taux n'est pas comparable. */
export const MIN_DENOMINATEUR = 30;
export const JOURS_MAX = 60;
const JOUR_MS = 86_400_000;

export interface Intervalle { low: number; high: number }

/** Intervalle de Wilson a 95 % d'une proportion k/n (arrondi a 4 decimales). */
export function wilson(k: number, n: number): Intervalle | null {
  if (n <= 0) return null;
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const marge = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  const r = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 10000) / 10000;
  return { low: r(centre - marge), high: r(centre + marge) };
}

export interface FenetreLue {
  from: string; to: string; days: number; complete: boolean;
}
export interface EtapeVisiteurs { etape: string; visitors: number; visitorDays: number; paired: number | null }
export interface Transactionnel { etape: string; events: number; withConsentedVisitor: number }
export interface MesureFenetre {
  window: FenetreLue;
  consentGated: EtapeVisiteurs[];
  transactional: Transactionnel[];
}

export interface Taux {
  from: string; to: string;
  before: { numerator: number; denominator: number; ratio: number | null; ci95: Intervalle | null };
  after: { numerator: number; denominator: number; ratio: number | null; ci95: Intervalle | null };
  deltaPoints: number | null;
  verdict: "insufficient_sample" | "intervals_overlap" | "difference_outside_intervals" | "no_data";
}

export interface AvantApres {
  view: "before-after";
  change: string;
  days: number;
  before: MesureFenetre;
  after: MesureFenetre;
  notInstrumented: string[];
  rates: Taux[];
  minDenominator: number;
  caveats: string[];
}

/** AAAA-MM-JJ valide (UTC), ou null. */
export function parseJour(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return d.toISOString().slice(0, 10) === v ? d : null;
}

const n = (v: unknown): number => Number(v ?? 0);

async function mesurer(query: Query, from: Date, to: Date, chaine: string[], complete: boolean, days: number): Promise<MesureFenetre> {
  const window: FenetreLue = { from: from.toISOString(), to: to.toISOString(), days, complete };
  if (to.getTime() <= from.getTime()) return { window, consentGated: chaine.map(e => ({ etape: e, visitors: 0, visitorDays: 0, paired: null })), transactional: [] };

  // Visiteurs distincts et visiteurs-jours distincts par etape (dedup visiteur+etape+jour).
  const etapes = await query(
    `SELECT etape, count(DISTINCT visiteur_id)::int AS visitors,
            count(DISTINCT (visiteur_id, (created_at AT TIME ZONE 'UTC')::date))::int AS visitor_days
       FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND visiteur_id IS NOT NULL AND ${FILTRE_TEST}
        AND etape = ANY($3::text[]) GROUP BY etape`,
    [from.toISOString(), to.toISOString(), chaine]);
  const parEtape = new Map(etapes.rows.map(r => [String(r["etape"]), r]));

  // Cohorte : visiteurs ayant l'etape k ET l'etape k-1 dans la fenetre.
  let paired: Array<number | null> = chaine.map(() => null);
  if (chaine.length > 1) {
    const filtres = chaine.slice(1).map((_, i) => `count(*) FILTER (WHERE $${i + 4} = ANY(e) AND $${i + 3} = ANY(e))::int AS p${i + 1}`);
    const r = await query(
      `WITH v AS (
         SELECT visiteur_id, array_agg(DISTINCT etape) AS e FROM funnel_events
          WHERE created_at >= $1 AND created_at < $2 AND visiteur_id IS NOT NULL AND ${FILTRE_TEST}
            AND etape = ANY($${chaine.length + 3}::text[]) GROUP BY visiteur_id)
       SELECT ${filtres.join(", ")} FROM v`,
      [from.toISOString(), to.toISOString(), ...chaine, chaine]);
    paired = [null, ...chaine.slice(1).map((_, i) => n(r.rows[0]?.[`p${i + 1}`]))];
  }

  const transacts = await query(
    `SELECT etape, count(DISTINCT COALESCE(cle_idempotence, id::text))::int AS events,
            count(DISTINCT COALESCE(cle_idempotence, id::text)) FILTER (WHERE visiteur_id IS NOT NULL)::int AS avec_visiteur
       FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND ${FILTRE_TEST} AND etape = ANY($3::text[]) GROUP BY etape`,
    [from.toISOString(), to.toISOString(), [...ETAPES_TRANSACTIONNELLES]]);
  const tr = new Map(transacts.rows.map(r => [String(r["etape"]), r]));

  return {
    window,
    consentGated: chaine.map((e, i) => ({
      etape: e, visitors: n(parEtape.get(e)?.["visitors"]), visitorDays: n(parEtape.get(e)?.["visitor_days"]), paired: paired[i] ?? null,
    })),
    transactional: ETAPES_TRANSACTIONNELLES.filter(e => ETAPES_TUNNEL.includes(e as never)).map(e => ({
      etape: e, events: n(tr.get(e)?.["events"]), withConsentedVisitor: n(tr.get(e)?.["avec_visiteur"]),
    })),
  };
}

function taux(from: EtapeVisiteurs, to: EtapeVisiteurs, avant: EtapeVisiteurs[], apres: EtapeVisiteurs[]): Taux {
  const cote = (liste: EtapeVisiteurs[]) => {
    const a = liste.find(e => e.etape === from.etape)!;
    const b = liste.find(e => e.etape === to.etape)!;
    const num = b.paired ?? 0;
    const den = a.visitors;
    return { numerator: num, denominator: den, ratio: den === 0 ? null : Math.round((num / den) * 10000) / 10000, ci95: wilson(num, den) };
  };
  const B = cote(avant), A = cote(apres);
  let verdict: Taux["verdict"];
  if (B.denominator === 0 || A.denominator === 0) verdict = "no_data";
  else if (B.denominator < MIN_DENOMINATEUR || A.denominator < MIN_DENOMINATEUR) verdict = "insufficient_sample";
  else {
    const chevauche = !!B.ci95 && !!A.ci95 && B.ci95.low <= A.ci95.high && A.ci95.low <= B.ci95.high;
    verdict = chevauche ? "intervals_overlap" : "difference_outside_intervals";
  }
  return {
    from: from.etape, to: to.etape, before: B, after: A, verdict,
    deltaPoints: B.ratio === null || A.ratio === null ? null : Math.round((A.ratio - B.ratio) * 10000) / 100,
  };
}

/**
 * `change` : date de mise en production (AAAA-MM-JJ, UTC), premier jour « apres ».
 * `now` : injectable, pour tester la fenetre incomplete.
 */
export async function avantApres(query: Query, change: Date, days: number, now: Date = new Date()): Promise<AvantApres> {
  const debutAvant = new Date(change.getTime() - days * JOUR_MS);
  const finApresPleine = new Date(change.getTime() + days * JOUR_MS);
  const finApres = new Date(Math.min(finApresPleine.getTime(), now.getTime()));
  const chaine = CHAINE_CONSENTEMENT.filter(e => ETAPES_TUNNEL.includes(e as never));
  const absentes = CHAINE_CONSENTEMENT.filter(e => !ETAPES_TUNNEL.includes(e as never));

  const [before, after] = await Promise.all([
    mesurer(query, debutAvant, change, [...chaine], true, days),
    mesurer(query, change, finApres, [...chaine], finApres.getTime() >= finApresPleine.getTime(),
      Math.max(0, Math.ceil((finApres.getTime() - change.getTime()) / JOUR_MS))),
  ]);
  const rates: Taux[] = [];
  for (let i = 1; i < chaine.length; i++) {
    rates.push(taux(before.consentGated[i - 1]!, before.consentGated[i]!, before.consentGated, after.consentGated));
  }
  return {
    view: "before-after", change: change.toISOString().slice(0, 10), days, before, after,
    notInstrumented: [...absentes],
    rates, minDenominator: MIN_DENOMINATEUR,
    caveats: [
      "consent_gated counts only visitors who accepted analytics: a lower bound, and the share can change between windows.",
      "transactional counts (Stripe-signed) cover everyone and are never added to, or divided by, consent_gated counts.",
      "Rates are cohort rates inside one window; a visitor entering the funnel before the window start is not counted as entering.",
      `Under ${MIN_DENOMINATEUR} visitors in a denominator a rate is flagged insufficient_sample: do not conclude.`,
      "Overlapping 95% Wilson intervals mean the difference cannot be told from chance.",
      "A change in traffic mix (campaign, season) is not controlled by this comparison.",
    ],
  };
}
