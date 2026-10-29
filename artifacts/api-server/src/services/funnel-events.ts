import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const ETAPES_TUNNEL = [
  "landing_vue",
  "tarifs_vus",
  "cta_clique",
  "signup_started",
  "signup_form_engaged",
  "signup_form_completed",
  "checkout_started",
  "checkout_completed",
  "trial_activated",
  "trial_expired",
  "subscription_activated",
] as const;

export const ETAPES_PUBLIQUES = new Set<string>([
  "landing_vue",
  "tarifs_vus",
  "cta_clique",
  "signup_started",
  "signup_form_engaged",
]);

const ETAPES = new Set<string>(ETAPES_TUNNEL);
const VISITEUR_ID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|fp-[a-z0-9]+-[a-z0-9]+)$/i;
const SOURCES_AUTORISEES = new Set([
  "smartlead",
  "google",
  "direct",
  "social",
  "other_campaign",
]);

/**
 * Campagne d'acquisition (UTM) : trois libelles courts, en minuscules, sans
 * donnee personnelle. Une valeur hors du motif est ignoree, pas tronquee : un
 * libelle de campagne n'est jamais un texte libre.
 */
export interface CampagneUtm {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface AttributionFunnel {
  visiteurId: string;
  source: string | null;
  /** Absente (et non `null`) quand aucune valeur UTM valide n'a ete fournie. */
  campagne?: CampagneUtm;
}

const UTM_RE = /^[a-z0-9._-]{1,64}$/;

function normaliserValeurUtm(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const v = valeur.trim().toLowerCase();
  return UTM_RE.test(v) ? v : null;
}

/**
 * Lit `utm_source`, `utm_medium` et `utm_campaign` d'un objet brut (corps de
 * requete). Meme regle que l'attribution : rien sans consentement `accepted`.
 * Renvoie `null` si aucune des trois valeurs n'est valide.
 */
export function normaliserCampagne(
  consentement: unknown,
  brut: unknown,
): CampagneUtm | null {
  if (consentement !== "accepted" || !brut || typeof brut !== "object") {
    return null;
  }
  const b = brut as Record<string, unknown>;
  const campagne: CampagneUtm = {
    utmSource: normaliserValeurUtm(b["utm_source"]),
    utmMedium: normaliserValeurUtm(b["utm_medium"]),
    utmCampaign: normaliserValeurUtm(b["utm_campaign"]),
  };
  return campagne.utmSource || campagne.utmMedium || campagne.utmCampaign
    ? campagne
    : null;
}

export function normaliserAttributionFunnel(
  consentement: unknown,
  visiteurId: unknown,
  source: unknown,
  campagneBrute?: unknown,
): AttributionFunnel | null {
  if (
    consentement !== "accepted" ||
    typeof visiteurId !== "string" ||
    !VISITEUR_ID_RE.test(visiteurId)
  ) {
    return null;
  }
  const campagne = normaliserCampagne(consentement, campagneBrute);
  return {
    visiteurId,
    source:
      typeof source === "string" && SOURCES_AUTORISEES.has(source)
        ? source
        : null,
    ...(campagne ? { campagne } : {}),
  };
}

/** Les seules cles Stripe ecrites par l'attribution du tunnel. */
export function metadataDepuisAttribution(
  attribution: AttributionFunnel | null,
): Record<string, string> {
  if (!attribution) return {};
  const c = attribution.campagne;
  return {
    fp_analytics_consent: "accepted",
    fp_visitor_id: attribution.visiteurId,
    ...(attribution.source ? { fp_source: attribution.source } : {}),
    ...(c?.utmSource ? { fp_utm_source: c.utmSource } : {}),
    ...(c?.utmMedium ? { fp_utm_medium: c.utmMedium } : {}),
    ...(c?.utmCampaign ? { fp_utm_campaign: c.utmCampaign } : {}),
  };
}

export function metadataAttributionFunnel(
  consentement: unknown,
  visiteurId: unknown,
  source: unknown,
  campagneBrute?: unknown,
): Record<string, string> {
  return metadataDepuisAttribution(
    normaliserAttributionFunnel(consentement, visiteurId, source, campagneBrute),
  );
}

export function lireAttributionFunnel(
  metadata: Record<string, unknown>,
): AttributionFunnel | null {
  return normaliserAttributionFunnel(
    metadata["fp_analytics_consent"],
    metadata["fp_visitor_id"],
    metadata["fp_source"],
    {
      utm_source: metadata["fp_utm_source"],
      utm_medium: metadata["fp_utm_medium"],
      utm_campaign: metadata["fp_utm_campaign"],
    },
  );
}

export interface EvenementTunnel {
  etape: string;
  visiteurId?: string | null;
  orgId?: string | null;
  plan?: string | null;
  source?: string | null;
  cleIdempotence?: string | null;
  campagne?: CampagneUtm | null;
}

function tronquer(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

const INSERT_ETAPE = `INSERT INTO funnel_events
         (etape, visiteur_id, org_ref, plan, source, cle_idempotence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cle_idempotence)
         WHERE cle_idempotence IS NOT NULL DO NOTHING`;

const INSERT_ETAPE_CAMPAGNE = `INSERT INTO funnel_events
         (etape, visiteur_id, org_ref, plan, source, cle_idempotence,
          utm_source, utm_medium, utm_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (cle_idempotence)
         WHERE cle_idempotence IS NOT NULL DO NOTHING`;

export async function enregistrerEtape(
  event: EvenementTunnel,
): Promise<boolean> {
  if (!ETAPES.has(event.etape)) return false;
  const base = [
    event.etape,
    tronquer(event.visiteurId),
    tronquer(event.orgId),
    tronquer(event.plan),
    tronquer(event.source),
    tronquer(event.cleIdempotence),
  ];
  // Re-normalise : une campagne n'entre en base que sous sa forme valide.
  const campagne = event.campagne
    ? normaliserCampagne("accepted", {
        utm_source: event.campagne.utmSource,
        utm_medium: event.campagne.utmMedium,
        utm_campaign: event.campagne.utmCampaign,
      })
    : null;
  try {
    if (!campagne) {
      // Sans campagne : la requete d'origine, a l'identique.
      const result = await pool.query(INSERT_ETAPE, base);
      return (result.rowCount ?? 0) > 0;
    }
    try {
      const result = await pool.query(INSERT_ETAPE_CAMPAGNE, [
        ...base,
        campagne.utmSource,
        campagne.utmMedium,
        campagne.utmCampaign,
      ]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      // Migration 020 pas encore appliquee (colonne absente, 42703) : on garde
      // l'etape, sans la campagne, plutot que de la perdre.
      if ((error as { code?: string } | null)?.code !== "42703") throw error;
      logger.warn({ etape: event.etape }, "[Tunnel] utm columns missing — event stored without campaign");
      const result = await pool.query(INSERT_ETAPE, base);
      return (result.rowCount ?? 0) > 0;
    }
  } catch (error) {
    logger.warn({ error, etape: event.etape }, "[Tunnel] event write failed");
    return false;
  }
}

// ── Schema UTM (migration 020) ──────────────────────────────────────────────

/** Colonnes de campagne exigees par l'attribution (migration 020_funnel_events_utm.sql). */
export const COLONNES_UTM = ["utm_source", "utm_medium", "utm_campaign"] as const;

export type EtatColonnesUtm =
  | { etat: "table_absente" }
  | { etat: "deja_presentes" }
  | { etat: "ajoutees"; colonnes: string[] };

/**
 * Applique la migration 020 au demarrage, quel que soit le chemin (Pre-Deploy ou non) :
 * le service Render n'execute pas `migrate.mjs` (aucune etape Pre-Deploy constatee le
 * 29/10), si bien que 020 n'etait appliquee nulle part. Additive et idempotente : les
 * colonnes deja presentes ne sont pas retouchees (aucun verrou pris dans ce cas), et
 * `lock_timeout` borne l'attente si la table est occupee. Sans table, rien n'est cree.
 */
export async function assurerColonnesUtm(): Promise<EtatColonnesUtm> {
  const client = await pool.connect();
  try {
    const t = await client.query<{ t: string | null }>(
      `SELECT to_regclass('public.funnel_events')::text AS t`,
    );
    if (!t.rows[0]?.t) return { etat: "table_absente" };
    const c = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'funnel_events'
          AND column_name = ANY($1::text[])`,
      [[...COLONNES_UTM]],
    );
    const presentes = new Set(c.rows.map((r) => r.column_name));
    const manquantes = COLONNES_UTM.filter((k) => !presentes.has(k));
    if (manquantes.length === 0) return { etat: "deja_presentes" };
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      for (const k of manquantes) {
        await client.query(`ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS ${k} TEXT NULL`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    return { etat: "ajoutees", colonnes: manquantes };
  } finally {
    client.release();
  }
}

/** Colonne absente (42703) : le schema n'a pas la migration 020. */
export function estSchemaUtmAbsent(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42703";
}

// ── Agregats d'attribution (admin) ───────────────────────────────────────────

export const PLAGE_ATTRIBUTION_MAX_JOURS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateUtcValide(valeur: unknown): Date | null {
  if (typeof valeur !== "string" || !DATE_RE.test(valeur)) return null;
  const d = new Date(`${valeur}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valeur
    ? null
    : d;
}

export type PlageAttribution =
  | { ok: true; du: string; au: string }
  | { ok: false; erreur: string };

/** `from`/`to` obligatoires, dates calendaires UTC, `from <= to`, 400 jours au plus (bornes incluses). */
export function validerPlageAttribution(from: unknown, to: unknown): PlageAttribution {
  const du = dateUtcValide(from);
  const au = dateUtcValide(to);
  if (!du || !au) {
    return { ok: false, erreur: "from and to are required, as YYYY-MM-DD calendar dates" };
  }
  if (du.getTime() > au.getTime()) {
    return { ok: false, erreur: "from must be on or before to" };
  }
  const jours = Math.round((au.getTime() - du.getTime()) / 86_400_000) + 1;
  if (jours > PLAGE_ATTRIBUTION_MAX_JOURS) {
    return { ok: false, erreur: `range exceeds ${PLAGE_ATTRIBUTION_MAX_JOURS} days` };
  }
  return { ok: true, du: from as string, au: to as string };
}

export interface LigneAttribution {
  jour: string;
  etape: string;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  evenements: number;
  visiteurs: number;
}

/**
 * Comptes par jour UTC x etape x source x campagne. Ne selectionne aucun
 * identifiant : ni visiteur_id, ni org_ref, ni cle d'idempotence.
 */
export async function agregerAttribution(du: string, au: string): Promise<LigneAttribution[]> {
  const r = await pool.query<LigneAttribution>(
    `SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS jour,
            etape,
            source,
            utm_source,
            utm_medium,
            utm_campaign,
            count(*)::int                    AS evenements,
            count(DISTINCT visiteur_id)::int AS visiteurs
       FROM funnel_events
      WHERE created_at >= ($1::date)::timestamp AT TIME ZONE 'UTC'
        AND created_at <  ($2::date + 1)::timestamp AT TIME ZONE 'UTC'
        -- Visiteurs de test (fp-test-…) exclus, comme dans la surveillance Conversion B.
        AND (visiteur_id IS NULL OR visiteur_id NOT LIKE 'fp-test-%')
      GROUP BY 1, 2, 3, 4, 5, 6
      ORDER BY 1, array_position($3::text[], etape), 3 NULLS LAST, 4 NULLS LAST, 5 NULLS LAST, 6 NULLS LAST`,
    [du, au, [...ETAPES_TUNNEL]],
  );
  return r.rows.map((l) => ({
    jour: l.jour,
    etape: l.etape,
    source: l.source ?? null,
    utm_source: l.utm_source ?? null,
    utm_medium: l.utm_medium ?? null,
    utm_campaign: l.utm_campaign ?? null,
    evenements: Number(l.evenements),
    visiteurs: Number(l.visiteurs),
  }));
}
