import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  Users,
  MapPin,
  TrendingUp,
  BarChart3,
  Target,
  ArrowRight,
  CheckCircle2,
  Zap,
  Globe,
  Star,
  MessageSquare,
  Bell,
  Shield,
  Monitor,
  Bot,
  Gauge,
  LineChart,
  DollarSign,
  Activity,
  Sparkles,
  Building2,
  Trophy,
} from "lucide-react";
import { trackSignupCta } from "@/lib/analytics";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/index.html";

const featureLandingLinks: Record<string, { href: string; label: string }> = {
  "Audit SEO automatique": {
    href: "/seo-audit",
    label: "Découvrir l'outil d'audit SEO",
  },
  "Optimisation Google Maps": {
    href: "/local-seo",
    label: "Découvrir l'outil SEO local",
  },
  "Suivi des performances": {
    href: "/website-monitoring",
    label: "Voir le monitoring SEO",
  },
  "Recommandations IA": {
    href: "/seo-reporting",
    label: "Découvrir le reporting SEO",
  },
  "Analyse de la concurrence": {
    href: "/competitor-analysis",
    label: "Analyser la concurrence SEO",
  },
};

export default function Features() {
  usePageTitle("Fonctionnalités | Flowpoint");

  const mainFeatures = [
    {
      icon: Search,
      title: "Audit SEO automatique",
      description: "Analysez instantanément les forces et faiblesses de votre présence en ligne.",
      details: [
        "Analyse complète de votre site web",
        "Vérification des balises meta et titres",
        "Audit de la vitesse de chargement",
        "Détection des erreurs techniques",
      ],
    },
    {
      icon: Users,
      title: "Analyse de la concurrence",
      description: "Analysez vos concurrents, comparez leurs performances et identifiez de nouvelles opportunités.",
      details: [
        "Identification automatique des concurrents",
        "Comparaison des positions",
        "Analyse des mots-clés concurrents",
        "Recommandations personnalisées",
      ],
    },
    {
      icon: MapPin,
      title: "Optimisation Google Maps",
      description: "Améliorez votre fiche Google Business pour attirer plus de clients locaux.",
      details: [
        "Optimisation de votre fiche Google",
        "Suggestions de catégories",
        "Conseils pour les photos",
        "Amélioration des attributs",
      ],
    },
    {
      icon: Target,
      title: "SEO & Mots-clés",
      description: "Identifiez les mots-clés les plus pertinents et suivez leur évolution dans le temps.",
      details: [
        "Recherche de mots-clés",
        "Suivi des positions",
        "Opportunités de mots-clés",
        "Analyse des tendances",
      ],
    },
    {
      icon: BarChart3,
      title: "Suivi des performances",
      description: "Suivez vos performances grâce à des tableaux de bord clairs et des indicateurs exploitables.",
      details: [
        "Tableaux de bord intuitifs",
        "Rapports hebdomadaires",
        "Alertes de changement de position",
        "Historique des performances",
      ],
    },
    {
      icon: TrendingUp,
      title: "Recommandations IA",
      description: "Recevez des recommandations personnalisées pour améliorer vos performances et accélérer votre croissance.",
      details: [
        "Optimisation des conversions",
        "Formulaires de contact",
        "Suivi des appels",
        "Analyse du parcours client",
      ],
    },
  ];

  const platformFeatures = [
    {
      icon: Monitor,
      badge: "Uptime & SSL",
      badgeCls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
      iconCls: "bg-cyan-100 dark:bg-cyan-900/30",
      iconColor: "text-cyan-600",
      title: "Monitoring en temps réel",
      description: "Surveillance 24/7 de votre site, tracking SSL, latence et endpoints API. Recevez une alerte dès qu'un incident est détecté.",
      points: ["Checks toutes les 5 min", "Tracking certificats SSL", "Alertes Slack & email"],
    },
    {
      icon: Bot,
      badge: "IA",
      badgeCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      iconCls: "bg-blue-100 dark:bg-blue-900/30",
      iconColor: "text-blue-600",
      title: "Missions IA automatisées",
      description: "Plan d'action personnalisé généré par l'IA. Actions prioritaires à fort impact, score d'effort, vue Kanban.",
      points: ["Plan d'action IA personnalisé", "Actions prioritaires : fort impact / faible effort", "Vue Kanban / Calendrier"],
    },
    {
      icon: Gauge,
      badge: "Performance",
      badgeCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
      iconCls: "bg-violet-100 dark:bg-violet-900/30",
      iconColor: "text-violet-600",
      title: "Core Web Vitals",
      description: "Surveillez automatiquement vos indicateurs Core Web Vitals et identifiez les axes d'amélioration.",
      points: ["Audits planifiés automatiques", "LCP / CLS / INP", "Export CSV des résultats"],
    },
    {
      icon: LineChart,
      badge: "Analytics",
      badgeCls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      iconCls: "bg-orange-100 dark:bg-orange-900/30",
      iconColor: "text-orange-600",
      title: "Analytics GA4 intégré",
      description: "Visualisez vos performances grâce à des tableaux de bord centralisés et connectés à Google Analytics 4.",
      points: ["Connexion GA4 native", "Funnels de conversion", "Vue live utilisateurs"],
    },
    {
      icon: Trophy,
      badge: "Concurrence",
      badgeCls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
      iconCls: "bg-red-100 dark:bg-red-900/30",
      iconColor: "text-red-600",
      title: "Intelligence concurrentielle",
      description: "Indice de concurrence IA en temps réel et analyse de vos rivaux locaux.",
      points: ["Indice de concurrence", "Analyse concurrents locaux", "Corrélations IA cross-modules"],
    },
    {
      icon: DollarSign,
      badge: "CRO",
      badgeCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      iconCls: "bg-emerald-100 dark:bg-emerald-900/30",
      iconColor: "text-emerald-600",
      title: "Revenue Leak AI",
      description: "Identifiez les opportunités de croissance et les points de friction qui limitent vos conversions. Score CRO avec recommandations IA actionnables.",
      points: ["Opportunités de croissance", "Analyse frictions UX", "Score CRO + recommandations"],
    },
  ];

  const additionalFeatures = [
    { icon: Globe, title: "Multi-langues", description: "Interface disponible en français" },
    { icon: Star, title: "Gestion des avis", description: "Surveillez et répondez à vos avis Google" },
    { icon: MessageSquare, title: "Support IA 24/7", description: "Assistant intelligent disponible à tout moment" },
    { icon: Bell, title: "Alertes en temps réel", description: "Notifications pour les changements importants" },
    { icon: Shield, title: "Données sécurisées", description: "Protection de vos données conforme RGPD" },
    { icon: Zap, title: "Mises à jour régulières", description: "Évolutions et nouvelles fonctionnalités régulières" },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Des fonctionnalités puissantes pour piloter votre activité
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Tout ce dont vous avez besoin pour analyser, surveiller et développer votre entreprise.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Main Features Grid */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {mainFeatures.map((feature, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border hover:border-blue-200 dark:border-blue-700 hover:shadow-lg transition-all">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
                      <feature.icon className="h-6 w-6 text-blue-600" />
                    </div>
                    <CardTitle asChild className="text-lg"><h2>{feature.title}</h2></CardTitle>
                    <CardDescription className="text-base">{feature.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {feature.details.map((detail, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                    {featureLandingLinks[feature.title] && (
                      <a
                        href={featureLandingLinks[feature.title].href}
                        className="inline-flex items-center mt-5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline"
                      >
                        {featureLandingLinks[feature.title].label}
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </a>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Platform Features Grid — "Une plateforme unique pour développer votre entreprise" */}
      <section className="py-24 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center mb-16">
            <motion.div variants={fadeInUp} className="mb-4">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                La plateforme complète
              </span>
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Une plateforme unique pour développer votre entreprise
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Flowpoint réunit dans un seul dashboard tout ce dont vous avez besoin pour croître en ligne.
            </motion.p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {platformFeatures.map((feature, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-lg transition-all bg-white dark:bg-slate-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-11 h-11 rounded-xl ${feature.iconCls} flex items-center justify-center`}>
                        <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${feature.badgeCls}`}>{feature.badge}</span>
                    </div>
                    <CardTitle asChild className="text-lg leading-snug"><h3>{feature.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <CardDescription className="text-sm mb-4">{feature.description}</CardDescription>
                    <ul className="space-y-1.5">
                      {feature.points.map((point, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Feature Spotlight — alternating left/right */}
      <section className="py-24 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-32">

          {/* Spotlight 1: SEO Local & GBP */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={fadeInUp} className="order-2 lg:order-1">
              <div className="bg-gradient-to-br from-blue-700 to-indigo-900 rounded-2xl p-6 text-white shadow-2xl">
                <div className="text-xs font-medium text-blue-200 mb-4 uppercase tracking-wider">Dashboard SEO Local</div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: "Position Maps", value: "#1" },
                    { label: "Note moyenne", value: "4.8★" },
                    { label: "Impressions", value: "+127%" },
                    { label: "Mots-clés Top 3", value: "45" },
                  ].map((m, i) => (
                    <div key={i} className="bg-white/15 backdrop-blur-sm rounded-xl p-4">
                      <div className="text-xs text-blue-200 mb-1">{m.label}</div>
                      <div className="text-2xl font-bold">{m.value}</div>
                    </div>
                  ))}
                </div>
                <div className="bg-white/10 rounded-xl p-3 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-400 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Fiche Google Business optimisée</div>
                    <div className="text-xs text-blue-200">Photos, horaires, catégories, posts auto</div>
                  </div>
                </div>
              </div>
            </motion.div>
            <motion.div variants={fadeInUp} className="order-1 lg:order-2">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <MapPin className="h-3.5 w-3.5" /> SEO Local & Google Business Profile
              </span>
              <h3 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Développez votre présence locale
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-6">
                Flowpoint optimise automatiquement votre fiche Google Business Profile, suit vos positions sur Maps et optimise votre présence locale grâce à un suivi intelligent de votre établissement et de vos performances.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Suivi des positions Google Maps en temps réel",
                  "Gestion automatique des avis clients",
                  "Heatmap de présence géographique",
                  "Mots-clés + analyse concurrents",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-blue-600 flex-shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="bg-blue-600 border-blue-600 text-white rounded-lg">
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_local_seo")}
                >
                  Configurer Google Business <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
          </motion.div>

          {/* Spotlight 2: AI Missions */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={fadeInUp}>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <Bot className="h-3.5 w-3.5" /> Missions IA & Automatisation
              </span>
              <h3 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Votre assistant IA
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-6">
                L'IA analyse vos données et génère automatiquement des recommandations personnalisées pour vous aider à prioriser les actions à plus fort impact.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Plan d'action IA personnalisé selon votre secteur",
                  "Templates SEO : Technique, Local, Contenu, Growth",
                  "Score d'impact et estimation d'effort par mission",
                  "Vue Kanban, Liste ou Calendrier",
                  "Actions prioritaires IA : fort impact / faible effort",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-blue-700 flex-shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="bg-blue-700 border-blue-700 text-white rounded-lg hover:bg-blue-800">
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_ai_missions")}
                >
                  Voir les missions IA <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
            <motion.div variants={fadeInUp}>
              <div className="bg-gradient-to-br from-blue-600 to-indigo-800 rounded-2xl p-6 text-white shadow-2xl">
                <div className="text-xs font-medium text-blue-200 mb-4 uppercase tracking-wider flex items-center gap-2">
                  <Bot className="h-4 w-4" /> Missions IA — Actions prioritaires
                </div>
                <div className="space-y-2.5">
                  {[
                    { tag: "Prioritaire", task: "Ajouter 5 photos à votre fiche GBP", effort: "15 min" },
                    { tag: "SEO Local", task: "Optimiser les balises title et meta", effort: "45 min" },
                    { tag: "Contenu", task: "Créer 3 posts Google Business", effort: "30 min" },
                    { tag: "Technique", task: "Corriger 4 erreurs Core Web Vitals", effort: "2h" },
                  ].map((item, i) => (
                    <div key={i} className="bg-white/15 backdrop-blur-sm rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">{item.tag}</span>
                        <span className="text-xs text-blue-200">⏱ {item.effort}</span>
                      </div>
                      <div className="text-sm font-medium">{item.task}</div>
                    </div>
                  ))}
                  <div className="bg-white/10 rounded-xl p-2.5 text-center text-xs text-blue-200 font-medium">
                    Missions générées selon votre secteur et vos données
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* Spotlight 3: Agencies */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={fadeInUp} className="order-2 lg:order-1">
              <div className="bg-gradient-to-br from-blue-800 to-indigo-950 rounded-2xl p-6 text-white shadow-2xl">
                <div className="text-xs font-medium text-blue-300 mb-4 uppercase tracking-wider flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Agency Workspace
                </div>
                <div className="space-y-2.5 mb-4">
                  {[
                    { client: "Boulangerie du Coin", score: 87, trend: "+12" },
                    { client: "Cabinet Dr. Bernard", score: 92, trend: "+8" },
                    { client: "Plomberie Martin & Fils", score: 74, trend: "+21" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/30 flex items-center justify-center text-sm font-bold">{item.client[0]}</div>
                        <div className="text-sm font-medium">{item.client}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-blue-400">{item.score}</div>
                        <div className="text-xs text-green-400">↑{item.trend}pts</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-white/5 rounded-xl p-3 flex items-center gap-2 text-xs text-blue-200 border border-blue-300/20">
                  <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                  Rapport white-label prêt à exporter pour tous vos clients
                </div>
              </div>
            </motion.div>
            <motion.div variants={fadeInUp} className="order-1 lg:order-2">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <Building2 className="h-3.5 w-3.5" /> Pour les agences digitales
              </span>
              <h3 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Pilotez tous vos clients depuis un seul espace
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-6">
                Centralisez vos clients, automatisez vos rapports et gérez plusieurs entreprises depuis une seule plateforme.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Rapports exécutifs générés automatiquement par IA",
                  "Export white-label (logo client, couleurs)",
                  "Workspace client isolé et sécurisé",
                  "Gestion multi-sites depuis un tableau de bord unique",
                  "Centre d'alertes : email, Slack, webhooks",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-blue-700 flex-shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="bg-blue-700 border-blue-700 text-white rounded-lg hover:bg-blue-800">
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_agency_spotlight")}
                >
                  Voir les plans agences <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
          </motion.div>

        </div>
      </section>

      {/* For Agencies Strip — La plateforme des agences digitales */}
      <section id="agencies" className="py-20 bg-blue-50 dark:bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
            <motion.div variants={fadeInUp} className="text-center mb-12">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-blue-600/40 dark:border-blue-400/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-6">
                <Building2 className="h-4 w-4" /> Pour les agences
              </span>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-white mb-4">
                La plateforme des agences digitales
              </h2>
              <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                Gérez tous vos clients, générez des rapports en marque blanche et scalez votre agence avec Flowpoint.
              </p>
            </motion.div>
            <motion.div variants={fadeInUp} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {[
                { icon: Globe, title: "White-label reports", desc: "Rapports à votre marque" },
                { icon: Users, title: "Client workspace", desc: "Accès client isolé" },
                { icon: Activity, title: "Multi-sites", desc: "Tous vos clients en un clin d'œil" },
                { icon: Sparkles, title: "Rapports IA", desc: "Générés automatiquement" },
              ].map((item, i) => (
                <div key={i} className="bg-white dark:bg-white/5 border border-blue-100 dark:border-white/10 rounded-xl p-5 text-center hover:border-blue-300 dark:hover:bg-white/10 transition-colors shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center mx-auto mb-3">
                    <item.icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{item.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{item.desc}</div>
                </div>
              ))}
            </motion.div>
            <motion.div variants={fadeInUp} className="text-center">
              <Button asChild size="lg" className="bg-blue-600 border-blue-600 text-white rounded-lg hover:bg-blue-700">
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_agency_section")}
                >
                  Voir les plans agences <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Et bien plus encore */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Et bien plus encore...
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {additionalFeatures.map((feature, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="flex items-start gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{feature.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 bg-gradient-to-br from-blue-600 to-indigo-700 dark:from-slate-900 dark:to-blue-950 text-white">
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
              Prêt à découvrir FlowPoint ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8">
              Créez votre compte gratuitement et découvrez tout le potentiel de la plateforme.
            </motion.p>
            <motion.div variants={fadeInUp}>
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-600 border-white rounded-lg py-4 px-6 text-base"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_final_cta")}
                >
                  Créer mon compte gratuitement
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
