import { useJsonLd } from "@/hooks/use-json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import type { ReactNode } from "react";
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
  Activity,
  ArrowRight,
  BarChart3,
  BellRing,
  Building2,
  CheckCircle2,
  FileText,
  Gauge,
  Globe2,
  LineChart,
  MapPin,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import type {
  SeoClusterContent,
  SeoClusterIcon,
} from "@shared/seo-cluster-content";
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

const iconMap: Record<SeoClusterIcon, LucideIcon> = {
  activity: Activity,
  barChart: BarChart3,
  bell: BellRing,
  building: Building2,
  fileText: FileText,
  gauge: Gauge,
  globe: Globe2,
  lineChart: LineChart,
  map: MapPin,
  search: Search,
  share: Share2,
  shield: ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  trophy: Trophy,
  users: Users,
};

function ClusterIcon({
  name,
  className,
}: {
  name: SeoClusterIcon;
  className?: string;
}) {
  const Icon = iconMap[name];
  return <Icon className={className} />;
}

function renderInlineLinks(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((\/[^)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let linkIndex = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }
    parts.push(
      <a
        key={`internal-link-${linkIndex++}`}
        href={match[2]}
        className="text-blue-700 dark:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
      >
        {match[1]}
      </a>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) {
    return text;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
}

interface SeoClusterLandingProps {
  content: SeoClusterContent;
}

export function SeoClusterLanding({ content }: SeoClusterLandingProps) {
  usePageTitle(content.title);
  useJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faqs.map((faq) => ({
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
                <ClusterIcon name={content.checks[0].icon} className="h-4 w-4" />
                {content.badge}
              </span>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              {content.heroH1}
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-3xl mx-auto mb-10"
            >
              {renderInlineLinks(content.heroDescription)}
            </motion.p>
            <motion.div
              variants={fadeInUp}
              className="flex flex-col sm:flex-row gap-4 items-center justify-center"
            >
              <Button
                size="lg"
                asChild
                className="bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    trackSignupCta("seo_cluster_hero", {
                      landing_page: content.path,
                    })
                  }
                >
                  Commencer avec Flowpoint
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <a
                href="#cluster-overview"
                className="text-blue-700 dark:text-blue-300 font-medium hover:underline"
              >
                Découvrir les fonctionnalités
              </a>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section id="cluster-overview" className="py-20 bg-white dark:bg-slate-900">
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
              {content.introHeading}
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-lg text-slate-600 dark:text-slate-300"
            >
              {renderInlineLinks(content.introDescription)}
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {content.checks.map((item) => (
              <motion.div key={item.title} variants={fadeInUp}>
                <Card className="h-full border hover:border-blue-200 dark:border-blue-700 hover:shadow-lg transition-all">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
                      <ClusterIcon name={item.icon} className="h-6 w-6 text-blue-600" />
                    </div>
                    <CardTitle asChild className="text-lg"><h3>{item.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {renderInlineLinks(item.description)}
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
              {content.overviewHeading}
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              {renderInlineLinks(content.overviewDescription)}
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-6"
          >
            {content.overviewItems.map((item) => (
              <motion.div
                key={item}
                variants={fadeInUp}
                className="flex items-start gap-3"
              >
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-slate-700 dark:text-slate-300">
                  {renderInlineLinks(item)}
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
              {content.actionHeading}
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-lg text-slate-600 dark:text-slate-300"
            >
              {renderInlineLinks(content.actionDescription)}
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-8"
          >
            {content.actionSteps.map((step, index) => (
              <motion.div key={step.title} variants={fadeInUp} className="text-center">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
                  <ClusterIcon name={step.icon} className="h-6 w-6 text-blue-600" />
                </div>
                <p className="text-sm font-semibold text-blue-600 mb-2">
                  Étape {index + 1}
                </p>
                <h3 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100 mb-3">
                  {step.title}
                </h3>
                <p className="text-slate-600 dark:text-slate-300">
                  {renderInlineLinks(step.description)}
                </p>
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
              {content.educationHeading}
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-lg text-slate-600 dark:text-slate-300"
            >
              {renderInlineLinks(content.educationDescription)}
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
              {content.audienceHeading}
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              {renderInlineLinks(content.audienceDescription)}
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-6"
          >
            {content.audiences.map((audience) => (
              <motion.div key={audience.title} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700">
                  <CardHeader>
                    <ClusterIcon name={audience.icon} className="h-7 w-7 text-blue-600 mb-2" />
                    <CardTitle asChild className="text-lg"><h3>{audience.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {renderInlineLinks(audience.description)}
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
              Questions fréquentes
            </motion.h2>
            <motion.div variants={fadeInUp}>
              <Accordion type="single" collapsible className="w-full">
                {content.faqs.map((faq, index) => (
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
              {content.finalCtaHeading}
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-blue-100 mb-8 max-w-xl mx-auto"
            >
              {renderInlineLinks(content.finalCtaDescription)}
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
                  onClick={() =>
                    trackSignupCta("seo_cluster_final", {
                      landing_page: content.path,
                    })
                  }
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