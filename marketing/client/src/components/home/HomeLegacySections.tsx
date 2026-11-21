import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Eye,
  Layers,
  Link2,
  Lock,
  MapPin,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  UserPlus,
  Zap,
} from "lucide-react";
import { trackSignupCta } from "@/lib/analytics";
import HomePremiumSections from "./HomePremiumSections";

const fadeInUp = {
  hidden: { opacity: 1, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";

const homeFeatureLandingLinks: Record<string, string> = {
  "Audit SEO automatique": "/seo-audit",
  "Analyse de la concurrence": "/competitor-analysis",
  "Optimisation Google Maps": "/local-seo",
  "SEO local & Mots-clés": "/local-seo",
  "Suivi des performances": "/website-monitoring",
  "Recommandations IA": "/seo-reporting",
};

export const legacyHomeFaqs = [
  {
    question: "Combien de temps avant de voir des résultats ?",
    answer: "Les premiers indicateurs et recommandations sont disponibles dès les premières analyses. Les résultats concrets dépendent de nombreux facteurs, comme votre secteur d'activité, la concurrence et les actions mises en œuvre. En référencement naturel, des améliorations peuvent être observées progressivement sur plusieurs semaines ou plusieurs mois.",
  },
  {
    question: "Est-ce que je dois avoir des connaissances techniques ?",
    answer: "Absolument pas ! Flowpoint est conçu pour être simple d'utilisation. Nous vous guidons étape par étape avec des recommandations claires et actionnables.",
  },
  {
    question: "Puis-je annuler à tout moment ?",
    answer: "Oui, tous nos abonnements sont sans engagement. Vous pouvez annuler à tout moment depuis votre espace client.",
  },
  {
    question: "Quel support est disponible ?",
    answer: "Tous les plans incluent un support par email. Les plans Pro et Ultra bénéficient d'un support prioritaire avec réponse sous 24h. Un support IA est également disponible 24h/24 et 7j/7 directement sur le site, sans attente.",
  },
  {
    question: "Flowpoint fonctionne-t-il pour mon secteur d'activité ?",
    answer: "Oui. FlowPoint est conçu pour s'adapter à de nombreux secteurs d'activité, tels que la restauration, l'artisanat, les commerces, les professions libérales et bien d'autres. Les analyses et recommandations sont adaptées aux données de votre entreprise.",
  },
  {
    question: "Mes données sont-elles sécurisées ?",
    answer: "Oui. La sécurité de vos données est une priorité. Les communications sont chiffrées et vos informations sont stockées de manière sécurisée. FlowPoint ne partage jamais vos données avec des tiers sans votre autorisation.",
  },
  {
    question: "Puis-je changer de formule plus tard ?",
    answer: "Oui. Vous pouvez passer à une formule supérieure ou inférieure à tout moment selon l'évolution de vos besoins.",
  },
  {
    question: "Comment tester Flowpoint avant de m'engager ?",
    answer: "C'est simple : profitez de notre essai gratuit de 14 jours. Vous accédez à l'ensemble de la plateforme pour tester toutes les fonctionnalités à votre rythme.",
  },
];

export function HomeLegacySections() {
  const problems = [
    {
      icon: Eye,
      title: "Manque de visibilité",
      description: "Vos clients potentiels ne vous trouvent pas sur Google. Vous perdez des opportunités chaque jour.",
    },
    {
      icon: Users,
      title: "Concurrence féroce",
      description: "Vos concurrents apparaissent avant vous dans les résultats de recherche et Google Maps.",
    },
    {
      icon: Zap,
      title: "Complexité technique",
      description: "Le référencement est complexe. On vous guide pas à pas.",
    },
  ];

  const benefits = [
    { icon: Layers, value: "Google Maps", label: "Suivez votre visibilité locale et repérez les points à vérifier." },
    { icon: Sparkles, value: "IA intégrée", label: "Des recommandations intelligentes pour prioriser vos prochaines actions." },
    { icon: Activity, value: "Temps réel", label: "Suivez vos performances et recevez des alertes dès qu’un changement est détecté." },
    { icon: Lock, value: "100 % sécurisé", label: "Hébergement fiable, paiements Stripe et protection de vos données." },
  ];

  return (
    <>
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Vous perdez des clients chaque jour
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Si vous n'êtes pas visible en ligne, vos concurrents captent vos clients potentiels.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-8"
          >
            {problems.map((problem, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border-none shadow-lg bg-white dark:bg-slate-800 hover:shadow-xl transition-shadow">
                  <CardHeader>
                    <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                      <problem.icon className="h-7 w-7 text-red-600" />
                    </div>
                    <CardTitle className="text-xl"><h3>{problem.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base">{problem.description}</CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section
        id="platform"
        className="fp-home-solution py-20 bg-gradient-to-br from-blue-600 to-indigo-700 dark:from-blue-900 dark:to-slate-950 text-white"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center max-w-3xl mx-auto"
          >
            <motion.div variants={fadeInUp} className="mb-6">
              <ShieldCheck className="h-16 w-16 mx-auto text-blue-200" />
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-white mb-6">
              Centre de contrôle de votre activité
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-xl text-blue-100 mb-8">
              SEO local · Suivi Google Maps · Points à vérifier pour votre établissement
            </motion.p>
            <motion.div variants={fadeInUp} className="flex justify-center">
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-600 border-white shadow-xl rounded-lg py-4 px-6 text-base max-w-xs"
                data-testid="button-solution-cta"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("home_solution")}
                >
                  Créer mon compte gratuitement
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section id="how-it-works" className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Comment ça marche ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Trois étapes pour transformer votre entreprise
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-8"
          >
            <motion.div variants={fadeInUp}>
              <Card className="h-full border-none shadow-lg bg-white dark:bg-slate-800 text-center relative overflow-visible">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">1</div>
                <CardHeader className="pt-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
                    <UserPlus className="h-8 w-8 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl"><h3>Créez votre compte</h3></CardTitle>
                </CardHeader>
                <CardContent><CardDescription className="text-base">Inscrivez-vous gratuitement en quelques secondes et configurez votre espace de travail.</CardDescription></CardContent>
              </Card>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <Card className="h-full border-none shadow-lg bg-white dark:bg-slate-800 text-center relative overflow-visible">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">2</div>
                <CardHeader className="pt-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
                    <Link2 className="h-8 w-8 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl"><h3>Connectez vos données</h3></CardTitle>
                </CardHeader>
                <CardContent><CardDescription className="text-base">Ajoutez votre site, informations complémentaires et les autres services que vous souhaitez utiliser.</CardDescription></CardContent>
              </Card>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <Card className="h-full border-none shadow-lg bg-white dark:bg-slate-800 text-center relative overflow-visible">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">3</div>
                <CardHeader className="pt-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
                    <Rocket className="h-8 w-8 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl"><h3>Passez à l’action</h3></CardTitle>
                </CardHeader>
                <CardContent><CardDescription className="text-base">Commencez à utiliser FlowPoint et transformez votre entreprise en véritable levier de croissance.</CardDescription></CardContent>
              </Card>
            </motion.div>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-center mt-12"
          >
            <Button
              size="lg"
              asChild
              className="bg-blue-600 border-blue-600 text-white rounded-lg py-4 px-6 text-base max-w-xs"
              data-testid="button-how-cta"
            >
              <a href={EXTERNAL_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackSignupCta("home_how_it_works")}>
                Commencer gratuitement
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </motion.div>
        </div>
      </section>

      <section id="benefits" className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Des repères pour mieux décider
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Des signaux utiles pour choisir les prochaines actions
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4 lg:gap-8"
          >
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="flex min-h-[420px] min-w-0 flex-col items-center justify-center rounded-2xl bg-white p-2 text-center shadow-lg dark:bg-slate-800 sm:min-h-[460px] sm:p-8"
              >
                <div className="mx-auto mb-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <benefit.icon className="h-7 w-7 text-blue-600" />
                </div>
                <div className="w-full break-normal font-display text-[clamp(1.2rem,6vw,1.5rem)] font-bold leading-tight text-blue-600 [hyphens:none] sm:text-4xl">
                  {benefit.value}
                </div>
                <div className="mt-2 w-full break-normal text-[clamp(0.875rem,3.8vw,1rem)] leading-relaxed text-slate-600 dark:text-slate-300 [hyphens:none] sm:text-base">
                  {benefit.label}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center mb-16">
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Tout ce dont vous avez besoin pour développer votre entreprise
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Des outils puissants pour analyser, surveiller et développer votre activité, accessibles dès le premier jour.
            </motion.p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Search, title: "Audit SEO automatique", desc: "Analysez instantanément les forces et faiblesses de votre présence en ligne." },
              { icon: Users, title: "Analyse de la concurrence", desc: "Analysez vos concurrents, comparez leurs performances et identifiez de nouvelles opportunités." },
              { icon: MapPin, title: "Optimisation Google Maps", desc: "Améliorez votre fiche Google Business pour attirer plus de clients." },
              { icon: Target, title: "SEO local & Mots-clés", desc: "Identifiez les mots-clés les plus pertinents et suivez leur évolution dans le temps." },
              { icon: BarChart3, title: "Suivi des performances", desc: "Suivez vos performances grâce à des tableaux de bord clairs et des indicateurs exploitables." },
              { icon: TrendingUp, title: "Recommandations IA", desc: "Recevez des recommandations personnalisées pour améliorer vos performances et accélérer votre croissance." },
            ].map((feature, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all bg-white dark:bg-slate-800 group">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 group-hover:bg-blue-600 transition-colors">
                      <feature.icon className="h-6 w-6 text-blue-600 group-hover:text-white transition-colors" />
                    </div>
                    <CardTitle className="text-lg">
                      <h3>
                        <a
                          href={homeFeatureLandingLinks[feature.title]}
                          className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                        >
                          {feature.title}
                        </a>
                      </h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent><CardDescription className="text-base">{feature.desc}</CardDescription></CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <HomePremiumSections />

      <section id="faq" className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Questions fréquentes
            </motion.h2>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
            <Accordion
              type="single"
              collapsible
              className="grid grid-cols-1 gap-4 md:grid-flow-col md:grid-cols-2 md:grid-rows-4"
            >
              {legacyHomeFaqs.map((faq, index) => (
                <AccordionItem
                  key={index}
                  value={`item-${index}`}
                  className="bg-white dark:bg-slate-800 border rounded-xl px-6 shadow-sm"
                >
                  <AccordionTrigger className="text-left font-semibold text-slate-900 dark:text-slate-100 hover:no-underline py-6">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600 dark:text-slate-300 pb-6 text-justify hyphens-auto break-words">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        </div>
      </section>
    </>
  );
}
