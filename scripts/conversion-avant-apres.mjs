#!/usr/bin/env node
/**
 * Tableau AVANT/APRES du tunnel, en lecture seule.
 *
 *   FLOWPOINT_API_URL=https://<hote> ADMIN_KEY=... \
 *     node scripts/conversion-avant-apres.mjs --change 2026-12-01 [--days 7] [--json]
 *
 * Appelle GET /api/admin/conversion/before-after (protege par x-admin-key). La cle
 * se lit dans l'environnement, jamais en argument (elle resterait dans l'historique
 * du shell). Aucune ecriture, aucun identifiant n'est affiche : des comptes seulement.
 * Methode et limites : docs/CONVERSION-COMPARAISON-AVANT-APRES.md
 */
const args = process.argv.slice(2);
const val = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined; };
const change = val("--change");
const days = val("--days") ?? "7";
const brut = args.includes("--json");
const base = (process.env.FLOWPOINT_API_URL ?? "").replace(/\/+$/, "");
const cle = process.env.ADMIN_KEY ?? "";

if (!/^\d{4}-\d{2}-\d{2}$/.test(change ?? "") || !/^\d{1,2}$/.test(days) || !base || cle.length < 32) {
  console.error("Usage : FLOWPOINT_API_URL=https://<hote> ADMIN_KEY=<cle de 32 caracteres minimum> node scripts/conversion-avant-apres.mjs --change AAAA-MM-JJ [--days 7] [--json]");
  process.exit(2);
}
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error("FLOWPOINT_API_URL doit etre en https (http n'est admis que pour localhost).");
  process.exit(2);
}

const reponse = await fetch(`${base}/api/admin/conversion/before-after?change=${change}&days=${days}`, {
  headers: { "x-admin-key": cle }, signal: AbortSignal.timeout(30_000),
});
if (!reponse.ok) { console.error(`Echec : HTTP ${reponse.status}`); process.exit(1); }
const r = await reponse.json();
if (brut) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

const pct = (x) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)} %`);
const ic = (i) => (i ? `[${(i.low * 100).toFixed(0)}–${(i.high * 100).toFixed(0)}]` : "—");
const f = (w) => `${w.from.slice(0, 10)} -> ${w.to.slice(0, 10)} (${w.days} j${w.complete ? "" : ", INCOMPLETE"})`;

console.log(`# Avant/apres — changement du ${r.change}\n`);
console.log(`Avant : ${f(r.before.window)}\nApres : ${f(r.after.window)}\n`);
console.log("## Famille consentement (visiteurs distincts ayant accepte l'analytique)\n");
console.log("| Etape | Avant | Apres |\n|---|---:|---:|");
r.before.consentGated.forEach((b, i) => {
  console.log(`| ${b.etape} | ${b.visitors} | ${r.after.consentGated[i].visitors} |`);
});
for (const e of r.notInstrumented) console.log(`| ${e} | non instrumentee | non instrumentee |`);
console.log("\n## Taux d'une etape a la suivante (cohorte, IC 95 % de Wilson)\n");
console.log("| De -> vers | Avant | IC | Apres | IC | Ecart (pts) | Verdict |\n|---|---:|---|---:|---|---:|---|");
for (const t of r.rates) {
  console.log(`| ${t.from} -> ${t.to} | ${pct(t.before.ratio)} (${t.before.numerator}/${t.before.denominator}) | ${ic(t.before.ci95)} | ${pct(t.after.ratio)} (${t.after.numerator}/${t.after.denominator}) | ${ic(t.after.ci95)} | ${t.deltaPoints ?? "—"} | ${t.verdict} |`);
}
console.log("\n## Famille transactionnelle (evenements Stripe signes, tous visiteurs) — jamais additionnee a la precedente\n");
console.log("| Etape | Avant | dont reliee a un visiteur consentant | Apres | dont reliee |\n|---|---:|---:|---:|---:|");
r.before.transactional.forEach((b, i) => {
  const a = r.after.transactional[i];
  console.log(`| ${b.etape} | ${b.events} | ${b.withConsentedVisitor} | ${a.events} | ${a.withConsentedVisitor} |`);
});
console.log(`\nSeuil : un taux dont le denominateur est sous ${r.minDenominator} visiteurs est marque insufficient_sample.\n\nLimites :`);
for (const c of r.caveats) console.log(`- ${c}`);
