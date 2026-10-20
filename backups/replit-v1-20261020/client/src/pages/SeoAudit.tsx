import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Gauge,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { trackSignupCta } from "@/lib/analytics";

const EXTERNAL_URL = "https://app.flowpoint.pro/index.html";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const faqs = [
  {
    question: "Qu'est-ce qu'un audit SEO ?",
    answer:
      "Un audit SEO est une analyse structurée d'un site web qui permet d'identifier les éléments qui facilitent ou freinent sa visibilité dans les moteurs de recherche. Il aide à comprendre les problèmes à traiter et les optimisations à prioriser.",
  },
  {
    question: "Que vérifie un audit SEO de site web ?",
    answer:
      "Flowpoint analyse notamment les balises meta et les titres, la vitesse de chargement, les erreurs techniques, les performances du site et les opportunités liées aux mots-clés. Ces informations sont regroupées pour rendre les prochaines actions plus claires.",
  },
  {
    question: "Pourquoi réaliser régulièrement un audit SEO ?",
    answer:
      "Un site évolue, ses performances peuvent changer et de nouveaux problèmes peuvent apparaître. Des audits réguliers permettent de suivre les résultats, de repérer les changements importants et de concentrer les efforts sur les améliorations les plus utiles.",
  },
  {
    question: "Faut-il être expert SEO pour utiliser Flowpoint ?",
    answer:
      "Non. Flowpoint présente les résultats dans des tableaux de bord clairs et fournit des recommandations personnalisées. L'objectif est de transformer les constats techniques en actions compréhensibles, même sans expertise SEO avancée.",
  },
  {
    question: "Comment commencer un audit avec Flowpoint ?",
    answer:
      "Créez votre compte Flowpoint, ajoutez votre site web et lancez l'analyse depuis votre espace. Vous pourrez ensuite consulter les résultats et utiliser les recommandations pour planifier vos prochaines actions.",
  },
];

const auditChecks = [
  {
    icon: Search,
    title: "Structure et balises",
    description:
      "Vérifiez les balises meta et les titres qui présentent vos pages aux moteurs de recherche.",
  },
  {
    icon: Gauge,
    title: "Vitesse de chargement",
    description:
      "Identifiez les axes d'amélioration liés à la rapidité et à l'expérience de navigation.",
  },
  {
    icon: AlertTriangle,
    title: "Erreurs techniques",
    description:
      "Repérez les problèmes techniques qui peuvent limiter la compréhension et la visibilité de votre site.",
  },
  {
    icon: Target,
    title: "Mots-clés et opportunités",
    description:
      "Analysez les mots-clés pertinents, leur évolution et les opportunités à travailler en priorité.",
  },
];

const actionSteps = [
  {
    icon: BarChart3,
    title: "Comprendre les résultats",
    description:
      "Les tableaux de bord regroupent les indicateurs utiles pour voir où se situent les principales difficultés.",
  },
  {
    icon: Target,
    title: "Prioriser les améliorations",
    description:
      "Les recommandations vous aident à distinguer les actions importantes et à avancer étape par étape.",
  },
  {
    icon: Sparkles,
    title: "Passer à l'action",
    description:
      "Les missions IA transforment les constats en plan d'action personnalisé avec des priorités concrètes.",
  },
];

const audiences = [
  {
    icon: Building2,
    title: "Entreprises et PME",
    description:
      "Suivez la visibilité de votre site et concentrez vos ressources sur les optimisations qui peuvent soutenir votre croissance.",
  },
  {
    icon: Users,
    title: "Indépendants et équipes marketing",
    description:
      "Obtenez une lecture claire de vos performances sans multiplier les outils ni les tableaux de bord.",
  },
  {
    icon: Sparkles,
    title: "Agences digitales",
    description:
      "Utilisez une base d'analyse structurée pour suivre plusieurs projets et transformer les résultats en recommandations actionnables.",
  },
];

export default function SeoAudit() {
  usePageTitle("Outil d'audit SEO pour analyser votre site | Flowpoint");
  useJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  });

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.div variants={fadeInUp} className="mb-6">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
                <Search className="h-4 w-4" />
                Outil d'audit SEO
              </span>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Analysez votre site avec un outil d'audit SEO complet
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-3xl mx-auto mb-10"
            >
              Flowpoint analyse votre site web pour identifier les problèmes SEO,
              suivre vos performances et mettre en évidence les optimisations
              prioritaires.
            </motion.p>
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 items-center justify-center">
              <Button
                size="lg"
                asChild
                className="bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("seo_audit_hero")}
                >
                  Commencer mon audit SEO
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <a
                href="#audit-analyse"
                className="text-blue-700 dark:text-blue-300 font-medium hover:underline"
              >
                Découvrir ce qui est analysé
              </a>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section id="audit-analyse" className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="max-w-3xl mx-auto text-center mb-12"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Un audit SEO pour identifier ce qui freine votre site
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Un audit SEO de site web ne doit pas seulement produire une liste
              d'erreurs. Il doit vous aider à comprendre les priorités, à suivre
              leur évolution et à décider quelles actions peuvent améliorer votre
              visibilité.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {auditChecks.map((item) => (
              <motion.div key={item.title} variants={fadeInUp}>
                <Card className="h-full border hover:border-blue-200 dark:border-blue-700 hover:shadow-lg transition-all">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
                      <item.icon className="h-6 w-6 text-blue-600" />
                    </div>
                    <CardTitle asChild className="text-lg"><h3>{item.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-12"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Ce que l'audit SEO Flowpoint analyse
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              L'outil rassemble les contrôles et indicateurs déjà disponibles
              dans Flowpoint pour donner une vision exploitable de votre présence
              en ligne.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-6"
          >
            {[
              "Audit de la vitesse de chargement et suivi des Core Web Vitals",
              "Analyse des positions, tendances et opportunités de mots-clés",
              "Comparaison avec les concurrents et recommandations personnalisées",
            ].map((item) => (
              <motion.div key={item} variants={fadeInUp} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-slate-700 dark:text-slate-300">
                  {item === "Comparaison avec les concurrents et recommandations personnalisées" ? (
                    <>
                      <a
                        href="/competitor-analysis"
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                      >
                        Comparaison avec les concurrents
                      </a>{" "}
                      et recommandations personnalisées
                    </>
                  ) : (
                    item
                  )}
                </p>
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
            className="max-w-3xl mx-auto text-center mb-12"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Transformez l'analyse en actions prioritaires
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Le résultat d'un audit SEO devient utile lorsqu'il permet de passer
              de l'observation à un plan d'action clair.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-8"
          >
            {actionSteps.map((step, index) => (
              <motion.div key={step.title} variants={fadeInUp} className="text-center">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
                  <step.icon className="h-6 w-6 text-blue-600" />
                </div>
                <p className="text-sm font-semibold text-blue-600 mb-2">Étape {index + 1}</p>
                <h3 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100 mb-3">
                  {step.title}
                </h3>
                <p className="text-slate-600 dark:text-slate-300">{step.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-blue-50 dark:bg-slate-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Pourquoi utiliser un logiciel d'audit SEO ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Un logiciel d'audit SEO vous donne une méthode reproductible pour
              analyser votre site, comparer les évolutions et conserver une
              vision globale de vos performances. Avec Flowpoint, l'analyse SEO
              s'intègre au suivi des mots-clés, au{" "}
              <a
                href="/website-monitoring"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                suivi technique et des performances
              </a>
              , à la{" "}
              <a
                href="/competitor-analysis"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                concurrence SEO
              </a>{" "}
              et aux recommandations IA. Vous pouvez ainsi relier
              les constats techniques aux actions qui soutiennent réellement
              votre activité.
            </motion.p>
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
            className="text-center mb-12"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Pour qui ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Flowpoint s'adapte aux équipes qui veulent suivre leur visibilité
              et avancer avec des recommandations concrètes.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-6"
          >
            {audiences.map((audience) => (
              <motion.div key={audience.title} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700">
                  <CardHeader>
                    <audience.icon className="h-7 w-7 text-blue-600 mb-2" />
                    <CardTitle asChild className="text-lg"><h3>{audience.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {audience.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 text-center mb-10"
            >
              Questions fréquentes sur l'audit SEO
            </motion.h2>
            <motion.div variants={fadeInUp}>
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={faq.question} value={`faq-${index}`}>
                    <AccordionTrigger className="text-left font-display font-semibold text-slate-900 dark:text-slate-100">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-slate-600 dark:text-slate-300">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-blue-600 to-indigo-700 dark:from-slate-900 dark:to-blue-950 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2 variants={fadeInUp} className="text-3xl font-display font-bold mb-4">
              Prêt à analyser votre site ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              Lancez votre essai Flowpoint et transformez votre analyse SEO en
              actions prioritaires pour votre entreprise.
            </motion.p>
            <motion.div variants={fadeInUp}>
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-700 hover:bg-blue-50 border-white"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("seo_audit_final")}
                >
                  Commencer gratuitement
                  <ArrowRight className="ml-2 h-4 w-4" />
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