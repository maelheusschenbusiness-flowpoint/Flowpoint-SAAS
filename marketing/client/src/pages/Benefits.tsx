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

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";

export default function Benefits() {
  usePageTitle("Benefits | FlowPoint");

  const mainBenefits = [
    {
      icon: Layers,
      title: "Local visibility",
      description: "See where your business appears on Google Maps and what to check.",
      details: [
        "Track your presence in your area",
        "Identify listing information to review",
        "View your local metrics",
      ],
    },
    {
      icon: Sparkles,
      title: "Integrated AI",
      description: "Personalized AI recommendations.",
      details: [
        "Personalized action plan",
        "Automatic prioritization",
        "Recommendations based on your data",
      ],
    },
    {
      icon: Activity,
      title: "Real time",
      description: "Alerts and continuous monitoring.",
      details: [
        "Continuous monitoring",
        "Instant alerts",
        "Up-to-date dashboards",
      ],
    },
    {
      icon: Shield,
      title: "Security and privacy",
      description: "GDPR-aware practices and secure hosting.",
      details: [
        "GDPR compliance",
        "Secure hosting",
        "Data protection",
      ],
    },
  ];

  const additionalBenefits = [
    {
      icon: Target,
      title: "Precise targeting",
      description: "Reach customers searching for your services in your area.",
    },
    {
      icon: BarChart3,
      title: "Detailed analysis",
      description: "Understand what works and keep improving your strategy.",
    },
    {
      icon: Zap,
      title: "Tracking without ranking promises",
      description: "Track local metrics and identify areas to improve, without guaranteed rankings or commercial results.",
    },
    {
      icon: Shield,
      title: "GDPR compliance",
      description: "Your data is protected in line with European requirements.",
    },
    {
      icon: Globe,
      title: "Multilingual interface",
      description: "A language selector with 30 options for using the platform.",
    },
    {
      icon: Star,
      title: "Expert support",
      description: "A dedicated team to support your work.",
    },
  ];

  const productBenefits = [
    { icon: Bot, title: "Automation", description: "Reports, alerts, monitoring and analysis run automatically." },
    { icon: TrendingUp, title: "More visibility", description: "Find opportunities that can help attract more customers." },
    { icon: Users, title: "Team collaboration", description: "Work with your team in one shared workspace." },
    { icon: Layers, title: "Scalable", description: "A platform that supports your growth, from independent business to agency." },
    { icon: Clock, title: "Save time", description: "Automate repetitive tasks and focus on your business." },
    { icon: FileText, title: "Automated reports", description: "Generate professional reports in seconds." },
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
              Why choose FlowPoint?
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Bring your data together, automate analysis and make better decisions with one platform supported by AI.
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
            The everyday benefits of FlowPoint
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
              Metrics to guide your actions
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300">
              Why businesses choose FlowPoint
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
              And much more...
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
              Ready to discover FlowPoint?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8">
              Create a free account and discover the full potential of the platform.
            </motion.p>
            <motion.div variants={fadeInUp} className="flex flex-col items-center">
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
                  Start my 14-day trial
                  <ArrowRight className="ml-2 h-5 w-5" />
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
