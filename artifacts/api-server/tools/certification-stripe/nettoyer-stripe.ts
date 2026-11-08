#!/usr/bin/env tsx
/**
 * Nettoyage des objets Stripe TEST crees par la campagne. DRY-RUN PAR DEFAUT.
 *
 *   pnpm exec tsx tools/certification-stripe/nettoyer-stripe.ts --email-base proprietaire@gmail.com --since 2026-11-08T00:00:00Z          # liste
 *   pnpm exec tsx tools/certification-stripe/nettoyer-stripe.ts --email-base proprietaire@gmail.com --since ... --apply                  # supprime
 *   ... --email-exact compte.google.test@gmail.com,autre@exemple.fr   # adresses EXACTES (parcours Google), au lieu de --email-base
 *
 * Ne touche QUE les customers dont l'e-mail correspond a `<base>+fp-cert-<...>@<domaine>` et crees apres --since.
 * Refuse toute cle non sk_test_ ET tout compte dont livemode != false.
 */
import { assertCleSecreteTest, assertCompteTest, assertEnvironnementSansCleLive, masquerSecrets, CleRefusee } from "./garde-cles.ts";
import { motifEmailCampagne } from "./config.ts";
import { planifierNettoyage, executerNettoyage } from "./nettoyage.ts";

function arg(nom: string): string | undefined { const i = process.argv.indexOf(`--${nom}`); return i > -1 ? process.argv[i + 1] : undefined; }

async function main(): Promise<number> {
  const base = arg("email-base"); const exacts = (arg("email-exact") ?? "").split(",").map((x) => x.trim()).filter(Boolean); const since = arg("since");
  if ((!base && exacts.length === 0) || !since || Number.isNaN(new Date(since).getTime())) { console.error("Usage : (--email-base <adresse> | --email-exact a@b.c,d@e.f) --since <ISO> [--apply]"); return 2; }
  const apply = process.argv.includes("--apply");
  assertEnvironnementSansCleLive();
  const cle = assertCleSecreteTest(process.env["STRIPE_TEST_SECRET_KEY"]);
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(cle);
  assertCompteTest(await stripe.balance.retrieve());
  const plan = await planifierNettoyage(stripe as never, exacts.length ? exacts : motifEmailCampagne(base!), Math.floor(new Date(since).getTime() / 1000));
  console.log(`${plan.length} customer(s) de campagne trouve(s) :`);
  for (const p of plan) console.log(`  ${p.customerId}  ${p.email}  souscriptions a annuler : ${p.souscriptions.map((s) => `${s.id}(${s.status})`).join(", ") || "aucune"}`);
  if (!apply) { console.log("\nDRY-RUN : rien n'a ete modifie. Ajoutez --apply pour annuler les souscriptions et supprimer ces customers."); return 0; }
  const r = await executerNettoyage(stripe as never, plan);
  console.log(`\nAPPLIQUE : ${r.souscriptionsAnnulees} souscription(s) annulee(s), ${r.customersSupprimes} customer(s) supprime(s).`);
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e instanceof CleRefusee ? `REFUS : ${e.message}` : `ERREUR : ${masquerSecrets(String((e as Error)?.message ?? e))}`); process.exit(2); });
