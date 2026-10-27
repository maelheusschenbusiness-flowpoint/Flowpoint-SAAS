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
    logger.warn({ err: (error as Error)?.message }, "[Tunnel] email click write failed (non-fatal)");
    return false;
  }
}
