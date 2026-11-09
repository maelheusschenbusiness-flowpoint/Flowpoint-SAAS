/**
 * 5. Lien magique -> session -> dashboard : chargement, plan/essai affiches, pas d'erreur inattendue, console propre.
 */
import { test, expect, IS_LOCAL, unexpectedApiFailures, unexpectedConsoleErrors } from "./support/fixtures";
import { ouvrirDashboard, attendre } from "./support/parcours";

test.skip(!IS_LOCAL, "Ecrit des comptes : local uniquement.");

test.describe("5. Lien magique et dashboard", () => {
  test("le lien de l'e-mail d'activation ouvre le dashboard : plan Pro, essai de 14 jours, aucune erreur inattendue", async ({ page, request, signupViaApi, mails, observed, shot }) => {
    const { email } = await signupViaApi(request);
    const m = await attendre(async () => (await mails(email)).find((x) => x["tag"] === "activation_magic_link"));
    expect(m, "e-mail d'activation").toBeTruthy();
    await ouvrirDashboard(page, String(m!["token"]));
    await shot(page, "dashboard");
    expect(await page.locator("#fp-plan-switcher").textContent()).toContain("Pro");

    const me = await page.evaluate(async () => (await fetch("/api/me")).json());
    expect(me).toMatchObject({ plan: "Pro", subscriptionStatus: "trialing", hasPaidAccess: true, role: "owner", canStartTrial: false });
    const jours = (new Date(me.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(13.5); expect(jours).toBeLessThan(14.1);

    // Vue facturation : l'essai est annonce (date de fin) avec le bouton pour y mettre fin.
    await page.evaluate(() => { location.hash = "billing/plans"; });
    await expect(page.getByText(/Essai gratuit|Free trial/).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, "facturation-essai");

    await page.waitForTimeout(1500);
    expect(unexpectedApiFailures(observed)).toEqual([]);
    expect(unexpectedConsoleErrors(observed)).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
  });

  test("le lien magique est a usage unique : le second passage n'ouvre pas de session", async ({ browser, request, signupViaApi, mails, page }) => {
    const { email } = await signupViaApi(request);
    const m = await attendre(async () => (await mails(email)).find((x) => x["tag"] === "activation_magic_link"));
    await ouvrirDashboard(page, String(m!["token"]));
    const autre = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "10.250.1.1" } });
    const p2 = await autre.newPage();
    await p2.goto(`/login-verify.html?token=${m!["token"]}`).catch(() => undefined);
    await p2.goto(`${new URL(page.url()).origin}/login-verify.html?token=${m!["token"]}`);
    await p2.waitForTimeout(3000);
    expect(p2.url()).not.toMatch(/dashboard\.html/);
    expect((await (await autre.request.get(`${new URL(page.url()).origin}/api/me`)).status())).toBe(401);
    await autre.close();
  });

  test("lien invalide : message d'erreur, aucune session", async ({ page }) => {
    await page.goto(`/login-verify.html?token=${"0".repeat(64)}`);
    await page.waitForTimeout(3000);
    expect(page.url()).not.toMatch(/dashboard\.html/);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });
});
