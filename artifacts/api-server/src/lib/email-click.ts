/**
 * Attribution Smartlead — le clic d'un email de prospection, mesure cote serveur.
 *
 * POURQUOI. Le lien des emails pointe vers le site vitrine ; la mesure navigateur
 * (`funnel-tracking.js`) n'existe qu'avec le cookie de consentement marketing et
 * ne voit donc presque rien : quelques `landing_vue` par jour, tous `direct`,
 * contre 30 a 110 clics comptes par Smartlead. Ce module donne a la campagne un
 * point d'entree de premiere partie, `GET /go`, qui compte le clic lui-meme puis
 * redirige vers la page d'inscription en y portant le `fp_lid`.
 *
 * VIE PRIVEE (RGPD), par construction :
 *  - premiere partie stricte : notre domaine, notre base, aucun tiers ;
 *  - aucun cookie pose, rien lu ni ecrit sur le terminal (pas d'ePrivacy 5(3)) ;
 *  - aucune donnee personnelle dans l'URL : `fp_lid` est un jeton aleatoire
 *    opaque de 128 bits, jamais un email ni un nom ; les UTM sont des valeurs
 *    d'une liste fermee ;
 *  - ni IP ni user-agent stockes : seul un drapeau grossier `bot_suspect` et
 *    l'horodatage. Le `fp_lid` lui-meme n'est pas stocke dans `funnel_events`,
 *    seulement un condensat tronque qui sert a dedoublonner ;
 *  - finalite unique : mesurer notre propre campagne (interet legitime, art.
 *    6(1)(f)), le meme perimetre que `pending_signups.fp_lid` deja en production.
 *
 * JAMAIS DE REDIRECTION OUVERTE. La destination est une CLE (`to=signup|pricing|
 * site`) resolue dans une table fixe ; aucune URL fournie par la requete n'est
 * jamais suivie. Les parametres reportes sont reconstruits un a un depuis des
 * valeurs validees, jamais recopies.
 */
import { createHash } from "node:crypto";
import { normalizeFpLid } from "./fp-lid.js";

/** Destinations autorisees. La requete choisit une cle, jamais une URL. */
export const CIBLES_CLIC = {
  signup:  "/signin.html",
  pricing: "/pricing.html",
  site:    "https://flowpoint.pro/",
} as const;
export type CleCible = keyof typeof CIBLES_CLIC;

export function estCleCible(value: unknown): value is CleCible {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CIBLES_CLIC, value);
}

/** Valeurs UTM acceptees. Tout le reste est ignore : jamais refuse, jamais reporte. */
const SOURCES = new Set(["smartlead"]);
const MEDIUMS = new Set(["email"]);
const CAMPAGNES_PAR_DEFAUT = ["clients_fr_be"];
/** Une variante d'email : court, minuscules, sans `@` ni `.` — rien qui ressemble a un email. */
const CONTENU_RE = /^[a-z0-9_-]{1,32}$/;
const CAMPAGNE_RE = /^[a-z0-9_-]{1,40}$/;

/** Campagnes autorisees : `FP_GO_CAMPAIGNS` (liste separee par des virgules) ou la valeur par defaut. */
export function campagnesAutorisees(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const brut = env["FP_GO_CAMPAIGNS"];
  const liste = (brut ? brut.split(",") : CAMPAGNES_PAR_DEFAUT)
    .map((c) => c.trim())
    .filter((c) => CAMPAGNE_RE.test(c));
  return new Set(liste);
}

export interface ClicEmail {
  fpLid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  cible: CleCible;
}

function texte(value: unknown): string | null {
  // `?a=1&a=2` arrive en tableau : ambigu, donc ignore.
  return typeof value === "string" ? value.trim() : null;
}

export function lireClic(query: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv = process.env): ClicEmail {
  const q = query ?? {};
  const source = texte(q["utm_source"])?.toLowerCase() ?? null;
  const medium = texte(q["utm_medium"])?.toLowerCase() ?? null;
  const campagne = texte(q["utm_campaign"])?.toLowerCase() ?? null;
  const contenu = texte(q["utm_content"])?.toLowerCase() ?? null;
  const to = texte(q["to"]);
  const parDefaut = env["FP_GO_DEFAULT_TARGET"];
  return {
    fpLid: normalizeFpLid(texte(q["fp_lid"])),
    utmSource: source && SOURCES.has(source) ? source : null,
    utmMedium: medium && MEDIUMS.has(medium) ? medium : null,
    utmCampaign: campagne && campagnesAutorisees(env).has(campagne) ? campagne : null,
    utmContent: contenu && CONTENU_RE.test(contenu) ? contenu : null,
    cible: estCleCible(to) ? to : estCleCible(parDefaut) ? parDefaut : "signup",
  };
}

/**
 * L'URL de redirection, reconstruite depuis les seules valeurs validees.
 * `fp_source=smartlead` accompagne `utm_source` : c'est le nom que lit
 * `funnel-tracking.js` en premier.
 */
export function urlRedirection(clic: ClicEmail): string {
  const params = new URLSearchParams();
  if (clic.fpLid) params.set("fp_lid", clic.fpLid);
  if (clic.utmSource) {
    params.set("utm_source", clic.utmSource);
    params.set("fp_source", clic.utmSource);
  }
  if (clic.utmMedium) params.set("utm_medium", clic.utmMedium);
  if (clic.utmCampaign) params.set("utm_campaign", clic.utmCampaign);
  if (clic.utmContent) params.set("utm_content", clic.utmContent);
  const base = CIBLES_CLIC[clic.cible];
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/**
 * Scanners de liens connus : passerelles de securite email, apercus de
 * messagerie, clients HTTP de script, navigateurs sans tete. Le drapeau est
 * grossier a dessein : il sert a separer les clics humains probables dans les
 * comptes, jamais a refuser une redirection.
 */
const UA_SCANNER_RE = new RegExp([
  "bot", "crawl", "spider", "slurp", "preview", "scanner", "scan\\b",
  "proofpoint", "mimecast", "barracuda", "safelinks", "urldefense", "trendmicro",
  "fortiguard", "forcepoint", "symantec", "sophos", "cisco", "ironport", "zscaler",
  "microsoft office", "ms-office", "outlook-ios", "googleimageproxy", "yahoomailproxy",
  "curl", "wget", "python", "go-http-client", "java/", "okhttp", "axios", "node-fetch",
  "libwww", "httpclient", "headless", "phantomjs", "puppeteer", "playwright",
  "facebookexternalhit", "linkedinbot", "whatsapp", "telegram", "slack", "discord", "skype",
].join("|"), "i");

export interface IndicesRequete {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

function entete(h: IndicesRequete["headers"], name: string): string {
  const v = h[name];
  return (Array.isArray(v) ? v.join(",") : v ?? "").toLowerCase();
}

export function estBotSuspect(req: IndicesRequete): boolean {
  if (req.method.toUpperCase() !== "GET") return true; // HEAD : verification de lien
  const h = req.headers;
  const ua = entete(h, "user-agent");
  if (!ua || UA_SCANNER_RE.test(ua)) return true;
  // Un navigateur humain annonce toujours une langue ; la plupart des scanners non.
  if (!entete(h, "accept-language")) return true;
  for (const name of ["purpose", "sec-purpose", "x-purpose", "x-moz"]) {
    const v = entete(h, name);
    if (v.includes("prefetch") || v.includes("preview") || v.includes("prerender")) return true;
  }
  return false;
}

/**
 * Le seul derive du `fp_lid` stocke dans `funnel_events` : un condensat tronque,
 * pour compter les prospects distincts et dedoublonner, sans recopier le jeton.
 */
export function empreinteLead(fpLid: string): string {
  return createHash("sha256").update(`fp-email-click:${fpLid}`).digest("hex").slice(0, 24);
}

/**
 * Un clic par lead, par jour, et par categorie : un scanner qui clique le
 * premier (70 % des clics arrivent dans la minute) ne doit pas masquer le clic
 * humain qui suit.
 */
export function cleIdempotenceClic(fpLid: string, bot: boolean, jour: string): string {
  return `email_clic:${empreinteLead(fpLid)}:${jour}:${bot ? "bot" : "humain"}`;
}

export function suiviClicActif(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["FP_EMAIL_CLICK_TRACKING"] === "on";
}
