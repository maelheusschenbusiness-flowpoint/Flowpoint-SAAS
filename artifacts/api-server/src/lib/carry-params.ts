/**
 * FlowPoint — funnel parameter preservation
 *
 * A prospect arrives on the funnel with parameters that identify where they came
 * from. Every hop that drops them loses the attribution for good: the funnel
 * redirects a visitor at least twice (pricing → signin → checkout, plus the
 * OAuth round trip), and `res.redirect` keeps only what the call site spells out.
 *
 * Until now each page re-appended its own parameter by hand — `pricing.html`
 * rewrote `fp_ref` into the links it could find with a querySelector. Anything
 * the server redirected, and any link that selector missed, lost it.
 *
 * This is the one place that decides what survives a hop. The list is an
 * allowlist on purpose: a redirect must never forward an arbitrary query string,
 * because that is how an open-redirect or a reflected parameter gets in.
 */

/** Parameters that identify where a prospect came from, and what they chose. */
// `fp_lid` (Conversion B) is the opaque 22-character lead id from an outreach email.
export const CARRIED_PARAMS = ["fp_ref", "ref", "plan", "fp_lid"] as const;

/** Values stay short and opaque: anything longer is not one of ours. */
const MAX_VALUE_LENGTH = 128;
const SAFE_VALUE = /^[A-Za-z0-9._~-]+$/;

export function isCarryableValue(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_VALUE_LENGTH
    && SAFE_VALUE.test(value);
}

type QueryLike = Record<string, unknown> | undefined;

/**
 * Pick the carryable parameters out of a request query.
 * Array values (`?plan=a&plan=b`) are ambiguous and therefore dropped.
 */
export function carriedParams(query: QueryLike): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const name of CARRIED_PARAMS) {
    const value = query[name];
    if (isCarryableValue(value)) out[name] = value;
  }
  return out;
}

/**
 * Append the carryable parameters of `query` to `target`, without overwriting a
 * parameter the target already sets — the call site is more specific than the
 * inbound request, so its own `error=` or `plan=` wins.
 *
 * `target` may be relative (`/signin.html`) or absolute
 * (`https://app.flowpoint.pro/signin.html`); both come back in the same shape
 * they were given, so existing redirects keep behaving identically when there is
 * nothing to carry.
 */
export function withCarriedParams(target: string, query: QueryLike): string {
  const carried = carriedParams(query);
  if (Object.keys(carried).length === 0) return target;

  const [base, fragment] = splitFragment(target);
  const questionMark = base.indexOf("?");
  const path = questionMark === -1 ? base : base.slice(0, questionMark);
  const existing = new URLSearchParams(questionMark === -1 ? "" : base.slice(questionMark + 1));

  for (const [name, value] of Object.entries(carried)) {
    if (!existing.has(name)) existing.append(name, value);
  }

  const search = existing.toString();
  return path + (search ? "?" + search : "") + fragment;
}

function splitFragment(target: string): [string, string] {
  const hash = target.indexOf("#");
  return hash === -1 ? [target, ""] : [target.slice(0, hash), target.slice(hash)];
}
