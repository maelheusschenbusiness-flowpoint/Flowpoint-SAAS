import { pool } from "@workspace/db";
import { normalizeLanguageCode } from "../lib/request-language.js";
import { logger } from "../lib/logger.js";
import { getRecipientLanguageSources } from "./signup-language.js";
import { loadOrgSettings } from "./org-settings.js";

export const EMAIL_LANGUAGES = [
  "en", "fr", "es", "de", "it", "pt", "pt-br", "nl", "pl", "sv", "ro", "cs",
] as const;

export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number];
export type EmailLocaleSource =
  | "explicit"
  | "user-preference"
  | "organization"
  | "country-region"
  | "default";

export interface EmailLocale {
  language: EmailLanguage;
  intlLocale: string;
  htmlLang: string;
  country: string | null;
  region: string | null;
  source: EmailLocaleSource;
}

export interface EmailLocaleHints {
  orgId?: string | null;
  language?: unknown;
  country?: unknown;
  region?: unknown;
  /** Useful for testing and for recipients whose account was just deleted. */
  resolvedLocale?: EmailLocale;
  /** Set false when the caller has already resolved all available account context. */
  lookupByEmail?: boolean;
}

export interface EmailLocaleSources {
  explicitLanguage?: unknown;
  userLanguage?: unknown;
  organizationLanguage?: unknown;
  country?: unknown;
  region?: unknown;
}

const INTL_LOCALE: Record<EmailLanguage, string> = {
  en: "en-GB",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  "pt-br": "pt-BR",
  nl: "nl-NL",
  pl: "pl-PL",
  sv: "sv-SE",
  ro: "ro-RO",
  cs: "cs-CZ",
};

const COUNTRY_LANGUAGE: Record<string, EmailLanguage> = {
  AT: "de", DE: "de", LI: "de",
  BR: "pt-br", PT: "pt",
  ES: "es", MX: "es", AR: "es", BO: "es", CL: "es", CO: "es", CR: "es",
  CU: "es", DO: "es", EC: "es", GT: "es", HN: "es", NI: "es", PA: "es",
  PE: "es", PY: "es", SV: "es", UY: "es", VE: "es",
  FR: "fr", MC: "fr",
  IT: "it", SM: "it", VA: "it",
  NL: "nl",
  PL: "pl",
  SE: "sv",
  RO: "ro", MD: "ro",
  CZ: "cs",
};

const COUNTRY_ALIASES: Record<string, string> = {
  austria: "AT", osterreich: "AT", autriche: "AT",
  germany: "DE", deutschland: "DE", allemagne: "DE",
  liechtenstein: "LI",
  brazil: "BR", brasil: "BR", bresil: "BR",
  portugal: "PT",
  spain: "ES", espana: "ES", espagne: "ES",
  mexico: "MX", mexique: "MX",
  argentina: "AR", argentine: "AR",
  bolivia: "BO", chile: "CL", chili: "CL", colombia: "CO", colombie: "CO",
  "costa rica": "CR", cuba: "CU", "dominican republic": "DO", "republique dominicaine": "DO",
  ecuador: "EC", equateur: "EC", guatemala: "GT", honduras: "HN", nicaragua: "NI",
  panama: "PA", peru: "PE", perou: "PE", paraguay: "PY", "el salvador": "SV",
  uruguay: "UY", venezuela: "VE",
  france: "FR", monaco: "MC",
  italy: "IT", italie: "IT", "san marino": "SM", "vatican city": "VA",
  netherlands: "NL", nederland: "NL", "pays bas": "NL", hollande: "NL",
  poland: "PL", polska: "PL", pologne: "PL",
  sweden: "SE", sverige: "SE", suede: "SE",
  romania: "RO", roumanie: "RO", moldova: "MD",
  czechia: "CZ", "czech republic": "CZ", "republique tcheque": "CZ",
};

const COUNTRY_REGION_LANGUAGE: Record<string, Record<string, EmailLanguage>> = {
  BE: {
    vlaanderen: "nl", flanders: "nl", flandre: "nl",
    "be-vlg": "nl",
    antwerp: "nl", antwerpen: "nl", anvers: "nl",
    "east flanders": "nl", "west flanders": "nl", "oost vlaanderen": "nl", "west vlaanderen": "nl",
    "flemish brabant": "nl", "brabant flamand": "nl", limburg: "nl",
    wallonia: "fr", wallonie: "fr", "be-wal": "fr",
    hainaut: "fr", namur: "fr", liege: "fr", luxembourg: "fr",
    "eupen": "de", ostbelgien: "de", "sankt vith": "de", "saint vith": "de",
    "be-de": "de", "german speaking community": "de", deutschsprachige: "de",
  },
  CA: {
    quebec: "fr", "province of quebec": "fr", "quebec province": "fr", "qc": "fr", "ca qc": "fr", "ca-qc": "fr",
    ontario: "en", alberta: "en", "british columbia": "en", "colombie britannique": "en",
    manitoba: "en", saskatchewan: "en", "nova scotia": "en", "nouvelle ecosse": "en",
    "prince edward island": "en", "ile du prince edouard": "en",
    "newfoundland and labrador": "en", "terre neuve et labrador": "en",
    yukon: "en", "northwest territories": "en", "territoires du nord ouest": "en",
  },
  CH: {
    vaud: "fr", "ch-vd": "fr", geneva: "fr", geneve: "fr", "ch-ge": "fr",
    neuchatel: "fr", "ch-ne": "fr", jura: "fr", "ch-ju": "fr",
    ticino: "it", tessin: "it", "ch-ti": "it",
    zurich: "de", "ch-zh": "de", lucerne: "de", luzern: "de", "ch-lu": "de",
    zug: "de", "ch-zg": "de", schwyz: "de", "ch-sz": "de",
    uri: "de", glarus: "de", solothurn: "de", aargau: "de", argovie: "de",
    "st gallen": "de", "saint gall": "de", thurgau: "de", schaffhausen: "de",
    "basel stadt": "de", "basel landschaft": "de", obwalden: "de", nidwalden: "de",
    appenzell: "de",
  },
};

const COUNTRY_NAME_ALIASES: Record<string, string> = {
  belgium: "BE", belgique: "BE", belgie: "BE",
  canada: "CA",
  switzerland: "CH", suisse: "CH", schweiz: "CH",
};

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
    : "";
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  const normalized = normalizedText(value);
  return COUNTRY_ALIASES[normalized] ?? COUNTRY_NAME_ALIASES[normalized] ?? null;
}

export function normalizeEmailLanguage(value: unknown): EmailLanguage | null {
  const normalized = normalizeLanguageCode(value);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === "pt") {
    const raw = typeof value === "string" ? value.trim().toLowerCase().replace("_", "-") : "";
    return raw === "pt-br" ? "pt-br" : "pt";
  }
  return (EMAIL_LANGUAGES as readonly string[]).includes(lower) ? lower as EmailLanguage : null;
}

function makeLocale(
  language: EmailLanguage,
  country: string | null,
  region: string | null,
  source: EmailLocaleSource,
): EmailLocale {
  return {
    language,
    intlLocale: INTL_LOCALE[language],
    htmlLang: language === "pt-br" ? "pt-BR" : language,
    country,
    region,
    source,
  };
}

export function emailLocaleForLanguage(
  base: EmailLocale,
  language: EmailLanguage,
): EmailLocale {
  return {
    ...base,
    language,
    intlLocale: INTL_LOCALE[language],
    htmlLang: language === "pt-br" ? "pt-BR" : language,
  };
}

function inferRegionLanguage(country: string, region: unknown): EmailLanguage | null {
  const normalized = normalizedText(region);
  if (!normalized) return null;
  const code = typeof region === "string" ? region.trim().toUpperCase() : "";
  const key = code && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code) ? code.toLowerCase() : normalized;
  const table = COUNTRY_REGION_LANGUAGE[country];
  if (!table) return null;
  if (table[key]) return table[key];
  // Regions such as Brussels, New Brunswick, Fribourg, Valais, and Graubünden
  // are intentionally omitted because multiple supported languages are used there.
  return table[normalized] ?? null;
}

export function inferEmailLanguageFromCountry(
  countryValue: unknown,
  regionValue?: unknown,
): EmailLanguage | null {
  const country = normalizeCountry(countryValue);
  if (!country) return null;
  return inferRegionLanguage(country, regionValue) ?? COUNTRY_LANGUAGE[country] ?? null;
}

function legacyFrenchDefault(value: unknown): boolean {
  const normalized = normalizeLanguageCode(value);
  return normalized === "fr";
}

export function resolveEmailLocaleFromSources(sources: EmailLocaleSources): EmailLocale {
  const country = normalizeCountry(sources.country);
  const region = typeof sources.region === "string" && sources.region.trim() ? sources.region.trim() : null;

  const explicit = normalizeEmailLanguage(sources.explicitLanguage);
  if (explicit) return makeLocale(explicit, country, region, "explicit");

  const userPreference = normalizeEmailLanguage(sources.userLanguage);
  if (userPreference) return makeLocale(userPreference, country, region, "user-preference");

  const organizationPreference = legacyFrenchDefault(sources.organizationLanguage)
    ? null
    : normalizeEmailLanguage(sources.organizationLanguage);
  if (organizationPreference) return makeLocale(organizationPreference, country, region, "organization");

  const inferred = inferEmailLanguageFromCountry(sources.country, sources.region);
  if (inferred) return makeLocale(inferred, country, region, "country-region");

  return makeLocale("en", country, region, "default");
}

type QueryResult = { rows: Array<Record<string, unknown>> };
type Query = (sql: string, values?: unknown[]) => Promise<QueryResult>;

async function bounded<T>(promise: Promise<T>, timeoutMs = 1800): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

async function findRecipientOrgId(email: string, query: Query): Promise<string | null> {
  const owner = await query(
    `SELECT id::text AS org_id FROM organizations WHERE lower(owner_email) = lower($1) LIMIT 1`,
    [email],
  );
  const ownerId = owner.rows[0]?.["org_id"];
  if (typeof ownerId === "string" && ownerId) return ownerId;

  const member = await query(
    `SELECT om.organization_id::text AS org_id
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
      WHERE lower(u.email) = lower($1) AND om.status = 'active'
      LIMIT 1`,
    [email],
  );
  const memberId = member.rows[0]?.["org_id"];
  return typeof memberId === "string" && memberId ? memberId : null;
}

export async function resolveEmailLocale(
  recipientEmail: string,
  hints: EmailLocaleHints = {},
  query: Query = pool.query.bind(pool),
): Promise<EmailLocale> {
  if (hints.resolvedLocale) return hints.resolvedLocale;

  let orgId = typeof hints.orgId === "string" && hints.orgId.trim() ? hints.orgId.trim() : null;
  const shouldLookup = hints.lookupByEmail === true
    || (process.env["NODE_ENV"] !== "test" && (!!orgId || hints.lookupByEmail !== false));

  let settings: Record<string, unknown> | null = null;
  let userLanguage: unknown;
  let organizationLanguage: unknown;
  if (shouldLookup) {
    try {
      if ((!orgId || orgId === "default") && hints.lookupByEmail !== false) {
        orgId = await bounded(findRecipientOrgId(recipientEmail, query)) ?? null;
      }
      if (orgId && orgId !== "default") {
        const [languageSources, loadedSettings] = await Promise.all([
          bounded(getRecipientLanguageSources({ orgId }, { query })),
          bounded(loadOrgSettings(orgId)),
        ]);
        userLanguage = languageSources?.userLanguage;
        organizationLanguage = languageSources?.organizationLanguage;
        settings = loadedSettings as unknown as Record<string, unknown> | null;
      }
    } catch (err) {
      logger.debug({ err, orgId }, "[email-locale] account preference lookup failed; using explicit hints and country");
    }
  }

  return resolveEmailLocaleFromSources({
    explicitLanguage: hints.language,
    userLanguage,
    organizationLanguage,
    country: hints.country ?? settings?.["country"],
    region: hints.region ?? settings?.["region"],
  });
}
