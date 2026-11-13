/** 10. Parcours REEL pour les trois plans (mode contrat) : plan conserve, SetupIntent, Payment Element, abonnement unique, attribution. */
import { test, expect, exigerContrat, PLANS, emailSynthetique, consentement, jusquAuPaiement, verifierDevis, attributionDeTest, saisirCarte, CARTES, espionner } from "./support/contrat.ts";

exigerContrat();

for (const plan of PLANS) {
  test(`${plan} : inscription -> Payment Element -> UNE souscription (essai 14 j, 0 EUR) -> attribution conservee`, async ({ page, context }) => {
    const email = emailSynthetique(`plan-${plan}`);
    const a = attributionDeTest({ fp_ref: "CERTREF1" });
    await consentement(context);
    const espion = await jusquAuPaiement(page, plan, email, a);
    verifierDevis(espion, plan);
    await saisirCarte(page, CARTES.succes);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
    await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBeGreaterThan(0);
    expect(espion.souscriptions(), "exactement UNE souscription").toHaveLength(1);
    const fin = espion.par(/finalize-checkout/, "POST").find((x) => x.corps?.success)!;
    expect(fin.statut).toBe(200);
    // Attribution : evenements emis une seule fois par etape, avec le meme visiteur et la meme source.
    const evts = espion.evenementsFunnel();
    const cles = evts.map((e) => `${e.etape}:${e.visiteurId}`);
    expect(new Set(cles).size, "aucun evenement de funnel en double").toBe(cles.length);
    for (const e of evts) { expect(e.visiteurId).toBe(a.vid); expect(e.source).toBe(a.fp_source); }
  });
}
