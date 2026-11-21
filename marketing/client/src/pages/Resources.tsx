import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import type { ReactNode } from "react";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import {
  BookOpen,
  Search,
  Bot,
  Monitor,
  MapPin,
  Gauge,
  BarChart3,
  FileText,
  Sparkles,
  Lightbulb,
  CaseSensitive,
  CheckCircle,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  buildResourcesItemListJsonLd,
  RESOURCE_CHAPTER_TITLES,
} from "@shared/structured-data-content";
import {
  getPublishedResourceArticles,
  getResourceArticlePath,
  toEnglishResourcePath,
} from "@shared/resource-articles";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

function renderResourceLink(
  text: string,
  rule?: { phrase: string; href: string },
): ReactNode {
  if (!rule) {
    return text;
  }

  const start = text.indexOf(rule.phrase);
  if (start === -1) {
    return text;
  }

  const end = start + rule.phrase.length;
  return (
    <>
      {text.slice(0, start)}
      <a
        href={toEnglishResourcePath(rule.href)}
        className="text-blue-700 dark:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
      >
        {rule.phrase}
      </a>
      {text.slice(end)}
    </>
  );
}

export default function Resources() {
  usePageTitle("Resource Center | Flowpoint");
  useJsonLd(buildResourcesItemListJsonLd());
  const publishedArticles = getPublishedResourceArticles();
  const articlesByCluster = publishedArticles.reduce<Record<string, typeof publishedArticles>>(
    (groups, article) => {
      (groups[article.cluster] ??= []).push(article);
      return groups;
    },
    {},
  );

  const categories = [
    { icon: Search, title: "SEO & Visibility", href: "/seo-audit", description: "Improve your Google ranking and attract more qualified clients." },
    { icon: Bot, title: "Artificial Intelligence", description: "Discover how AI automates your analytics and generates recommendations." },
    { icon: Monitor, title: "Monitoring & Uptime", href: "/website-monitoring", description: "Monitor your site 24/7 and get alerted before your customers in case of incidents." },
    { icon: MapPin, title: "Google Business Profile", href: "/local-seo", description: "Optimize your Google listing to capture local searches." },
    { icon: Gauge, title: "Web Performance", description: "Master your Core Web Vitals and provide a smooth user experience." },
    { icon: BarChart3, title: "Analytics & Data", description: "Centralize your data and make decisions based on concrete metrics." },
    { icon: FileText, title: "Reporting & Automation", href: "/seo-reporting", description: "Generate professional reports automatically, without manual effort." },
    { icon: Sparkles, title: "FlowPoint Updates", description: "Stay informed about the latest features and platform developments." },
    { icon: Lightbulb, title: "Practical Guides", description: "Step-by-step tutorials to get the most out of every tool." },
    { icon: CaseSensitive, title: "Use Cases", description: "Learn how FlowPoint adapts to different types of businesses." },
  ];

  const chapters = [
    {
      icon: Search,
      title: RESOURCE_CHAPTER_TITLES[0],
      content: `Natural search engine optimization (SEO) remains the most cost-effective acquisition channel for businesses. Unlike advertising campaigns, a strong Google ranking generates qualified traffic sustainably without marginal costs per visit.

The pillars of an effective SEO strategy:

1. Optimize your technical site (speed, mobile, structure)
2. Create content that answers your customers' search intent
3. Master your site's technical structure (tags, internal linking, schemas)
4. Target geographic searches with structured local SEO
5. Regularly monitor your rankings and those of your competitors

SEO is not a sprint. The first results appear after a few weeks, but a lasting presence requires a long-term strategy.

FlowPoint centralizes your rankings, technical performance, Core Web Vitals, Google Business Profile data, and key metrics into a single dashboard.`,
    },
    {
      icon: Bot,
      title: RESOURCE_CHAPTER_TITLES[1],
      content: `Artificial intelligence is profoundly transforming how companies analyze their data and make decisions. It is no longer reserved for large corporations: accessible tools now allow freelancers and SMEs to automate complex tasks.

Here is how AI can amplify your results:

- Automatic performance analysis: AI detects trends, anomalies, and opportunities in your data
- Personalized recommendations: instead of generic lists, you receive actions tailored to your sector and geographic area
- Intelligent prioritization: AI estimates the impact and effort of each action to help you choose where to invest your time
- Report generation: executive reports written automatically, ready to be shared with your team or clients
- Performance forecasting: anticipate changes in your traffic and visibility

FlowPoint's AI analyzes your own data to offer concrete recommendations adapted to your business.

The goal is not to replace your expertise, but to give you more time for strategic decisions by automating analysis.`,
    },
    {
      icon: Monitor,
      title: RESOURCE_CHAPTER_TITLES[2],
      content: `Your website is your digital storefront. Downtime, an expired SSL error, or a slow page can cost you customers and harm your credibility. Monitoring allows you to be proactive rather than reactive.

What to monitor continuously:

1. Your site's availability (uptime) with regular checks
2. Validity of your SSL certificates
3. Response times of your key pages
4. API endpoints and webhooks if you use integrations
5. Unexpected changes on your site (modified content, missing alt tags)

The consequences of an inaccessible site:

- Immediate loss of revenue for e-commerce sites
- SEO degradation (Google penalizes unstable sites)
- Loss of customer trust when they encounter an error
- Difficulty identifying the cause without surveillance history

An effective monitoring tool alerts you via email, Slack, or other configured channels as soon as an incident is detected, giving you time to react before your customers notice.`,
    },
    {
      icon: MapPin,
      title: RESOURCE_CHAPTER_TITLES[3],
      content: `Google Business Profile (GBP) is the cornerstone of your local visibility. It is what appears on Google Maps, in the Local Pack, and in localized search results. An optimized listing can generate dozens of qualified contacts every month.

Key elements of a high-performing listing:

1. Complete and up-to-date information (name, address, phone, hours, site)
2. Precise categories matching your business exactly
3. Detailed description with your strategic keywords
4. Regular, high-quality photos (interior, exterior, products, team)
5. Frequent posts to show Google you are active
6. Responses to all reviews, both positive and negative

Customer reviews are a major ranking factor. A business with 50 reviews at 4.7 stars will have a better chance of appearing in the Local Pack than a business with 5 reviews at 5 stars.

Quality photos improve user engagement and increase interactions with your Google Business Profile listing. Investing in your visual content on GBP is one of the highest-impact actions.`,
    },
    {
      icon: Gauge,
      title: RESOURCE_CHAPTER_TITLES[4],
      content: `Your site's loading speed directly influences your conversion rate, your Google ranking, and your visitors' satisfaction. Google has used Core Web Vitals (LCP, CLS, INP) as ranking factors since 2021.

The three essential metrics:

- LCP (Largest Contentful Paint): display time of the largest visible element. Goal: less than 2.5 seconds.
- CLS (Cumulative Layout Shift): visual stability of the page. Goal: less than 0.1.
- INP (Interaction to Next Paint): responsiveness to user interactions. Goal: less than 200 ms.

How to improve your performance:

1. Optimize your images (WebP format, compression, lazy loading)
2. Use a CDN to distribute your static content
3. Minify your CSS and JavaScript files
4. Reduce the number of server requests
5. Enable browser caching
6. Choose a high-performance host close to your customers

Improving loading speed can have a direct impact on conversion rates, user experience, and SEO.`,
    },
    {
      icon: BarChart3,
      title: RESOURCE_CHAPTER_TITLES[5],
      content: `Data is the fuel for any effective digital strategy. But having data is not enough: it must be centralized, interpreted, and turned into concrete actions.

The essential metrics to track:

1. Organic traffic: evolution of the number of visitors from Google
2. Conversion rate: percentage of visitors who perform an action (call, form, purchase)
3. Keyword ranking: where you appear for your strategic queries
4. Traffic sources: which channels generate the most qualified visitors
5. User behavior: pages visited, visitor engagement, time spent on the site
6. Customer Acquisition Cost (CAC): how much each new customer costs you

Errors to avoid:

- Focusing on traffic quantity rather than quality
- Ignoring local data if you have a physical location
- Failing to segment your analytics (device, geographic area, source)
- Monitoring too many metrics instead of focusing on 3-5 key KPIs

A well-designed dashboard shows you at a glance what is working, what isn't, and where to invest your next hour of work.`,
    },
    {
      icon: FileText,
      title: RESOURCE_CHAPTER_TITLES[6],
      content: `Manual reporting is one of the most time-consuming tasks for marketing teams and agencies. Automating this part frees up precious hours for higher-value activities.

What report automation brings you:

- Reports generated automatically at the frequency of your choice (weekly, monthly)
- Data that is always up-to-date, with no risk of copy-paste errors
- Reports shareable with your team, clients, or investors
- Automatic alerts when a metric exceeds a critical threshold
- Accessible history to track your evolution over time

For agencies, white-label reports allow you to customize branding (client logo, colors) and deliver professional reports without extra effort.

Automation does not replace human analysis: it gives you the clean, structured database on which you can build your strategic recommendations.`,
    },
    {
      icon: Sparkles,
      title: RESOURCE_CHAPTER_TITLES[7],
      content: `FlowPoint is constantly evolving to integrate digital best practices and new artificial intelligence capabilities. FlowPoint's development is guided by user feedback and market trends.

Priority innovation areas:

- Artificial Intelligence: increasingly personalized action plans, performance predictions, content generation
- Integrations: richer connections with Google Analytics, Search Console, social media, and third-party tools
- Monitoring: finer surveillance, multi-channel alerts (email, Slack, other configured channels), anomaly detection
- Collaboration: shared workspaces, permission management, commenting on reports
- Mobility: mobile application to track your metrics wherever you are

Every new feature is tested with a group of users before its general rollout. You can follow updates on our dedicated page and suggest ideas via our support team.`,
    },
    {
      icon: Lightbulb,
      title: RESOURCE_CHAPTER_TITLES[8],
      content: `FlowPoint is designed to be operational in minutes, even without technical expertise. Here are the key steps to get the most out of the platform from day one.

Recommended first steps:

1. Connect your Google Business Profile to import your local data
2. Add your website to launch the automatic SEO audit
3. Configure uptime monitoring to track your availability
4. Define your strategic keywords to track your ranking
5. Connect the services available in your FlowPoint workspace to enrich your traffic data
6. Enable alerts to be notified of important changes

Tips for going further:

- Explore the AI dashboard to discover your priority actions
- Customize your reports to share with your team
- Use AI missions to plan your work for the coming weeks
- Consult competitor analysis regularly to stay competitive
- Enable white-labeling if you manage clients as an agency

Our support is available via email to help you get started. Most users are autonomous in less than an hour.`,
    },
    {
      icon: CaseSensitive,
      title: RESOURCE_CHAPTER_TITLES[9],
      content: `FlowPoint adapts to different types of businesses and organizations. Here is how the platform can help you according to your profile, without invented figures.

Local Business

Track your Google Business Profile visibility, receive AI recommendations, and monitor your online reputation from a single platform. Uptime monitoring alerts you if your site is inaccessible during opening hours.

Marketing Agency

Manage multiple clients from a single dashboard, generate white-label reports, and track the performance of each site without juggling between tools. Competitive intelligence helps you identify opportunities for each client.

E-commerce

Monitor your shop's availability 24/7, track your Core Web Vitals to ensure a smooth shopping experience, and receive alerts before your customers notice a technical problem.

SME

Centralize your key metrics in a simple dashboard: Google rankings, technical performance, Google Business Profile data. AI missions guide you step-by-step through the actions to prioritize.

Multi-site

Manage the visibility of multiple locations or websites from a single interface. Compare performance between sites and apply best practices identified on one to all of them.

Franchise

Ensure consistency in your outlets' online presence. Track customer reviews, local rankings, and technical performance for each location in a single workspace.

Every profile has specific needs, but the fundamentals remain the same: centralize your data, identify high-impact actions, and act consistently.`,
    },
  ];

  const quickTips = [
    "Audit your site for free with FlowPoint",
    "Optimize your Google Business Profile",
    "Define 5 strategic keywords to track",
    "Enable your website monitoring",
    "Configure your custom alerts",
    "Check your weekly AI recommendations",
  ];

  const quickTipLinks: Record<string, string> = {
    "Audit your site for free with FlowPoint": "/seo-audit",
    "Enable your website monitoring": "/website-monitoring",
  };

  const resourceTextLinks: Record<number, { phrase: string; href: string }> = {
    8: {
      phrase: "Consult competitor analysis regularly",
      href: "/competitor-analysis",
    },
  };

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
            <motion.div variants={fadeInUp} className="mb-6">
              <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100">
                <BookOpen className="h-3 w-3 mr-1" />
                Resource Center
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Everything to grow your business
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Guides, best practices, and use cases to master digital growth, from SEO to artificial intelligence.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-12 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <Card className="p-6 border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900">
              <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-4">
                Browse by category
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {categories.map((cat, index) => (
                  <div key={index} className="flex items-start gap-3 text-slate-600 dark:text-slate-300">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <cat.icon className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                        {cat.href ? (
                          <a
                            href={toEnglishResourcePath(cat.href)}
                            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                          >
                            {cat.title}
                          </a>
                        ) : (
                          cat.title
                        )}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{cat.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {publishedArticles.length > 0 && (
        <section
          className="py-16 bg-slate-50 dark:bg-slate-800/20"
          aria-labelledby="published-articles-heading"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-10">
              <h2
                id="published-articles-heading"
                className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100"
              >
                Articles and guides
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300">
                Editorial resources organized by theme.
              </p>
            </div>

            <div className="space-y-10">
              {Object.entries(articlesByCluster).map(([cluster, articles]) => (
                <section key={cluster} aria-labelledby={`article-cluster-${cluster}`}>
                  <h3
                    id={`article-cluster-${cluster}`}
                    className="mb-4 text-xl font-display font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {cluster}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {articles.map((article) => (
                      <a
                        key={article.slug}
                        href={getResourceArticlePath(article.slug)}
                        className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      >
                        <Card className="h-full p-6 transition-colors group-hover:border-blue-400 dark:group-hover:border-blue-500">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <Badge>{article.cluster}</Badge>
                            {article.testOnly && (
                              <Badge variant="outline">Temporary local certification</Badge>
                            )}
                          </div>
                          <h4 className="text-lg font-semibold text-slate-900 group-hover:text-blue-700 dark:text-slate-100 dark:group-hover:text-blue-300">
                            {article.h1}
                          </h4>
                          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {article.metaDescription}
                          </p>
                        </Card>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-12 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <Card className="p-6 border-green-200 dark:border-green-700 bg-white dark:bg-slate-900">
              <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-4">
                Quick actions to get started
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {quickTips.map((tip, index) => (
                  <div key={index} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm">
                      {quickTipLinks[tip] ? (
                        <a
                          href={quickTipLinks[tip]}
                          className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                        >
                          {tip}
                        </a>
                      ) : (
                        tip
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
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
            className="space-y-16"
          >
            {chapters.map((chapter, index) => (
              <motion.div key={index} variants={fadeInUp} id={`chapter-${index + 1}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                    <chapter.icon className="h-5 w-5 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                    {index + 1}. {chapter.title}
                  </h2>
                </div>
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  {(() => {
                    type Segment =
                      | { type: 'p'; text: string }
                      | { type: 'ol'; items: string[] }
                      | { type: 'ul'; items: string[] }
                      | { type: 'checklist'; items: string[] };

                    const segments: Segment[] = [];
                    const allLines = chapter.content.split('\n');
                    let i = 0;
                    while (i < allLines.length) {
                      const raw = allLines[i];
                      const trimmed = raw.trim();
                      if (trimmed === '') { i++; continue; }
                      if (/^\d+\.\s/.test(trimmed)) {
                        const items: string[] = [];
                        while (i < allLines.length && /^\d+\.\s/.test(allLines[i].trim())) {
                          items.push(allLines[i].trim().replace(/^\d+\.\s*/, ''));
                          i++;
                        }
                        segments.push({ type: 'ol', items });
                      } else if (/^-\s/.test(trimmed)) {
                        const items: string[] = [];
                        while (i < allLines.length && /^-\s/.test(allLines[i].trim())) {
                          items.push(allLines[i].trim().replace(/^-\s*/, ''));
                          i++;
                        }
                        segments.push({ type: 'ul', items });
                      } else if (trimmed.startsWith('☐')) {
                        const items: string[] = [];
                        while (i < allLines.length && allLines[i].trim().startsWith('☐')) {
                          items.push(allLines[i].trim().replace(/^☐\s*/, ''));
                          i++;
                        }
                        segments.push({ type: 'checklist', items });
                      } else {
                        const textLines: string[] = [];
                        while (
                          i < allLines.length &&
                          allLines[i].trim() !== '' &&
                          !/^\d+\.\s/.test(allLines[i].trim()) &&
                          !/^-\s/.test(allLines[i].trim()) &&
                          !allLines[i].trim().startsWith('☐')
                        ) {
                          textLines.push(allLines[i]);
                          i++;
                        }
                        segments.push({ type: 'p', text: textLines.join('\n') });
                      }
                    }

                    return segments.map((seg, idx) => {
                      if (seg.type === 'ol') {
                        return (
                          <ol key={idx} className="list-decimal list-outside ml-6 mb-4 space-y-1">
                            {seg.items.map((item, j) => (
                              <li key={j} className="dark:text-slate-100 leading-relaxed">{item}</li>
                            ))}
                          </ol>
                        );
                      }
                      if (seg.type === 'ul') {
                        return (
                          <ul key={idx} className="list-disc list-outside ml-6 mb-4 space-y-1">
                            {seg.items.map((item, j) => (
                              <li key={j} className="dark:text-slate-100 leading-relaxed">{item}</li>
                            ))}
                          </ul>
                        );
                      }
                      if (seg.type === 'checklist') {
                        return (
                          <ul key={idx} className="list-none mb-4 space-y-1">
                            {seg.items.map((item, j) => (
                              <li key={j} className="dark:text-slate-100 leading-relaxed flex items-start gap-2">
                                <span aria-hidden="true">☐</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        );
                      }
                      return (
                        <p key={idx} className="dark:text-slate-100 leading-relaxed mb-4 whitespace-pre-line">
                          {renderResourceLink(seg.text, resourceTextLinks[index])}
                        </p>
                      );
                    });
                  })()}
                </div>
              </motion.div>
            ))}
          </motion.div>
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
              Ready to take action?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              Create your account for free and apply these best practices today with FlowPoint.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="https://app.flowpoint.pro/signin.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-full font-semibold hover:bg-blue-50 transition-colors"
            >
              Create my free account
              <ArrowRight className="h-4 w-4" />
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
