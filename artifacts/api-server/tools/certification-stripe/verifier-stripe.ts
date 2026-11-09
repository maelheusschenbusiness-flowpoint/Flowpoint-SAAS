#!/usr/bin/env tsx
/**
 * Preuves cote Stripe (TEST) pour UN e-mail de campagne.
 *
 *   STRIPE_TEST_SECRET_KEY=sk_test_... pnpm exec tsx tools/certification-stripe/verifier-stripe.ts \
 *       --email proprietaire+fp-cert-xxx@gmail.com [--price price_xxx] [--since 2026-11-08T10:00:00Z] [--intent seti_xxx]
 *
 * Lecture seule. Refuse toute cle non sk_test_. N'affiche jamais la cle. Code de sortie 0 = GO, 1 = NO-GO, 2 = refus/erreur.
 */
import { assertCleSecreteTest, assertCompteTest, assertEnvironnementSansCleLive, masquerSecrets, CleRefusee } from "./garde-cles.ts";
import { calculerVerifications, collecterDonnees, toutEstOk } from "./verifications.ts";

function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const email = arg("email");
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) { console.error("Usage : --email <adresse d'essai> [--price price_...] [--since ISO] [--intent seti_...]"); return 2; }
  assertEnvironnementSansCleLive();
  const cle = assertCleSecreteTest(process.env["STRIPE_TEST_SECRET_KEY"]);
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(cle);
  assertCompteTest(await stripe.balance.retrieve());
  const depuis = Math.floor(new Date(arg("since") ?? Date.now() - 24 * 3600 * 1000).getTime() / 1000);
  const prix = arg("price") ?? process.env["STRIPE_TEST_PRICE_ID_PRO"];
  const intents = (arg("intent") ?? "").split(",").filter(Boolean);
  const donnees = await collecterDonnees(stripe as never, email, depuis, intents);
  const verdicts = calculerVerifications(donnees, prix ? { prixAttendu: prix } : {});
  for (const x of verdicts) console.log(`${x.ok ? "OK  " : "FAIL"}  ${x.nom} — ${x.detail}`);
  const go = toutEstOk(verdicts);
  console.log(go ? "\nVERDICT : GO (preuves Stripe TEST completes)" : "\nVERDICT : NO-GO");
  return go ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => {
  console.error(e instanceof CleRefusee ? `REFUS : ${e.message}` : `ERREUR : ${masquerSecrets(String((e as Error)?.message ?? e))}`);
  process.exit(2);
});
