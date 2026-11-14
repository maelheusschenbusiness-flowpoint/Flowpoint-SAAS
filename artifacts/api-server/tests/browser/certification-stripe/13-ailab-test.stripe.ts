/**
 * 13. Parcours REEL SaaS TEST -> AI Lab TEST : inscription, SetupIntent, essai Stripe TEST, avec un `fp_lid` emis par
 * l'instance AI Lab de TEST (CERT_FP_LID, jamais journalise). Le visiteur est `fp-test-…` : exclu des chiffres commerciaux.
 * Les preuves cote recepteur se lisent dans l'instance AI Lab TEST (voir docs/CERTIFICATION-CONVERSION-AI-LAB-2026-11-14.md).
 */
import { test, expect, exigerContrat, emailSynthetique, consentement, jusquAuPaiement, verifierDevis, attributionDeTest, saisirCarte, CARTES } from "./support/contrat.ts";

exigerContrat();
const FP_LID = process.env["CERT_FP_LID"] ?? "";
test.skip(!/^[A-Za-z0-9_-]{22}$/.test(FP_LID), "CERT_FP_LID (fp_lid emis par AI Lab TEST) absent ou invalide.");

test("fp_lid de TEST : parcours reel jusqu'a l'essai, jalons emis vers AI Lab TEST", async ({ page, context }) => {
  const vid = `fp-test-ailab${Date.now().toString(36)}`;
  const a = attributionDeTest({ vid, fp_source: "smartlead", fp_lid: FP_LID });
  await consentement(context);
  const espion = await jusquAuPaiement(page, "standard", emailSynthetique("ailab"), a);
  verifierDevis(espion, "standard");
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
  await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBeGreaterThan(0);
  expect(espion.souscriptions()).toHaveLength(1);
  // Le visiteur et la source declares au navigateur restent ceux du parcours.
  for (const e of espion.evenementsFunnel()) { expect(e.visiteurId).toBe(vid); }
  // Trace technique anonymisee : ni fp_lid, ni e-mail.
  console.log(JSON.stringify({ event: "ailab_test_journey", visiteur: vid, etapesNavigateur: espion.evenementsFunnel().map((e) => e.etape) }));
});
