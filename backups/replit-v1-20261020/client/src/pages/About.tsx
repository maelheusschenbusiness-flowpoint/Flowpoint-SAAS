import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Target, Users, Lightbulb, Heart, MapPin, RefreshCw, Database, Shield, Building } from "lucide-react";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function About() {
  usePageTitle("À propos | Flowpoint");

  const whyUs = [
    {
      icon: RefreshCw,
      title: "Développé en continu",
      description: "Nouvelles fonctionnalités, améliorations et optimisations sont déployées régulièrement afin de faire évoluer la plateforme en permanence.",
    },
    {
      icon: Database,
      title: "Données réelles",
      description: "FlowPoint s'appuie sur vos données réelles (Google Analytics 4, Google Search Console, Google Business Profile, DataForSEO…) pour fournir des analyses fiables et exploitables.",
    },
    {
      icon: Shield,
      title: "Sécurité",
      description: "Vos données sont protégées grâce au chiffrement, à l'isolation des organisations (RLS), à une authentification sécurisée et à une infrastructure cloud moderne.",
    },
    {
      icon: Building,
      title: "Pensé pour les entreprises",
      description: "Chaque fonctionnalité est conçue pour répondre aux besoins des commerces, indépendants, PME et agences souhaitant améliorer leur visibilité en ligne.",
    },
  ];

  const values = [
    {
      icon: Target,
      title: "Résultats concrets",
      description: "Nous nous engageons à fournir des résultats mesurables. Chaque fonctionnalité est conçue pour avoir un impact direct sur votre visibilité.",
    },
    {
      icon: Users,
      title: "Accessibilité",
      description: "Le SEO ne devrait pas être réservé aux grandes entreprises. Nous rendons les outils professionnels accessibles à tous.",
    },
    {
      icon: Lightbulb,
      title: "Innovation continue",
      description: "Notre équipe surveille constamment les évolutions de Google pour vous offrir les stratégies les plus efficaces.",
    },
    {
      icon: Heart,
      title: "Proximité",
      description: "Nous comprenons les défis des entreprises car nous travaillons au quotidien avec elles.",
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              À propos de FlowPoint
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Une plateforme tout-en-un conçue pour aider les entreprises à piloter leur visibilité en ligne.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 gap-12"
          >
            <motion.div variants={fadeInUp} className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-8">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Notre mission
              </h2>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                Nous développons FlowPoint pour aider les entreprises et les agences à centraliser leurs données, piloter leurs performances et prendre de meilleures décisions grâce à une plateforme intelligente réunissant monitoring, analyses, automatisations et intelligence artificielle.
              </p>
            </motion.div>
            <motion.div variants={fadeInUp} className="bg-blue-600 dark:bg-blue-900/40 rounded-2xl p-8">
              <h2 className="text-2xl font-display font-bold text-white mb-4">
                Notre vision
              </h2>
              <p className="text-blue-100 leading-relaxed">
                Nous pensons que les outils de pilotage digital doivent être à la fois puissants, intuitifs et accessibles. C'est pourquoi FlowPoint réunit l'ensemble de vos indicateurs, analyses et automatisations dans une interface unique, pensée pour vous faire gagner du temps et accélérer votre croissance.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Pourquoi FlowPoint */}
      <section className="py-20 bg-slate-50 dark:bg-slate-800/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-12"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Pourquoi choisir FlowPoint ?
            </motion.h2>
          </motion.div>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            {whyUs.map((item, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm"
              >
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4">
                  <item.icon className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Valeurs */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Nos valeurs
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Ce qui nous guide au quotidien dans notre mission d'accompagner les entreprises.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            {values.map((value, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm"
              >
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4">
                  <value.icon className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 mb-2">{value.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">{value.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.div variants={fadeInUp} className="flex items-center justify-center gap-2 mb-6">
              <MapPin className="h-6 w-6 text-blue-600" />
              <span className="text-slate-600 dark:text-slate-300">Entreprise 100% en ligne</span>
            </motion.div>
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Prêt à développer votre visibilité en ligne ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 mb-8">
              Rejoignez les entreprises qui font confiance à FlowPoint.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="https://app.flowpoint.pro/index.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-full font-semibold hover:bg-blue-700 transition-colors"
            >
              Créer mon compte gratuitement
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
