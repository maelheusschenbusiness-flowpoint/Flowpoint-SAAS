export interface GeoGridPoint {
  row: number;
  column: number;
  latitude: number;
  longitude: number;
}

export interface MeasuredHeatmapCell extends GeoGridPoint {
  status: "measured" | "error";
  rank: number | null;
}

export function buildLocalGeoGrid(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  gridSize: number,
): GeoGridPoint[] {
  if (!Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) {
    throw new Error("Invalid latitude");
  }
  if (!Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) {
    throw new Error("Invalid longitude");
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 20) {
    throw new Error("Invalid radius");
  }
  if (![5, 7, 9].includes(gridSize)) throw new Error("Invalid grid size");

  const points: GeoGridPoint[] = [];
  const kmPerLatitudeDegree = 111.32;
  const longitudeScale = kmPerLatitudeDegree * Math.cos((centerLat * Math.PI) / 180);
  if (Math.abs(longitudeScale) < 0.01) throw new Error("Grid is too close to a pole");

  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const northKm = ((gridSize - 1) / 2 - row) * ((2 * radiusKm) / (gridSize - 1));
      const eastKm = (column - (gridSize - 1) / 2) * ((2 * radiusKm) / (gridSize - 1));
      points.push({
        row,
        column,
        latitude: Number((centerLat + northKm / kmPerLatitudeDegree).toFixed(7)),
        longitude: Number((centerLng + eastKm / longitudeScale).toFixed(7)),
      });
    }
  }
  return points;
}

export function normalizeBusinessName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function findBusinessRank(
  results: Array<{ name?: string; rank?: number }>,
  businessName: string,
): number | null {
  const target = normalizeBusinessName(businessName);
  if (!target) return null;
  const result = results.find(item =>
    normalizeBusinessName(String(item.name ?? "")) === target &&
    Number.isInteger(item.rank) &&
    Number(item.rank) > 0
  );
  return result ? Number(result.rank) : null;
}

export function summarizeMeasuredCells(cells: MeasuredHeatmapCell[]) {
  const measured = cells.filter(cell => cell.status === "measured");
  const ranked = measured.flatMap(cell => cell.rank === null ? [] : [cell.rank]);
  const top3 = ranked.filter(rank => rank <= 3).length;
  const top10 = ranked.filter(rank => rank <= 10).length;
  return {
    measuredPoints: measured.length,
    totalPoints: cells.length,
    averageRank: ranked.length
      ? Number((ranked.reduce((sum, rank) => sum + rank, 0) / ranked.length).toFixed(1))
      : null,
    top3Points: measured.length ? top3 : null,
    top10Points: measured.length ? top10 : null,
    notFoundPoints: measured.length - ranked.length,
    coverageScore: cells.length ? Math.round((measured.length / cells.length) * 100) : null,
    dominanceScore: measured.length ? Math.round((top3 / measured.length) * 100) : null,
  };
}
