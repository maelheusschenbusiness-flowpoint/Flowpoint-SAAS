/**
 * Activation explicite des planificateurs de la bêta 2.0.
 *
 * POURQUOI. Reunir la bêta (Test-Replit) a la branche de production (Flowpoint)
 * ne doit RIEN demarrer tout seul : un planificateur actif publie, envoie ou
 * consomme des quotas pour de vrais clients. Un planificateur de bêta ne tourne
 * donc en production que si sa variable d'environnement vaut exactement `true`.
 * Hors production (developpement, tests, CI), le comportement est inchange.
 *
 * Interrupteurs :
 *   GBP_POST_SCHEDULER_ENABLED   publication planifiee de posts Google Business Profile
 *   WORKFLOW_SCHEDULER_ENABLED   workflows IA planifies (dont rapports AI Workspace Launch)
 */
export type BetaScheduler = "GBP_POST_SCHEDULER_ENABLED" | "WORKFLOW_SCHEDULER_ENABLED";

export function betaSchedulerEnabled(flag: BetaScheduler, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NODE_ENV"] !== "production") return true;
  return env[flag] === "true";
}
