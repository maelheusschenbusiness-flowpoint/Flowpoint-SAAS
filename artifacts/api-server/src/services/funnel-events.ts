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
  // Attribution Smartlead : clic serveur sur `GET /go`, jamais emis par un navigateur.
  "email_clic",
  // Signal navigateur de la page d'arrivee, lie au meme lead (drapeau separe).
  "email_visite",
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

export interface AttributionFunnel {
  visiteurId: string;
  source: string | null;
}

export function normaliserAttributionFunnel(
  consentement: unknown,
  visiteurId: unknown,
  source: unknown,
): AttributionFunnel | null {
  if (
    consentement !== "accepted" ||
    typeof visiteurId !== "string" ||
    !VISITEUR_ID_RE.test(visiteurId)
  ) {
    return null;
  }
  return {
    visiteurId,
    source:
      typeof source === "string" && SOURCES_AUTORISEES.has(source)
        ? source
        : null,
  };
}

export function metadataAttributionFunnel(
  consentement: unknown,
  visiteurId: unknown,
  source: unknown,
): Record<string, string> {
  const attribution = normaliserAttributionFunnel(
    consentement,
    visiteurId,
    source,
  );
  if (!attribution) return {};
  return {
    fp_analytics_consent: "accepted",
    fp_visitor_id: attribution.visiteurId,
    ...(attribution.source ? { fp_source: attribution.source } : {}),
  };
}

export function lireAttributionFunnel(
  metadata: Record<string, unknown>,
): AttributionFunnel | null {
  return normaliserAttributionFunnel(
    metadata["fp_analytics_consent"],
    metadata["fp_visitor_id"],
    metadata["fp_source"],
  );
}

export interface EvenementTunnel {
  etape: string;
  visiteurId?: string | null;
  orgId?: string | null;
  plan?: string | null;
  source?: string | null;
  cleIdempotence?: string | null;
}

function tronquer(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

export async function enregistrerEtape(
  event: EvenementTunnel,
): Promise<boolean> {
  if (!ETAPES.has(event.etape)) return false;
  try {
    const result = await pool.query(
      `INSERT INTO funnel_events
         (etape, visiteur_id, org_ref, plan, source, cle_idempotence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cle_idempotence)
         WHERE cle_idempotence IS NOT NULL DO NOTHING`,
      [
        event.etape,
        tronquer(event.visiteurId),
        tronquer(event.orgId),
        tronquer(event.plan),
        tronquer(event.source),
        tronquer(event.cleIdempotence),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.warn({ error, etape: event.etape }, "[Tunnel] event write failed");
    return false;
  }
}

export interface ClicEmailEnregistre {
  /** Condensat tronque du fp_lid (jamais le jeton lui-meme). */
  empreinteLead: string;
  campagne: string | null;
  variante: string | null;
  botSuspect: boolean;
  cleIdempotence: string;
}

/**
 * Le clic d'un email de prospection (`GET /go`). Requete a part, et non
 * `enregistrerEtape`, parce qu'elle ecrit les colonnes ajoutees par la
 * migration 020 : tant que celle-ci n'est pas appliquee, seule cette ecriture
 * echoue (avalee, journalisee), jamais les autres etapes du tunnel.
 * Ni IP, ni user-agent, ni fp_lid en clair.
 */
export async function enregistrerClicEmail(clic: ClicEmailEnregistre): Promise<boolean> {
  try {
    const result = await pool.query(
      `INSERT INTO funnel_events
         (etape, visiteur_id, source, campagne, variante, bot_suspect, cle_idempotence)
       VALUES ('email_clic', $1, 'smartlead', $2, $3, $4, $5)
       ON CONFLICT (cle_idempotence)
         WHERE cle_idempotence IS NOT NULL DO NOTHING`,
      [
        `lid-${clic.empreinteLead}`,
        tronquer(clic.campagne),
        tronquer(clic.variante),
        clic.botSuspect,
        tronquer(clic.cleIdempotence),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    // Le code SQLSTATE seulement : un message d'erreur PostgreSQL peut citer
    // une valeur de la ligne.
    logger.warn({ code: (error as { code?: string })?.code }, "[Tunnel] email click write failed (non-fatal)");
    return false;
  }
}

/** La visite navigateur qui suit un clic (`POST /api/public/email-visit`). */
export async function enregistrerVisiteEmail(empreinte: string, cleIdempotence: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `INSERT INTO funnel_events (etape, visiteur_id, source, cle_idempotence)
       VALUES ('email_visite', $1, 'smartlead', $2)
       ON CONFLICT (cle_idempotence)
         WHERE cle_idempotence IS NOT NULL DO NOTHING`,
      [`lid-${empreinte}`, tronquer(cleIdempotence)],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.warn({ code: (error as { code?: string })?.code }, "[Tunnel] email visit write failed (non-fatal)");
    return false;
  }
}

/**
 * Le comptage d'une campagne. Un clic n'est « humain probable » que s'il n'est
 * pas marque `bot_suspect` ET qu'une visite navigateur du meme lead le suit
 * (de 5 minutes avant a 24 heures apres : horloges et dedoublonnage par jour).
 * Sans signal de visite active, `humains_probables` reste a 0 et seul
 * `clics_non_suspects` est significatif.
 */
export interface StatistiquesClicsEmail {
  clics: number;
  clics_bot_suspect: number;
  clics_non_suspects: number;
  humains_probables: number;
  visites: number;
}

export async function statistiquesClicsEmail(
  depuis: Date,
  jusqua: Date,
  campagne: string | null = null,
): Promise<StatistiquesClicsEmail> {
  const r = await pool.query<Record<keyof StatistiquesClicsEmail, number>>(
    `WITH clics AS (
       SELECT c.visiteur_id, c.created_at, c.bot_suspect
         FROM funnel_events c
        WHERE c.etape = 'email_clic' AND c.created_at >= $1 AND c.created_at < $2
          AND ($3::text IS NULL OR c.campagne = $3)
     )
     SELECT count(*)::int AS clics,
            count(*) FILTER (WHERE bot_suspect)::int AS clics_bot_suspect,
            count(*) FILTER (WHERE bot_suspect IS FALSE)::int AS clics_non_suspects,
            count(*) FILTER (WHERE bot_suspect IS FALSE AND EXISTS (
              SELECT 1 FROM funnel_events v
               WHERE v.etape = 'email_visite' AND v.visiteur_id = clics.visiteur_id
                 AND v.created_at >= clics.created_at - interval '5 minutes'
                 AND v.created_at <  clics.created_at + interval '24 hours'))::int AS humains_probables,
            (SELECT count(*)::int FROM funnel_events v
              WHERE v.etape = 'email_visite' AND v.created_at >= $1 AND v.created_at < $2
                AND v.visiteur_id IN (SELECT visiteur_id FROM clics)) AS visites
       FROM clics`,
    [depuis, jusqua, campagne],
  );
  const row = r.rows[0];
  return {
    clics: row?.clics ?? 0,
    clics_bot_suspect: row?.clics_bot_suspect ?? 0,
    clics_non_suspects: row?.clics_non_suspects ?? 0,
    humains_probables: row?.humains_probables ?? 0,
    visites: row?.visites ?? 0,
  };
}

/**
 * Conservation : les lignes d'attribution email (`email_clic`, `email_visite`)
 * sont supprimees apres 13 mois — une annee de campagnes comparable d'un mois
 * sur l'autre, pas davantage. Les autres etapes du tunnel ne sont pas touchees.
 */
export const CONSERVATION_ATTRIBUTION_EMAIL = "13 months";

export async function purgerAttributionEmail(): Promise<number> {
  try {
    const r = await pool.query(
      `DELETE FROM funnel_events
        WHERE etape IN ('email_clic', 'email_visite')
          AND created_at < now() - interval '${CONSERVATION_ATTRIBUTION_EMAIL}'`,
    );
    return r.rowCount ?? 0;
  } catch (error) {
    logger.warn({ code: (error as { code?: string })?.code }, "[Tunnel] email attribution purge failed (non-fatal)");
    return 0;
  }
}

let purgeDemarree = false;
/** Une passe peu apres le demarrage, puis une par jour. */
export function demarrerPurgeAttributionEmail(intervalMs = 24 * 60 * 60 * 1000): void {
  if (purgeDemarree) return;
  purgeDemarree = true;
  const passe = () => {
    void purgerAttributionEmail().then((n) => {
      if (n > 0) logger.info({ purged: n }, "[Tunnel] email attribution rows past retention purged");
    });
  };
  const premier = setTimeout(passe, 5 * 60 * 1000);
  const t = setInterval(passe, intervalMs);
  (premier as { unref?: () => void }).unref?.();
  (t as { unref?: () => void }).unref?.();
}
