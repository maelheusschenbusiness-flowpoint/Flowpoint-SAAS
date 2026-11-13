export type PagePerformanceRow = {
  page: unknown;
  date: unknown;
  clicks: unknown;
  impressions: unknown;
  position: unknown;
};

type WindowTotals = {
  clicks: number;
  impressions: number;
  positionWeighted: number;
};

export type ContentDecayOpportunity = {
  page: string;
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  current: { clicks: number; impressions: number; ctr: number; position: number };
  lostClicks: number;
  lostImpressions: number;
  ctrDrop: number;
  positionDrop: number;
  reasons: ("clicks_declining" | "impressions_declining" | "ctr_declining" | "ranking_declining")[];
  priorityScore: number;
  recommendedAction: string;
};

export type LowCtrOpportunity = {
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  comparisonCtr: number;
  ctrGap: number;
  recommendedAction: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function totals(): WindowTotals {
  return { clicks: 0, impressions: 0, positionWeighted: 0 };
}

function metrics(value: WindowTotals) {
  return {
    clicks: value.clicks,
    impressions: value.impressions,
    ctr: value.impressions > 0 ? value.clicks / value.impressions : 0,
    position: value.impressions > 0 ? value.positionWeighted / value.impressions : 0,
  };
}

export function findContentDecayOpportunities(
  rows: PagePerformanceRow[],
  nowMs = Date.now(),
): ContentDecayOpportunity[] {
  const pivot = new Date(nowMs - 28 * DAY_MS).toISOString().slice(0, 10);
  const start = new Date(nowMs - 56 * DAY_MS).toISOString().slice(0, 10);
  const byPage = new Map<string, { previous: WindowTotals; current: WindowTotals }>();

  for (const row of rows) {
    const page = String(row.page ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    const impressions = Math.max(0, Number(row.impressions) || 0);
    const clicks = Math.max(0, Number(row.clicks) || 0);
    const position = Number(row.position);
    if (!page || date < start || date >= new Date(nowMs).toISOString().slice(0, 10)
      || impressions <= 0 || !Number.isFinite(position) || position <= 0) continue;

    let pageTotals = byPage.get(page);
    if (!pageTotals) {
      pageTotals = { previous: totals(), current: totals() };
      byPage.set(page, pageTotals);
    }
    const bucket = date < pivot ? pageTotals.previous : pageTotals.current;
    bucket.clicks += clicks;
    bucket.impressions += impressions;
    bucket.positionWeighted += position * impressions;
  }

  const results: ContentDecayOpportunity[] = [];
  for (const [page, windows] of byPage) {
    if (windows.previous.impressions < 100 || windows.current.impressions < 50) continue;
    const previous = metrics(windows.previous);
    const current = metrics(windows.current);
    const lostClicks = Math.max(0, previous.clicks - current.clicks);
    const lostImpressions = Math.max(0, previous.impressions - current.impressions);
    const ctrDrop = Math.max(0, previous.ctr - current.ctr);
    const positionDrop = current.position - previous.position;
    const reasons: ContentDecayOpportunity["reasons"] = [];
    if (lostClicks >= Math.max(5, previous.clicks * 0.2)) reasons.push("clicks_declining");
    if (lostImpressions >= Math.max(50, previous.impressions * 0.2)) reasons.push("impressions_declining");
    if (ctrDrop >= Math.max(0.001, previous.ctr * 0.2)) reasons.push("ctr_declining");
    if (positionDrop >= 3) reasons.push("ranking_declining");
    if (reasons.length === 0) continue;

    const recommendedAction = reasons.includes("ranking_declining")
      ? "Vérifier l'intention de recherche, l'indexation et les liens internes avant de modifier la page."
      : reasons.includes("impressions_declining")
        ? "Vérifier l'indexation, la demande de recherche et la couverture des requêtes sur cette période."
        : reasons.includes("ctr_declining")
          ? "Comparer les titres et descriptions affichés ainsi que les changements de résultats de recherche."
          : "Comparer les clics, les requêtes et l'extrait affiché pour identifier la baisse mesurée.";

    results.push({
      page,
      previous: {
        clicks: Math.round(previous.clicks),
        impressions: Math.round(previous.impressions),
        ctr: Number(previous.ctr.toFixed(4)),
        position: Number(previous.position.toFixed(1)),
      },
      current: {
        clicks: Math.round(current.clicks),
        impressions: Math.round(current.impressions),
        ctr: Number(current.ctr.toFixed(4)),
        position: Number(current.position.toFixed(1)),
      },
      lostClicks: Math.round(lostClicks),
      lostImpressions: Math.round(lostImpressions),
      ctrDrop: Number(ctrDrop.toFixed(4)),
      positionDrop: Number(positionDrop.toFixed(1)),
      reasons,
      priorityScore: Number((
        lostClicks
        + lostImpressions * 0.05
        + ctrDrop * 100
        + Math.max(0, positionDrop) * 5
      ).toFixed(1)),
      recommendedAction,
    });
  }

  return results.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 100);
}

export function findLowCtrOpportunities(
  rows: PagePerformanceRow[],
  nowMs = Date.now(),
): LowCtrOpportunity[] {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const pivot = new Date(nowMs - 28 * DAY_MS).toISOString().slice(0, 10);
  const pages = new Map<string, WindowTotals>();
  for (const row of rows) {
    const page = String(row.page ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    const impressions = Math.max(0, Number(row.impressions) || 0);
    const clicks = Math.max(0, Number(row.clicks) || 0);
    const position = Number(row.position);
    if (!page || date < pivot || date >= today || impressions <= 0 || !Number.isFinite(position) || position <= 0) continue;
    let pageTotals = pages.get(page);
    if (!pageTotals) {
      pageTotals = totals();
      pages.set(page, pageTotals);
    }
    pageTotals.clicks += clicks;
    pageTotals.impressions += impressions;
    pageTotals.positionWeighted += position * impressions;
  }

  const bands = new Map<string, Array<{ page: string; ctr: number }>>();
  const bandFor = (position: number) => position <= 3 ? "top3" : position <= 5 ? "top5" : position <= 10 ? "top10" : position <= 20 ? "top20" : "beyond20";
  for (const [page, value] of pages) {
    if (value.impressions < 500) continue;
    const position = value.positionWeighted / value.impressions;
    const band = bandFor(position);
    const ctrs = bands.get(band) ?? [];
    ctrs.push({ page, ctr: value.clicks / value.impressions });
    bands.set(band, ctrs);
  }

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const opportunities: LowCtrOpportunity[] = [];
  for (const [page, value] of pages) {
    if (value.impressions < 500) continue;
    const position = value.positionWeighted / value.impressions;
    const peers = (bands.get(bandFor(position)) ?? [])
      .filter(candidate => candidate.page !== page)
      .map(candidate => candidate.ctr);
    if (peers.length < 3) continue;
    const comparisonCtr = median(peers);
    const ctr = value.clicks / value.impressions;
    const ctrGap = comparisonCtr - ctr;
    if (comparisonCtr <= 0 || ctr >= comparisonCtr * 0.7 || ctrGap < 0.001) continue;
    opportunities.push({
      page,
      impressions: Math.round(value.impressions),
      clicks: Math.round(value.clicks),
      ctr: Number(ctr.toFixed(4)),
      position: Number(position.toFixed(1)),
      comparisonCtr: Number(comparisonCtr.toFixed(4)),
      ctrGap: Number(ctrGap.toFixed(4)),
      recommendedAction: "Testez un titre et une meta description plus précis, puis comparez le CTR après une nouvelle période de mesure.",
    });
  }
  return opportunities.sort((a, b) => (b.ctrGap * b.impressions) - (a.ctrGap * a.impressions)).slice(0, 100);
}
