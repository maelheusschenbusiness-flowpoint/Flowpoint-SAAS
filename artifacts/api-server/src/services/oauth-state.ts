/**
 * FlowPoint — protection CSRF/rejeu des connexions OAuth (Google, GitHub, Apple).
 *
 * Avant ce module, le parametre `state` de Google etait un JSON base64 non signe
 * que le callback decodait sans jamais le comparer a rien, GitHub n'en envoyait
 * pas et Apple n'avait ni `state` verifie ni `nonce`. Un tiers pouvait donc
 * faire terminer a une victime un flux OAuth qu'il avait initie (login CSRF).
 *
 * Principe :
 *  - au depart du flux, le serveur tire un `state` aleatoire (32 octets) ;
 *  - il pose un cookie httpOnly qui contient ce `state`, son expiration et la
 *    charge utile (plan, seller_code, fp_lid, redirect_to) : la charge utile ne
 *    voyage plus dans l'URL du fournisseur ;
 *  - au callback, le `state` recu doit etre identique (comparaison a temps
 *    constant) a celui du cookie, non expire, et n'a servi qu'une fois : le
 *    cookie est supprime a la lecture et le `state` est memorise comme consomme.
 *
 * Le cookie est la liaison au navigateur : sans lui, le callback est refuse.
 * Aucun secret serveur n'est necessaire. Une charge utile alteree par
 * l'utilisateur dans son propre cookie ne touche que son propre parcours (meme
 * pouvoir que modifier le parametre `plan` de l'URL).
 */
import { randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";

export type OAuthProvider = "google" | "github" | "apple";

/** Duree de validite d'un depart de flux : le temps de s'authentifier chez le fournisseur. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthPayload {
  plan: string | null;
  redirect_to: string | null;
  seller_code: string | null;
  fp_lid: string | null;
}

export interface OAuthStateRecord extends OAuthPayload {
  /** Valeur envoyee au fournisseur dans `state`. */
  state: string;
  /** Valeur envoyee a Apple dans `nonce` (et recontrolee dans l'id_token). */
  nonce: string;
  exp: number;
}

export const EMPTY_OAUTH_PAYLOAD: OAuthPayload = {
  plan: null, redirect_to: null, seller_code: null, fp_lid: null,
};

export type OAuthStateResult =
  | { ok: true; record: OAuthStateRecord }
  | { ok: false; reason: "missing_state" | "missing_cookie" | "malformed" | "mismatch" | "expired" | "replayed" };

const PLANS = new Set(["standard", "pro", "ultra"]);

export function cookieName(provider: OAuthProvider): string {
  return `fp_oauth_${provider}`;
}

/** Chemin restreint : le cookie n'est envoye qu'aux routes d'authentification. */
const COOKIE_PATH = "/api/auth";

function cookieOptions(provider: OAuthProvider, isProd: boolean, maxAge?: number) {
  return {
    httpOnly: true,
    secure: isProd,
    // Apple repond par un POST inter-sites (response_mode=form_post) : un cookie
    // Lax ne serait pas renvoye. Google et GitHub reviennent par navigation GET
    // de premier niveau, Lax suffit.
    sameSite: (provider === "apple" && isProd ? "none" : "lax") as "none" | "lax",
    path: COOKIE_PATH,
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/** `redirect_to` n'est accepte que s'il designe une page du meme site. */
export function safeRedirectTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\r\n]/.test(value)) return null;
  return value;
}

export function sanitizePlan(value: unknown): string | null {
  return typeof value === "string" && PLANS.has(value) ? value : null;
}

// Etats deja consommes (defense en profondeur en plus de la suppression du cookie).
const consumed = new Map<string, number>();
function pruneConsumed(now: number): void {
  for (const [k, exp] of consumed) if (exp <= now) consumed.delete(k);
}

/** Pose le cookie de liaison et renvoie l'enregistrement (dont le `state` a transmettre). */
export function startOAuthState(
  res: Response,
  provider: OAuthProvider,
  payload: OAuthPayload,
  isProd: boolean,
  now: number = Date.now(),
): OAuthStateRecord {
  const record: OAuthStateRecord = {
    ...payload,
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    exp: now + OAUTH_STATE_TTL_MS,
  };
  res.cookie(
    cookieName(provider),
    Buffer.from(JSON.stringify(record)).toString("base64url"),
    cookieOptions(provider, isProd, OAUTH_STATE_TTL_MS),
  );
  return record;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verifie et CONSOMME l'etat. Le cookie est supprime dans tous les cas, succes
 * ou echec : un `state` ne sert qu'une fois.
 */
export function consumeOAuthState(
  req: Request,
  res: Response,
  provider: OAuthProvider,
  receivedState: unknown,
  isProd: boolean,
  now: number = Date.now(),
): OAuthStateResult {
  const name = cookieName(provider);
  const raw = (req as unknown as { cookies?: Record<string, string> }).cookies?.[name];
  res.clearCookie(name, cookieOptions(provider, isProd));

  if (typeof receivedState !== "string" || receivedState.length === 0) return { ok: false, reason: "missing_state" };
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "missing_cookie" };

  let rec: Partial<OAuthStateRecord>;
  try {
    rec = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OAuthStateRecord>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!rec || typeof rec.state !== "string" || typeof rec.nonce !== "string" || typeof rec.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (!safeEqual(rec.state, receivedState)) return { ok: false, reason: "mismatch" };
  if (rec.exp <= now) return { ok: false, reason: "expired" };
  pruneConsumed(now);
  if (consumed.has(rec.state)) return { ok: false, reason: "replayed" };
  consumed.set(rec.state, rec.exp);

  return {
    ok: true,
    record: {
      state: rec.state,
      nonce: rec.nonce,
      exp: rec.exp,
      plan: sanitizePlan(rec.plan),
      redirect_to: safeRedirectTo(rec.redirect_to),
      seller_code: typeof rec.seller_code === "string" && /^SELLER-[A-Z0-9]{1,20}$/.test(rec.seller_code) ? rec.seller_code : null,
      fp_lid: typeof rec.fp_lid === "string" ? rec.fp_lid : null,
    },
  };
}

/** Pour les tests uniquement. */
export function _resetConsumedOAuthStates(): void {
  consumed.clear();
}
