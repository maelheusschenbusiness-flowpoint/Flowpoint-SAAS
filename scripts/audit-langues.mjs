#!/usr/bin/env node
/**
 * Audit de langue (non-regression) — francais code en dur, traductions
 * manquantes, melange de langues.
 *
 *   node scripts/audit-langues.mjs                    rapport + controle de la base
 *   node scripts/audit-langues.mjs --update-baseline  reecrit scripts/audit-langues-baseline.json
 *
 * Principe : CLIQUET. L'existant (messages d'erreur serveur en francais,
 * heritage) est compte par fichier dans la base committee. Le compte d'un
 * fichier ne peut que BAISSER : une hausse, un nouveau fichier, ou une base
 * superieure au compte reel (base non abaissee apres une traduction) echouent.
 * `--update-baseline` est un outil local ; le test compare toujours a la base
 * committee, donc une hausse ne passe jamais en silence en CI.
 *
 * Portee deja couverte AILLEURS (non dupliquee ici) :
 *  - les 8 pages du tunnel (signin, login, login-verify, checkout,
 *    checkout-payment, checkout-return, success, cancel) : aucune chaine
 *    francaise visible -> src/tests/tunnel-inscription-anglais-themes.test.ts ;
 *  - couverture FR du tunnel -> src/tests/fp-locale-francais-tunnel.test.ts ;
 *  - comportement runtime de fp-locale -> src/tests/public-locale-translations.test.ts ;
 *  - catalogue anglais du tableau de bord (cles utilisees par dashboard.js)
 *    -> src/tests/dashboard-i18n-static-audit.test.ts.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = join(RACINE, "artifacts/api-server/src/routes");
const EXPORT = join(RACINE, "artifacts/flowpoint-export");
export const CHEMIN_BASE = join(RACINE, "scripts/audit-langues-baseline.json");

/** Meme detecteur que tunnel-inscription-anglais-themes.test.ts (a garder aligne). */
export const FRANCAIS =
  /[éèêàâçùûôîœ]|\b(?:vous|votre|vos|nous|avec|sans|pour|mois|essai|paiement|carte|jours|gratuit|abonnement|connexion|compte|erreur|réessayer)\b/i;

/**
 * EXCEPTIONS — liste fermee. Chaque motif est RETIRE de la chaine avant le
 * test FRANCAIS. Ajouter une entree exige une raison.
 */
export const EXCEPTIONS = [
  { motif: /https?:\/\/\S+/g, raison: "URL : chemins/parametres non traduisibles" },
  { motif: /[\w.+-]+@[\w-]+\.[\w.]+/g, raison: "adresse e-mail (exemples, contacts)" },
  { motif: /\$\{[^}]*\}/g, raison: "interpolation de gabarit : identifiants de code, pas du texte" },
  { motif: /`[^`]*`/g, raison: "identifiant de code cite entre accents graves" },
  { motif: /\b(?:Café|Crème|Pâtisserie|Société Générale|Liège|Genève|Québec|Montréal)\b/g, raison: "noms propres / exemples de marques et de lieux" },
  { motif: /\ballée des Acacias\b/g, raison: "adresse d'exemple (nom de rue propre) gardee telle quelle dans le placeholder anglais de settings-i18n-en.js" },
];

export function estFrancais(texte) {
  let t = String(texte);
  for (const { motif } of EXCEPTIONS) t = t.replace(motif, " ");
  return FRANCAIS.test(t);
}

function ligneDe(source, index) {
  return source.slice(0, index).split("\n").length;
}

function fichiersTs(dossier) {
  const out = [];
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) out.push(...fichiersTs(p));
    else if (nom.endsWith(".ts") && !nom.endsWith(".test.ts") && !nom.endsWith(".d.ts")) out.push(p);
  }
  return out.sort();
}

/** Contenu de l'appel `.json(` qui commence a `debut` (parentheses equilibrees, chaines sautees). */
function argumentsJson(src, debut) {
  let prof = 0;
  for (let i = debut; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(") prof++;
    else if (c === ")" && --prof === 0) return src.slice(debut, i + 1);
  }
  return src.slice(debut);
}

/** (a) Messages `error:` / `message:` litteraux passes a res.json / res.status().json. */
export function auditServeur() {
  const parFichier = {};
  const constats = [];
  for (const f of fichiersTs(ROUTES)) {
    const src = readFileSync(f, "utf8");
    const rel = relative(RACINE, f);
    for (const m of src.matchAll(/\.json\s*\(/g)) {
      const debut = m.index + m[0].length - 1;
      const args = argumentsJson(src, debut);
      for (const s of args.matchAll(/\b(?:error|message)\s*:\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g)) {
        const texte = s[1] ?? s[2] ?? s[3] ?? "";
        if (!estFrancais(texte)) continue;
        parFichier[rel] = (parFichier[rel] ?? 0) + 1;
        constats.push({ fichier: rel, ligne: ligneDe(src, debut + s.index), texte });
      }
    }
  }
  return { parFichier, constats };
}

/** Evalue un litteral objet `var NOM = { ... };` de fp-locale.js sans executer le fichier. */
function objetLitteral(src, nom) {
  const m = src.match(new RegExp(`var ${nom} = (\\{[\\s\\S]*?\\n\\s*\\});`));
  if (!m) throw new Error(`${nom} introuvable dans fp-locale.js`);
  return runInNewContext(`(${m[1]})`);
}

export function catalogues() {
  const locale = readFileSync(join(EXPORT, "fp-locale.js"), "utf8");
  const ctx = { window: {} };
  runInNewContext(readFileSync(join(EXPORT, "billing-i18n-en.js"), "utf8") + ";window.__b = FP_I18N_EN_BILLING;", ctx);
  runInNewContext(readFileSync(join(EXPORT, "settings-i18n-en.js"), "utf8"), ctx);
  return {
    PUBLIC_ENGLISH: objetLitteral(locale, "PUBLIC_ENGLISH"),
    PUBLIC_ENGLISH_ATTRIBUTES: objetLitteral(locale, "PUBLIC_ENGLISH_ATTRIBUTES"),
    PUBLIC_PAGES: objetLitteral(locale, "PUBLIC_PAGES"),
    "billing-i18n-en.js": ctx.window.__b,
    "settings-i18n-en.js": ctx.window.FP_I18N_EN_SETTINGS,
  };
}

/** Pages du tunnel, redigees en anglais (gardees par tunnel-inscription-anglais-themes.test.ts). */
export const PAGES_TUNNEL_ANGLAIS = [
  "signin.html", "login.html", "login-verify.html", "checkout.html",
  "checkout-payment.html", "checkout-return.html", "success.html", "cancel.html",
];

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", middot: "·", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç" };
function decoder(t) {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITES[e.toLowerCase()] ?? tout;
  });
}

/** (b) Pages publiques redigees en francais : chaque texte visible francais doit avoir son entree exacte. */
export function auditPagesFrancaises(cat = catalogues()) {
  const pages = Object.keys(cat.PUBLIC_PAGES).filter((p) => !PAGES_TUNNEL_ANGLAIS.includes(p)).sort();
  const parPage = {};
  const constats = [];
  for (const page of pages) {
    const html = readFileSync(join(EXPORT, page), "utf8");
    // Comme translateSubtree : on saute SCRIPT/STYLE/NOSCRIPT/CODE/PRE/OPTION et les commentaires.
    const corps = html
      .replace(/<!--[\s\S]*?-->/g, (x) => x.replace(/[^\n]/g, " "))
      .replace(/<(script|style|noscript|code|pre|option)\b[\s\S]*?<\/\1>/gi, (x) => x.replace(/[^\n]/g, " "));
    const vus = new Set();
    const signaler = (texte, index, attribut) => {
      if (!texte || !estFrancais(texte) || vus.has(texte)) return;
      const ok = Object.hasOwn(cat.PUBLIC_ENGLISH, texte) || (attribut && Object.hasOwn(cat.PUBLIC_ENGLISH_ATTRIBUTES, texte));
      if (ok) return;
      vus.add(texte);
      parPage[page] = (parPage[page] ?? 0) + 1;
      constats.push({ fichier: `artifacts/flowpoint-export/${page}`, ligne: ligneDe(html, index), texte });
    };
    for (const m of corps.matchAll(/>([^<]+)</g)) signaler(decoder(m[1]).trim(), m.index, false);
    for (const m of corps.matchAll(/\s(?:placeholder|aria-label|title)="([^"]*)"/gi)) signaler(decoder(m[1]), m.index, true);
  }
  return { pages, parPage, constats };
}

/** (c) Melange : une traduction anglaise ne contient pas de francais ; une cle francaise n'est pas recopiee telle quelle. */
export function auditMelange(cat = catalogues()) {
  const constats = [];
  for (const nom of ["PUBLIC_ENGLISH", "PUBLIC_ENGLISH_ATTRIBUTES", "billing-i18n-en.js", "settings-i18n-en.js"]) {
    for (const [cle, valeur] of Object.entries(cat[nom])) {
      if (typeof valeur !== "string") continue;
      if (estFrancais(valeur)) constats.push({ fichier: nom, ligne: 0, texte: `${cle} => ${valeur}`, raison: cle === valeur ? "cle francaise recopiee" : "valeur anglaise contenant du francais" });
    }
  }
  return { constats };
}

export function lireBase() {
  return JSON.parse(readFileSync(CHEMIN_BASE, "utf8"));
}

/** Compare des comptes reels a la base : regressions (echec) et baisses (a reporter dans la base). */
export function comparer(reel, base) {
  const erreurs = [];
  const baisses = [];
  for (const [f, n] of Object.entries(reel)) {
    const b = base[f]?.compte;
    if (b === undefined) erreurs.push(`${f} : ${n} chaine(s) francaise(s), fichier absent de la base (nouveau francais interdit)`);
    else if (n > b) erreurs.push(`${f} : ${n} > base ${b} (francais ajoute)`);
  }
  for (const [f, { compte }] of Object.entries(base)) {
    const n = reel[f] ?? 0;
    if (n < compte) baisses.push(`${f} : ${n} < base ${compte} -> abaisser la base (node scripts/audit-langues.mjs --update-baseline)`);
  }
  return { erreurs, baisses };
}

export function auditer() {
  const cat = catalogues();
  return { serveur: auditServeur(), pages: auditPagesFrancaises(cat), melange: auditMelange(cat) };
}

function versBase(comptes, ancienne = {}, defaut) {
  const out = {};
  for (const f of Object.keys(comptes).sort()) out[f] = { compte: comptes[f], raison: ancienne[f]?.raison ?? defaut };
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = auditer();
  const imprimer = (titre, constats) => {
    console.log(`\n== ${titre} (${constats.length}) ==`);
    for (const c of constats) console.log(`${c.fichier}${c.ligne ? `:${c.ligne}` : ""}  ${JSON.stringify(c.texte)}${c.raison ? `  [${c.raison}]` : ""}`);
  };
  imprimer("(a) Messages d'erreur serveur en francais", r.serveur.constats);
  imprimer("(b) Pages publiques francaises : traductions manquantes dans PUBLIC_ENGLISH", r.pages.constats);
  imprimer("(c) Melange de langues dans les catalogues anglais", r.melange.constats);

  if (process.argv.includes("--update-baseline")) {
    let ancienne = { serveur: {}, pages: {} };
    try { ancienne = lireBase(); } catch {}
    const base = {
      _note: "Cliquet : les comptes ne peuvent que baisser. Regenerer : node scripts/audit-langues.mjs --update-baseline",
      serveur: versBase(r.serveur.parFichier, ancienne.serveur, "heritage : messages d'erreur en francais, a traduire"),
      pages: versBase(r.pages.parPage, ancienne.pages, "heritage : texte francais sans entree PUBLIC_ENGLISH, a ajouter"),
    };
    writeFileSync(CHEMIN_BASE, JSON.stringify(base, null, 2) + "\n");
    console.log(`\nBase reecrite : ${relative(RACINE, CHEMIN_BASE)}`);
    process.exit(0);
  }
  const base = lireBase();
  const s = comparer(r.serveur.parFichier, base.serveur);
  const p = comparer(r.pages.parPage, base.pages);
  const erreurs = [...s.erreurs, ...p.erreurs, ...r.melange.constats.map((c) => `melange : ${c.fichier} ${c.texte}`)];
  for (const b of [...s.baisses, ...p.baisses]) console.log(`ABAISSER  ${b}`);
  for (const e of erreurs) console.error(`ECHEC  ${e}`);
  process.exit(erreurs.length || s.baisses.length || p.baisses.length ? 1 : 0);
}
