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
import { SEO_AUDIT_FAQS } from "@shared/structured-data-content";
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
import { FeatureScreenshot } from "@/components/FeatureScreenshot";

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const faqs = SEO_AUDIT_FAQS;

const auditChecks = [
  {
    icon: Search,
    title: "Structure and tags",
    description:
      "Check the meta tags and titles that introduce your pages to search engines.",
  },
  {
    icon: Gauge,
    title: "Loading speed",
    description:
      "Identify areas for improvement related to speed and browsing experience.",
  },
  {
    icon: AlertTriangle,
    title: "Technical errors",
    description:
      "Spot technical issues that may limit the understanding and visibility of your site.",
  },
  {
    icon: Target,
    title: "Keywords and opportunities",
    description:
      "Analyze relevant keywords, their trends, and opportunities to prioritize.",
  },
];

const actionSteps = [
  {
    icon: BarChart3,
    title: "Understand the results",
    description:
      "Dashboards group useful indicators to see where the main difficulties lie.",
  },
  {
    icon: Target,
    title: "Prioritize improvements",
    description:
      "Recommendations help you distinguish important actions and move forward step by step.",
  },
  {
    icon: Sparkles,
    title: "Take action",
    description:
      "AI tasks turn findings into a personalized action plan with concrete priorities.",
  },
];

const audiences = [
  {
    icon: Building2,
    title: "Restaurants and cafes",
    description:
      "Check how your establishment appears in local searches and points to correct on your online presence.",
  },
  {
    icon: Users,
    title: "Independent artisans",
    description:
      "Track your local presence and identify information on your site or Google profile to verify.",
  },
  {
    icon: Sparkles,
    title: "Local services",
    description:
      "Spot the searches and local areas to monitor to help your customers find you.",
  },
];

export default function SeoAudit() {
  usePageTitle("SEO Audit Software for Website Analysis | FlowPoint");
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
                SEO audit tool
              </span>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Analyze your site with a complete SEO audit tool
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-3xl mx-auto mb-10"
            >
              FlowPoint analyzes your website to identify SEO issues,
              track your performance, and highlight priority
              optimizations.
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
                  Start my 14-day trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <a
                href="#audit-analyse"
                className="text-blue-700 dark:text-blue-300 font-medium hover:underline"
              >
                Discover what is analyzed
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
              An SEO audit to identify what is holding your site back
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              A website SEO audit shouldn't just produce a list
              of errors. It should help you understand priorities, track
              their evolution, and decide which actions can improve your
              visibility.
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

      <section id="product-preview" className="py-20 bg-slate-50 dark:bg-slate-800/20">
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
              What the FlowPoint SEO audit analyzes
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              The tool gathers the checks and indicators already available
              in FlowPoint to provide an actionable view of your online
              presence.
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
              "Audit of loading speed and Core Web Vitals tracking",
              "Analysis of positions, trends, and keyword opportunities",
              "Competitor comparison and personalized recommendations",
            ].map((item) => (
              <motion.div key={item} variants={fadeInUp} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-slate-700 dark:text-slate-300">
                  {item === "Competitor comparison and personalized recommendations" ? (
                    <>
                      <a
                        href="/competitor-analysis"
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                      >
                        Competitor comparison
                      </a>{" "}
                      and personalized recommendations
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

      <section className="py-20 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeInUp}
            >
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                Product preview
              </span>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                See audit scores and trends in context
              </h2>
              <p className="text-lg text-slate-600 dark:text-slate-300 mb-4">
                Preview the audit workspace with sample site scores, statuses,
                and recent results.
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Illustrative sample data; this preview does not show live customer data.
              </p>
            </motion.div>
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeInUp}
              className="relative z-0 hover:z-30"
            >
              <FeatureScreenshot
                route="audits"
                alt="FlowPoint SEO audits dashboard showing sample site scores and statuses"
              />
            </motion.div>
          </div>
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
              Turn analysis into priority actions
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              The result of an SEO audit becomes useful when it allows you to move
              from observation to a clear action plan.
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
                <p className="text-sm font-semibold text-blue-600 mb-2">Step {index + 1}</p>
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
              Why use SEO audit software?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              SEO audit software gives you a repeatable method to
              analyze your site, compare changes, and maintain a
              global view of your performance. With FlowPoint, SEO analysis
              integrates with keyword tracking,{" "}
              <a
                href="/website-monitoring"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                technical and performance monitoring
              </a>
              ,{" "}
              <a
                href="/competitor-analysis"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                SEO competition
              </a>{" "}
              and AI recommendations. You can thus link
              technical findings to the actions that actually support
              your business. For a practical workflow, try the{" "}
              <a
                href="/free-seo-audit"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                free one-page SEO audit
              </a>
              , then see our{" "}
              <a
                href="/resources/technical-seo-audit-checklist"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                technical SEO audit checklist
              </a>
              ,{" "}
              <a
                href="/resources/audit-seo-pme-priorites"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                SEO audit priorities guide
              </a>{" "}
              and{" "}
              <a
                href="/resources/interpreter-resultats-audit-seo"
                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
              >
                guide to interpreting audit results
              </a>
              .
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
              For whom?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              FlowPoint adapts to teams that want to track their visibility
              and move forward with concrete recommendations.
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
              Frequently asked questions about SEO audit
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
              Ready to analyze your site?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              Start your FlowPoint trial and turn your SEO analysis into
              priority actions for your business.
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
                  Start my 14-day trial
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
