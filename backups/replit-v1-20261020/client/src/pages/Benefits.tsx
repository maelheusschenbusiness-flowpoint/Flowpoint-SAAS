import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  CheckCircle2,
  Zap,
  Shield,
  Globe,
  Star,
  Layers,
  Sparkles,
  Activity,
  Bot,
  TrendingUp,
  Users,
  Clock,
  FileText,
  Target,
  BarChart3,
  Settings,
  Plug,
  Eye,
  LayoutDashboard,
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

export default function Benefits() {
  usePageTitle("Avantages | Flowpoint");

  const mainBenefits = [
    {
      icon: Layers,
      title: "Tout-en-un",
      description: "Tous vos outils dans une seule plateforme.",
      details: [
        "Centralisez tous vos outils",
        "Plus besoin de jongler entre plateformes",
        "Gagnez du temps au quotidien",
      ],
    },
    {
      icon: Sparkles,
      title: "IA intégrée",
      description: "Recommandations IA personnalisées.",
      details: [
        "Plan d'action personnalisé",
        "Priorisation automatique",
        "Recommandations basées sur vos données",
      ],
    },
    {
      icon: Activity,
      title: "Temps réel",
      description: "Alertes et monitoring continu.",
      details: [
        "Monitoring continu",
        "Alertes instantanées",
        "Tableaux de bord à jour",
      ],
    },
    {
      icon: Shield,
      title: "100% sécurisé",
      description: "RGPD et hébergement sécurisé.",
      details: [
        "Conformité RGPD",
        "Hébergement sécurisé",
        "Protection des données garantie",
      ],
    },
  ];

  const additionalBenefits = [
    {
      icon: Target,
      title: "Ciblage précis",
      description: "Atteignez exactement les clients qui recherchent vos services dans votre zone.",
    },
    {
      icon: BarChart3,
      title: "Analyse détaillée",
      description: "Comprenez ce qui fonctionne et optimisez votre stratégie en continu.",
    },
    {
      icon: Zap,
      title: "Résultats rapides",
      description: "Voyez des améliorations dès les premières semaines d'utilisation.",
    },
    {
      icon: Shield,
      title: "Conformité RGPD",
      description: "Vos données sont protégées selon les normes européennes les plus strictes.",
    },
    {
      icon: Globe,
      title: "Interface multi-langues",
      description: "Une plateforme pensée pour les entreprises du monde entier.",
    },
    {
      icon: Star,
      title: "Support expert",
      description: "Une équipe dédiée pour vous accompagner dans votre réussite.",
    },
  ];

  const productBenefits = [
    { icon: Bot, title: "Automatisation", description: "Rapports, alertes, surveillance et analyses fonctionnent automatiquement" },
    { icon: TrendingUp, title: "Plus de visibilité", description: "Identifiez les opportunités qui peuvent réellement attirer plus de clients" },
    { icon: Users, title: "Collaboration d'équipe", description: "Travaillez avec votre équipe depuis un espace unique" },
    { icon: Layers, title: "Évolutif", description: "Une plateforme qui accompagne votre croissance, de l'indépendant à l'agence" },
    { icon: Clock, title: "Gagnez du temps", description: "Automatisez les tâches répétitives et concentrez-vous sur votre activité" },
    { icon: FileText, title: "Rapports automatiques", description: "Générez des rapports professionnels en quelques secondes" },
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
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Pourquoi choisir FlowPoint ?
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Centralisez vos données, automatisez vos analyses et prenez de meilleures décisions grâce à une plateforme unique alimentée par l'intelligence artificielle.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-slate-50 via-white to-blue-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 text-center mb-12"
          >
            Les avantages de FlowPoint au quotidien
          </motion.h2>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {productBenefits.map((benefit, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-700 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center mb-4">
                  <benefit.icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">{benefit.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{benefit.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

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
              Des résultats concrets
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Pourquoi les entreprises choisissent Flowpoint
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 gap-8"
          >
            {mainBenefits.map((benefit, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border hover:border-blue-200 dark:border-blue-700 hover:shadow-lg transition-all">
                  <CardHeader className="flex flex-col sm:flex-row items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <benefit.icon className="h-7 w-7 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle asChild className="text-xl mb-2"><h3>{benefit.title}</h3></CardTitle>
                      <CardDescription className="text-sm sm:text-base leading-snug break-words">{benefit.description}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {benefit.details.map((detail, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          {detail}
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
            {additionalBenefits.map((benefit, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="flex items-start gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{benefit.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{benefit.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

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
            <motion.div variants={fadeInUp} className="flex justify-center">
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-600 border-white rounded-lg py-4 px-6 text-base"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("benefits_final_cta")}
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
