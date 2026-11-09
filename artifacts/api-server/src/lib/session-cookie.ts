/**
 * Attributs du cookie de session `fp_token` (audit C-01).
 *
 * Le dashboard est servi par l'API elle-meme (appels relatifs `/api/...`,
 * voir artifacts/flowpoint-export) : front et API sont same-origin, donc
 * `SameSite=Lax` suffit. Les retours Stripe / OAuth / lien magique sont des
 * navigations top-level GET, pour lesquelles Lax envoie le cookie.
 * `SameSite=None` n'apportait que l'envoi du cookie sur des requetes
 * cross-site (surface CSRF) : on ne l'emet plus nulle part.
 */
export function sessionCookieSameSite(): "lax" {
  return "lax";
}
