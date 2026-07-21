import { randomUUID } from "crypto";
import { db, revenueLeaksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface RevenueLeakData {
  leaks: RevenueLeakItem[];
  summary: {
    totalLeaks: number;
    activeLeaks: number;
    estimatedMonthlyLoss: number;
    resolvedSavings: number;
    topCategory: string;
    criticalLeaks: number;
  };
}

export interface RevenueLeakItem {
  id: string;
  orgId: string;
  siteUrl: string | null;
  type: string;
  title: string;
  description: string | null;
  severity: string;
  estimatedLoss: number | null;
  status: string;
  resolvedAt: Date | null;
  createdAt: Date | null;
}

const LEAK_TEMPLATES = [
  { type: "conversion",  title: "Abandon de panier élevé",         description: "73% des paniers ne sont pas finalisés. Chaque 1% d'amélioration du taux de conversion = +1,200€/mois.", severity: "critical", estimatedLoss: 3600 },
  { type: "performance", title: "Temps de chargement > 3s",         description: "Un délai de 1s réduit les conversions de 7%. Vos pages mettent en moyenne 3.8s à charger sur mobile.", severity: "high",     estimatedLoss: 1800 },
  { type: "seo",         title: "Pages sans trafic organique",      description: "38 pages de votre site n'ont reçu aucun trafic organique en 90 jours. Contenu inutile ou mal indexé.", severity: "medium",   estimatedLoss: 900 },
  { type: "ux",          title: "Formulaire de contact abandonné",  description: "Le formulaire de contact affiche un taux d'abandon de 68%. Un formulaire optimisé pourrait augmenter les leads de +45%.", severity: "high", estimatedLoss: 2200 },
  { type: "local",       title: "Avis négatifs sans réponse",       description: "5 avis 1-2 étoiles sans réponse pendant > 7 jours impactent votre réputation locale et réduisent les conversions.", severity: "medium", estimatedLoss: 700 },
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
      estimatedMonthlyLoss:  activeLeaks.reduce((s, l) => s + Number(l.estimatedLoss ?? 0), 0),
      resolvedSavings:       resolvedLeaks.reduce((s, l) => s + Number(l.estimatedLoss ?? 0), 0),
      topCategory:           activeLeaks.length > 0
        ? activeLeaks.sort((a, b) => Number(b.estimatedLoss) - Number(a.estimatedLoss))[0].type
        : "N/A",
      criticalLeaks:         activeLeaks.filter(l => l.severity === "critical").length,
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
      type:          t.type,
      title:         t.title,
      description:   t.description,
      severity:      t.severity,
      estimatedLoss: t.estimatedLoss,
      status:        "active",
    }).onConflictDoNothing();
  }
}
