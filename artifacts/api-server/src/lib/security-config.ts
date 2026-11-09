/**
 * Garde-fous de configuration de securite (constat C-15, audit du 08/11/2026).
 *
 * Trois defauts permissifs existaient :
 *   1. `NODE_ENV` vaut « development » quand la variable est absente (lib/env.ts) ;
 *   2. `requireAuth` laissait passer un jeton INVALIDE quand `API_SECRET_KEY`
 *      etait absente hors production ;
 *   3. `JWT_SECRET` avait un repli code en dur (services/sessions.ts,
 *      services/google-service.ts) : un secret public signe des sessions.
 *
 * Ce module est volontairement sans dependance (ni logger, ni base) pour etre
 * importable partout et testable seul.
 *
 * Environnements reels (render.yaml) : `flowpoint-test` pose NODE_ENV=test,
 * le service de production NODE_ENV=production ; la CI pose NODE_ENV=test. Les
 * valeurs presentes dans Render ne sont pas lisibles depuis le depot : seules
 * les anomalies SANS risque de panne sont donc fatales par defaut ; les autres
 * sont journalisees, et deviennent fatales avec SECURITY_STRICT_STARTUP=true.
 */

type Env = Record<string, string | undefined>;

const REPLI_JWT_TEST = "test-only-jwt-secret-never-used-outside-vitest";

/** Vrai quand le processus tourne sur Render (variable posee par la plateforme). */
export function isRenderRuntime(e: Env = process.env): boolean {
  return Boolean(e["RENDER"]) || Boolean(e["RENDER_SERVICE_NAME"]);
}

/**
 * Le contournement « API privee ouverte » demande une intention declaree, et
 * n'est jamais honore en production ni sur Render.
 */
export function devAuthBypassAllowed(e: Env = process.env): boolean {
  return e["ALLOW_UNAUTHENTICATED_DEV"] === "true" && e["NODE_ENV"] !== "production" && !isRenderRuntime(e);
}

/**
 * Secret de signature des sessions / de chiffrement des jetons Google.
 * Aucun repli code en dur : hors tests, un secret absent leve une erreur.
 */
export function resolveJwtSecret(e: Env = process.env): string {
  const valeur = e["JWT_SECRET"];
  if (valeur && valeur.trim()) return valeur;
  if (e["NODE_ENV"] === "test") return REPLI_JWT_TEST;
  throw new Error("JWT_SECRET est absent : refus de demarrer avec un secret par defaut.");
}

export interface SecurityConfigReport {
  fatal: string[];
  warnings: string[];
}

export function evaluateSecurityConfig(e: Env = process.env): SecurityConfigReport {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const rawNodeEnv = e["NODE_ENV"];
  const deployed = isRenderRuntime(e);
  const prod = rawNodeEnv === "production";

  if (!e["JWT_SECRET"]?.trim() && rawNodeEnv !== "test") {
    fatal.push("JWT_SECRET absent : les sessions ne peuvent pas etre signees de facon sure.");
  }
  if (deployed && !rawNodeEnv?.trim()) {
    warnings.push("NODE_ENV absent sur Render : le defaut « development » s'applique et desactive des garde-fous.");
  }
  if (e["ALLOW_UNAUTHENTICATED_DEV"] === "true" && (deployed || prod)) {
    warnings.push("ALLOW_UNAUTHENTICATED_DEV=true sur un environnement deploye : le drapeau est IGNORE, retirez-le.");
  }
  if (e["ENABLE_DEV_AUTH"] === "true" && (deployed || prod)) {
    warnings.push("ENABLE_DEV_AUTH=true sur un environnement deploye : les routes dev-session restent fermees, retirez-le.");
  }
  if (!e["API_SECRET_KEY"]?.trim() && rawNodeEnv !== "test") {
    warnings.push("API_SECRET_KEY absente : le credential de service est desactive (les sessions utilisateur restent valables).");
  }
  if (e["SECURITY_STRICT_STARTUP"] === "true") {
    fatal.push(...warnings.splice(0, warnings.length));
  }
  return { fatal, warnings };
}

/** Appelee au demarrage : journalise, et arrete le processus si une anomalie fatale subsiste. */
export function enforceSecurityConfig(
  log: { warn: (m: string) => void; fatal: (m: string) => void },
  exit: (code: number) => never | void = (c) => process.exit(c),
  e: Env = process.env,
): SecurityConfigReport {
  const rapport = evaluateSecurityConfig(e);
  for (const w of rapport.warnings) log.warn(`[Securite] ${w}`);
  if (rapport.fatal.length > 0) {
    for (const f of rapport.fatal) log.fatal(`[Securite] FATAL : ${f}`);
    exit(1);
  }
  return rapport;
}
