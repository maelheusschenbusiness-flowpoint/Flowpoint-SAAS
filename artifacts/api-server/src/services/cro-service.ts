/**
 * Analyse CRO d'une page RÉELLE.
 *
 * Principes (voir D-02 de l'audit) :
 *  - la page est récupérée via `fetchUrlContent` (garde SSRF, DNS épinglé,
 *    redirections validées) ; rien n'est affirmé sur une page non lue ;
 *  - chaque constat est dérivé du HTML observé et porte sa preuve (`evidence`) ;
 *  - aucune statistique sectorielle, aucun gain estimé, aucune « confiance »
 *    codée en dur, aucun score synthétique calculé à partir d'un nombre de
 *    recommandations ;
 *  - si la page ne peut pas être lue, l'état est explicite
 *    (`status: "unavailable"` + code + message) et AUCUNE recommandation
 *    de remplacement n'est fabriquée ;
 *  - l'IA est un complément facultatif : ses constats doivent citer un extrait
 *    réellement présent dans la page, sinon ils sont écartés. Si l'IA est
 *    indisponible, les constats déterministes restent servis et `ai.status`
 *    vaut `"unavailable"`.
 */
import { fetchUrlContent, type FetchUrlResult } from "./url-fetcher.js";
import { logger } from "../lib/logger.js";

export type CroFindingType = "cta" | "form" | "layout" | "copy" | "trust" | "speed" | "mobile";
export type CroPriority = "high" | "medium" | "low";

export interface CroFinding {
  id: string;
  type: CroFindingType;
  priority: CroPriority;
  title: string;
  /** Ce qui a été observé sur la page (faits, pas de benchmark). */
  description: string;
  /** Extrait / mesure concrète tirée de la page. */
  evidence: string;
  implementation: string;
  source: "page" | "ai";
}

export interface CroPageSignals {
  httpStatus: number | null;
  loadTimeMs: number | null;
  title: string | null;
  h1Count: number;
  formCount: number;
  /** Nombre de champs de saisie visibles par formulaire (hors hidden/submit/button). */
  formFieldCounts: number[];
  ctaCount: number;
  genericSubmitLabels: string[];
  hasViewportMeta: boolean;
  socialProofKeywordsFound: string[];
  wordCount: number;
}

export type CroUnavailableCode = "PAGE_FETCH_FAILED" | "INVALID_URL";

export type CroPageAnalysis =
  | {
      status: "ok";
      siteUrl: string;
      analyzedUrl: string;
      analyzedAt: string;
      signals: CroPageSignals;
      findings: CroFinding[];
      ai: { status: "ok" | "unavailable" | "skipped"; message?: string };
      /** Aucun score synthétique : le CRO n'est pas noté à partir d'un décompte de constats. */
      score: null;
    }
  | {
      status: "unavailable";
      siteUrl: string;
      code: CroUnavailableCode;
      message: string;
      findings: [];
      score: null;
    };

export interface CroDeps {
  fetchPage: (url: string) => Promise<FetchUrlResult>;
  /** Retourne le texte brut de la réponse de l'IA, ou lève si l'IA n'est pas disponible. */
  aiChat?: (opts: { systemPrompt: string; userPrompt: string }) => Promise<string>;
}

const GENERIC_SUBMIT = /^(envoyer|soumettre|valider|submit|send|ok)$/i;
const SOCIAL_PROOF_WORDS = [
  "témoignage", "temoignage", "avis", "testimonial", "review", "trustpilot",
  "ils nous font confiance", "nos clients", "clients satisfaits", "customers",
];

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

/** Extrait des signaux structurels du HTML (fonction pure, testable). */
export function extractCroSignals(html: string, page: Pick<FetchUrlResult, "statusCode" | "loadTimeMs" | "title" | "wordCount" | "bodyText">): CroPageSignals {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const h1Count = (clean.match(/<h1[\s>]/gi) ?? []).length;

  const formBlocks = clean.match(/<form[\s\S]*?<\/form>/gi) ?? [];
  const formFieldCounts: number[] = [];
  const genericSubmitLabels: string[] = [];
  let formCtas = 0;
  for (const block of formBlocks) {
    let fields = 0;
    for (const tag of block.match(/<input\b[^>]*>/gi) ?? []) {
      const type = (attr(tag, "type") ?? "text").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) {
        if (type === "submit" || type === "button") {
          formCtas++;
          const v = (attr(tag, "value") ?? "").trim();
          if (v && GENERIC_SUBMIT.test(v)) genericSubmitLabels.push(v);
        }
        continue;
      }
      fields++;
    }
    fields += (block.match(/<select\b/gi) ?? []).length + (block.match(/<textarea\b/gi) ?? []).length;
    for (const m of block.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const type = (attr(m[1] ?? "", "type") ?? "submit").toLowerCase();
      if (type === "reset") continue;
      formCtas++;
      const label = stripTags(m[2] ?? "");
      if (label && GENERIC_SUBMIT.test(label)) genericSubmitLabels.push(label);
    }
    formFieldCounts.push(fields);
  }

  // CTA hors formulaires : <button> et liens stylés « bouton ».
  const outside = clean.replace(/<form[\s\S]*?<\/form>/gi, " ");
  let ctaCount = formCtas;
  ctaCount += (outside.match(/<button\b/gi) ?? []).length;
  for (const m of outside.matchAll(/<a\b([^>]*)>/gi)) {
    const cls = attr(m[1] ?? "", "class") ?? "";
    const role = attr(m[1] ?? "", "role") ?? "";
    if (/\b(btn|button|cta)\b/i.test(cls) || role.toLowerCase() === "button") ctaCount++;
  }

  const text = (page.bodyText ?? stripTags(clean)).toLowerCase();
  const socialProofKeywordsFound = SOCIAL_PROOF_WORDS.filter((w) => text.includes(w));

  return {
    httpStatus: page.statusCode ?? null,
    loadTimeMs: page.loadTimeMs ?? null,
    title: page.title ?? null,
    h1Count,
    formCount: formBlocks.length,
    formFieldCounts,
    ctaCount,
    genericSubmitLabels: [...new Set(genericSubmitLabels)],
    hasViewportMeta: /<meta[^>]+name=["']viewport["']/i.test(clean),
    socialProofKeywordsFound,
    wordCount: page.wordCount ?? 0,
  };
}

/** Constats déterministes : uniquement ce qui est observé sur la page. */
export function deriveCroFindings(s: CroPageSignals): CroFinding[] {
  const out: CroFinding[] = [];

  if (s.ctaCount === 0) {
    out.push({
      id: "no-cta", type: "cta", priority: "high",
      title: "Aucun appel à l'action détecté dans le HTML de la page",
      description: "Aucun bouton, formulaire ni lien de type bouton n'a été trouvé dans le HTML servi. Il peut être injecté par JavaScript, auquel cas ce constat ne s'applique pas.",
      evidence: "0 bouton / lien bouton / formulaire dans le HTML initial",
      implementation: "Vérifier qu'une action principale (contact, devis, achat) est visible sans défilement et présente dans le HTML.",
      source: "page",
    });
  }

  s.formFieldCounts.forEach((n, i) => {
    if (n >= 7) {
      out.push({
        id: `form-long-${i}`, type: "form", priority: "medium",
        title: "Formulaire comportant de nombreux champs",
        description: `Le formulaire n°${i + 1} contient ${n} champs de saisie visibles. Chaque champ demande un effort au visiteur ; vérifiez lesquels sont réellement nécessaires.`,
        evidence: `${n} champs dans le formulaire n°${i + 1}`,
        implementation: "Retirer les champs non essentiels ou répartir la saisie en plusieurs étapes, puis mesurer l'effet sur vos conversions.",
        source: "page",
      });
    }
  });

  if (s.genericSubmitLabels.length > 0) {
    out.push({
      id: "generic-submit", type: "cta", priority: "low",
      title: "Libellé de bouton générique",
      description: `Un bouton d'envoi utilise un libellé générique (« ${s.genericSubmitLabels.join("», «")} »). Un libellé qui décrit le bénéfice est généralement plus clair.`,
      evidence: `Libellés relevés : ${s.genericSubmitLabels.join(", ")}`,
      implementation: "Reformuler le libellé en indiquant ce que le visiteur obtient (ex. « Recevoir mon devis »), puis tester.",
      source: "page",
    });
  }

  if (s.h1Count === 0) {
    out.push({
      id: "no-h1", type: "copy", priority: "medium",
      title: "Aucun titre principal (H1) sur la page",
      description: "Le HTML ne contient pas de balise H1 : la proposition de valeur n'est pas portée par un titre principal identifiable.",
      evidence: "0 balise <h1>",
      implementation: "Ajouter un H1 qui formule clairement le bénéfice principal de la page.",
      source: "page",
    });
  } else if (s.h1Count > 1) {
    out.push({
      id: "multi-h1", type: "copy", priority: "low",
      title: "Plusieurs titres principaux (H1)",
      description: `La page contient ${s.h1Count} balises H1, ce qui dilue le message principal.`,
      evidence: `${s.h1Count} balises <h1>`,
      implementation: "Conserver un seul H1 pour la proposition de valeur et rétrograder les autres en H2.",
      source: "page",
    });
  }

  if (!s.hasViewportMeta) {
    out.push({
      id: "no-viewport", type: "mobile", priority: "medium",
      title: "Balise viewport absente",
      description: "La page ne déclare pas de balise meta viewport : l'affichage mobile risque de ne pas être adapté.",
      evidence: "Aucune <meta name=\"viewport\">",
      implementation: "Ajouter <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> et vérifier l'affichage mobile.",
      source: "page",
    });
  }

  if (s.socialProofKeywordsFound.length === 0 && s.wordCount > 0) {
    out.push({
      id: "no-social-proof", type: "trust", priority: "low",
      title: "Aucun élément de preuve sociale repéré dans le texte",
      description: "Aucun terme lié aux avis, témoignages ou références clients n'apparaît dans le texte de la page. Ils peuvent exister sous forme d'images ou être chargés dynamiquement.",
      evidence: "0 occurrence de : témoignage, avis, testimonial, review, nos clients…",
      implementation: "Si vous disposez d'avis ou de références clients réels, les afficher près de l'appel à l'action.",
      source: "page",
    });
  }

  if (s.loadTimeMs !== null && s.loadTimeMs > 3000) {
    out.push({
      id: "slow-response", type: "speed", priority: "medium",
      title: "Réponse serveur lente lors de la mesure",
      description: `Le document HTML a été reçu en ${s.loadTimeMs} ms depuis nos serveurs (mesure unique, à confirmer).`,
      evidence: `${s.loadTimeMs} ms pour le document HTML`,
      implementation: "Confirmer avec un outil de performance puis réduire le temps de réponse (cache, hébergement, poids de la page).",
      source: "page",
    });
  }

  return out;
}

const VALID_TYPES = new Set<string>(["cta", "form", "layout", "copy", "trust", "speed", "mobile"]);
const VALID_PRIORITIES = new Set<string>(["high", "medium", "low"]);

async function aiFindings(
  aiChat: NonNullable<CroDeps["aiChat"]>,
  page: FetchUrlResult,
  signals: CroPageSignals,
): Promise<CroFinding[]> {
  const text = (page.bodyText ?? "").slice(0, 6000);
  const raw = await aiChat({
    systemPrompt:
      "Tu es un consultant CRO senior. Tu analyses UNIQUEMENT le contenu fourni. " +
      "Chaque constat doit citer dans `quote` un extrait EXACT du texte fourni. " +
      "N'invente aucune statistique, benchmark ni gain chiffré. Réponds en JSON strict.",
    userPrompt:
      `URL : ${page.url}\nTitre : ${page.title ?? "(aucun)"}\n` +
      `Titres : ${(page.headings ?? []).map((h) => `H${h.level} ${h.text}`).join(" | ")}\n` +
      `Signaux : ${JSON.stringify(signals)}\n\nTexte de la page :\n${text}\n\n` +
      'Format : {"findings":[{"type":"cta|form|layout|copy|trust|speed|mobile","priority":"high|medium|low",' +
      '"title":"...","description":"...","quote":"extrait exact","implementation":"..."}]} (0 à 5 constats, en français).',
  });
  const parsed = JSON.parse(raw) as { findings?: unknown[] };
  const haystack = text.toLowerCase();
  const out: CroFinding[] = [];
  for (const f of Array.isArray(parsed.findings) ? parsed.findings : []) {
    const o = (f ?? {}) as Record<string, unknown>;
    const quote = String(o["quote"] ?? "").trim();
    const title = String(o["title"] ?? "").trim();
    const description = String(o["description"] ?? "").trim();
    // Anti-hallucination : le constat doit s'appuyer sur un extrait réellement présent.
    if (!title || !description || quote.length < 8 || !haystack.includes(quote.toLowerCase())) continue;
    out.push({
      id: `ai-${out.length + 1}`,
      type: (VALID_TYPES.has(String(o["type"])) ? String(o["type"]) : "copy") as CroFindingType,
      priority: (VALID_PRIORITIES.has(String(o["priority"])) ? String(o["priority"]) : "medium") as CroPriority,
      title: title.slice(0, 200),
      description: description.slice(0, 800),
      evidence: `« ${quote.slice(0, 300)} »`,
      implementation: String(o["implementation"] ?? "").slice(0, 800),
      source: "ai",
    });
    if (out.length >= 5) break;
  }
  return out;
}

async function defaultAiChat(opts: { systemPrompt: string; userPrompt: string }): Promise<string> {
  const { aiChatCompletion } = await import("../lib/openai-client.js");
  return aiChatCompletion({ ...opts, json: true, maxTokens: 1200 });
}

export async function analyzeCroPage(siteUrl: string, deps?: Partial<CroDeps>): Promise<CroPageAnalysis> {
  const fetchPage = deps?.fetchPage ?? ((u: string) => fetchUrlContent(u, { includeHtml: true }));
  const aiChat = deps?.aiChat ?? defaultAiChat;

  let url: URL;
  try { url = new URL(siteUrl); } catch {
    return { status: "unavailable", siteUrl, code: "INVALID_URL", message: "URL du site invalide.", findings: [], score: null };
  }

  const page = await fetchPage(url.toString());
  if (!page.ok || typeof page.html !== "string") {
    return {
      status: "unavailable", siteUrl, code: "PAGE_FETCH_FAILED",
      message: `La page n'a pas pu être analysée : ${page.error ?? "contenu HTML indisponible"}. Aucune recommandation n'est générée sans lecture de la page.`,
      findings: [], score: null,
    };
  }

  const signals = extractCroSignals(page.html, page);
  const findings = deriveCroFindings(signals);

  let ai: { status: "ok" | "unavailable" | "skipped"; message?: string } = { status: "ok" };
  try {
    findings.push(...(await aiFindings(aiChat, page, signals)));
  } catch (err) {
    const notConfigured = (err as Error)?.message === "AI_NOT_CONFIGURED";
    ai = {
      status: "unavailable",
      message: notConfigured
        ? "L'analyse IA n'est pas configurée : seuls les constats mesurés sur la page sont affichés."
        : "L'analyse IA est momentanément indisponible : seuls les constats mesurés sur la page sont affichés.",
    };
    if (!notConfigured) logger.warn({ err: (err as Error)?.message }, "[CRO] AI enrichment failed");
  }

  return { status: "ok", siteUrl, analyzedUrl: page.url, analyzedAt: new Date().toISOString(), signals, findings, ai, score: null };
}
