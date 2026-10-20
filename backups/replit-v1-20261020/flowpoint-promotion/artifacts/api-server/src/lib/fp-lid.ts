/**
 * Conversion B — `fp_lid`, the opaque lead identifier carried from a Smartlead
 * email to the organization it converts into.
 *
 * Issued by the acquisition engine: 128 random bits, base64url without
 * padding, exactly 22 characters `[A-Za-z0-9_-]`. It carries no personal data.
 * Anything else — absent, malformed, too long, wrong type — is NULL: an
 * attribution is never a reason to refuse or to error on a signup.
 */
export const FP_LID_RE = /^[A-Za-z0-9_-]{22}$/;

export function normalizeFpLid(value: unknown): string | null {
  return typeof value === "string" && FP_LID_RE.test(value) ? value : null;
}
