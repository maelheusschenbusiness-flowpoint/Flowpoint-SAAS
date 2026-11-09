/**
 * Cible de la certification : locale (harnais) ou environnement de TEST.
 * La PRODUCTION est refusee, quoi qu'on passe dans CERT_BASE_URL.
 */
export const BASE_URL = (process.env["CERT_BASE_URL"] ?? "http://127.0.0.1:4321").replace(/\/$/, "");

const PRODUCTION = /(^|\.)flowpoint\.pro$/i;
const AUTORISES = [/^127\.0\.0\.1$/, /^localhost$/, /^flowpoint-test\.onrender\.com$/];

export function verifierCible(url: string = BASE_URL): { host: string; local: boolean } {
  const host = new URL(url).hostname;
  if (PRODUCTION.test(host)) throw new Error(`CIBLE REFUSEE : ${host} est la PRODUCTION. La certification ne vise jamais flowpoint.pro / app.flowpoint.pro.`);
  if (!AUTORISES.some((re) => re.test(host))) throw new Error(`CIBLE REFUSEE : ${host} n'est ni local ni flowpoint-test.onrender.com.`);
  return { host, local: host === "127.0.0.1" || host === "localhost" };
}

export const IS_LOCAL: boolean = verifierCible().local;
/** Les parcours qui ECRIVENT (inscription, paiement) ne tournent en distant que sur demande explicite. */
export const REMOTE_WRITES = process.env["CERT_ALLOW_REMOTE_WRITES"] === "1";
