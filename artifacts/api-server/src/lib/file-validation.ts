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
 * Resolves the MIME type to use for `filename`, or `null` when no MIME type can be agreed on.
 *
 * `null` is returned, indistinguishably, in each of the following four cases:
 *
 * 1. Unknown extension: `extractExtension(filename)` (the lowercased segment after the last
 *    `"."`, or `""` when `filename` contains no usable segment) is not a key of `extToMimes`.
 *    Reached before `suppliedMime` is looked at at all, so it applies whether or not a MIME
 *    type was supplied.
 * 2. Unknown supplied MIME type: `suppliedMime` is truthy but is not a key of `allowedMime`,
 *    i.e. the caller supplied a MIME type this validator does not accept for any extension.
 * 3. Supplied MIME type inconsistent with the extension: `suppliedMime` is truthy and is a key
 *    of `allowedMime`, but is not contained in `extToMimes[ext]`, i.e. it is accepted in general
 *    but not for this extension.
 * 4. No MIME type supplied and no fallback available: `suppliedMime` is falsy (`undefined` or
 *    the empty string) and `extToMimes[ext]` has no element at index 0, so there is no default
 *    MIME type to infer from the extension.
 *
 * In every other case a non-null string is returned: `suppliedMime` itself when it passes cases
 * 2 and 3, otherwise the first entry of `extToMimes[ext]`.
 *
 * Note that cases 2, 3 and 4 signal a rejection, while case 1 only signals that this check does
 * not apply; callers needing to tell them apart cannot do so from the return value.
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
