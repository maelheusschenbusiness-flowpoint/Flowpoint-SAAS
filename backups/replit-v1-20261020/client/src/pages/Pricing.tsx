import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, HelpCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PRICING_FAQS, buildFaqPageJsonLd } from "@shared/structured-data-content";
import { trackEvent, trackSignupCta } from "@/lib/analytics";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/index.html";

export default function Pricing() {
  usePageTitle("Tarifs | Flowpoint");
  useJsonLd(buildFaqPageJsonLd(PRICING_FAQS));
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const plans = [
    {
      name: "Standard",
      price: 29,
      description: "Pour démarrer et tester",
      popular: false,
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
    },
    {
      name: "Pro",
      price: 79,
      description: "Le plus populaire",
      popular: true,
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
    },
    {
      name: "Ultra",
      price: 149,
      description: "Pour les leaders & agences",
      popular: false,
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
    },
  ];

  const faqs = PRICING_FAQS;

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
              Des tarifs simples et transparents
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Choisissez le plan qui accompagne votre croissance, de votre premier client à la gestion de plusieurs établissements.
            </motion.p>
            <motion.div variants={fadeInUp} className="flex items-center justify-center gap-4 mt-4">
              <span className="inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-medium px-3 py-1.5 rounded-full">
                <CheckCircle2 className="h-4 w-4" /> Essai gratuit 14 jours
              </span>
              <span className="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium px-3 py-1.5 rounded-full">
                <CheckCircle2 className="h-4 w-4" /> Changement d'offre à tout moment
              </span>
            </motion.div>
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
                    <CardTitle asChild className="text-2xl mb-2"><h2>{plan.name}</h2></CardTitle>
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
                      {!expandedCards.has(index) && plan.features.length > 5 && (
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
                              location: "pricing_page",
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
                    >
                      <a
                        href={EXTERNAL_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          trackSignupCta("pricing_plan", {
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

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-center mt-12"
          >
            <p className="text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Paiements sécurisés par Stripe
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-12"
          >
            <motion.div variants={fadeInUp} className="flex items-center justify-center gap-2 mb-4">
              <HelpCircle className="h-6 w-6 text-blue-600" />
              <h2 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100">
                Questions fréquentes
              </h2>
            </motion.div>
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
                  className="bg-white dark:bg-slate-800 rounded-xl px-6 border"
                >
                  <AccordionTrigger className="text-left font-medium text-slate-900 dark:text-slate-100 hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600 dark:text-slate-300">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
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
              Commencez gratuitement dès aujourd'hui
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8">
              Créez votre compte en quelques minutes et découvrez toutes les fonctionnalités de FlowPoint gratuitement pendant 14 jours.
            </motion.p>
            <motion.div variants={fadeInUp}>
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-600 border-white rounded-lg px-8 py-5 text-lg"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("pricing_final_cta")}
                >
                  Créer mon compte gratuitement
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
