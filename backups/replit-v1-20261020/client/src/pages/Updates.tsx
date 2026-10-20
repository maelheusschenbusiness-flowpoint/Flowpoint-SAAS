import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Rocket, Sparkles, Zap, TrendingUp, Shield, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const updateTitleLinks: Record<string, string> = {
  "Monitoring uptime & surveillance SSL": "/website-monitoring",
  "Rapports white-label & workspace agence": "/seo-reporting",
};

const updateFeatureLinks: Record<string, string> = {
  "Analyse concurrentielle avancée": "/competitor-analysis",
  "Audits Core Web Vitals automatiques planifiés": "/seo-audit",
};

export default function Updates() {
  usePageTitle("Mises à jour | Flowpoint");
  const updates = [
    {
      version: "2.8.0",
      date: "18 Août 2026",
      type: "Amélioration",
      typeColor: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      icon: Sparkles,
      title: "Amélioration de l'intelligence artificielle",
      description: "Notre IA fournit désormais des analyses plus pertinentes, des recommandations mieux adaptées à votre activité et des réponses plus rapides pour vous aider à prioriser les actions les plus importantes.",
      features: [
        "Recommandations plus précises et personnalisées",
        "Meilleure compréhension du contexte de votre activité",
        "Réponses plus rapides dans l'assistant IA",
        "Priorisation améliorée des actions à fort impact",
      ],
    },
    {
      version: "2.7.0",
      date: "23 Juillet 2026",
      type: "Nouvelle fonctionnalité",
      typeColor: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
      icon: Rocket,
      title: "AI Insights & Performance Intelligence",
      description: "Centralisez vos données SEO, Analytics et Local SEO dans une seule vue intelligente. FlowPoint analyse automatiquement vos performances, identifie les opportunités de croissance et fournit des recommandations IA personnalisées pour améliorer votre visibilité, vos conversions et votre présence locale.",
      features: [
        "Recommandations IA basées sur vos données SEO",
        "Analyse CRO et recommandations d'optimisation",
        "Analyse concurrentielle avancée",
        "Vue unifiée des performances SEO, Analytics et Local SEO",
        "Prévisions de performance SEO",
      ],
    },
    {
      version: "2.6.0",
      date: "9 Juillet 2026",
      type: "Nouvelle fonctionnalité",
      typeColor: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
      icon: Sparkles,
      title: "Missions IA & plan d'action personnalisé",
      description: "L'IA génère désormais un plan d'action entièrement personnalisé selon votre secteur et votre zone géographique. Vue Kanban, Calendrier et Actions prioritaires à fort impact sont disponibles pour tous les plans Pro et Ultra.",
      features: [
        "Plan d'action IA adapté à votre secteur",
        "Actions prioritaires : fort impact / faible effort",
        "Vue Kanban, Liste et Calendrier",
        "Priorisation des actions selon leur impact estimé",
      ],
    },
    {
      version: "2.5.0",
      date: "25 Juin 2026",
      type: "Amélioration",
      typeColor: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      icon: TrendingUp,
      title: "Analytics GA4 intégré & Core Web Vitals",
      description: "Connectez votre compte Google Analytics 4 directement depuis votre dashboard Flowpoint. Les Core Web Vitals (LCP, CLS, INP) sont désormais audités automatiquement selon votre plan.",
      features: [
        "Connexion GA4 native depuis le dashboard",
        "Vue d'ensemble des performances Analytics",
        "Audits Core Web Vitals automatiques planifiés",
        "Export CSV des résultats de performance",
      ],
    },
    {
      version: "2.4.0",
      date: "11 Juin 2026",
      type: "Nouvelle fonctionnalité",
      typeColor: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
      icon: Rocket,
      title: "Monitoring uptime & surveillance SSL",
      description: "Votre site est maintenant surveillé 24h/24 : checks uptime, expiration SSL, latence, surveillance des services externes compatibles et endpoints API (POST/GET, webhooks).",
      features: [
        "Checks toutes les 5 min (plan Pro/Ultra)",
        "Tracking des certificats SSL",
        "Monitoring API & webhooks",
        "Alertes Slack & email en temps réel",
      ],
    },
    {
      version: "2.3.0",
      date: "28 Mai 2026",
      type: "Version majeure",
      typeColor: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
      icon: Zap,
      title: "Rapports white-label & workspace agence",
      description: "Les agences peuvent désormais générer des rapports exécutifs en marque blanche, gérer plusieurs clients depuis un workspace isolé et exporter les données avec leur logo et leurs couleurs.",
      features: [
        "Export white-label (logo client, couleurs)",
        "Workspace client isolé et sécurisé",
        "Rapports exécutifs enrichis par IA",
        "Gestion multi-sites depuis un tableau de bord unique",
      ],
    },
  ];

  const roadmap = [
    {
      quarter: "T3 2026",
      items: [
        "Détection intelligente des anomalies SEO et trafic",
        "Alertes SMS pour plans Ultra",
        "Double authentification (2FA)",
      ],
    },
    {
      quarter: "T4 2026",
      items: [
        "Application mobile iOS & Android",
        "Comparaison historique avancée",
        "Intégration réseaux sociaux (Instagram, Facebook)",
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div variants={fadeInUp} className="mb-6">
              <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100">
                <Bell className="h-3 w-3 mr-1" />
                Journal des mises à jour
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Nouveautés et mises à jour
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Découvrez les dernières fonctionnalités et améliorations de Flowpoint. Nous travaillons constamment pour vous offrir la meilleure plateforme pour développer votre entreprise.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 text-center mb-12"
          >
            Dernières mises à jour de Flowpoint
          </motion.h2>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="space-y-8"
          >
            {updates.map((update, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="p-6 border-l-4 border-l-blue-500">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                        <update.icon className="h-6 w-6 text-blue-600" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <Badge className={update.typeColor}>{update.type}</Badge>
                        <span className="text-sm text-slate-500 dark:text-slate-400">v{update.version}</span>
                        <span className="text-sm text-slate-400">{update.date}</span>
                      </div>
                       <h3 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100 mb-2">
                         {updateTitleLinks[update.title] ? (
                           <a
                             href={updateTitleLinks[update.title]}
                             className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                           >
                             {update.title}
                           </a>
                         ) : (
                           update.title
                         )}
                      </h3>
                      <p className="text-slate-600 dark:text-slate-300 mb-4">{update.description}</p>
                      <ul className="space-y-1">
                        {update.features.map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                             {updateFeatureLinks[feature] ? (
                               <a
                                 href={updateFeatureLinks[feature]}
                                 className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                               >
                                 {feature}
                               </a>
                             ) : (
                               feature
                             )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-12"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Feuille de route
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300">
              Découvrez ce que nous préparons pour les prochains mois.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 gap-8"
          >
            {roadmap.map((quarter, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="p-6 h-full">
                  <h3 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-4">
                    {quarter.quarter}
                  </h3>
                  <ul className="space-y-3">
                    {quarter.items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-3 text-slate-600 dark:text-slate-300">
                        <Sparkles className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            ))}
          </motion.div>
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-center text-slate-500 dark:text-slate-400 mt-8 italic"
          >
            Et ce n'est qu'un aperçu de ce qui arrive prochainement.
          </motion.p>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold mb-4"
            >
              Une idée de fonctionnalité ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              Nous adorons recevoir vos suggestions ! Partagez vos idées et contribuez à améliorer Flowpoint.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="/contact"
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-full font-semibold hover:bg-blue-50 transition-colors"
            >
              Suggérer une fonctionnalité
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
