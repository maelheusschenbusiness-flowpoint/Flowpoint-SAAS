import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface MissionStats {
  total: number;
  open: number;
  inProgress: number;
  done: number;
  dismissed: number;
  completionRate: number;
  avgPriorityScore: number;
  quickWins: number;
  estimatedTrafficImpact: number;
  estimatedRevenueImpact: number;
}

type MissionTemplate = {
  title: string; category: string; type: string; priority: string; impact: string; effort: string;
  estimatedTrafficImpact: number | null; estimatedRevenueImpact: number | null;
  aiExplanation: string; aiActionSteps: string[]; aiQuickWin: boolean; priorityScore: number;
};

const MISSION_TEMPLATES: MissionTemplate[] = [
  { title: "Optimiser le titre de la page d'accueil", category: "seo", type: "technical", priority: "high", impact: "high", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Le titre de la page d'accueil est un facteur de classement majeur. Un titre optimisé (max 60 chars, mot-clé principal en tête) améliore significativement le CTR dans les résultats de recherche.", aiActionSteps: ["Vérifier la longueur du titre (max 60 chars)", "Inclure le mot-clé principal en début", "Ajouter un différenciateur de marque", "Tester le résultat dans les SERP"], aiQuickWin: true, priorityScore: 92 },
  { title: "Améliorer la vitesse de chargement mobile", category: "performance", type: "technical", priority: "high", impact: "high", effort: "medium", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Les Core Web Vitals (LCP, CLS, INP) influencent directement le classement Google depuis l'update Page Experience. Une amélioration de la vitesse mobile réduit le taux de rebond et augmente les conversions.", aiActionSteps: ["Compresser les images (WebP/AVIF)", "Activer le lazy loading", "Minifier CSS/JS", "Configurer un CDN"], aiQuickWin: false, priorityScore: 88 },
  { title: "Créer des backlinks locaux de qualité", category: "netlinking", type: "offpage", priority: "high", impact: "high", effort: "high", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Un profil de backlinks de qualité améliore l'autorité de domaine et le positionnement sur les mots-clés compétitifs. Des backlinks locaux DR>40 renforcent particulièrement la visibilité locale.", aiActionSteps: ["Identifier les annuaires locaux de qualité", "Contacter des partenaires locaux pour des échanges", "Créer du contenu linkable (études locales)", "Surveiller les mentions non liées"], aiQuickWin: false, priorityScore: 85 },
  { title: "Optimiser la fiche Google Business Profile", category: "local_seo", type: "local", priority: "high", impact: "medium", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Une fiche GBP complète et régulièrement mise à jour améliore la visibilité dans le Pack Local Google. Photos, horaires à jour et réponses aux avis sont des signaux de confiance clés.", aiActionSteps: ["Ajouter 5+ photos professionnelles", "Mettre à jour les horaires et services", "Répondre à tous les avis (positifs et négatifs)", "Publier un post Google par semaine"], aiQuickWin: true, priorityScore: 82 },
  { title: "Corriger les erreurs de balisage structuré", category: "seo", type: "technical", priority: "medium", impact: "medium", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Les données structurées (Schema.org) permettent l'affichage de rich snippets dans les SERP. Des erreurs de balisage empêchent Google d'indexer correctement ces informations.", aiActionSteps: ["Auditer le schema.org existant", "Corriger les erreurs LocalBusiness", "Ajouter Review/Rating schema", "Valider avec Google Rich Results Test"], aiQuickWin: true, priorityScore: 75 },
  { title: "Développer une stratégie de contenu local", category: "content", type: "content", priority: "medium", impact: "high", effort: "high", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Un contenu centré sur des requêtes locales à fort volume améliore la visibilité sur les recherches géolocalisées. Des articles réguliers et optimisés renforcent l'autorité thématique du site.", aiActionSteps: ["Identifier les requêtes locales à fort potentiel", "Créer des articles de 1500+ mots ciblant ces requêtes", "Optimiser pour la featured snippet", "Promouvoir sur les réseaux sociaux locaux"], aiQuickWin: false, priorityScore: 79 },
  { title: "Améliorer le maillage interne", category: "seo", type: "technical", priority: "medium", impact: "medium", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Un maillage interne optimisé distribue le PageRank entre les pages du site et facilite l'exploration par les robots de Google. Les pages importantes doivent être accessibles en 3 clics maximum.", aiActionSteps: ["Auditer les pages orphelines", "Ajouter des liens contextuels depuis les pages fortes", "Optimiser les ancres de liens", "Créer un plan de cocon sémantique"], aiQuickWin: true, priorityScore: 71 },
  { title: "Optimiser les meta descriptions", category: "seo", type: "content", priority: "medium", impact: "low", effort: "low", estimatedTrafficImpact: null, estimatedRevenueImpact: null, aiExplanation: "Les meta descriptions influencent le taux de clic depuis les SERP. Une description unique par page, orientée bénéfice utilisateur (< 160 chars) avec un CTA clair améliore le CTR organique.", aiActionSteps: ["Auditer toutes les meta descriptions", "Rédiger des descriptions orientées bénéfice (< 160 chars)", "Inclure un CTA clair", "Intégrer le mot-clé principal"], aiQuickWin: true, priorityScore: 65 },
];

export async function runMissionEngine(orgId = "default"): Promise<number> {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT COUNT(*) as count FROM missions WHERE org_id = $1 AND status != 'done'`,
      [orgId]
    );
    const count = Number(existing.rows[0]?.count ?? 0);
    if (count >= 10) return 0;

    let inserted = 0;
    for (const t of MISSION_TEMPLATES.slice(0, Math.max(0, 8 - count))) {
      const id = `m_${orgId}_${t.title.replace(/\s+/g, "_").toLowerCase().slice(0, 30)}_${Date.now()}`;
      await client.query(
        `INSERT INTO missions (id, org_id, title, description, category, type, priority, priority_score,
          status, impact, effort, estimated_traffic_impact, estimated_revenue_impact,
          ai_explanation, ai_action_steps, ai_quick_win, due_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13,$14,$15,
           NOW() + INTERVAL '30 days', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          id, orgId, t.title,
          `Mission générée par l'IA FlowPoint — ${t.category}`,
          t.category, t.type, t.priority, t.priorityScore,
          t.impact, t.effort, t.estimatedTrafficImpact, t.estimatedRevenueImpact,
          t.aiExplanation, JSON.stringify(t.aiActionSteps), t.aiQuickWin,
        ]
      );
      inserted++;
    }
    return inserted;
  } catch (err) {
    logger.error({ err }, "[mission-engine] runMissionEngine failed");
    return 0;
  } finally {
    client.release();
  }
}

export async function getMissionsStats(orgId = "default"): Promise<MissionStats> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status='dismissed' THEN 1 ELSE 0 END) as dismissed,
        AVG(priority_score) as avg_priority,
        SUM(CASE WHEN ai_quick_win=true THEN 1 ELSE 0 END) as quick_wins,
        COALESCE(SUM(estimated_traffic_impact),0) as total_traffic,
        COALESCE(SUM(estimated_revenue_impact),0) as total_revenue
       FROM missions WHERE org_id=$1`,
      [orgId]
    );
    const r = res.rows[0] ?? {};
    const total = Number(r.total ?? 0);
    const done = Number(r.done ?? 0);
    return {
      total,
      open: Number(r.open ?? 0),
      inProgress: Number(r.in_progress ?? 0),
      done,
      dismissed: Number(r.dismissed ?? 0),
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      avgPriorityScore: Math.round(Number(r.avg_priority ?? 0)),
      quickWins: Number(r.quick_wins ?? 0),
      estimatedTrafficImpact: Number(r.total_traffic ?? 0),
      estimatedRevenueImpact: Number(r.total_revenue ?? 0),
    };
  } finally {
    client.release();
  }
}
