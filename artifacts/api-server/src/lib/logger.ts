import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Chemins masques dans les journaux.
 *
 * La liste ne couvrait que trois en-tetes. Un appel comme
 * `logger.warn({ err, token }, "…")` ecrivait donc le jeton en clair : mesure du
 * 17/10/2026, services/seller-attribution.ts journalisait le jeton de
 * `pending_signups`, c'est-a-dire l'identifiant qui autorise une inscription.
 * Un jeton dans un journal est une credential rejouable par quiconque lit les
 * journaux.
 *
 * La rédaction est posee ICI plutot qu'a chaque appel : un site d'appel oublie
 * est la regle, pas l'exception, et un nouveau code n'a rien a savoir pour etre
 * sur. Les motifs `*.x` couvrent le deuxieme niveau, la ou arrivent la plupart
 * des objets d'erreur et de contexte.
 */
const CHAMPS_SENSIBLES = [
  "token", "accessToken", "refreshToken", "sessionToken", "magicToken",
  "password", "secret", "clientSecret", "client_secret",
  "apiKey", "api_key", "adminKey", "admin_key", "serviceKey",
  "authorization", "cookie", "setupIntentSecret",
];

export const REDACTED_PATHS: readonly string[] = [
  // en-tetes et reponses
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  // le corps d'une requete n'a pas sa place dans un journal : il porte aussi
  // bien un mot de passe que des donnees personnelles sans interet operationnel.
  "req.body",
  "body",
  // champs sensibles, au premier et au deuxieme niveau
  ...CHAMPS_SENSIBLES,
  ...CHAMPS_SENSIBLES.map((c) => `*.${c}`),
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: [...REDACTED_PATHS], censor: "[masque]" },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
