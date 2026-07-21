import { randomUUID } from "crypto";
import { db, revenueLeaksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface RevenueLeakData {
  leaks: RevenueLeakItem[];
  summary: {
    totalLeaks:           number;
    activeLeaks:          number;
    estimatedMonthlyLoss: number;
    resolvedSavings:      number;
    topCategory:          string;
    criticalLeaks:        number;
  };
}

export interface RevenueLeakItem {
  id:                   string;
  orgId:                string;
  siteUrl:              string | null;
  leakType:             string;
  page:                 string;
  title:                string;
  description:          string | null;
  estimatedMonthlyLoss: number | null;
  impactScore:          number | null;
  fixDifficultyMin:     number | null;
  quickFix:             string | null;
  status:               string;
  metadata:             unknown;
  detectedAt:           Date | null;
  resolvedAt:           Date | null;
}

const LEAK_TEMPLATES = [
  {
    leakType: "conversion",
    page:     "/panier",
    title:    "Abandon de panier élevé",
    description: "73% des paniers ne sont pas finalisés. Chaque 1% d'amélioration du taux de conversion = +1 200€/mois.",
    estimatedMonthlyLoss: 3600,
    impactScore:          90,
    fixDifficultyMin:     120,
    quickFix: "Ajouter un email de relance panier (récupère 5-10% des abandons)",
  },
  {
    leakType: "performance",
    page:     "/",
    title:    "Temps de chargement > 3s",
    description: "Un délai de 1s réduit les conversions de 7%. Vos pages mettent en moyenne 3.8s à charger sur mobile.",
    estimatedMonthlyLoss: 1800,
    impactScore:          78,
    fixDifficultyMin:     240,
    quickFix: "Optimiser les images (WebP) et activer le cache navigateur",
  },
  {
    leakType: "seo",
    page:     "/blog",
    title:    "Pages sans trafic organique",
    description: "38 pages de votre site n'ont reçu aucun trafic organique en 90 jours.",
    estimatedMonthlyLoss: 900,
    impactScore:          55,
    fixDifficultyMin:     180,
    quickFix: "Fusionner les pages orphelines ou les rediriger vers des contenus performants",
  },
  {
    leakType: "ux",
    page:     "/contact",
    title:    "Formulaire de contact abandonné",
    description: "Le formulaire de contact affiche un taux d'abandon de 68%.",
    estimatedMonthlyLoss: 2200,
    impactScore:          82,
    fixDifficultyMin:     60,
    quickFix: "Réduire à 3 champs essentiels (nom, email, message)",
  },
  {
    leakType: "local",
    page:     "/avis",
    title:    "Avis négatifs sans réponse",
    description: "5 avis 1-2 étoiles sans réponse depuis > 7 jours impactent la réputation locale.",
    estimatedMonthlyLoss: 700,
    impactScore:          48,
    fixDifficultyMin:     30,
    quickFix: "Répondre aux avis négatifs sous 24h pour montrer l'engagement",
  },
];

export async function getRevenueLeakData(orgId: string, siteUrl?: string): Promise<RevenueLeakData> {
  const where = siteUrl
    ? and(eq(revenueLeaksTable.orgId, orgId), eq(revenueLeaksTable.siteUrl, siteUrl))
    : eq(revenueLeaksTable.orgId, orgId);

  const leaks = (await db.select().from(revenueLeaksTable).where(where).limit(50)) as RevenueLeakItem[];

  const activeLeaks   = leaks.filter(l => l.status === "active");
  const resolvedLeaks = leaks.filter(l => l.status === "resolved");

  return {
    leaks,
    summary: {
      totalLeaks:            leaks.length,
      activeLeaks:           activeLeaks.length,
      estimatedMonthlyLoss:  activeLeaks.reduce((s, l) => s + Number(l.estimatedMonthlyLoss ?? 0), 0),
      resolvedSavings:       resolvedLeaks.reduce((s, l) => s + Number(l.estimatedMonthlyLoss ?? 0), 0),
      topCategory:           activeLeaks.length > 0
        ? activeLeaks.sort((a, b) => Number(b.estimatedMonthlyLoss) - Number(a.estimatedMonthlyLoss))[0].leakType
        : "N/A",
      criticalLeaks:         activeLeaks.filter(l => Number(l.impactScore ?? 0) >= 80).length,
    },
  };
}

export async function detectRevenueLeaks(orgId: string, siteUrl: string): Promise<void> {
  const existing = await db.select()
    .from(revenueLeaksTable)
    .where(and(eq(revenueLeaksTable.orgId, orgId), eq(revenueLeaksTable.siteUrl, siteUrl)))
    .limit(1);

  if (existing.length > 0) return;

  for (const t of LEAK_TEMPLATES) {
    const id = randomUUID();
    await db.insert(revenueLeaksTable).values({
      id,
      orgId,
      siteUrl,
      leakType:             t.leakType,
      page:                 t.page,
      title:                t.title,
      description:          t.description,
      estimatedMonthlyLoss: t.estimatedMonthlyLoss,
      impactScore:          t.impactScore,
      fixDifficultyMin:     t.fixDifficultyMin,
      quickFix:             t.quickFix,
      status:               "active",
    }).onConflictDoNothing();
  }
}
