#!/usr/bin/env node
/**
 * Verification EN LECTURE SEULE du site vitrine publie (GET uniquement, aucune ecriture, aucun cookie).
 * Sert apres la publication demandee a Replit (docs/REPLIT-MESSAGE-SITE-MARKETING.md) : le site n'est
 * considere comme corrige que si TOUS les controles ci-dessous passent sur le site PUBLIE.
 *
 *   node scripts/verifier-site-vitrine.mjs [--base https://flowpoint.pro] [--json]
 *
 * Code de sortie : 0 = tout passe, 1 = au moins un controle echoue ou une page est injoignable.
 * Cibles admises : flowpoint.pro et www.flowpoint.pro uniquement (jamais l'application).
 */
const args = process.argv.slice(2);
const baseArg = args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://flowpoint.pro";
const json = args.includes("--json");
const BASE = String(baseArg).replace(/\/+$/, "");
if (!/^https:\/\/(www\.)?flowpoint\.pro$/.test(BASE)) {
  console.error("Cible refusee : seules https://flowpoint.pro et https://www.flowpoint.pro sont admises.");
  process.exit(2);
}

const UA = "flowpoint-verification/1.0 (lecture seule)";
async function get(path, method = "GET") {
  try {
    const r = await fetch(BASE + path, { method, headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    return { status: r.status, body: method === "GET" ? await r.text() : "" };
  } catch (e) {
    return { status: 0, body: "", error: e instanceof Error ? e.message : String(e) };
  }
}

const count = (text, needle) => text.split(needle).length - 1;
const results = [];
const check = (id, label, ok, detail = "") => results.push({ id, label, ok: Boolean(ok), detail });

const pricing = await get("/pricing");
const home = await get("/");
const head = await get("/", "HEAD");
const headPricing = await get("/pricing", "HEAD");

check("P0-1a", "FAQ /pricing : « charged automatically » present", count(pricing.body, "charged automatically") >= 1, `occurrences=${count(pricing.body, "charged automatically")}`);
check("P0-1b", "FAQ /pricing : ancienne formulation trompeuse absente", pricing.status === 200 && count(pricing.body, "choose the plan that fits") === 0, `occurrences=${count(pricing.body, "choose the plan that fits")}`);
check("P0-1c", "FAQ /pricing : mention « credit card is required » (HTML et JSON-LD)", count(pricing.body, "credit card is required") >= 2, `occurrences=${count(pricing.body, "credit card is required")} (attendu >= 2 : FAQ visible + JSON-LD)`);
const plans = [...new Set([...pricing.body.matchAll(/signin\.html\?[^"'\s<]*plan=([a-z]+)/g)].map((m) => m[1]))].sort();
check("P0-2", "Boutons de plan : plan=standard, pro et ultra", ["pro", "standard", "ultra"].every((p) => plans.includes(p)), `plans trouves=${plans.join(",") || "aucun"}`);
check("P0-3", "Aucun lien de plan vers un plan non autorise", plans.every((p) => ["standard", "pro", "ultra"].includes(p)), plans.join(","));
check("P2-4", "« Dashboard IA » absent des pages anglophones", count(pricing.body, "Dashboard IA") === 0, `occurrences=${count(pricing.body, "Dashboard IA")}`);
check("P2-5a", "HEAD / renvoie 200", head.status === 200, `status=${head.status}`);
check("P2-5b", "HEAD /pricing renvoie 200", headPricing.status === 200, `status=${headPricing.status}`);
const appLinks = [...(pricing.body + home.body).matchAll(/https:\/\/app\.flowpoint\.pro\/[^"'\s<)]*/g)].map((m) => m[0]);
check("LINK-1", "Des liens vers l'application existent", appLinks.length > 0, `liens=${appLinks.length}`);
check("LINK-2", "Aucun lien ne contient fp_vid sans consentement (statique : aucun fp_vid code en dur)", !appLinks.some((l) => /fp_vid=/.test(l)), "fp_vid ne doit etre ajoute que par script apres consentement");
check("LINK-3", "Liens vers l'application : aucun parametre lang code en dur avec une valeur non supportee", appLinks.every((l) => { const m = l.match(/[?&]lang=([^&#]*)/); return !m || ["fr","en","es","de","it","pt","pt-br","nl","pl","sv","ro","cs"].includes(m[1].toLowerCase()); }), "");
check("PAGES", "Pages /pricing et / repondent 200", pricing.status === 200 && home.status === 200, `pricing=${pricing.status} home=${home.status}`);

const failed = results.filter((r) => !r.ok);
if (json) console.log(JSON.stringify({ base: BASE, date: new Date().toISOString(), ok: failed.length === 0, results }, null, 2));
else {
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.label}${r.detail ? "  — " + r.detail : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} controles reussis`);
  if (failed.length) console.log("Le site vitrine N'EST PAS considere comme corrige.");
  console.log("Limites : controles statiques sur le HTML servi ; le parcours navigateur (bouton Pro -> plan preselectionne, ?lang=fr -> francais) reste a executer a la main (voir la checklist).");
}
process.exit(failed.length ? 1 : 0);
