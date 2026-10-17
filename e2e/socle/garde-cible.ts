/**
 * Garde-fou de cible.
 *
 * Ces tests creent des comptes, lancent des audits et ecrivent en base. Lances
 * par erreur contre la production, ils y laisseraient des donnees. Le risque
 * n'est pas theorique : une variable d'environnement oubliee suffit.
 *
 * La regle est donc une liste BLANCHE, pas une liste noire : seules les cibles
 * reconnues comme locales ou de recette sont acceptees. Tout le reste est
 * refuse, y compris une URL inconnue.
 */
const HOTES_AUTORISES = [
  "127.0.0.1",
  "localhost",
  "[::1]",
];

const SUFFIXES_AUTORISES = [
  ".localhost",
  ".test",
  // Instance de recette Render
  "flowpoint-test.onrender.com",
];

export function verifierCible(urlBrute: string): URL {
  let url: URL;
  try {
    url = new URL(urlBrute);
  } catch {
    throw new Error(`E2E_BASE_URL n'est pas une URL valide : ${urlBrute}`);
  }
  const hote = url.hostname.toLowerCase();
  const autorise =
    HOTES_AUTORISES.includes(hote) ||
    SUFFIXES_AUTORISES.some((s) => hote === s.replace(/^\./, "") || hote.endsWith(s));

  if (!autorise) {
    throw new Error(
      `REFUS : la cible E2E « ${hote} » n'est pas un environnement local ou de recette.\n` +
      `Ces tests creent des comptes et ecrivent en base. Cibles acceptees : ` +
      `${[...HOTES_AUTORISES, ...SUFFIXES_AUTORISES].join(", ")}.`
    );
  }
  return url;
}
