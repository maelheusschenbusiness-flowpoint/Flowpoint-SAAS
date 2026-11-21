import { useEffect } from "react";
import { HOME_FAQS as landingV2Faqs } from "@shared/home-faqs";
import { motion } from "framer-motion";
import { Footer } from "./Footer";
import { SecurityControls } from "./ConnectedView";
import { SignalExplorer } from "./SignalExplorer";
import { SupportChat } from "@/components/SupportChat";
import { trackEvent, trackSignupCta } from "@/lib/analytics";
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
  UsersRound,
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
  Sparkles,
  Activity,
  UserPlus,
  Link2,
  Rocket,
  BrainCircuit,
  Check,
  KeyRound,
  ClipboardList,
} from "lucide-react";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";

function AiSupportSection() {
  return (
    <section className="fp2-premium fp2-premium-ai" aria-labelledby="fp2-premium-ai-title">
      <div className="fp2-premium-wrap fp2-premium-ai-layout">
        <motion.div className="fp2-premium-copy" initial={{ opacity: 1, x: -18 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.65, delay: 0.08 }}>
          <span className="fp2-premium-eyebrow">AI to support your decisions</span>
          <h2 id="fp2-premium-ai-title">More useful insights.<br /><em>You stay in control.</em></h2>
          <p>FlowPoint uses a tool-enabled assistant. By default, GPT-5 mini and GPT-5 support chat and missions; Claude Haiku 4.5, Sonnet 4.6 and Opus 4.8 support reports and SEO, CRO and market analysis; Gemini 3 Flash and 3.1 Pro support image analysis; GPT-5 supports forecasts; and GPT Image 1 supports image generation. Analysis, strategy and action describe workflow stages—not three autonomous agents.</p>
          <p className="fp2-premium-note">Provider, model and intensity vary by workspace and task.</p>
        </motion.div>
        <motion.div className="fp2-premium-panel" initial={{ opacity: 1, x: 22 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.12 }}>
          <div className="fp2-premium-panel-title"><span><BrainCircuit size={18} /></span><div><small>SUPPORTED PROVIDERS</small><b>Configured per workspace</b></div></div>
          <div className="fp2-premium-provider"><b>OpenAI</b><small>gpt-5-mini · gpt-5 · gpt-image-1</small><Check /></div>
          <div className="fp2-premium-provider"><b>Anthropic · Claude</b><small>Haiku 4.5 · Sonnet 4.6 · Opus 4.8</small><Check /></div>
          <div className="fp2-premium-provider"><b>Google Gemini</b><small>Gemini 3 Flash · Gemini 3.1 Pro</small><Check /></div>
          <div className="fp2-premium-config"><span>WORKSPACE PREFERENCES</span><b>Provider · model · intensity</b></div>
          <p>Availability depends on configuration. Some features send the selected provider the prompt and context needed for the request.</p>
        </motion.div>
      </div>
    </section>
  );
}

function TeamWorkspaceSection() {
  return (
    <section className="fp2-premium fp2-premium-team" aria-labelledby="fp2-premium-team-title">
      <div className="fp2-premium-wrap fp2-premium-team-layout">
        <motion.div className="fp2-premium-roles" initial={{ opacity: 1, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.68, delay: 0.08 }}>
          <div className="fp2-premium-roles-head"><span>WORKSPACE ROLES</span><small>Permissions managed by admins</small></div>
          <div className="fp2-premium-role"><KeyRound /><b>Owner</b><span>Full administration</span></div>
          <div className="fp2-premium-role"><UsersRound /><b>Admin</b><span>Access and settings</span></div>
          <div className="fp2-premium-role"><UsersRound /><b>Member</b><span>Workspace access</span></div>
          <div className="fp2-premium-role"><UsersRound /><b>Viewer</b><span>View only</span></div>
          <div className="fp2-premium-credits"><span><ClipboardList size={15} /> Monthly AI credits</span><b>Standard · 100,000</b><b>Pro · 500,000</b><b>Ultra · 10,000,000</b></div>
        </motion.div>
        <motion.div className="fp2-premium-copy" initial={{ opacity: 1, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.68, delay: 0.14 }}>
          <span className="fp2-premium-eyebrow">One workspace, clear roles</span>
          <h2 id="fp2-premium-team-title">Everyone knows where to act.<br /><em>Your team stays aligned.</em></h2>
          <p>Built-in roles organize access. Admins manage permissions, custom roles and workspace settings.</p>
          <div className="fp2-premium-team-foot"><UsersRound size={17} /><span>Review activity, access and audit logs, AI usage and credits.</span></div>
        </motion.div>
      </div>
    </section>
  );
}

function SecurityPrivacySection() {
  return (
    <section className="fp2-premium fp2-premium-security" aria-labelledby="fp2-premium-security-title">
      <SecurityControls />
    </section>
  );
}

function BenefitsSection() {
  return (
    <section id="benefits" className="fp2-current-benefits">
      <SignalExplorer />
    </section>
  );
}

const homeFeatureLandingLinks: Record<string, string> = {
  "SEO site audit": "/seo-audit",
  "Competitor insights": "/competitor-analysis",
  "Google Business Profile": "/local-seo",
  "Local search & keywords": "/local-seo",
  "Website performance": "/website-monitoring",
  "AI-assisted recommendations": "/seo-reporting",
};

export default function Home() {
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
      title: "Low online visibility",
      description: "Potential customers may not find you on Google, leaving opportunities on the table.",
    },
    {
      icon: Users,
      title: "Crowded search results",
      description: "Competitors can appear ahead of you in search results and Google Maps.",
    },
    {
      icon: Zap,
      title: "Technical complexity",
      description: "Digital marketing can be complex. FlowPoint helps you review it step by step.",
    },
  ];

  const testimonials = [
    {
      quote: "Thanks to FlowPoint, our bakery went from page 3 to the top spot on Google Maps. Customers are flooding in!",
      author: "Marie Dubois",
      role: "Owner, Boulangerie du Coin",
      rating: 4,
    },
    {
      quote: "In 2 months, we doubled our quote requests. The tool is simple and the recommendations are clear.",
      author: "Pierre Martin",
      role: "Plumbing Craftsman",
      rating: 5,
    },
    {
      quote: "FlowPoint allowed us to understand why our competitors were ahead of us. Now, we are the ones dominating.",
      author: "Sophie Laurent",
      role: "Director, Real Estate Agency",
      rating: 4,
    },
    {
      quote: "An incredible time-saver! I spend less time on marketing and more with my clients. Results visible in a few weeks.",
      author: "Jean-Luc Moreau",
      role: "Manager, Restaurant Le Petit Bistro",
      rating: 5,
    },
    {
      quote: "The support is responsive and the advice is personalized. My dental practice saw a 40% increase in new patients.",
      author: "Dr. Claire Bernard",
      role: "Dentist",
      rating: 5,
    },
    {
      quote: "FlowPoint transformed our digital approach. Our IT services company now receives 3 times more requests from local businesses.",
      author: "Rachid Bachour",
      role: "Manager, IT Company",
      rating: 5,
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
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
              Insights for local businesses
              </span>
            </motion.div>
            
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-slate-900 dark:text-slate-100 leading-tight mb-6"
            >
              Understand your online presence and decide what to improve next
            </motion.h1>
            
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 mb-10 max-w-2xl mx-auto"
            >
              Bring website health, search visibility, analytics and AI-supported workflows into one workspace. Review the signals that matter to your business.
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
                  Start my 14-day trial
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
                How it works
              </Button>
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>For local businesses and their advisors</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>Stripe payments</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>Manage your plan from your account</span>
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
              Make your digital presence easier to understand
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Bring key digital signals together so your team can see what needs attention and choose the next step.
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

      <BenefitsSection />

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
                How it works
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Three steps to get started
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
                  <CardTitle className="text-xl"><h3>Create your account</h3></CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Sign up and set up your workspace for your business.
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
                  <CardTitle className="text-xl"><h3>Connect your data</h3></CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Add your website and connect the services you want to use.
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
                  <CardTitle className="text-xl"><h3>Put insights to work</h3></CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Review the signals, choose your priorities and decide what happens next.
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
                Start my 14-day trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </motion.div>
        </div>
      </section>

      <SecurityPrivacySection />
      <TeamWorkspaceSection />

      <AiSupportSection />

      {/* Core Local SEO Features Section */}
      <section className="py-20 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center mb-16">
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Tools to understand and grow your digital presence
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Bring search, website health, analytics and recommendations together in one workspace.
            </motion.p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Search, title: "SEO site audit", desc: "Review key strengths and issues across your online presence." },
              { icon: Users, title: "Competitor insights", desc: "Compare visibility and performance to find areas worth exploring." },
              { icon: MapPin, title: "Google Business Profile", desc: "Review your local listing and identify details to check." },
              { icon: Target, title: "Local search & keywords", desc: "Explore relevant search terms and how they change over time." },
              { icon: BarChart3, title: "Website performance", desc: "Track website health with clear dashboards and useful indicators." },
              { icon: TrendingUp, title: "AI-assisted recommendations", desc: "Surface suggestions to help prioritize work across your digital presence." },
            ].map((f, i) => (
              <motion.div key={i} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all bg-white dark:bg-slate-800 group">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 group-hover:bg-blue-600 transition-colors">
                      <f.icon className="h-6 w-6 text-blue-600 group-hover:text-white transition-colors" />
                    </div>
                    <CardTitle className="text-lg">
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

      {/* Closing activity-control band */}
      <section className="fp2-current-control-band py-16 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center max-w-3xl mx-auto"
          >
            <motion.div variants={fadeInUp} className="mb-5">
              <ShieldCheck className="h-12 w-12 mx-auto text-blue-200" />
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold mb-4">
              Your digital activity, in one workspace
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-blue-100 mb-7">
              Search · Website health · Analytics · AI-supported recommendations
            </motion.p>
            <motion.div variants={fadeInUp} className="flex flex-col items-center">
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
                  Start my 14-day trial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="fp2-current-faq py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Frequently asked questions
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <Accordion
              type="single"
              collapsible
              className="grid grid-cols-1 gap-4 md:grid-flow-col md:grid-cols-2 md:grid-rows-4"
            >
              {landingV2Faqs.map((faq, index) => (
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

      <Footer />

      <SupportChat />
    </div>
  );
}
