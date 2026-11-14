/**
 * Tableaux de bord de conversion — deux vues, des definitions explicites.
 *
 *  GLOBALE  : tout le trafic mesurable du SaaS (`funnel_events`).
 *  OUTBOUND : ce qui vient de Smartlead (`source = 'smartlead'`) + la sante de la
 *             livraison des jalons vers le moteur d'acquisition (outbox).
 *
 * REGLES.
 *  - Aucune donnee fictive : une mesure absente est `null`, jamais 0 par defaut.
 *  - Consentement : les etapes navigateur, l'inscription validee et le debut de checkout ne
 *    sont enregistres qu'avec le consentement analytique (couverture `consented`) ; seuls
 *    l'essai et l'abonnement payant, issus d'evenements Stripe signes, couvrent tout le monde
 *    (`all`). Un taux n'est calcule qu'entre deux etapes de MEME couverture, sinon
 *    `ratio: null` avec la raison — jamais un taux trompeur.
 *  - Doublons : on compte des evenements distincts par cle d'idempotence (a defaut,
 *    par ligne), et des visiteurs distincts.
 *  - Un clic n'est jamais une conversion payante : `paiement` ne vient que du
 *    statut `active` signe par Stripe.
 *  - Les visiteurs de test (`fp-test-*`) sont exclus.
 *  - Aucun email, IP, `fp_lid` ni identifiant Stripe n'est lu ni renvoye.
 *  - Le funnel par PROSPECT Smartlead (prospects contactes, clics, `fp_lid`) vit
 *    dans le moteur d'acquisition : il n'est pas recopie ici.
 */
import { pool } from "@workspace/db";

/**
 * Couverture d'une etape, telle que le code l'ecrit reellement :
 *  - `consented` : l'etape n'est enregistree qu'avec le consentement analytique (etapes navigateur,
 *    mais aussi `signup_form_completed` et `checkout_started`, emises par le serveur SEULEMENT si le
 *    visiteur a consenti) ;
 *  - `all` : l'etape est comptee pour tout le monde, avec ou sans consentement (evenements Stripe
 *    signes : essai, abonnement payant).
 * Un taux n'a de sens qu'entre deux etapes de meme couverture.
 */
export type Coverage = "consented" | "all";

export interface StageDef { key: string; label: string; coverage: Coverage; definition: string }

export const GLOBAL_STAGES: readonly StageDef[] = [
  { key: "landing_vue", label: "Visites (site vitrine)", coverage: "consented", definition: "Page vitrine affichee, visiteur ayant accepte l'analytique." },
  { key: "tarifs_vus", label: "Vues des tarifs", coverage: "consented", definition: "Page tarifs affichee, visiteur consentant." },
  { key: "cta_clique", label: "Clics CTA", coverage: "consented", definition: "Clic sur un appel a l'action. Un clic n'est pas une conversion." },
  { key: "signup_started", label: "Debuts d'inscription", coverage: "consented", definition: "Formulaire d'inscription affiche, visiteur consentant." },
  { key: "signup_form_completed", label: "Inscriptions validees", coverage: "consented", definition: "Formulaire envoye et accepte par le serveur ; enregistre seulement si le visiteur a consenti a l'analytique." },
  { key: "checkout_started", label: "Debuts de checkout", coverage: "consented", definition: "Parcours de paiement ouvert cote serveur ; enregistre seulement si le visiteur a consenti a l'analytique." },
  { key: "checkout_completed", label: "Paiements confirmes", coverage: "consented", definition: "Carte confirmee aupres de Stripe (intent reussi) ; enregistre seulement si le visiteur a consenti a l'analytique. Distinct de `trial_activated`, qui est signe par Stripe et compte tout le monde." },
  { key: "checkout_payment_failed", label: "Echecs de confirmation de carte", coverage: "consented", definition: "Le navigateur signale un refus lors de la confirmation de la carte (au plus une fois par visiteur et par jour). Aucun motif, aucun detail bancaire ; consentants seulement, donc un minimum : les refus de visiteurs non consentants ne sont pas comptes." },
  { key: "trial_activated", label: "Essais actives", coverage: "all", definition: "Abonnement passe au statut `trialing` signe par Stripe." },
  { key: "subscription_activated", label: "Abonnements payants", coverage: "all", definition: "Abonnement passe au statut `active` signe par Stripe." },
] as const;

const RATE_PAIRS: ReadonlyArray<[string, string]> = [
  ["tarifs_vus", "cta_clique"], ["cta_clique", "signup_started"], ["signup_started", "signup_form_completed"],
  ["signup_form_completed", "checkout_started"], ["checkout_started", "checkout_completed"],
  ["checkout_completed", "trial_activated"], ["trial_activated", "subscription_activated"],
];

export type Query = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface StageCount {
  key: string; label: string; coverage: Coverage; definition: string;
  events: number; uniqueVisitors: number | null;
}
export interface RateRow { from: string; to: string; ratio: number | null; reason: "ok" | "mixed_coverage" | "no_denominator" }

const TEST_FILTER = `(visiteur_id IS NULL OR visiteur_id NOT LIKE 'fp-test-%')`;

async function stageRows(query: Query, from: Date, to: Date, source: string | null) {
  const params: unknown[] = [from.toISOString(), to.toISOString()];
  let sourceClause = "";
  if (source) { params.push(source); sourceClause = ` AND source = $3`; }
  const stages = await query(
    `SELECT etape, count(DISTINCT COALESCE(cle_idempotence, id::text))::int AS events,
            count(DISTINCT visiteur_id)::int AS visitors
       FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND ${TEST_FILTER}${sourceClause}
      GROUP BY etape`, params);
  const total = await query(
    `SELECT count(DISTINCT visiteur_id)::int AS visitors FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2 AND visiteur_id IS NOT NULL AND ${TEST_FILTER}${sourceClause}`, params);
  return { stages: stages.rows, measurableVisitors: Number(total.rows[0]?.["visitors"] ?? 0) };
}

export function buildStages(rows: Record<string, unknown>[]): StageCount[] {
  const byKey = new Map(rows.map(r => [String(r["etape"]), r]));
  return GLOBAL_STAGES.map(def => {
    const row = byKey.get(def.key);
    return {
      ...def,
      events: Number(row?.["events"] ?? 0),
      // Une etape serveur peut n'avoir aucun visiteur identifie (pas de consentement) : null, pas 0.
      uniqueVisitors: row && Number(row["visitors"]) > 0 ? Number(row["visitors"]) : null,
    };
  });
}

export function buildRates(stages: StageCount[]): RateRow[] {
  const by = new Map(stages.map(s => [s.key, s]));
  return RATE_PAIRS.map(([from, to]) => {
    const a = by.get(from)!, b = by.get(to)!;
    if (a.coverage !== b.coverage) return { from, to, ratio: null, reason: "mixed_coverage" as const };
    if (a.events === 0) return { from, to, ratio: null, reason: "no_denominator" as const };
    return { from, to, ratio: Math.round((b.events / a.events) * 10000) / 10000, reason: "ok" as const };
  });
}

export interface DashboardWindow { from: string; to: string }

export async function globalConversion(query: Query, from: Date, to: Date) {
  const { stages, measurableVisitors } = await stageRows(query, from, to, null);
  const counts = buildStages(stages);
  return { view: "global", measurableVisitors, stages: counts, rates: buildRates(counts) };
}

export async function outboundConversion(query: Query, from: Date, to: Date) {
  const { stages, measurableVisitors } = await stageRows(query, from, to, "smartlead");
  const counts = buildStages(stages);
  let delivery: unknown;
  try {
    const r = await query(
      `SELECT status, count(*)::int AS n,
              count(*) FILTER (WHERE last_status = 'rejected:400:exhausted')::int AS exhausted,
              extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))::int AS oldest_pending_seconds
         FROM conversion_event_outbox WHERE created_at >= $1 AND created_at < $2 GROUP BY status`,
      [from.toISOString(), to.toISOString()]);
    const get = (s: string) => r.rows.find(x => x["status"] === s);
    const oldest = get("pending")?.["oldest_pending_seconds"];
    delivery = {
      status: "observed",
      delivered: Number(get("delivered")?.["n"] ?? 0),
      pending: Number(get("pending")?.["n"] ?? 0),
      rejected: Number(get("rejected")?.["n"] ?? 0),
      abandonedAfterRetries: Number(get("rejected")?.["exhausted"] ?? 0),
      oldestPendingSeconds: oldest === null || oldest === undefined ? null : Number(oldest),
    };
  } catch (err) {
    // La table de file n'est creee qu'au premier jalon : son absence n'est pas une panne.
    delivery = (err as { code?: string })?.code === "42P01" ? { status: "not_initialized" } : { status: "unavailable" };
  }
  return {
    view: "outbound", source: "smartlead", measurableVisitors, stages: counts, rates: buildRates(counts), delivery,
    external: {
      prospectsContacted: { status: "not_available_in_saas", owner: "flowpoint-acquisition-engine" },
      attributedVisitsByFpLid: { status: "not_available_in_saas", owner: "flowpoint-acquisition-engine" },
    },
  };
}

/** Borne la fenetre : dates AAAA-MM-JJ (UTC), `to` inclus, 366 jours maximum. */
export function parseWindow(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
  if (!ok(fromRaw) || !ok(toRaw) || fromRaw > toRaw) return null;
  const from = new Date(`${fromRaw}T00:00:00.000Z`);
  const to = new Date(new Date(`${toRaw}T00:00:00.000Z`).getTime() + 86_400_000);
  if ((to.getTime() - from.getTime()) / 86_400_000 > 366) return null;
  return { from, to };
}

export const poolQuery: Query = (sql, params) => pool.query(sql, params) as unknown as ReturnType<Query>;
