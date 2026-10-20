import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import { motion } from "framer-motion";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search,
  Users,
  MapPin,
  TrendingUp,
  BarChart3,
  Target,
  Clock,
  Award,
  CheckCircle2,
  ArrowRight,
  Zap,
  Eye,
  ShieldCheck,
  Layers,
  Sparkles,
  Activity,
  Lock,
  UserPlus,
  Link2,
  Rocket,
} from "lucide-react";
import { HOME_PAGE_TITLE } from "@shared/site-metadata";
import { trackEvent, trackSignupCta } from "@/lib/analytics";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/index.html";

const homeFeatureLandingLinks: Record<string, string> = {
  "Audit SEO automatique": "/seo-audit",
  "Analyse de la concurrence": "/competitor-analysis",
  "Optimisation Google Maps": "/local-seo",
  "SEO local & Mots-clés": "/local-seo",
  "Suivi des performances": "/website-monitoring",
  "Recommandations IA": "/seo-reporting",
};

export default function Home() {
  usePageTitle(HOME_PAGE_TITLE);
  useJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Combien de temps avant de voir des résultats ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "La plupart de nos clients voient des améliorations dans les 2 à 4 semaines. Les résultats significatifs sur le classement Google apparaissent généralement entre 2 et 3 mois."
        }
      },
      {
        "@type": "Question",
        "name": "Est-ce que je dois avoir des connaissances techniques ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Absolument pas ! Flowpoint est conçu pour être simple d'utilisation. Nous vous guidons étape par étape avec des recommandations claires et actionnables."
        }
      },
      {
        "@type": "Question",
        "name": "Puis-je annuler à tout moment ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Oui, tous nos abonnements sont sans engagement. Vous pouvez annuler à tout moment depuis votre espace client."
        }
      },
      {
        "@type": "Question",
        "name": "Quel support est disponible ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Tous les plans incluent un support par email. Les plans Pro et Ultra bénéficient d'un support prioritaire avec réponse sous 24h. Un support IA est également disponible 24h/24 et 7j/7 directement sur le site, sans attente."
        }
      },
      {
        "@type": "Question",
        "name": "Flowpoint fonctionne-t-il pour mon secteur d'activité ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Oui ! Que vous soyez restaurateur, artisan, professionnel de santé, ou commerçant, Flowpoint s'adapte à votre secteur avec des recommandations personnalisées."
        }
      },
      {
        "@type": "Question",
        "name": "Comment tester Flowpoint avant de m'engager ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "C'est simple : profitez de notre essai gratuit de 14 jours. Vous accédez à l'ensemble de la plateforme pour tester toutes les fonctionnalités à votre rythme."
        }
      }
    ]
  });

  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  useEffect(() => {
    const anchor = sessionStorage.getItem("scrollTo");
    if (!anchor) return;
    sessionStorage.removeItem("scrollTo");
    const attempt = () => {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      } else {
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
  }, []);

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
    { icon: Layers, value: "Tout-en-un", label: "SEO, IA, Monitoring, Analytics et rapports dans une seule plateforme." },
    { icon: Sparkles, value: "IA intégrée", label: "Des recommandations intelligentes pour prioriser vos prochaines actions." },
    { icon: Activity, value: "Temps réel", label: "Suivez vos performances et recevez des alertes dès qu’un changement est détecté." },
    { icon: Lock, value: "100 % sécurisé", label: "Hébergement fiable, paiements Stripe et protection de vos données." },
  ];

  const plans = [
    {
      name: "Standard",
      price: "29",
      description: "Pour démarrer et tester",
      features: [
        "Audit SEO automatique",
        "Monitoring uptime",
        "Dashboard IA",
        "Local SEO & Google Business Profile",
        "Suivi de 10 mots-clés",
        "Rapports PDF mensuels",
        "Export CSV",
        "Alertes automatiques",
        "Support par email",
        "Tableau de bord personnalisé",
      ],
      popular: false,
    },
    {
      name: "Pro",
      price: "79",
      description: "Le plus populaire",
      features: [
        "3 établissements connectés",
        "Tout Standard +",
        "Monitoring uptime (checks / 5 min)",
        "Missions IA — plan d'action personnalisé",
        "Connexion Google Analytics 4",
        "Analyse concurrentielle avancée",
        "Suivi de 50 mots-clés",
        "Revenue Leak AI",
        "Rapports automatisés hebdomadaires",
        "Support prioritaire 48h",
        "Rapports planifiés automatiques",
        "Alertes intelligentes",
        "Historique étendu",
        "Comparaison des performances dans le temps",
      ],
      popular: true,
    },
    {
      name: "Ultra",
      price: "149",
      description: "Pour les leaders & agences",
      features: [
        "Multi-workspace",
        "Tout Pro +",
        "White-label complet",
        "IA Stratégiste",
        "Domaine personnalisé",
        "API illimitée",
        "Workspace agence",
        "Gestion avancée des équipes",
        "Rapports IA avancés",
        "Missions IA illimitées",
        "Heatmaps locales",
        "Benchmark concurrentiel avancé",
        "Rétention 365 jours",
        "Support prioritaire",
      ],
      popular: false,
    },
  ];

  const testimonials = [
    {
      quote: "Grâce à Flowpoint, notre boulangerie est passée de la page 3 à la première position sur Google Maps. Les clients affluent !",
      author: "Marie Dubois",
      role: "Propriétaire, Boulangerie du Coin",
      rating: 4,
    },
    {
      quote: "En 2 mois, nous avons doublé nos demandes de devis. L'outil est simple et les recommandations sont claires.",
      author: "Pierre Martin",
      role: "Artisan Plombier",
      rating: 5,
    },
    {
      quote: "Flowpoint nous a permis de comprendre pourquoi nos concurrents étaient devant nous. Maintenant, c'est nous qui dominons.",
      author: "Sophie Laurent",
      role: "Directrice, Agence Immobilière",
      rating: 4,
    },
    {
      quote: "Un gain de temps incroyable ! Je passe moins de temps sur le marketing et plus avec mes clients. Résultats visibles en quelques semaines.",
      author: "Jean-Luc Moreau",
      role: "Gérant, Restaurant Le Petit Bistro",
      rating: 5,
    },
    {
      quote: "Le support est réactif et les conseils personnalisés. Mon cabinet dentaire a vu une augmentation de 40% des nouveaux patients.",
      author: "Dr. Claire Bernard",
      role: "Chirurgien-dentiste",
      rating: 5,
    },
    {
      quote: "Flowpoint a transformé notre approche digitale. Notre société de services informatiques reçoit maintenant 3 fois plus de demandes de la part d'entreprises locales.",
      author: "Rachid Bachour",
      role: "Gérant, Société Informatique",
      rating: 5,
    },
  ];

  const faqs = [
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

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-100/30 to-transparent dark:from-slate-800/30" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="text-center max-w-4xl mx-auto"
          >
            <motion.div variants={fadeInUp} className="mb-6">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
                <Zap className="h-4 w-4" />
                Plateforme tout-en-un · SEO · IA · Monitoring · Analytics...
              </span>
            </motion.div>
            
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-slate-900 dark:text-slate-100 leading-tight mb-6"
            >
              Flowpoint, la plateforme de <span className="text-blue-600">SEO local</span> pour rendre votre entreprise visible sur Google
            </motion.h1>
            
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 mb-10 max-w-2xl mx-auto"
            >
              Une plateforme unique pour surveiller votre site, améliorer votre référencement, analyser vos performances et transformer vos données en actions concrètes.
            </motion.p>
            
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 items-center justify-center">
              <Button
                size="lg"
                asChild
                className="bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 rounded-lg py-4 px-6 text-base max-w-xs"
                data-testid="button-hero-cta"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("home_hero")}
                >
                  Créer mon compte gratuitement
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  trackEvent("how_it_works_clicked", { location: "home_hero" });
                  document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-lg py-4 px-6 text-base"
                data-testid="button-hero-how"
              >
                Comment ça marche ?
              </Button>
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>Conçu pour les PME et indépendants</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>Paiements sécurisés par Stripe</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>Annulation à tout moment</span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Problem Section */}
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
                    <CardTitle asChild className="text-xl"><h3>{problem.title}</h3></CardTitle>
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

      {/* Solution Section */}
      <section className="py-20 bg-gradient-to-br from-blue-600 to-indigo-700 dark:from-slate-900 dark:to-blue-950 text-white">
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
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold mb-6">
              Centre de contrôle de votre activité
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-xl text-blue-100 mb-8">
              Plateforme IA tout-en-un · Pilotage de la croissance · Surveillance et analyses en temps réel · Décisions assistées par l’IA
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

      {/* How It Works Section */}
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
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                  1
                </div>
                <CardHeader className="pt-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
                    <UserPlus className="h-8 w-8 text-blue-600" />
                  </div>
                  <CardTitle asChild className="text-xl"><h3>Créez votre compte</h3></CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Inscrivez-vous gratuitement en quelques secondes et configurez votre espace de travail.
                  </CardDescription>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <Card className="h-full border-none shadow-lg bg-white dark:bg-slate-800 text-center relative overflow-visible">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                  2
                </div>
                <CardHeader className="pt-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
                    <Link2 className="h-8 w-8 text-blue-600" />
                  </div>
                  <CardTitle asChild className="text-xl"><h3>Connectez vos données</h3></CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Ajoutez votre site, informations complémentaires et les autres services que vous souhaitez utiliser.
                  </CardDescription>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={fadeInUp}>
              <Card className="h-full border-none shadow-lg bg-white dark:bg-slate-800 text-center relative overflow-visible">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                  3
                </div>
                <CardHeader className="pt-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
                    <Rocket className="h-8 w-8 text-blue-600" />
                  </div>
                  <CardTitle asChild className="text-xl"><h3>Passez à l’action</h3></CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Commencez à utiliser FlowPoint et transformez votre entreprise en véritable levier de croissance.
                  </CardDescription>
                </CardContent>
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
              <a
                href={EXTERNAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackSignupCta("home_how_it_works")}
              >
                Commencer gratuitement
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Core Local SEO Features Section */}
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
            ].map((f, i) => (
              <motion.div key={i} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all bg-white dark:bg-slate-800 group">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 group-hover:bg-blue-600 transition-colors">
                      <f.icon className="h-6 w-6 text-blue-600 group-hover:text-white transition-colors" />
                    </div>
                    <CardTitle asChild className="text-lg">
                      <h3>
                        <a
                          href={homeFeatureLandingLinks[f.title]}
                          className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                        >
                          {f.title}
                        </a>
                      </h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base">{f.desc}</CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Benefits Section */}
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

      {/* Pricing Section */}
      <section id="pricing" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Des tarifs simples et transparents
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Essayez l'essai gratuit de 14 jours pour tester la plateforme et voir Flowpoint en action.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-8"
          >
            {plans.map((plan, index) => (
              <motion.div key={index} variants={fadeInUp} className="flex">
                <Card
                  className={`relative flex flex-col w-full ${
                    plan.popular
                      ? "border-2 border-blue-600 shadow-xl"
                      : "border hover:border-blue-200 dark:border-blue-700"
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-medium">
                        Le plus populaire
                      </span>
                    </div>
                  )}
                  <CardHeader className="text-center pb-8 pt-8">
                    <CardTitle asChild className="text-2xl mb-2"><h3>{plan.name}</h3></CardTitle>
                    <CardDescription className="text-base">{plan.description}</CardDescription>
                    <div className="mt-4">
                      <span className="text-5xl font-display font-bold text-slate-900 dark:text-slate-100">{plan.price}€</span>
                      <span className="text-slate-500 dark:text-slate-400">/mois</span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 flex flex-col flex-1">
                    <ul className="space-y-3 mb-3 flex-1">
                      {(expandedCards.has(index) ? plan.features : plan.features.slice(0, 5)).map((feature, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                          <span className="text-slate-600 dark:text-slate-300">{feature}</span>
                        </li>
                      ))}
                      {expandedCards.has(index) && plan.features.length > 5 && (
                        <li className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-blue-400 flex-shrink-0" />
                          <span className="text-slate-400 dark:text-slate-500 italic text-sm">Et bien plus encore...</span>
                        </li>
                      )}
                    </ul>
                    {plan.features.length > 5 && (
                      <button
                        onClick={() => {
                          const isExpanded = expandedCards.has(index);
                          if (!isExpanded) {
                            trackEvent("pricing_features_expanded", {
                              plan: plan.name.toLowerCase(),
                              location: "home_page",
                            });
                          }
                          setExpandedCards(prev => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index); else next.add(index);
                            return next;
                          });
                        }}
                        className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium mb-6 flex items-center gap-1 transition-colors"
                        data-testid={`button-toggle-features-${plan.name.toLowerCase()}`}
                      >
                        {expandedCards.has(index)
                          ? "Voir moins ▲"
                          : `Voir plus (${plan.features.length - 5} de plus) ▼`}
                      </button>
                    )}
                    <Button
                      asChild
                      className={`w-full rounded-lg py-5 text-lg transition-colors ${
                        plan.popular
                          ? "bg-blue-700 border-blue-700 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 text-white hover:bg-blue-800 hover:border-blue-800"
                          : "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:border-blue-700"
                      }`}
                      data-testid={`button-subscribe-${plan.name.toLowerCase()}`}
                    >
                      <a
                        href={EXTERNAL_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          trackSignupCta("home_plan", {
                            plan: plan.name.toLowerCase(),
                          })
                        }
                      >
                        Essayer gratuitement
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>


      {/* FAQ Section */}
      <section id="faq" className="py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
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

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <Accordion type="single" collapsible className="space-y-4">
              {faqs.map((faq, index) => (
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

      {/* Final CTA Section */}
      <section className="py-12 bg-gradient-to-br from-blue-600 to-indigo-700 dark:from-slate-900 dark:to-blue-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-white mb-6">
              Prêt à accélérer la croissance de votre entreprise ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-xl text-blue-100 mb-8">
              Commencez votre essai gratuit et découvrez comment FlowPoint peut vous aider à analyser, surveiller et développer votre entreprise.
            </motion.p>
            <motion.div variants={fadeInUp} className="flex justify-center">
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-600 border-white shadow-xl rounded-lg py-4 px-6 text-base max-w-xs"
                data-testid="button-final-cta"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("home_final_cta")}
                >
                  Commencer gratuitement
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </motion.div>
            <motion.p variants={fadeInUp} className="mt-6 text-blue-200 text-sm">
              Paiements sécurisés par Stripe • Annulation à tout moment
            </motion.p>
          </motion.div>
        </div>
      </section>

      <Footer />

      <SupportChat />
    </div>
  );
}
