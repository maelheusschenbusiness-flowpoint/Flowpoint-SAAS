export interface LocalLandingSettings {
  services: string[];
  locations: string[];
  minimumImpressions: number;
  maximumPosition: number;
}

export interface SearchQuerySignal {
  keyword: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  latestDate: string;
}

export const DEFAULT_LOCAL_LANDING_SETTINGS: LocalLandingSettings = {
  services: [],
  locations: [],
  minimumImpressions: 10,
  maximumPosition: 30,
};

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function normalizeLocalLandingSettings(input: unknown): LocalLandingSettings {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const terms = (raw: unknown) => Array.isArray(raw)
    ? [...new Set(raw.filter((item): item is string => typeof item === "string")
      .map(item => item.trim()).filter(Boolean).map(item => item.slice(0, 80)))].slice(0, 10)
    : [];
  const minimumImpressions = Number(value["minimumImpressions"]);
  const maximumPosition = Number(value["maximumPosition"]);
  return {
    services: terms(value["services"]),
    locations: terms(value["locations"]),
    minimumImpressions: Number.isFinite(minimumImpressions)
      ? Math.max(1, Math.min(100_000, Math.floor(minimumImpressions)))
      : DEFAULT_LOCAL_LANDING_SETTINGS.minimumImpressions,
    maximumPosition: Number.isFinite(maximumPosition)
      ? Math.max(4, Math.min(100, maximumPosition))
      : DEFAULT_LOCAL_LANDING_SETTINGS.maximumPosition,
  };
}

export function findLocalLandingOpportunities(
  rows: SearchQuerySignal[],
  settingsInput: unknown,
) {
  const settings = normalizeLocalLandingSettings(settingsInput);
  if (!settings.services.length || !settings.locations.length) return [];
  const services = settings.services.map(normalized);
  const locations = settings.locations.map(normalized);

  return rows
    .filter(row => {
      const keyword = normalized(row.keyword);
      return keyword.length > 0
        && services.some(term => keyword.includes(term))
        && locations.some(term => keyword.includes(term))
        && Number.isFinite(row.impressions)
        && row.impressions >= settings.minimumImpressions
        && Number.isFinite(row.position)
        && row.position >= 4
        && row.position <= settings.maximumPosition;
    })
    .map(row => ({
      keyword: row.keyword,
      impressions: Math.max(0, Math.round(row.impressions)),
      clicks: Math.max(0, Math.round(row.clicks)),
      ctr: Number.isFinite(row.ctr) ? row.ctr : 0,
      averagePosition: Math.round(row.position * 10) / 10,
      latestDate: row.latestDate,
      evidence: "Données réelles de requêtes Google Search Console sur les 28 derniers jours.",
      recommendation: "Vérifiez si une page dédiée à ce service et à cette zone existe; sinon, créez-en une.",
    }))
    .sort((a, b) => b.impressions - a.impressions || a.averagePosition - b.averagePosition)
    .slice(0, 50);
}
