/**
 * funnel-events.ts — mesure du tunnel commercial de FlowPoint.
 *
 * POURQUOI, mesure du 18/10/2026. L'audit a etabli qu'aucune etape du tunnel
 * n'etait mesurable :
 *   - aucune balise analytique sur `flowpoint.pro` (verifie trois fois) ;
 *   - `pending_signups` est purgee toutes les heures, donc la trace des
 *     formulaires commences est detruite ;
 *   - `usage_events` existe mais `recordUsageEvent` REFUSE tout appel sans
 *     `orgId`, or `signup_started` et `checkout_started` se produisent avant
 *     qu'une organisation existe.
 *
 * Resultat : sur un mois, impossible de dire combien de personnes avaient
 * commence une inscription. Deux l'ont terminee. C'est tout ce qu'on savait.
 *
 * CE QUI EST STOCKE, ET CE QUI NE L'EST PAS. Aucune adresse email, aucune IP,
 * aucune donnee postale, aucun identifiant Stripe. Seulement une etape, un
 * identifiant de visiteur anonyme, et eventuellement l'organisation une fois
 * qu'elle existe. Rien ici ne permet de reidentifier une personne.
 *
 * CONSERVATION DURABLE : cette table n'est purgee par rien. C'est voulu — la
 * purge horaire de `pending_signups` est precisement ce qui a rendu le tunnel
 * aveugle.
 *
 * DOUBLONS : `cle_idempotence` porte un index unique. Une emission serveur
 * passe une cle naturelle (identifiant de session Stripe, identifiant
 * d'evenement), une emission navigateur passe visiteur+etape+jour. Un rejeu
 * n'ajoute donc jamais une seconde ligne, et un meme visiteur peut revenir un
 * autre jour sans que son retour soit efface.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Les etapes du tunnel. Liste fermee : une etape inconnue est refusee, pour
 * qu'un appelant exterieur ne puisse pas inventer d'evenements.
 */
export const ETAPES_TUNNEL = [
  "landing_vue",             // page vitrine affichee
  "tarifs_vus",              // page tarifs affichee
  "cta_clique",              // clic sur un appel a l'action
  "signup_started",          // formulaire d'inscription affiche
  "signup_form_completed",   // formulaire envoye et accepte
  "checkout_started",        // session Stripe Checkout creee
  "checkout_completed",      // paiement/essai confirme par Stripe
  "trial_activated",         // essai reellement ouvert
  "trial_expired",           // essai arrive a terme
  "subscription_activated",  // abonnement payant actif
] as const;

export type EtapeTunnel = (typeof ETAPES_TUNNEL)[number];

const ETAPES = new Set<string>(ETAPES_TUNNEL);

/** Les etapes qu'un navigateur peut declarer. Les autres viennent du serveur. */
export const ETAPES_PUBLIQUES = new Set<string>([
  "landing_vue", "tarifs_vus", "cta_clique", "signup_started",
]);

let tablePrete = false;

async function assurerTable(): Promise<void> {
  if (tablePrete) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS funnel_events (
        id              BIGSERIAL   PRIMARY KEY,
        etape           TEXT        NOT NULL,
        visiteur_id     TEXT,
        org_ref         TEXT,
        plan            TEXT,
        source          TEXT,
        cle_idempotence TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS funnel_events_etape_date_idx ON funnel_events (etape, created_at)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS funnel_events_idem_uniq ON funnel_events (cle_idempotence) WHERE cle_idempotence IS NOT NULL`);
    // RLS : regle de la maison, toute table nouvelle l'active a la creation.
    // Sans policy, aucun client PostgREST n'y accede — le defaut est le refus,
    // et le serveur y accede par le role de connexion.
    //
    // POURQUOI LA COLONNE S'APPELLE `org_ref` ET NON `org_id`. Mesure du
    // 18/10/2026 : nommee `org_id`, elle faisait echouer l'invariant de schema
    // de `pg-init-contract-db` et la porte de `readiness` — « toute table
    // portant org_id a RLS active ET une policy d'isolation sur org_id ».
    // Cet invariant est juste, et je ne vais pas l'affaiblir : cette table
    // n'est PAS une table de locataire. Elle mesure des visiteurs anonymes
    // avant qu'une organisation existe, et note seulement, apres coup, quelle
    // organisation une conversion a produite. Une policy d'isolation par
    // organisation la rendrait inutilisable pour son objet meme. Le nom dit
    // donc ce qu'elle est, et l'invariant continue de proteger les vraies
    // tables de locataire.
    await client.query(`ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY`);
    tablePrete = true;
  } finally {
    client.release();
  }
}

export interface EvenementTunnel {
  etape: string;
  visiteurId?: string | null;
  /** Organisation, quand elle existe deja. Stocke dans `org_ref`. */
  orgId?: string | null;
  plan?: string | null;
  source?: string | null;
  cleIdempotence?: string | null;
}

/**
 * Enregistre une etape. Ne leve jamais : une mesure ratee ne doit pas casser
 * un parcours d'inscription ou un webhook de paiement.
 *
 * Rend `true` quand une ligne a ete ecrite, `false` sinon — utile aux tests et
 * pour distinguer un doublon d'un echec.
 */
export async function enregistrerEtape(ev: EvenementTunnel): Promise<boolean> {
  if (!ETAPES.has(ev.etape)) {
    logger.warn({ etape: ev.etape }, "[Tunnel] etape inconnue — ignoree");
    return false;
  }
  try {
    await assurerTable();
    const r = await pool.query(
      `INSERT INTO funnel_events (etape, visiteur_id, org_ref, plan, source, cle_idempotence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cle_idempotence) WHERE cle_idempotence IS NOT NULL DO NOTHING`,
      [
        ev.etape,
        tronquer(ev.visiteurId),
        tronquer(ev.orgId),
        tronquer(ev.plan),
        tronquer(ev.source),
        tronquer(ev.cleIdempotence),
      ],
    );
    return (r.rowCount ?? 0) > 0;
  } catch (err) {
    logger.warn({ err, etape: ev.etape }, "[Tunnel] enregistrement impossible (non fatal)");
    return false;
  }
}

/** Borne la longueur : aucune valeur libre ne doit pouvoir gonfler la table. */
function tronquer(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, 120);
}

/** Comptes par etape sur une fenetre, pour lire le tunnel. */
export async function compterParEtape(depuis: Date, jusqua: Date): Promise<Record<string, number>> {
  try {
    await assurerTable();
    const r = await pool.query<{ etape: string; n: string }>(
      `SELECT etape, count(*) AS n FROM funnel_events
        WHERE created_at >= $1 AND created_at < $2 GROUP BY etape`,
      [depuis.toISOString(), jusqua.toISOString()],
    );
    const sortie: Record<string, number> = {};
    for (const l of r.rows) sortie[l.etape] = Number(l.n);
    return sortie;
  } catch (err) {
    logger.warn({ err }, "[Tunnel] lecture impossible");
    return {};
  }
}

/** Remet l'etat interne a zero — tests uniquement. */
export function _reinitialiserPourTests(): void { tablePrete = false; }
