/**
 * Garde de cles de la certification Stripe REEL (mode TEST uniquement).
 *
 * Regle absolue : aucun script ni test de ce dossier n'accepte une cle qui ne soit pas une cle
 * de TEST. Les fonctions ici LEVENT une erreur dont le message ne contient JAMAIS la valeur de la cle
 * (seulement le nom de la variable et un prefixe generique).
 */

export class CleRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleRefusee";
  }
}

/** Variables qui, si elles portent une cle LIVE, rendent l'environnement non sur pour la campagne. */
const VARIABLES_LIVE = ["STRIPE_LIVE_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_API_KEY", "PUBLIC_STRIPE_API_KEY", "STRIPE_PUBLISHABLE_KEY"];
const SECRETS_WEBHOOK_LIVE = ["STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_RENDER"];

type Env = Record<string, string | undefined>;

/** `sk_test_` exigee. `sk_live_`, `rk_live_`, vide, ou tout autre format sont refuses. */
export function assertCleSecreteTest(cle: string | undefined, nom = "STRIPE_TEST_SECRET_KEY"): string {
  if (!cle || !cle.trim()) throw new CleRefusee(`${nom} est absente.`);
  const v = cle.trim();
  if (/^(sk|rk|pk)_live_/.test(v)) throw new CleRefusee(`${nom} est une cle LIVE : refusee. Cette campagne n'utilise que des cles de TEST (sk_test_).`);
  if (!v.startsWith("sk_test_")) throw new CleRefusee(`${nom} ne commence pas par sk_test_ : refusee.`);
  if (v.length < 20 || /\s/.test(v)) throw new CleRefusee(`${nom} a un format invalide : refusee.`);
  return v;
}

/** `pk_test_` exigee. */
export function assertClePubliableTest(cle: string | undefined, nom = "STRIPE_TEST_PUBLISHABLE_KEY"): string {
  if (!cle || !cle.trim()) throw new CleRefusee(`${nom} est absente.`);
  const v = cle.trim();
  if (/^(sk|rk|pk)_live_/.test(v)) throw new CleRefusee(`${nom} est une cle LIVE : refusee.`);
  if (!v.startsWith("pk_test_")) throw new CleRefusee(`${nom} ne commence pas par pk_test_ : refusee.`);
  return v;
}

/**
 * Secret de signature de webhook. Le prefixe `whsec_` ne distingue pas test et live ; on refuse donc
 * (a) tout format different de `whsec_...`, (b) une valeur IDENTIQUE a un secret de webhook de production
 * present dans l'environnement (STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_RENDER).
 * Le rapprochement final est fait par l'application elle-meme : elle rejette un evenement dont `livemode`
 * ne correspond pas a son mode (400 « Event mode mismatch »).
 */
export function assertSecretWebhookTest(secret: string | undefined, env: Env = process.env, nom = "STRIPE_TEST_WEBHOOK_SECRET"): string {
  if (!secret || !secret.trim()) throw new CleRefusee(`${nom} est absent.`);
  const v = secret.trim();
  if (!v.startsWith("whsec_") || v.length < 12 || /\s/.test(v)) throw new CleRefusee(`${nom} n'a pas le format whsec_... : refuse.`);
  for (const autre of SECRETS_WEBHOOK_LIVE) {
    const o = env[autre]?.trim();
    if (o && o === v) throw new CleRefusee(`${nom} est identique a ${autre} (secret d'un endpoint de production) : refuse.`);
  }
  return v;
}

/** Echoue si une cle LIVE est presente dans l'environnement du processus de campagne. */
export function assertEnvironnementSansCleLive(env: Env = process.env): void {
  for (const nom of VARIABLES_LIVE) {
    const v = env[nom]?.trim();
    if (v && /^(sk|rk|pk)_live_/.test(v)) {
      throw new CleRefusee(`${nom} contient une cle LIVE dans l'environnement : retirez-la avant de lancer la campagne (sessions separees, aucun melange test/live).`);
    }
  }
}

/** Masque toute valeur secrete connue dans un texte (journaux, messages d'erreur). */
export function masquerSecrets(texte: string, env: Env = process.env): string {
  let t = String(texte);
  const noms = Object.keys(env).filter((k) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/i.test(k));
  for (const n of noms) {
    const v = env[n];
    if (v && v.length >= 8) t = t.split(v).join(`[${n}]`);
  }
  return t.replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]{6,}/g, "[cle-stripe]").replace(/\bwhsec_[A-Za-z0-9]{6,}/g, "[whsec]");
}

/** L'objet Balance d'un compte Stripe porte `livemode` : defense en profondeur apres le test de prefixe. */
export function assertCompteTest(balance: { livemode?: unknown } | null | undefined): void {
  if (!balance || balance.livemode !== false) {
    throw new CleRefusee("Le compte Stripe interroge n'est pas en mode TEST (livemode != false) : arret.");
  }
}
