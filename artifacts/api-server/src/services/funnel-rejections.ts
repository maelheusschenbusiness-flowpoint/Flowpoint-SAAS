/**
 * funnel-rejections.ts — compteur ANONYME des evenements du tunnel refuses ou perdus.
 *
 * POURQUOI. `POST /api/public/funnel-event` repond 400 (etape inconnue,
 * visiteurId absent), 204 sans rien ecrire (consentement absent ou refuse) ou
 * 204 apres un echec d'ecriture avale par conception (une mesure ne casse
 * jamais un parcours). Dans les trois cas rien n'etait compte : impossible de
 * dire si le tunnel perdait des evenements, ni pourquoi.
 *
 * CE QUI EST STOCKE. Un jour (UTC), un motif d'une liste FERMEE, un total.
 * Jamais de visiteur, d'email, d'IP, de corps de requete ni de valeur libre :
 * le motif est choisi par le serveur, jamais recopie depuis l'appelant. La
 * cardinalite est bornee (jours x 4 motifs), donc un appelant hostile ne peut
 * pas gonfler la table.
 *
 * Ne leve jamais. La table est creee a la premiere ecriture (comme
 * `funnel_events`) ; la definition versionnee est `migrations/029_funnel_event_rejections.sql`.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Motifs, avec le statut HTTP que le navigateur a recu.
 *  - unknown_stage, missing_visitor_id : 400 (validation) ;
 *  - consent_missing : 204, ignore volontairement (pas de consentement `accepted`
 *    ou identifiant de visiteur mal forme) ;
 *  - storage_error : evenement valide mais ecriture impossible (contrainte,
 *    base indisponible), perdu ; la reponse reste 204.
 */
export const MOTIFS_REJET = {
  unknown_stage: 400,
  missing_visitor_id: 400,
  consent_missing: 204,
  storage_error: 204,
} as const;

export type MotifRejet = keyof typeof MOTIFS_REJET;

let tablePrete = false;

async function assurerTable(): Promise<void> {
  if (tablePrete) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnel_event_rejections (
      jour   DATE   NOT NULL,
      motif  TEXT   NOT NULL,
      total  BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (jour, motif)
    )`);
  await pool.query(`ALTER TABLE funnel_event_rejections ENABLE ROW LEVEL SECURITY`);
  tablePrete = true;
}

/** Compte un rejet. Ne leve jamais, ne bloque jamais l'appelant. */
export async function compterRejetFunnel(motif: MotifRejet): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(MOTIFS_REJET, motif)) return;
  try {
    await assurerTable();
    await pool.query(
      `INSERT INTO funnel_event_rejections (jour, motif, total)
       VALUES ((now() AT TIME ZONE 'UTC')::date, $1, 1)
       ON CONFLICT (jour, motif) DO UPDATE SET total = funnel_event_rejections.total + 1`,
      [motif],
    );
  } catch (err) {
    logger.warn({ err: (err as Error)?.name, motif }, "[Tunnel] rejection counter unavailable (non-fatal)");
  }
}

/** Remet l'etat interne a zero — tests uniquement. */
export function _reinitialiserRejetsPourTests(): void { tablePrete = false; }
