/**
 * Politique CORS avec credentials (audit C-01).
 *
 * - Production (NODE_ENV=production) : liste blanche EXACTE uniquement
 *   (domaines FlowPoint + origines declarees en variables d'environnement).
 *   Ni localhost, ni *.replit.dev / *.replit.app.
 * - Hors production (test Render, dev, Replit) : localhost et Replit restent
 *   acceptes pour ne pas casser les environnements de test.
 */

export type OriginPattern = string | RegExp;

export const FLOWPOINT_ORIGINS = [
  "https://app.flowpoint.pro",
  "https://flowpoint.pro",
  "https://www.flowpoint.pro",
] as const;

const NON_PROD_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  // Ancres strictes : https + sous-domaine(s) Replit, jamais de suffixe libre.
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.replit\.dev$/,
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.replit\.app$/,
];

const ENV_KEYS = ["PUBLIC_URL", "PUBLIC_BASE_URL", "APP_URL", "FRONTEND_URL", "CORS_ORIGIN"];

export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): OriginPattern[] {
  const isProduction = env["NODE_ENV"] === "production";
  const list: OriginPattern[] = [...FLOWPOINT_ORIGINS];
  if (!isProduction) list.push(...NON_PROD_PATTERNS);
  for (const key of ENV_KEYS) {
    for (const raw of (env[key] ?? "").split(",")) {
      const candidate = raw.trim();
      if (!candidate) continue;
      let origin: string;
      try {
        // Normalise (retire chemin / slash final) ; refuse tout ce qui n'est pas http(s).
        const u = new URL(candidate);
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
        origin = u.origin;
      } catch {
        continue;
      }
      if (!list.includes(origin)) list.push(origin);
    }
  }
  return list;
}

export function isOriginAllowed(origin: string, allowed: OriginPattern[]): boolean {
  return allowed.some((p) => (typeof p === "string" ? p === origin : p.test(origin)));
}
