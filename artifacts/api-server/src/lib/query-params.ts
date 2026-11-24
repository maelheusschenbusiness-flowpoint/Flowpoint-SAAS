/**
 * Lecture d'un entier dans une chaine de requete.
 *
 * Une valeur de `req.query` n'est pas un nombre : c'est ce que le client a
 * tape. Elle peut etre absente, repetee (`?limit=1&limit=2` donne un tableau),
 * vide, ou ne ressembler a un nombre que de loin. `parseInt` accepte les
 * prefixes — « 30abc » donne 30, « 7.9 » donne 7, « 0x10 » donne 16 — et
 * laisse passer un signe moins. Une limite negative partait ainsi telle quelle
 * dans un `LIMIT`, que PostgreSQL refuse : la route repondait 500 pour un
 * simple `?limit=-5`.
 *
 * Ici, rien n'est devine. Seule une suite de chiffres decimaux, eventuellement
 * precedee d'un signe moins, est lue ; tout le reste vaut « non fourni » et
 * rend la valeur par defaut. Une valeur lue hors des bornes rend, au choix de
 * l'appelant, la valeur par defaut ou la borne la plus proche : une liste veut
 * etre ramenee a sa taille maximale, une fenetre de jours veut retomber sur sa
 * duree habituelle.
 */

/**
 * Que faire d'une valeur bien formee mais hors de [min, max].
 * - `defaut` : on rend la valeur par defaut.
 * - `borner` : on rend la borne la plus proche.
 */
export type HorsBornes = "defaut" | "borner";

export interface QueryIntOptions {
  /** Valeur rendue quand rien d'exploitable n'a ete fourni. */
  defaut: number;
  /** Plus petite valeur acceptee. */
  min: number;
  /** Plus grande valeur acceptee. */
  max: number;
  /** Traitement d'une valeur hors de [min, max]. */
  horsBornes: HorsBornes;
}

/** Un signe moins optionnel, puis des chiffres decimaux, et rien d'autre. */
const ENTIER_DECIMAL = /^-?[0-9]+$/;

export function queryInt(value: unknown, opts: QueryIntOptions): number {
  if (typeof value !== "string" || !ENTIER_DECIMAL.test(value)) return opts.defaut;

  const n = Number(value);
  // Au-dela de 2^53, deux chaines distinctes donnent le meme nombre : on ne
  // lit pas ce qu'on ne peut pas representer fidelement.
  if (!Number.isSafeInteger(n)) return opts.defaut;

  if (n < opts.min) return opts.horsBornes === "borner" ? opts.min : opts.defaut;
  if (n > opts.max) return opts.horsBornes === "borner" ? opts.max : opts.defaut;
  return n;
}
