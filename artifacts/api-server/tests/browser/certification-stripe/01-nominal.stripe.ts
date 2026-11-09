/** 1. Parcours nominal contre le VRAI Stripe TEST : carte 4242 -> SetupIntent -> webhook -> UNE souscription en essai. */
import fs from "node:fs";
import { test, expect, exigerConfiguration, preparerContexte, inscriptionJusquAuPaiement, attendrePaymentElementReel, saisirCarte, attendreConfirmationStripe, CARTES, exigerPreuvesStripe, exigerUneSeuleSouscriptionStable, mailsCaptures, organisationEn, cfg } from "./support/stripe-reel";

exigerConfiguration();

test("nominal : inscription e-mail -> carte 4242 -> essai 14 j -> une souscription Stripe trialing", async ({ page, context, nouvelEmail }) => {
  const email = nouvelEmail("nominal");
  await preparerContexte(context);
  const hotes = new Set<string>();
  page.on("request", (r) => { try { hotes.add(new URL(r.url()).host); } catch { /* ignore */ } });
  await inscriptionJusquAuPaiement(page, email);
  await attendrePaymentElementReel(page);
  expect(await page.evaluate(() => document.documentElement.innerHTML.match(/pk_(test|live)_/g)?.[0] ?? "")).not.toBe("pk_live_");
  await saisirCarte(page, CARTES.succes);
  const confirmation = attendreConfirmationStripe(page);
  await page.locator("#fp-pay-btn").click();
  await confirmation;
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 90_000 });
  await expect(page.locator("#fp-title")).toHaveText(/Compte activé/i, { timeout: 90_000 });
  // Hotes reellement joints par le navigateur : liste a autoriser dans le reseau de la session (docs, §3).
  fs.mkdirSync("artifacts/api-server/tests/browser/certification-stripe/.out", { recursive: true });
  fs.writeFileSync("artifacts/api-server/tests/browser/certification-stripe/.out/hotes-reseau.txt", [...hotes].sort().join("\n") + "\n");
  await exigerPreuvesStripe(email);
  await exigerUneSeuleSouscriptionStable(email);
  const org = await organisationEn(email);
  if (org !== undefined) {
    expect(org, "organisation en base").toMatchObject({ subscription_status: "trialing" });
    expect(org!["stripe_subscription_id"]).toMatch(/^sub_/);
  }
  if (cfg.mode === "L") {
    const m = mailsCaptures(email).find((x) => x["tag"] === "activation_magic_link");
    expect(m, "e-mail d'activation capture (Mode L)").toBeTruthy();
  }
});
