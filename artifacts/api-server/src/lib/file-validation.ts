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
 * Resolves the MIME type to use for `filename`, or `null` when no type can be resolved.
 *
 * Returns `null` in each of the following cases, which the caller cannot tell apart
 * since the single `null` carries no reason:
 *
 * 1. Unknown extension: `extractExtension(filename)` (the segment after the last `.`,
 *    lowercased, or `""` when `filename` has no `.`) is not a key of `extToMimes`.
 *    `allowedExtensions` is built on the preceding line from `Object.keys(extToMimes)`,
 *    so the guard `!allowedExtensions.has(ext)` is exactly that test.
 * 2. Unknown supplied type: `suppliedMime` is a non-empty string but is not a key of
 *    `allowedMime` (`!allowedMime[suppliedMime]`) — it is not an accepted type at all.
 * 3. Supplied type inconsistent with the extension: `suppliedMime` is a key of
 *    `allowedMime`, yet it is absent from `allowedMimesForExt` (i.e. `extToMimes[ext]`)
 *    — accepted in general, but not for this extension.
 * 4. No supplied type and no fallback: `suppliedMime` is falsy (`undefined` or `""`) and
 *    `allowedMimesForExt` is empty, so `allowedMimesForExt[0]` is `undefined` and the
 *    `?? null` applies. This requires `extToMimes[ext]` to be an empty array, case 1
 *    having already excluded a missing key; `buildExtToMimes` never produces empty
 *    arrays, but `extToMimes` is a plain parameter and is not otherwise constrained.
 *
 * Otherwise a MIME string is returned: `suppliedMime` when it passes cases 2 and 3, or
 * `allowedMimesForExt[0]`, the first type registered for the extension, when none was supplied.
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
