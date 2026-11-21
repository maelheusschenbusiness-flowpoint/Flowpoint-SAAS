import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { Rocket, Sparkles, Zap, TrendingUp, Shield, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const updateTitleLinks: Record<string, string> = {
  "Uptime monitoring & SSL checks": "/website-monitoring",
  "White-label reports & agency workspace": "/seo-reporting",
};

const updateFeatureLinks: Record<string, string> = {
  "Advanced competitor analysis": "/competitor-analysis",
  "Scheduled Core Web Vitals audits": "/seo-audit",
};

export default function Updates() {
  usePageTitle("Product updates | FlowPoint");
  const updates = [
    {
      version: "2.8.0",
      date: "October 20, 2026",
      type: "Improvement",
      typeColor: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      icon: Sparkles,
      title: "Improved AI insights",
      description: "AI now provides more relevant analysis, recommendations better suited to your business and faster responses to help prioritize important actions.",
      features: [
        "More precise, personalized recommendations",
        "Better understanding of your business context",
        "Faster responses from the AI assistant",
        "Improved prioritization of high-impact actions",
      ],
    },
    {
      version: "2.7.0",
      date: "October 13, 2026",
      type: "New feature",
      typeColor: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
      icon: Rocket,
      title: "AI Insights & Performance Intelligence",
      description: "Bring SEO, Analytics and local SEO data together in one view. FlowPoint analyzes performance, identifies growth opportunities and provides personalized AI recommendations to improve visibility, conversions and local presence.",
      features: [
        "AI recommendations based on your SEO data",
        "CRO analysis and optimization recommendations",
        "Advanced competitor analysis",
        "Unified view of SEO, Analytics and local SEO performance",
        "SEO performance forecasts",
      ],
    },
    {
      version: "2.6.0",
      date: "October 6, 2026",
      type: "New feature",
      typeColor: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
      icon: Sparkles,
      title: "AI Missions & personalized action plans",
      description: "AI now creates an action plan tailored to your industry and location. Kanban, calendar and high-impact priority views are available on Pro and Ultra plans.",
      features: [
        "AI action plan tailored to your industry",
        "Priorities: high impact, low effort",
        "Kanban, list and calendar views",
        "Prioritize actions by estimated impact",
      ],
    },
    {
      version: "2.5.0",
      date: "September 29, 2026",
      type: "Improvement",
      typeColor: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      icon: TrendingUp,
      title: "Integrated GA4 Analytics & Core Web Vitals",
      description: "Connect Google Analytics 4 from your FlowPoint dashboard. Core Web Vitals (LCP, CLS and INP) are now audited automatically according to your plan.",
      features: [
        "Native GA4 connection from the dashboard",
        "Analytics performance overview",
        "Scheduled Core Web Vitals audits",
        "Export performance results to CSV",
      ],
    },
    {
      version: "2.4.0",
      date: "September 22, 2026",
      type: "New feature",
      typeColor: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
      icon: Rocket,
      title: "Uptime monitoring & SSL checks",
      description: "Monitor your website around the clock for uptime, SSL expiry, latency, compatible external services and API endpoints (POST/GET and webhooks).",
      features: [
        "Checks every 5 minutes on Pro and Ultra",
        "SSL certificate tracking",
        "API and webhook monitoring",
        "Real-time Slack and email alerts",
      ],
    },
    {
      version: "2.3.0",
      date: "September 15, 2026",
      type: "Major release",
      typeColor: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
      icon: Zap,
      title: "White-label reports & agency workspace",
      description: "Agencies can create white-label executive reports, manage multiple clients in an isolated workspace and export data with their own logo and colors.",
      features: [
        "White-label exports (client logo and colors)",
        "Isolated, secure client workspace",
        "AI-enhanced executive reports",
        "Manage multiple sites from one dashboard",
      ],
    },
  ];

  const roadmap = [
    {
      quarter: "Q4 2026",
      items: [
        "Intelligent detection of SEO and traffic anomalies",
        "SMS alerts for Ultra plans",
        "Two-factor authentication (2FA)",
        "iOS and Android mobile app",
        "Advanced historical comparisons",
        "Social media integrations (Instagram, Facebook)",
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
            <motion.div variants={fadeInUp} className="mb-6">
              <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100">
                <Bell className="h-3 w-3 mr-1" />
                Product updates
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              What's new
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Explore the latest FlowPoint features and improvements. We continue to develop tools to support your business.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 text-center mb-12"
          >
            Latest FlowPoint updates
          </motion.h2>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="space-y-8"
          >
            {updates.map((update, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="p-6 border-l-4 border-l-blue-500">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                        <update.icon className="h-6 w-6 text-blue-600" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <Badge className={update.typeColor}>{update.type}</Badge>
                        <span className="text-sm text-slate-500 dark:text-slate-400">v{update.version}</span>
                        <span className="text-sm text-slate-400">{update.date}</span>
                      </div>
                       <h3 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100 mb-2">
                         {updateTitleLinks[update.title] ? (
                           <a
                             href={updateTitleLinks[update.title]}
                             className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                           >
                             {update.title}
                           </a>
                         ) : (
                           update.title
                         )}
                      </h3>
                      <p className="text-slate-600 dark:text-slate-300 mb-4">{update.description}</p>
                      <ul className="space-y-1">
                        {update.features.map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                             {updateFeatureLinks[feature] ? (
                               <a
                                 href={updateFeatureLinks[feature]}
                                 className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                               >
                                 {feature}
                               </a>
                             ) : (
                               feature
                             )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-12"
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Roadmap
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300">
              See what we're preparing for the coming months.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid grid-cols-1 max-w-3xl mx-auto"
          >
            {roadmap.map((quarter, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="p-6 sm:p-8 h-full">
                  <h3 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-6 text-center">
                    {quarter.quarter}
                  </h3>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {quarter.items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-3 text-slate-600 dark:text-slate-300">
                        <Sparkles className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            ))}
          </motion.div>
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
            className="text-center text-slate-500 dark:text-slate-400 mt-8 italic"
          >
            And this is only a preview of what's coming next.
          </motion.p>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white">
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
              Have an idea for a feature?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              We welcome your suggestions. Share your ideas and help us improve FlowPoint.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="/contact"
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-full font-semibold hover:bg-blue-50 transition-colors"
            >
              Suggest a feature
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer language="en" />
      <SupportChat />
    </div>
  );
}
