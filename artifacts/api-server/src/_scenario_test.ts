/**
 * SCENARIO TEST — Stripe customer lifecycle audit
 * Run: tsx src/_scenario_test.ts
 * No code changes — read-only + external Stripe API calls.
 */

import { pool } from "@workspace/db";

const BASE = "http://localhost:8081";
const STRIPE_KEY = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
const TEST_EMAIL = `scenario-${Date.now()}@flowpoint.pro`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function http(path: string, opts: RequestInit = {}, jar = "") {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(jar ? { Cookie: jar } : {}),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 500); }
  return { status: r.status, data, cookie: r.headers.get("set-cookie") ?? "" };
}

async function stripeAPI(path: string, method = "GET", body: Record<string, string> | null = null) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
  return r.json();
}

async function dbQ(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try {
    const r = await client.query(sql, params);
    return r.rows;
  } finally {
    client.release();
  }
}

function sep(label: string) {
  console.log("\n" + "═".repeat(60));
  console.log(label);
  console.log("═".repeat(60));
}

function ok(label: string, val: any, expectTruthy = true) {
  const pass = expectTruthy ? !!val : !val;
  console.log(`  ${pass ? "✅" : "❌"} ${label}: ${JSON.stringify(val)}`);
  return pass;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — New account, Stripe customer creation, persistence, re-login
// ─────────────────────────────────────────────────────────────────────────────

sep(`PHASE 1 — Compte neuf : ${TEST_EMAIL}`);

// Step 1: Magic link
console.log("\nÉTAPE 1 — Envoi magic link…");
const ml = await http("/api/auth/login-request", {
  method: "POST",
  body: JSON.stringify({ email: TEST_EMAIL }),
});
console.log(`  status: ${ml.status}`);
ok("debugLink présent", ml.data?.debugLink);
if (!ml.data?.debugLink) {
  console.log("  ERREUR:", JSON.stringify(ml.data));
  process.exit(1);
}

// Step 2: Verify token → session 1
console.log("\nÉTAPE 2 — Vérification token (session 1)…");
const token1 = new URL(ml.data.debugLink).searchParams.get("token")!;
const v1 = await http(`/api/auth/login-verify?token=${token1}`);
const JAR1 = v1.cookie.split(";")[0];
ok("session cookie défini", JAR1);
console.log("  réponse server:", JSON.stringify(v1.data));

// Step 3: Wait for fire-and-forget Stripe customer creation
console.log("\nATTENTE 5s — fire-and-forget Stripe customer creation…");
await new Promise((r) => setTimeout(r, 5000));

// Step 4: Read DB immediately after signup
console.log("\nÉTAPE 3 — org_settings en base (immédiatement après signup)…");
const dbRows1 = await dbQ(
  "SELECT org_id, stripe_customer_id, plan, subscription_status, email, created_at FROM org_settings WHERE org_id = $1",
  [TEST_EMAIL]
);
const dbCustId1 = dbRows1[0]?.stripe_customer_id ?? null;
console.log("  DB row:", dbRows1[0] ? JSON.stringify(dbRows1[0]) : "❌ AUCUN ENREGISTREMENT");
ok("stripe_customer_id en DB", dbCustId1);

// Step 5: /api/me — session 1
console.log("\nÉTAPE 4 — /api/me (session 1)…");
const me1 = await http("/api/me", {}, JAR1);
const storeCustId1 = me1.data?.stripeCustomerId ?? null;
ok("stripeCustomerId dans store.me", storeCustId1);
console.log(`  plan: ${me1.data?.plan} | subscriptionStatus: ${me1.data?.subscriptionStatus}`);

// Step 6: Stripe API — search customer by email
console.log("\nÉTAPE 5 — Recherche customer dans Stripe (email)…");
const stripeSearch = await stripeAPI(
  `/customers/search?query=email:'${TEST_EMAIL}'&limit=3`
);
const stripeCustId1 = stripeSearch.data?.[0]?.id ?? null;
ok("customer trouvé dans Stripe", stripeCustId1);
if (stripeCustId1) {
  console.log(`  id: ${stripeCustId1} | name: ${stripeSearch.data[0]?.name} | email: ${stripeSearch.data[0]?.email}`);
  console.log(`  created: ${new Date((stripeSearch.data[0]?.created ?? 0) * 1000).toISOString()}`);
}

// Coherence check
console.log("\n── COHÉRENCE DB / store.me / Stripe ──");
console.log(`  DB   stripe_customer_id    : ${dbCustId1 ?? "NULL ❌"}`);
console.log(`  store.me stripeCustomerId  : ${storeCustId1 ?? "NULL ❌"}`);
console.log(`  Stripe customer found      : ${stripeCustId1 ?? "AUCUN ❌"}`);

const dbMatchStripe = dbCustId1 && stripeCustId1 && dbCustId1 === stripeCustId1;
const storeMatchDb = storeCustId1 && storeCustId1 === dbCustId1;
ok("DB == Stripe", dbMatchStripe);
ok("store.me == DB", storeMatchDb);

// Step 7: Logout + re-login (session 2)
console.log("\nÉTAPE 6 — Logout + reconnexion (session 2)…");
await http("/api/auth/logout", { method: "POST" }, JAR1);
const ml2 = await http("/api/auth/login-request", {
  method: "POST",
  body: JSON.stringify({ email: TEST_EMAIL }),
});
const token2 = ml2.data?.debugLink ? new URL(ml2.data.debugLink).searchParams.get("token")! : null;
const v2 = token2 ? await http(`/api/auth/login-verify?token=${token2}`) : null;
const JAR2 = v2?.cookie.split(";")[0] ?? "";
ok("session 2 cookie défini", JAR2);

// Step 8: /api/me — session 2 (after re-login)
console.log("\nÉTAPE 7 — /api/me (session 2 après reconnexion)…");
const me2 = await http("/api/me", {}, JAR2);
const storeCustId2 = me2.data?.stripeCustomerId ?? null;
ok("stripeCustomerId rechargé depuis DB", storeCustId2);
console.log(`  plan: ${me2.data?.plan} | subscriptionStatus: ${me2.data?.subscriptionStatus}`);

// Step 9: Portail Stripe (requires customer)
console.log("\nÉTAPE 8 — Portail Stripe…");
const portal1 = await http("/api/billing/portal", { method: "POST" }, JAR2);
ok("portail accessible (200)", portal1.status === 200);
if (portal1.status !== 200) {
  console.log(`  ❌ ${portal1.status}: ${JSON.stringify(portal1.data)}`);
} else {
  console.log(`  ✅ URL: ${portal1.data?.url?.slice(0, 60)}…`);
}

// Step 10: Checkout
console.log("\nÉTAPE 9 — Checkout public (sans auth)…");
const csR = await http("/api/public/checkout-session", {
  method: "POST",
  body: JSON.stringify({ plan: "pro", addons: {} }),
});
const csUrl = csR.data?.url ?? "";
const csLive = csUrl.includes("cs_live_");
ok("checkout cs_live_", csLive);
console.log(`  URL: ${csUrl.slice(0, 80)}…`);

// ─────────────────────────────────────────────────────────────────────────────
// RÉSUMÉ PHASE 1
// ─────────────────────────────────────────────────────────────────────────────

sep("RÉSUMÉ PHASE 1");
console.log(`Customer Stripe créé              : ${stripeCustId1 ? "✅ " + stripeCustId1 : "❌ NON CRÉÉ"}`);
console.log(`stripe_customer_id en DB          : ${dbCustId1 ?? "❌ NULL"}`);
console.log(`store.me session 1 (juste après)  : ${storeCustId1 ?? "❌ NULL"}`);
console.log(`store.me session 2 (reconnexion)  : ${storeCustId2 ?? "❌ NULL"}`);
console.log(`DB == Stripe                      : ${dbMatchStripe ? "✅" : "❌ DIVERGENCE"}`);
console.log(`store.me session2 == DB           : ${storeCustId2 === dbCustId1 ? "✅" : "❌ DIVERGENCE"}`);
console.log(`Portail Stripe                    : ${portal1.status === 200 ? "✅" : "❌ " + portal1.status + " " + JSON.stringify(portal1.data)}`);
console.log(`Checkout                          : ${csLive ? "✅ cs_live_" : "❌ " + csR.status}`);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Suppression Customer dans Stripe → impact
// ─────────────────────────────────────────────────────────────────────────────

sep("PHASE 2 — Suppression du Customer dans Stripe");

const custToDelete = stripeCustId1 ?? dbCustId1;
if (!custToDelete) {
  console.log("❌ Aucun customer à supprimer — Phase 2 impossible sans customer Stripe.");
  await pool.end();
  process.exit(0);
}

// Step 1: Delete in Stripe
console.log(`\nSUPPRESSION — DELETE /customers/${custToDelete} dans Stripe…`);
const deleteResult = await stripeAPI(`/customers/${custToDelete}`, "DELETE");
console.log("  résultat Stripe:", JSON.stringify(deleteResult));
ok("deleted: true confirmé", deleteResult.deleted);

// Step 2: DB still has the old ID
console.log("\nÉTAPE 2 — DB après suppression Stripe (doit garder l'ID)…");
const dbRows2 = await dbQ(
  "SELECT stripe_customer_id, plan, subscription_status FROM org_settings WHERE org_id = $1",
  [TEST_EMAIL]
);
console.log("  DB row:", JSON.stringify(dbRows2[0]));
ok("DB garde l'ID (normal)", dbRows2[0]?.stripe_customer_id);

// Step 3: Re-login (session 3) — simulates user reconnecting after deletion
console.log("\nÉTAPE 3 — Reconnexion après suppression (session 3)…");
await http("/api/auth/logout", { method: "POST" }, JAR2);
const ml3 = await http("/api/auth/login-request", {
  method: "POST",
  body: JSON.stringify({ email: TEST_EMAIL }),
});
const token3 = ml3.data?.debugLink ? new URL(ml3.data.debugLink).searchParams.get("token")! : null;
const v3 = token3 ? await http(`/api/auth/login-verify?token=${token3}`) : null;
const JAR3 = v3?.cookie.split(";")[0] ?? "";
ok("session 3 cookie défini", JAR3);

// Step 4: /api/me — session 3 (reads from DB, gets stale deleted ID)
console.log("\nÉTAPE 4 — /api/me (session 3 — lit depuis DB, ID potentiellement mort)…");
const me3 = await http("/api/me", {}, JAR3);
const storeCustId3 = me3.data?.stripeCustomerId ?? null;
console.log(`  stripeCustomerId retourné: ${storeCustId3 ?? "NULL"}`);
console.log(`  C'est l'ID mort ?         ${storeCustId3 === custToDelete ? "⚠️  OUI — ID supprimé dans Stripe" : "Non / absent"}`);

// Step 5: Portail après suppression
console.log("\nÉTAPE 5 — Portail Stripe (customer supprimé)…");
const portal2 = await http("/api/billing/portal", { method: "POST" }, JAR3);
console.log(`  status: ${portal2.status}`);
console.log(`  réponse: ${JSON.stringify(portal2.data)}`);

// Identify which function throws the error
console.log("\n── Trace d'erreur attendue ──");
if (portal2.status === 422) {
  if (portal2.data?.error === "no_customer") {
    console.log("  🔎 Origine: billing-service.ts → getPortalUrl()");
    console.log("     Condition: !store.me.stripeCustomerId → retourne 422 {error:'no_customer'}");
    console.log("     Diagnostic: store.me.stripeCustomerId est NULL (pas chargé) OU est l'ID supprimé");
  } else if (portal2.data?.error === "resource_missing") {
    console.log("  🔎 Origine: billing-service.ts → getPortalUrl() → stripe.billingPortal.sessions.create()");
    console.log("     Stripe retourne: No such customer:", custToDelete);
    console.log("     Diagnostic: ID présent dans store.me mais supprimé dans Stripe → pas de get-or-create");
  }
} else if (portal2.status === 500) {
  console.log("  🔎 Origine: Exception non gérée dans billing-service.ts → getPortalUrl()");
  console.log("     Stripe StripeInvalidRequestError propagée sans catch resource_missing");
}

// Step 6: Checkout après suppression (public — ne nécessite pas de customer)
console.log("\nÉTAPE 6 — Checkout (public, ne nécessite pas de customer)…");
const cs2R = await http("/api/public/checkout-session", {
  method: "POST",
  body: JSON.stringify({ plan: "pro", addons: {} }),
});
const cs2Live = cs2R.data?.url?.includes("cs_live_");
ok("checkout fonctionne sans customer (cs_live_)", cs2Live);

// Step 7: Check billing/upgrade route (goes through billing-service)
console.log("\nÉTAPE 7 — /api/billing/upgrade (passe par billing-service, nécessite customer)…");
const upg = await http("/api/billing/upgrade", {
  method: "POST",
  body: JSON.stringify({ plan: "pro" }),
}, JAR3);
console.log(`  status: ${upg.status} | réponse: ${JSON.stringify(upg.data).slice(0, 200)}`);

// ─────────────────────────────────────────────────────────────────────────────
// RÉSUMÉ PHASE 2 + DIAGNOSTIC FINAL
// ─────────────────────────────────────────────────────────────────────────────

sep("RÉSUMÉ PHASE 2 + DIAGNOSTIC FINAL");

console.log(`\nCustomer supprimé dans Stripe     : ${deleteResult.deleted ? "✅ " + custToDelete : "❌"}`);
console.log(`DB garde l'ancien ID              : ${dbRows2[0]?.stripe_customer_id ? "✅ (attendu)" : "❌"}`);
console.log(`store.me après reconnexion        : ${storeCustId3 ?? "NULL"}`);
console.log(`store.me == ID supprimé           : ${storeCustId3 === custToDelete ? "⚠️  OUI" : "non"}`);
console.log(`Portail après suppression         : ${portal2.status === 200 ? "✅ (inattendu!)" : "❌ " + portal2.status + " " + JSON.stringify(portal2.data)}`);
console.log(`Checkout après suppression        : ${cs2Live ? "✅ (public, pas de customer)" : "❌"}`);

console.log("\n── CAUSE(S) RACINE IDENTIFIÉE(S) ──────────────────────────────────────");

const causes: string[] = [];

if (!stripeCustId1) {
  causes.push("A) FIRE-AND-FORGET : Customer Stripe non créé lors du signup → ID jamais écrit en DB");
}
if (stripeCustId1 && !dbCustId1) {
  causes.push("B) PERSISTANCE : Customer créé dans Stripe mais stripe_customer_id non écrit en DB");
}
if (dbCustId1 && !storeCustId1) {
  causes.push("C) CHARGEMENT SESSION 1 : ID en DB mais non copié dans store.me lors du login-verify (race condition fire-and-forget)");
}
if (dbCustId1 && storeCustId1 && !storeCustId2) {
  causes.push("D) RECHARGEMENT LOGIN : ID en DB mais non rechargé dans store.me lors de la reconnexion");
}
if (portal2.status !== 200 && storeCustId3 === custToDelete) {
  causes.push("E) DELETED CUSTOMER : ID mort gardé en DB/store.me, aucun get-or-create → portail 422/500 permanent");
}
if (portal2.status !== 200 && !storeCustId3) {
  causes.push("E') NO CUSTOMER LOADED : store.me.stripeCustomerId=null → portail refuse avant même d'appeler Stripe");
}

if (causes.length === 0) {
  console.log("  ✅ Aucune cause racine détectée — tout fonctionne correctement.");
} else {
  causes.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
}

console.log("\n── FONCTIONS RESPONSABLES ──────────────────────────────────────────────");
if (!stripeCustId1 || (stripeCustId1 && !dbCustId1)) {
  console.log("  • auth.ts  → login-verify handler → fire-and-forget IIFE (L618-638)");
  console.log("    Race condition : réponse HTTP envoyée avant que la création Stripe soit terminée");
}
if (dbCustId1 && !storeCustId2) {
  console.log("  • store.ts → loadStoreFromDb() → stripe_customer_id non recopié dans store.me");
  console.log("    OU store.ts L96-106 : SELECT lit stripe_customer_id mais store.me n'est pas mis à jour");
}
if (portal2.status !== 200) {
  console.log("  • billing-service.ts → getPortalUrl() : pas de get-or-create, crash sur ID mort/null");
}

await pool.end();
