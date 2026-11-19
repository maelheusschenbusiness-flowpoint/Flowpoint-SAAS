/**
 * 9. Retour de connexion (lien magique) : l'attribution du visiteur survit a la purge de securite de login-verify.js.
 * Phase 1 « P0 » : fp_vid / fp_source (localStorage) et fp_lid (sessionStorage) etaient purges au retour de connexion.
 */
import { test, expect, IS_LOCAL } from "./support/fixtures";

test.skip(!IS_LOCAL, "Harnais local uniquement.");

const LID = "AbCdEfGhIjKlMnOpQrStUv";            // 22 caracteres [A-Za-z0-9_-]
const VID = "3f2b8a52-7c1e-4b6d-9a40-5e8f1c2d3b4a";

test.describe("9. Retour de connexion", () => {
  test("lien magique : l'attribution, fp_lid et la langue survivent a la purge de securite", async ({ page, request, signupViaApi, magicToken }) => {
    const { email } = await signupViaApi(request);
    const token = await magicToken(email);
    await page.addInitScript(([vid, lid]) => {
      try {
        if (sessionStorage.getItem("__cert_seed")) return;
        sessionStorage.setItem("__cert_seed", "1");
        localStorage.setItem("fp_vid", vid!); localStorage.setItem("fp_source", "smartlead"); localStorage.setItem("fp:language", "fr");
        localStorage.setItem("fp_other_user_cache", "doit-disparaitre");
        sessionStorage.setItem("fp_lid", lid!);
      } catch { /* ignore */ }
    }, [VID, LID]);
    await page.goto(`/login-verify.html?token=${token}`);
    await page.locator("#fp-success").waitFor({ state: "visible", timeout: 15_000 });
    const s = await page.evaluate(() => ({
      vid: localStorage.getItem("fp_vid"), source: localStorage.getItem("fp_source"), lang: localStorage.getItem("fp:language"),
      autre: localStorage.getItem("fp_other_user_cache"), lid: sessionStorage.getItem("fp_lid"),
    }));
    expect(s.autre, "la purge de securite des caches utilisateur reste active").toBeNull();
    expect(s).toMatchObject({ vid: VID, source: "smartlead", lang: "fr", lid: LID });
  });
});
