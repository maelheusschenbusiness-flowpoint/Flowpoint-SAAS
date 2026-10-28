import path from "path";

export function sanitizeFilename(raw: string): string {
  const base = path.basename(raw).replace(/[/\\]/g, "");
  const safe = base.replace(/[^a-zA-Z0-9 ._\-]/g, "_").replace(/\.{2,}/g, ".");
  return safe.slice(0, 200) || "file";
}

export function extractExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function buildExtToMimes(allowedMime: Record<string, string>): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [mime, ext] of Object.entries(allowedMime)) {
    if (!map[ext]) map[ext] = [];
    map[ext]!.push(mime);
  }
  return map;
}

/**
 * Resout le type MIME a retenir pour `filename`, ou `null`.
 *
 * La valeur `null` est renvoyee dans quatre cas distincts, que l'appelant ne
 * peut pas differencier a partir du seul retour :
 *
 * 1. Extension inconnue : `extractExtension(filename)` ne fait pas partie des
 *    cles de `extToMimes` (`!allowedExtensions.has(ext)`). Inclut le cas d'un
 *    nom de fichier sans extension, ou `ext` vaut la chaine vide.
 * 2. MIME fourni non autorise : `suppliedMime` est une chaine non vide mais
 *    n'est pas une cle de `allowedMime` (`!allowedMime[suppliedMime]`).
 * 3. MIME fourni incoherent avec l'extension : `suppliedMime` est une cle de
 *    `allowedMime`, mais n'appartient pas a `extToMimes[ext]`
 *    (`!allowedMimesForExt.includes(suppliedMime)`).
 * 4. Aucun MIME deductible : `suppliedMime` est absent ou vide et
 *    `extToMimes[ext]` est une liste vide, donc `allowedMimesForExt[0]` est
 *    `undefined` et l'expression `?? null` rend `null`.
 *
 * Dans tous les autres cas la fonction renvoie une chaine : `suppliedMime`
 * lui-meme lorsqu'il est fourni et coherent, sinon le premier element de
 * `extToMimes[ext]`.
 */
export function validateMimeExtConsistency(
  suppliedMime: string | undefined,
  filename:     string,
  allowedMime:  Record<string, string>,
  extToMimes:   Record<string, string[]>,
): string | null {
  const ext = extractExtension(filename);
  const allowedExtensions = new Set(Object.keys(extToMimes));
  if (!allowedExtensions.has(ext)) return null;

  const allowedMimesForExt = extToMimes[ext] ?? [];

  if (suppliedMime) {
    if (!allowedMime[suppliedMime]) return null;
    if (!allowedMimesForExt.includes(suppliedMime)) return null;
    return suppliedMime;
  }

  return allowedMimesForExt[0] ?? null;
}
