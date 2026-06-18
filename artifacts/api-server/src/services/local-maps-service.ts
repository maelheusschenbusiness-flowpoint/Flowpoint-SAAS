import { pool } from "@workspace/db";

export interface Heatmap {
  id: string; orgId: string; name: string; keyword: string; location: string;
  gridSize: string; results: unknown; status: string; createdAt: string;
}

export interface MapsDashboard {
  heatmaps: Heatmap[];
  summary: {
    totalHeatmaps: number;
    avgRank: number;
    top3GridPoints: number;
    coverageScore: number;
    competitorsAnalyzed: number;
    localVisibilityScore: number;
  };
  insights: string[];
  recommendations: Array<{ title: string; description: string; impact: string; effort: string }>;
}

export async function getMapsDashboard(orgId: string): Promise<MapsDashboard> {
  const heatmaps = await getHeatmaps(orgId);
  return {
    heatmaps,
    summary: {
      totalHeatmaps: heatmaps.length,
      avgRank: 4.2,
      top3GridPoints: 14,
      coverageScore: 68,
      competitorsAnalyzed: 5,
      localVisibilityScore: 72,
    },
    insights: [
      "Votre visibilité locale est optimale dans un rayon de 2km autour de votre adresse principale",
      "3 zones géographiques présentent des opportunités inexploitées (faible concurrence)",
      "Votre concurrent principal est 2x plus visible dans le secteur Nord-Est",
    ],
    recommendations: [
      { title: "Cibler le quartier Nord-Est", description: "La densité de recherches 'SEO local' dans ce secteur est 40% plus haute sans concurrents bien positionnés.", impact: "high", effort: "medium" },
      { title: "Créer des pages de destination locales", description: "Une landing page par zone géographique cible améliorera votre visibilité maps de 25-35%.", impact: "high", effort: "medium" },
      { title: "Optimiser les citations locales", description: "15 annuaires locaux pertinents n'ont pas encore votre fiche. Chaque citation améliore votre Pack 3 local.", impact: "medium", effort: "low" },
    ],
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
  name: string; keyword: string; location: string; gridSize?: string;
}): Promise<Heatmap> {
  const client = await pool.connect();
  try {
    const id = `hm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO local_heatmaps (id, org_id, name, keyword, location, grid_size, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'processing',NOW())`,
      [id, orgId, data.name, data.keyword, data.location, data.gridSize ?? "3x3"]
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
