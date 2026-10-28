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
 * Resout le type MIME effectif d'un fichier a partir de son extension et du type MIME
 * eventuellement fourni par l'appelant.
 *
 * Renvoie `null` dans chacun des cas suivants, sans les distinguer :
 * - l'extension extraite de `filename` n'est pas une cle de `extToMimes`
 *   (extension inconnue, ou nom de fichier sans extension) ;
 * - `suppliedMime` est fourni mais n'est pas une cle de `allowedMime`
 *   (type MIME non autorise globalement) ;
 * - `suppliedMime` est fourni et autorise globalement, mais n'appartient pas a
 *   `extToMimes[ext]` (incoherence entre le type MIME et l'extension) ;
 * - `suppliedMime` est absent (ou vide) et `extToMimes[ext]` est un tableau vide,
 *   donc aucun type MIME par defaut n'est disponible pour cette extension.
 *
 * Sinon, renvoie `suppliedMime` quand il est fourni et coherent, ou le premier type
 * MIME de `extToMimes[ext]` quand il ne l'est pas.
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
