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
  usePageTitle("About | FlowPoint");

  const whyUs = [
    {
      icon: RefreshCw,
      title: "Continuously developed",
      description: "New features, improvements and optimizations are released regularly to keep the platform evolving.",
    },
    {
      icon: Database,
      title: "Real data",
      description: "FlowPoint uses your data from Google Analytics 4, Google Search Console, Google Business Profile, DataForSEO and other connected sources to provide useful analysis.",
    },
    {
      icon: Shield,
      title: "Security",
      description: "Your data is protected through encryption, organization isolation (RLS), secure authentication and modern cloud infrastructure.",
    },
    {
      icon: Building,
      title: "Built for businesses",
      description: "A connected workspace for businesses and the teams advising them, covering SEO, website health, analytics, local search and reporting.",
    },
  ];

  const values = [
    {
      icon: Target,
      title: "Transparent tracking",
      description: "Track visibility metrics and identify areas to improve. Results depend on your market, competition and the actions you take.",
    },
    {
      icon: Users,
      title: "Accessibility",
      description: "SEO should not be reserved for large companies. We make professional tools accessible to everyone.",
    },
    {
      icon: Lightbulb,
      title: "Continuous innovation",
      description: "Our team keeps track of Google's changes to help you choose effective strategies.",
    },
    {
      icon: Heart,
      title: "Close collaboration",
      description: "We understand business challenges because we work with businesses every day.",
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation language="en" />

      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              About FlowPoint
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              FlowPoint is a digital-growth SaaS workspace connecting SEO analysis, local search, competitor insights, website monitoring, analytics and reporting for businesses and their teams.
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
                Our mission
              </h2>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                We build FlowPoint to help businesses and their advisors understand online performance, monitor site health, assess competitors, and turn search and analytics signals into prioritized next steps.
              </p>
            </motion.div>
            <motion.div variants={fadeInUp} className="bg-blue-600 dark:bg-blue-900/40 rounded-2xl p-8">
              <h2 className="text-2xl font-display font-bold text-white mb-4">
                Our vision
              </h2>
              <p className="text-blue-100 leading-relaxed">
                We believe digital management tools should be powerful, intuitive and accessible. FlowPoint brings your metrics, analysis and automations together in one interface to save time and support your growth.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Why FlowPoint */}
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
              Why choose FlowPoint?
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

      {/* Values */}
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
              Our values
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              The principles that guide our work supporting businesses every day.
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
              <span className="text-slate-600 dark:text-slate-300">Online-only business</span>
            </motion.div>
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4"
            >
              Ready to grow your online visibility?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-slate-600 dark:text-slate-300 mb-8">
              Join businesses that trust FlowPoint.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="https://app.flowpoint.pro/signin.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-full font-semibold hover:bg-blue-700 transition-colors"
            >
              Create my free account
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer language="en" />
      <SupportChat />
    </div>
  );
}
