/**
 * Configuration de la suite Playwright « Stripe reel » : decide, depuis l'environnement, si la suite
 * PEUT tourner, et sinon pourquoi (message explicite, jamais d'echec silencieux ni de faux vert).
 */
import { CleRefusee, assertClePubliableTest, assertSecretWebhookTest, assertEnvironnementSansCleLive } from "./garde-cles.ts";

type Env = Record<string, string | undefined>;

export const HOTES_AUTORISES = [/^127\.0\.0\.1$/, /^localhost$/, /^flowpoint-test\.onrender\.com$/];
const PRODUCTION = /(^|\.)flowpoint\.pro$/i;

export interface ConfigStripeReel {
  pret: boolean;
  /** Raisons pour lesquelles la suite est sautee (vide si pret). */
  raisons: string[];
  baseUrl: string;
  mode: "L" | "R";
  /** Base de l'adresse d'essai, ex. proprietaire@gmail.com -> proprietaire+fp-cert-<run>-<etiquette>@gmail.com */
  emailBase: string;
  /**
   * Mode « contrat » : prerequis MINIMAUX (demande explicite + cible autorisee + aucune cle LIVE). Il permet d'executer le parcours
   * navigateur reel et de n'asserter que sur les reponses API de l'application, sans cle secrete ni base. Les preuves cote Stripe /
   * base (suite complete) exigent `pret`.
   */
  pretContrat: boolean;
  raisonsContrat: string[];
  /** Dossier des e-mails captures (Mode L) ; vide en Mode R. */
  dossierMails: string;
}

export function verifierBaseUrl(url: string): { hote: string; local: boolean } {
  let u: URL;
  try { u = new URL(url); } catch { throw new CleRefusee(`CERT_STRIPE_BASE_URL invalide : ${url}`); }
  if (PRODUCTION.test(u.hostname)) throw new CleRefusee(`CIBLE REFUSEE : ${u.hostname} est la PRODUCTION.`);
  if (!HOTES_AUTORISES.some((re) => re.test(u.hostname))) throw new CleRefusee(`CIBLE REFUSEE : ${u.hostname} n'est ni local ni flowpoint-test.onrender.com.`);
  return { hote: u.hostname, local: u.hostname === "127.0.0.1" || u.hostname === "localhost" };
}

/** Construit une adresse d'essai par adressage `+` ; refuse une base invalide. */
export function emailDeTest(base: string, run: string, etiquette: string): string {
  const m = /^([^@+\s]+)@([^@\s]+\.[^@\s]+)$/.exec(base.trim());
  if (!m) throw new CleRefusee("CERT_STRIPE_EMAIL_BASE doit etre une adresse sans « + », ex. nom@domaine.tld.");
  const tag = `fp-cert-${run}-${etiquette}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${m[1]}+${tag}@${m[2]}`;
}

/** Motif commun a toutes les adresses d'essai d'une campagne (utilise par nettoyage / verification). */
export function motifEmailCampagne(base: string): RegExp {
  const m = /^([^@+\s]+)@([^@\s]+)$/.exec(base.trim());
  if (!m) throw new CleRefusee("CERT_STRIPE_EMAIL_BASE invalide.");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc(m[1]!)}\\+fp-cert-[a-z0-9-]+@${esc(m[2]!)}$`, "i");
}

export function resoudreConfigStripeReel(env: Env = process.env): ConfigStripeReel {
  const raisons: string[] = [];
  const baseUrl = (env["CERT_STRIPE_BASE_URL"] ?? "").replace(/\/$/, "");
  let mode: "L" | "R" = "L";
  if (env["CERT_STRIPE_REEL"] !== "1") raisons.push("CERT_STRIPE_REEL=1 n'est pas defini (garde-fou : la suite ne s'execute que sur demande explicite).");
  if (!baseUrl) raisons.push("CERT_STRIPE_BASE_URL absente (ex. http://127.0.0.1:8080 en Mode L, https://flowpoint-test.onrender.com en Mode R).");
  else {
    try { mode = verifierBaseUrl(baseUrl).local ? "L" : "R"; } catch (e) { raisons.push((e as Error).message); }
  }
  const emailBase = (env["CERT_STRIPE_EMAIL_BASE"] ?? "").trim();
  if (!emailBase) raisons.push("CERT_STRIPE_EMAIL_BASE absente (boite de reception de test, ex. proprietaire@gmail.com : adressage « + »).");
  else { try { motifEmailCampagne(emailBase); } catch (e) { raisons.push((e as Error).message); } }
  // Cle secrete de TEST : necessaire pour prouver le resultat cote Stripe (verifier-stripe.ts) ; refusee si live.
  try { assertEnvironnementSansCleLive(env); } catch (e) { raisons.push((e as Error).message); }
  if (!env["STRIPE_TEST_SECRET_KEY"]) raisons.push("STRIPE_TEST_SECRET_KEY absente (necessaire aux preuves cote Stripe).");
  else if (!/^sk_test_/.test(env["STRIPE_TEST_SECRET_KEY"]!)) raisons.push("STRIPE_TEST_SECRET_KEY n'est pas une cle sk_test_ : refusee.");
  // Mode L : l'application locale lit ces variables ; on verifie leur presence et leur mode.
  if (mode === "L") {
    try { assertClePubliableTest(env["STRIPE_TEST_PUBLISHABLE_KEY"]); } catch (e) { raisons.push((e as Error).message); }
    try { assertSecretWebhookTest(env["STRIPE_TEST_WEBHOOK_SECRET"], env); } catch (e) { raisons.push((e as Error).message); }
    if (!env["TEST_MAIL_DIR"] || env["ENABLE_TEST_MAILER"] !== "true") raisons.push("TEST_MAIL_DIR et ENABLE_TEST_MAILER=true requis en Mode L (e-mails captures, jamais envoyes).");
  }
  // Mode contrat : seulement les garde-fous de securite (jamais de prerequis secret).
  const raisonsContrat: string[] = [];
  if (env["CERT_STRIPE_REEL"] !== "1") raisonsContrat.push("CERT_STRIPE_REEL=1 n'est pas defini.");
  if (!baseUrl) raisonsContrat.push("CERT_STRIPE_BASE_URL absente.");
  else { try { verifierBaseUrl(baseUrl); } catch (e) { raisonsContrat.push((e as Error).message); } }
  try { assertEnvironnementSansCleLive(env); } catch (e) { raisonsContrat.push((e as Error).message); }
  return { pret: raisons.length === 0, raisons, pretContrat: raisonsContrat.length === 0, raisonsContrat, baseUrl, mode, emailBase, dossierMails: env["TEST_MAIL_DIR"] ?? "" };
}
