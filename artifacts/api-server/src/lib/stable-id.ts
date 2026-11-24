import { createHash } from "node:crypto";

/**
 * Identifiant stable, unique et de longueur fixe derive d'une cle metier.
 *
 * Remplace les identifiants du type `prefixe_<org>_<valeur>.slice(0, n)` : une troncature place
 * la collision dans la partie variable (URL, mot-cle, date) et, quand `id` est la cle primaire,
 * transforme un deuxieme enregistrement legitime en violation de cle (500, ou echec avale par un
 * `.catch(() => {})`). Les parties sont serialisees en JSON : ("a|b","c") != ("a","b|c").
 */
export function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40)}`;
}
