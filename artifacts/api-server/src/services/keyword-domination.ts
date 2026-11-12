export interface KeywordDominationRow {
  keyword: unknown;
  current_position: unknown;
  prev_position: unknown;
  position_change: unknown;
  search_volume: unknown;
  difficulty: unknown;
  url: unknown;
  intent: unknown;
}

export interface KeywordDominationItem {
  keyword: string;
  position: number | null;
  change: number | null;
  searchVolume: number;
  difficulty: number | null;
  url: string | null;
  intent: string | null;
  priorityScore: number;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Rank opportunities from the tenant's saved tracking data only. priorityScore
 * is a sorting aid, not a forecast of traffic or revenue.
 */
export function buildKeywordDominationReport(rows: KeywordDominationRow[]) {
  const keywords: KeywordDominationItem[] = rows
    .map((row) => {
      const position = finiteNumber(row.current_position);
      const change = finiteNumber(row.position_change);
      const volume = Math.max(0, finiteNumber(row.search_volume) ?? 0);
      const difficulty = finiteNumber(row.difficulty);
      const strikingDistance = position !== null && position >= 4 && position <= 20;
      const priorityScore = strikingDistance
        ? Math.round(Math.min(100, (volume / (1 + Math.max(0, position - 4))) * (1 - Math.min(100, Math.max(0, difficulty ?? 50)) / 150)))
        : 0;
      return {
        keyword: String(row.keyword ?? "").trim(),
        position,
        change,
        searchVolume: volume,
        difficulty,
        url: row.url ? String(row.url) : null,
        intent: row.intent ? String(row.intent) : null,
        priorityScore,
      };
    })
    .filter((item) => item.keyword.length > 0);

  const opportunities = keywords
    .filter((item) => item.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.searchVolume - a.searchVolume)
    .slice(0, 50);
  const atRisk = keywords
    .filter((item) => item.change !== null && item.change <= -3)
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0))
    .slice(0, 50);
  const top3 = keywords.filter((item) => item.position !== null && item.position <= 3).length;

  return {
    summary: {
      tracked: keywords.length,
      top3,
      strikingDistance: opportunities.length,
      atRisk: atRisk.length,
    },
    opportunities,
    atRisk,
  };
}
