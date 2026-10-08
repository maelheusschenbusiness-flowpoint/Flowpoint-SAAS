/**
 * AI Lab — emission des jalons de conversion, en meilleur effort.
 *
 * AI Lab mesure le funnel `Smartlead -> clic -> visite -> inscription -> checkout
 * -> essai -> payant` a partir d'evenements signes. Ce module est le seul endroit
 * du SaaS qui les lui envoie.
 *
 * MEILLEUR EFFORT, AU SENS FORT. Une indisponibilite d'AI Lab ne doit jamais
 * faire echouer une inscription, une activation, un checkout, un webhook Stripe
 * ni un paiement. Le chemin d'appel est donc sans exception : toute erreur —
 * reseau, DNS, timeout, 500, JSON — est avalee et journalisee. La fonction ne
 * rejette jamais et ne rend qu'un verdict consultatif. Un module de mesure qui
 * peut interrompre un encaissement est un bug, pas une mesure.
 *
 * NE RIEN FABRIQUER. `fp_lid` existe deja — frappe par l'acquisition engine,
 * porte jusqu'a `pending_signups.fp_lid` puis `organizations.fp_lid` (Conversion
 * B, en production). Ce module le LIT ; il ne le cree pas, ne le propage pas et
 * ne le copie pas dans Stripe.
 *
 * HORODATAGE STABLE. `occurred_at` doit venir d'une donnee persistee —
 * `event.created` pour Stripe, `pending_signups.created_at` pour l'inscription.
 * Jamais `Date.now()` : AI Lab exige qu'un meme `event_id` decrive un evenement
 * immuable, horodatage compris, et refuse le contraire comme une collision
 * d'identifiant. Un horodatage regenere transforme un rejeu legitime en erreur.
 */
import { createHash } from "node:crypto";
import { logger } from "./logger.js";

/** Les etapes que ce module sait emettre. `click` et `visit` ne sont pas cables. */
export type ConversionStage = "signup" | "checkout" | "trial" | "paid";

/** La provenance de la preuve, telle qu'AI Lab la contraint. */
export type ConversionSource = "saas" | "stripe";

export interface ConversionEvent {
  /** Identifiant stable et opaque de l'evenement. Jamais un secret en clair. */
  eventId: string;
  stage: ConversionStage;
  source: ConversionSource;
  /** Le `fp_lid` deja present en base. Absent ou invalide : rien n'est emis. */
  fpLid: string;
  /** Horodatage persiste, en ISO 8601 avec fuseau. */
  occurredAt: string;
}

/**
 * Court a dessein.
 *
 * Deux secondes suffisent a un POST d'une centaine d'octets vers un service
 * interne. Au-dela, la mesure coute plus que ce qu'elle rapporte, et elle
 * retarderait un webhook que Stripe reessaiera si on tarde trop.
 */
const DEFAULT_TIMEOUT_MS = 2000;

const HEADER = "X-Flowpoint-Event-Secret";
/** AI Lab refuse un secret plus court : le verifier ici evite un appel inutile. */
const MIN_SECRET_LENGTH = 32;

/** Resultat consultatif. Aucun appelant n'a a le lire pour etre correct. */
export type EmitOutcome =
  | "sent"
  | "duplicate"
  | "not-configured"
  | "invalid-input"
  | "rejected"
  | "unreachable";

/**
 * Un identifiant d'evenement derive d'un jeton, sans divulguer ce jeton.
 *
 * Le jeton de pre-inscription est un secret de courte duree : l'envoyer tel quel
 * a un autre service le ferait sortir de son perimetre pour rien. Un condensat
 * tronque garde ce qui compte — la stabilite et l'unicite — et ne revele pas la
 * valeur d'origine.
 */
export function stableEventId(prefix: string, token: string): string {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 32);
  return `${prefix}:${digest}`;
}

/** La forme exacte qu'AI Lab attend d'un `fp_lid`. */
const FP_LID_RE = /^[A-Za-z0-9_-]{22}$/;

interface Config {
  url: string;
  secret: string;
  timeoutMs: number;
}

/**
 * La configuration, ou rien.
 *
 * L'absence d'URL ou de secret n'est pas une erreur : c'est un environnement ou
 * la mesure n'est pas branchee, et le SaaS doit y fonctionner a l'identique.
 * Le secret est lu ici, cote serveur uniquement, et n'est jamais rendu ni
 * journalise.
 */
function readConfig(): Config | null {
  const url = String(process.env["AI_LAB_CONVERSION_URL"] ?? "").trim();
  const secret = String(process.env["CONVERSION_EVENT_SECRET"] ?? "");
  if (!url || secret.length < MIN_SECRET_LENGTH) return null;
  if (!/^https?:\/\//.test(url)) return null;
  const raw = Number(process.env["AI_LAB_CONVERSION_TIMEOUT_MS"]);
  const timeoutMs = Number.isFinite(raw) && raw > 0 && raw <= 10000 ? raw : DEFAULT_TIMEOUT_MS;
  return { url, secret, timeoutMs };
}

/**
 * Emet un jalon. Ne leve jamais.
 *
 * Ce que le journal contient : l'etape, l'identifiant d'evenement — deja opaque —
 * et l'issue. Ce qu'il ne contient jamais : le `fp_lid`, le secret, l'email, ni
 * la charge utile. Un journal de mesure ne doit pas devenir la fuite qu'on a
 * pris soin d'eviter partout ailleurs.
 */
export async function emitConversionEvent(event: ConversionEvent): Promise<EmitOutcome> {
  const config = readConfig();
  if (!config) return "not-configured";
  if (!FP_LID_RE.test(event.fpLid)) return "invalid-input";
  if (!event.eventId || event.eventId.length < 8 || event.eventId.length > 128) return "invalid-input";
  if (!event.occurredAt) return "invalid-input";

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [HEADER]: config.secret },
      body: JSON.stringify({
        event_id: event.eventId,
        stage: event.stage,
        source: event.source,
        fp_lid: event.fpLid,
        occurred_at: event.occurredAt,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (response.ok) {
      // AI Lab distingue l'enregistrement du doublon. Les deux sont des succes :
      // un meme jalon ne compte qu'une fois par prospect, par construction.
      const body = (await response.json().catch(() => null)) as { duplicate?: boolean } | null;
      const outcome: EmitOutcome = body?.duplicate === true ? "duplicate" : "sent";
      logger.debug({ stage: event.stage, eventId: event.eventId, outcome },
        "[AI Lab] conversion milestone emitted");
      return outcome;
    }

    // Un refus est une information sur NOTRE appel, jamais sur le parcours de
    // l'utilisateur : on le note et on continue. Le corps n'est pas journalise,
    // il peut citer ce qu'on vient d'envoyer.
    logger.warn({ stage: event.stage, eventId: event.eventId, status: response.status },
      "[AI Lab] conversion milestone refused (non-fatal)");
    return "rejected";
  } catch (err) {
    // Timeout, DNS, reseau, TLS : tout atterrit ici, et rien ne remonte.
    logger.warn({ stage: event.stage, eventId: event.eventId, err: (err as Error)?.name },
      "[AI Lab] conversion milestone unreachable (non-fatal)");
    return "unreachable";
  }
}
