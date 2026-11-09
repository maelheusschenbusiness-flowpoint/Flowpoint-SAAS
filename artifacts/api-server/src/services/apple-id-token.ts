/**
 * FlowPoint — verification complete d'un id_token Sign in with Apple.
 *
 * Controles : signature RS256 contre le JWKS d'Apple, `iss`, `aud`, `exp`
 * (et `iat` non situe dans le futur), `nonce` egal a celui du depart du flux.
 * L'adresse e-mail n'est retenue que si elle vient de ce jeton signe ET que
 * `email_verified` vaut true : le champ `user` du formulaire est controle par
 * le navigateur et n'est jamais une source d'identite.
 */
import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from "crypto";

export const APPLE_ISSUER = "https://appleid.apple.com";
const CLOCK_SKEW_S = 60;

export interface AppleJwk { kid?: string; kty?: string; [k: string]: unknown }
export type AppleKeysFetcher = () => Promise<AppleJwk[]>;

export interface AppleIdentity {
  sub: string;
  email: string;
}

export class AppleTokenError extends Error {
  constructor(public readonly code: string) {
    super(`apple_id_token_${code}`);
  }
}

function eq(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function verifyAppleIdToken(
  idToken: string,
  opts: { clientId: string; expectedNonce: string; fetchKeys: AppleKeysFetcher; nowSeconds?: number },
): Promise<AppleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AppleTokenError("malformed");
  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    throw new AppleTokenError("malformed");
  }
  if (header.alg !== "RS256") throw new AppleTokenError("bad_alg");

  const keys = await opts.fetchKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AppleTokenError("unknown_key");
  const pubKey = createPublicKey({ key: jwk as never, format: "jwk" });
  const valid = cryptoVerify("SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), pubKey, Buffer.from(parts[2]!, "base64url"));
  if (!valid) throw new AppleTokenError("bad_signature");

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload["iss"] !== APPLE_ISSUER) throw new AppleTokenError("bad_iss");
  if (payload["aud"] !== opts.clientId) throw new AppleTokenError("bad_aud");
  if (typeof payload["exp"] !== "number" || payload["exp"] <= now - CLOCK_SKEW_S) throw new AppleTokenError("expired");
  if (typeof payload["iat"] === "number" && payload["iat"] > now + CLOCK_SKEW_S) throw new AppleTokenError("iat_future");
  // Le nonce est impose : un jeton sans nonce (ou avec un autre) n'appartient pas a ce flux.
  if (!opts.expectedNonce || !eq(payload["nonce"], opts.expectedNonce)) throw new AppleTokenError("bad_nonce");

  const sub = payload["sub"];
  const email = payload["email"];
  if (typeof sub !== "string" || !sub) throw new AppleTokenError("no_sub");
  if (typeof email !== "string" || !email.trim()) throw new AppleTokenError("no_email");
  const verified = payload["email_verified"];
  if (verified !== true && verified !== "true") throw new AppleTokenError("email_unverified");
  return { sub, email: email.toLowerCase().trim() };
}
