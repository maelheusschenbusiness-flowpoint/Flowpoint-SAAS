import { pool } from "@workspace/db";

export interface Heatmap {
  id: string; org_id: string; name: string; keyword: string;
  location_id: string | null; center_lat: number; center_lng: number;
  radius_km: number; grid_size: number; status: string; created_at: string;
}

export interface MapsDashboard {
  heatmaps: Heatmap[];
  summary: {
    totalHeatmaps: number;
    avgRank: number | null;
    top3GridPoints: number | null;
    coverageScore: number | null;
    competitorsAnalyzed: number | null;
    localVisibilityScore: number | null;
  };
  insights: string[];
  recommendations: Array<{ title: string; description: string; impact: string; effort: string }>;
}

export async function getMapsDashboard(orgId: string): Promise<MapsDashboard> {
  const heatmaps = await getHeatmaps(orgId);

  const dominanceScores = heatmaps.map(h => Number((h as Record<string,unknown>)["dominance_score"] ?? 0)).filter(n => n > 0);
  const avgRank = dominanceScores.length > 0
    ? Math.round((dominanceScores.reduce((s, n) => s + n, 0) / dominanceScores.length) * 10) / 10
    : null;
  const coverageScore = heatmaps.length > 0
    ? Math.min(100, Math.round((heatmaps.filter(h => Number((h as Record<string,unknown>)["dominance_score"] ?? 0) >= 50).length / heatmaps.length) * 100))
    : null;

  return {
    heatmaps,
    summary: {
      totalHeatmaps: heatmaps.length,
      avgRank,
      top3GridPoints: null,
      coverageScore,
      competitorsAnalyzed: null,
      localVisibilityScore: null,
    },
    insights: [],
    recommendations: [],
  };
}

export async function getHeatmaps(orgId: string): Promise<Heatmap[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM local_heatmaps WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [orgId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getHeatmapDetail(id: string): Promise<Heatmap | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM local_heatmaps WHERE id=$1 LIMIT 1`, [id]);
    return res.rows[0] ?? null;
  } catch { return null; } finally { client.release(); }
}

export async function createHeatmap(orgId: string, data: {
  name: string; keyword: string; locationId?: string;
  centerLat: number; centerLng: number; radiusKm?: number; gridSize?: number;
}): Promise<Heatmap> {
  const client = await pool.connect();
  try {
    const id = `hm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO local_heatmaps
         (id, org_id, location_id, name, keyword, center_lat, center_lng, radius_km, grid_size, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NOW())`,
      [id, orgId, data.locationId ?? null, data.name, data.keyword,
       data.centerLat, data.centerLng, data.radiusKm ?? 5, data.gridSize ?? 7]
    );
    const res = await client.query(`SELECT * FROM local_heatmaps WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function generateAiLocalRecommendations(_orgId: string): Promise<Array<{ title: string; description: string; priority: string }>> {
  return [
    { title: "Créer des citations locales", description: "Inscrivez votre entreprise sur les 10 annuaires locaux les plus importants de votre secteur.", priority: "high" },
    { title: "Optimiser les photos Google Business", description: "Les fiches avec 10+ photos reçoivent 35% plus de clics. Ajoutez des photos récentes de qualité.", priority: "high" },
    { title: "Répondre aux questions publiques", description: "Répondre aux questions Q&A sur votre fiche GBP améliore la confiance et le référencement local.", priority: "medium" },
  ];
}
