/**
 * 3. Google : lien de depart avec plan/state verifies (PR #367), retour, membre invite non traite comme nouveau (PR #371).
 * Google est SIMULE : l'ecran accounts.google.com est une route Playwright, les deux appels sortants du callback
 * (token + userinfo) sont interceptes par le harnais. Le vrai Google n'est verifiable qu'a la main (voir le runbook).
 */
import { test, expect, db, one, all, IS_LOCAL, BASE_URL, ANON_OK, unexpectedConsoleErrors } from "./support/fixtures";
import { seedCart } from "./support/parcours";

test.skip(!IS_LOCAL, "Harnais Google : local uniquement.");

async function persona(request: any, code: string, email: string, extra: Record<string, unknown> = {}) {
  const r = await request.post(`${BASE_URL}/__fake/google/persona`, { data: { code, email, given_name: "Gaelle", family_name: "Test", ...extra } });
  expect(r.status()).toBe(200);
}
const codeUnique = (l: string) => `${l}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

test.describe("3. Google", () => {
  test("depart : le lien porte le plan, l'URL Google est correcte, le state est lie a un cookie", async ({ page, context, request, newEmail, useGoogleStub, shot }) => {
    const code = codeUnique("nouv"); const email = newEmail("g");
    await persona(request, code, email);
    const { authorizeUrls } = await useGoogleStub(code);
    await seedCart(page, "pro");
    await page.goto("/signin.html");
    const bouton = page.locator("#btn-google-oauth");
    await expect(bouton).toBeVisible();
    await expect(bouton).toHaveAttribute("href", /\/api\/auth\/google\/login\?.*plan=pro/);
    await shot(page, "bouton-google");
    await bouton.click();
    await page.waitForURL(/\/checkout\.html/, { timeout: 20_000 });

    // Requete de depart vue par « Google ».
    expect(authorizeUrls).toHaveLength(1);
    const u = authorizeUrls[0]!;
    expect(u.searchParams.get("client_id")).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/api/auth/google/callback`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(u.searchParams.get("plan"), "le plan ne voyage pas dans l'URL du fournisseur").toBeNull();

    // Retour : plan conserve, jeton retire de l'URL, aucune donnee personnelle dans l'URL, jeton range en sessionStorage.
    expect(page.url()).toContain("plan=pro");
    expect(page.url()).not.toMatch(/pre_reg_token|@/);
    const stock = await page.evaluate(() => ({ cart: JSON.parse(localStorage.getItem("fp_cart") ?? "null"), tok: sessionStorage.getItem("fp_pre_reg_token") }));
    expect(stock.cart.plan).toBe("pro");
    expect(stock.tok).toMatch(/^[a-f0-9]{64}$/);
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
    await shot(page, "retour-google-recapitulatif");

    // Nouveau compte : une inscription en attente, ni utilisateur actif ni organisation avant le paiement.
    expect((await all("SELECT token FROM pending_signups WHERE lower(email)=lower($1) AND consumed_at IS NULL", [email]))).toHaveLength(1);
    expect(await one("SELECT 1 FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toBeNull();
    void context;
  });

  test("state falsifie ou absent : refus (invalid_state), aucun echange de code", async ({ request }) => {
    const r = await request.get(`${BASE_URL}/api/auth/google/callback?code=x&state=forge`, { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    expect(r.headers()["location"]).toContain("/login.html?error=invalid_state");
    const calls = ((await (await request.get(`${BASE_URL}/__fake/google/calls`)).json()) as { calls: string[] }).calls;
    expect(calls.filter((c) => c === "token:x")).toHaveLength(0);
  });

  test("le state est a usage unique : rejouer le callback est refuse", async ({ page, request, newEmail, useGoogleStub }) => {
    const code = codeUnique("rejeu"); await persona(request, code, newEmail("grj"));
    await useGoogleStub(code);
    let callbackUrl = "";
    page.on("request", (rq) => { if (rq.url().includes("/api/auth/google/callback")) callbackUrl = rq.url(); });
    await page.goto("/api/auth/google/login?plan=standard");
    await page.waitForURL(/\/signin\.html|\/checkout\.html/, { timeout: 20_000 });
    expect(callbackUrl).toContain("state=");
    const rejeu = await page.request.get(callbackUrl, { maxRedirects: 0 });
    expect(rejeu.headers()["location"]).toContain("invalid_state");
  });

  test("e-mail non verifie par Google : refus, aucune inscription creee", async ({ page, request, newEmail, useGoogleStub }) => {
    const code = codeUnique("nv"); const email = newEmail("gnv");
    await persona(request, code, email, { email_verified: false });
    await useGoogleStub(code);
    const cb = page.waitForResponse((r) => r.url().includes("/api/auth/google/callback"));
    await page.goto("/api/auth/google/login");
    expect((await cb).headers()["location"]).toContain("/login.html?error=email_not_verified");   // login.html reecrit ensuite son URL
    expect(await one("SELECT 1 FROM pending_signups WHERE lower(email)=lower($1)", [email])).toBeNull();
  });

  test("refus de l'utilisateur chez Google (access_denied) : retour a la connexion avec le message", async ({ page, useGoogleStub }) => {
    await useGoogleStub("sans-objet", { error: "access_denied" });
    const cb = page.waitForResponse((r) => r.url().includes("/api/auth/google/callback"));
    await page.goto("/api/auth/google/login");
    expect((await cb).headers()["location"]).toMatch(/\/login\.html\?.*error=access_denied/);
    await page.waitForURL(/\/login\.html/);
  });

  test("membre invite (utilisateur actif d'une organisation) : connexion Google directe au dashboard, jamais traite comme un nouveau compte (PR #371)", async ({ page, request, newEmail, signupViaApi, useGoogleStub, observed }) => {
    const { orgId } = await signupViaApi(request);
    const email = newEmail("membre");
    const u = await db().query<{ id: string }>("INSERT INTO users (email, first_name, last_name, auth_provider, email_verified, status) VALUES ($1,'Membre','Invite','magic_link',true,'active') RETURNING id::text", [email]);
    await db().query("INSERT INTO organization_members (organization_id, user_id, role, status) VALUES ($1,$2::uuid,'member','active')", [orgId, u.rows[0]!.id]);
    const code = codeUnique("mem"); await persona(request, code, email);
    await useGoogleStub(code);
    await page.goto("/api/auth/google/login?plan=ultra");
    await page.waitForURL(/\/dashboard\.html/, { timeout: 25_000 });
    expect(page.url()).not.toContain("google_signup");
    const me = await page.evaluate(async () => (await fetch("/api/me")).json());
    expect(me.role).toBe("member");
    expect(me.orgId).toBe(orgId);
    // Aucun faux nouveau compte : ni inscription en attente, ni organisation a son nom.
    expect(await one("SELECT 1 FROM pending_signups WHERE lower(email)=lower($1)", [email])).toBeNull();
    expect(await one("SELECT 1 FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toBeNull();
    void observed; void ANON_OK; void unexpectedConsoleErrors;
  });

  test("proprietaire existant : connexion Google au dashboard avec le role owner", async ({ page, request, signupViaApi, useGoogleStub }) => {
    const { email, orgId } = await signupViaApi(request);
    const code = codeUnique("own"); await persona(request, code, email);
    await useGoogleStub(code);
    await page.goto("/api/auth/google/login");
    await page.waitForURL(/\/dashboard\.html/, { timeout: 25_000 });
    const me = await page.evaluate(async () => (await fetch("/api/me")).json());
    expect(me).toMatchObject({ role: "owner", orgId });
    expect(await all("SELECT id FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toHaveLength(1);
  });
});
