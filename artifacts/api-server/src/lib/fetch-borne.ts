/**
 * Sortie reseau bornee dans le temps.
 *
 * MESURE DU 17/10/2026 : sur soixante appels sortants du serveur, trente-cinq
 * portaient un delai et vingt-quatre n'en portaient aucun. Parmi ces derniers,
 * SIX sont sur le chemin de connexion — echange de jeton et lecture du profil
 * chez Google, GitHub et Apple.
 *
 * `fetch` de Node ne coupe pas une requete qui n'avance plus avant ses delais
 * par defaut d'environ cinq minutes. Un fournisseur d'identite lent tenait donc
 * une connexion de login pendant des minutes, et chaque requete bloquee occupe
 * une connexion du serveur. Ce n'est pas une panne franche, c'est une
 * degradation silencieuse : le symptome est « le site ne repond plus », la
 * cause est chez un tiers.
 *
 * Cette fonction ne fait qu'une chose : poser un delai quand l'appelant n'en a
 * pas pose. Un `signal` fourni par l'appelant est respecte tel quel — on ne
 * remplace jamais une annulation voulue.
 */

/** Delai par defaut. Court : ces appels sont tous sur un chemin de requete. */
export const DELAI_SORTIE_MS = 10_000;

/** Delais par famille de fournisseur, en millisecondes. */
export const DELAIS = {
  /** Identite : l'utilisateur attend devant un ecran de connexion. */
  identite: 10_000,
  /** Cartographie et geocodage. */
  cartographie: 8_000,
  /** Courriel transactionnel. */
  courriel: 10_000,
  /** SMS. */
  sms: 10_000,
  /** Supervision. */
  supervision: 15_000,
  /** Stockage d'objets, pendant une suppression de compte : plus genereux. */
  stockage: 20_000,
} as const;

/**
 * Vrai si l'erreur est un depassement de delai pose par cette fonction.
 * `AbortSignal.timeout` rejette avec un `DOMException` nomme `TimeoutError`.
 */
export function estDepassementDeDelai(err: unknown): boolean {
  const nom = (err as { name?: string } | null)?.name;
  return nom === "TimeoutError" || nom === "AbortError";
}

export async function fetchBorne(
  entree: string | URL | Request,
  init: RequestInit = {},
  msDelai: number = DELAI_SORTIE_MS,
): Promise<Response> {
  if (init.signal) return fetch(entree, init);
  return fetch(entree, { ...init, signal: AbortSignal.timeout(msDelai) });
}
