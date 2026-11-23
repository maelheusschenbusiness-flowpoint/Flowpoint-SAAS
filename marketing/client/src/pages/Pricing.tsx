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
import {
  buildFaqPageJsonLd,
  getPricingFaqs,
  PRICING_TRIAL_FAQ_ANSWER_FR,
} from "@shared/structured-data-content";
import { trackEvent, trackSignupCta } from "@/lib/analytics";
import { TrialDisclosure } from "@/components/TrialDisclosure";
import { useMarketingLanguage } from "@/lib/marketing-language";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";

export default function Pricing() {
  usePageTitle("Pricing | FlowPoint");
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const displayLanguage = useMarketingLanguage();
  const faqs = getPricingFaqs(displayLanguage);
  useJsonLd(buildFaqPageJsonLd(faqs));

  const plans = [
    {
      name: "Standard",
      price: 29,
      description: "For getting started and trying the platform",
      popular: false,
      features: [
        "Automated SEO audits",
        "Monitoring uptime",
        "AI dashboard",
        "Local SEO & Google Business Profile",
        "Track 10 keywords",
        "Monthly PDF reports",
        "Export CSV",
        "Automated alerts",
        "Email support",
        "Personalized dashboard",
      ],
    },
    {
      name: "Pro",
      price: 79,
      description: "Our most popular plan",
      popular: true,
      features: [
        "3 connected locations",
        "Everything in Standard, plus:",
        "Monitoring uptime (checks / 5 min)",
        "AI Missions — personalized action plan",
        "Google Analytics 4 connection",
        "Advanced competitor analysis",
        "Track 50 keywords",
        "Revenue Leak AI",
        "Automated weekly reports",
        "Priority support within 48 hours",
        "Scheduled reports",
        "Smart alerts",
        "Extended history",
        "Compare performance over time",
      ],
    },
    {
      name: "Ultra",
      price: 149,
      description: "For local chains and multi-site teams",
      popular: false,
      features: [
        "Multi-workspace",
        "Everything in Pro, plus:",
        "Full white-label reporting",
        "AI Strategist",
        "Custom domain",
        "Unlimited API access",
        "Multi-site workspace",
        "Advanced team management",
        "Advanced AI reports",
        "Unlimited AI Missions",
        "Local visibility heatmaps",
        "Advanced competitor benchmarking",
        "365-day data retention",
        "Priority support",
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation language="en" />

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
              Simple, transparent pricing
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Choose a plan that supports your growth, from your first client to managing multiple locations.
            </motion.p>
            <motion.div variants={fadeInUp} className="flex items-center justify-center gap-4 mt-4">
              <span className="inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-medium px-3 py-1.5 rounded-full">
                <CheckCircle2 className="h-4 w-4" /> 14-day free trial
              </span>
              <span className="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium px-3 py-1.5 rounded-full">
                <CheckCircle2 className="h-4 w-4" /> Change plans at any time
              </span>
            </motion.div>
            <TrialDisclosure showPricingLink={false} className="mt-2" />
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
                  id={`plan-${plan.name.toLowerCase()}`}
                  className={`relative flex flex-col w-full ${
                    plan.popular
                      ? "border-2 border-blue-600 shadow-xl"
                      : "border hover:border-blue-200 dark:border-blue-700"
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-medium">
                        Most popular
                      </span>
                    </div>
                  )}
                  <CardHeader className="text-center pb-8 pt-8">
                    <CardTitle asChild className="text-2xl mb-2"><h2>{plan.name}</h2></CardTitle>
                    <CardDescription className="text-base">{plan.description}</CardDescription>
                    <div className="mt-4">
                      <span className="text-5xl font-display font-bold text-slate-900 dark:text-slate-100">{plan.price}€</span>
                      <span className="text-slate-500 dark:text-slate-400">/month</span>
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
                          <span className="text-slate-400 dark:text-slate-500 italic text-sm">And much more...</span>
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
                          ? "See less ▲"
                          : `See more (${plan.features.length - 5} more) ▼`}
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
                        href={`${EXTERNAL_URL}?plan=${plan.name.toLowerCase()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          trackSignupCta("pricing_plan", {
                            plan: plan.name.toLowerCase(),
                          })
                        }
                      >
                        Start my 14-day trial
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
              Payments processed securely by Stripe
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
                Frequently asked questions
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
                  <AccordionContent
                    forceMount
                    className="text-slate-600 dark:text-slate-300"
                  >
                    {faq.answer === PRICING_TRIAL_FAQ_ANSWER_FR ? (
                      <span lang="fr" translate="no">{faq.answer}</span>
                    ) : (
                      faq.answer
                    )}
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
              Start your 14-day trial
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8">
              Create your account in minutes and explore all FlowPoint features free for 14 days.
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
                  Start my 14-day trial
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Footer language="en" />
      <SupportChat />
    </div>
  );
}
