/**
 * access-config.ts — configuration de la regle d'acces (annulation / past_due).
 *
 *  PAST_DUE_GRACE_DAYS   entier 0..30, defaut 3. Valeur invalide → 3 + log.
 *  PAST_DUE_RULE_ACTIVATED_AT  (optionnel, ISO) ancre des organisations deja
 *                        past_due SANS past_due_since. Defaut : demarrage du
 *                        processus (le backfill de initDataTables pose de toute
 *                        facon past_due_since = NOW() au premier deploiement).
 *
 * Lu a chaque appel (pas de cache de valeur) pour que les tests et un
 * redemarrage a chaud voient la valeur courante ; seul le log d'invalidite est
 * dedoublonne.
 */
import { logger } from "./logger.js";
import {
  parsePastDueGraceDays, DEFAULT_PAST_DUE_GRACE_DAYS, type AccessConfig,
} from "./subscription-state.js";

const PROCESS_START = new Date();
let lastInvalidLogged: string | null = null;

export function getAccessConfig(env: NodeJS.ProcessEnv = process.env): AccessConfig {
  const raw = env["PAST_DUE_GRACE_DAYS"];
  const { days, valid } = parsePastDueGraceDays(raw);
  if (!valid && lastInvalidLogged !== (raw ?? null)) {
    lastInvalidLogged = raw ?? null;
    logger.warn({ value: raw, fallback: DEFAULT_PAST_DUE_GRACE_DAYS },
      "[AccessConfig] PAST_DUE_GRACE_DAYS invalide (entier 0..30 attendu) — valeur par defaut utilisee");
  }
  let anchor = PROCESS_START;
  const rawAnchor = env["PAST_DUE_RULE_ACTIVATED_AT"];
  if (rawAnchor) {
    const d = new Date(rawAnchor);
    if (Number.isNaN(d.getTime())) {
      logger.warn({ value: rawAnchor }, "[AccessConfig] PAST_DUE_RULE_ACTIVATED_AT invalide — demarrage du processus utilise");
    } else anchor = d;
  }
  return { pastDueGraceDays: days, legacyPastDueAnchor: anchor };
}
