export type SeoClusterPath =
  | "/local-seo"
  | "/website-monitoring"
  | "/seo-reporting"
  | "/competitor-analysis";

export type SeoClusterIcon =
  | "activity"
  | "barChart"
  | "bell"
  | "building"
  | "fileText"
  | "gauge"
  | "globe"
  | "lineChart"
  | "map"
  | "search"
  | "share"
  | "shield"
  | "sparkles"
  | "star"
  | "target"
  | "trophy"
  | "users";

export interface SeoClusterFaq {
  question: string;
  answer: string;
}

export interface SeoClusterCard {
  icon: SeoClusterIcon;
  title: string;
  description: string;
}

export interface SeoClusterContent {
  path: SeoClusterPath;
  title: string;
  description: string;
  preview?: {
    route: "local-seo" | "monitors" | "reports" | "competitor";
    heading: string;
    description: string;
    alt: string;
  };
  badge: string;
  heroH1: string;
  heroDescription: string;
  introHeading: string;
  introDescription: string;
  checks: readonly SeoClusterCard[];
  overviewHeading: string;
  overviewDescription: string;
  overviewItems: readonly string[];
  actionHeading: string;
  actionDescription: string;
  actionSteps: readonly SeoClusterCard[];
  educationHeading: string;
  educationDescription: string;
  audienceHeading: string;
  audienceDescription: string;
  audiences: readonly SeoClusterCard[];
  faqs: readonly SeoClusterFaq[];
  finalCtaHeading: string;
  finalCtaDescription: string;
}

export const SEO_CLUSTER_CONTENT: Record<SeoClusterPath, SeoClusterContent> = {
  "/local-seo": {
    path: "/local-seo",
    title: "Local SEO Software for Google Maps Rankings | FlowPoint",
    description:
      "Track local SEO with FlowPoint across Google Maps positions, Google Business Profile data, local keywords and competitors. Prioritize visibility by location.",
    preview: {
      route: "local-seo",
      heading: "Explore local visibility in FlowPoint",
      description:
        "Preview the workspace for reviewing local presence, Google Business Profile details, and related opportunities.",
      alt: "FlowPoint local SEO dashboard preview",
    },
    badge: "Local SEO tool",
    heroH1: "Boost your rankings with a local SEO tool",
    heroDescription:
      "FlowPoint gathers the information useful for your local visibility to help you better track your presence on Google, identify priorities, and move forward with concrete recommendations.",
    introHeading: "Your local visibility relies on several signals",
    introDescription:
      "A Google Business Profile, positions on Maps, reviews, and consistent keywords all contribute to your local presence. FlowPoint helps you read these elements from a single platform.",
    checks: [
      {
        icon: "map",
        title: "Google Business Profile",
        description:
          "Track key elements of your Google profile and optimizations that can strengthen your local presence.",
      },
      {
        icon: "globe",
        title: "Google Maps and local positions",
        description:
          "Observe the evolution of your local visibility and identify areas where your presence needs work.",
      },
      {
        icon: "star",
        title: "Reviews and local presence",
        description:
          "Keep an overview of your reviews and the signals that build trust around your establishment.",
      },
      {
        icon: "target",
        title: "Keywords and opportunities",
        description:
          "Identify local keywords to track and opportunities to prioritize based on your business.",
      },
    ],
    overviewHeading: "What you can track with FlowPoint",
    overviewDescription:
      "The FlowPoint local SEO tool connects local presence data, keywords, and recommendations to make your tracking clearer.",
    overviewItems: [
      "Tracking of Google Maps positions and geographic presence",
      "Optimization of Google Business Profile and its key information",
      "Local keywords, competitor analysis, and personalized recommendations",
    ],
    actionHeading: "Move from scattered local presence to a clear plan",
    actionDescription:
      "The value of a local SEO tool is to transform multiple signals into simple decisions to make.",
    actionSteps: [
      {
        icon: "search",
        title: "Take stock",
        description:
          "Gather the information that describes your local visibility and the points to monitor.",
      },
      {
        icon: "barChart",
        title: "Identify priorities",
        description:
          "Compare your indicators to distinguish the most useful optimizations for your establishment.",
      },
      {
        icon: "sparkles",
        title: "Improve gradually",
        description:
          "Use FlowPoint recommendations to organize your next actions without losing sight of your results.",
      },
    ],
    educationHeading: "Why use a local SEO tool?",
    educationDescription:
      "Local SEO evolves with your business, your competitors, and your customers' searches. A dedicated tool gives you a regular method to track your Google Business Profile, your positions, and your opportunities. FlowPoint centralizes these elements along with keyword tracking, competition, and AI recommendations to help you maintain a consistent view of your local presence. To compare gaps in your area, also consult our [SEO competitor analysis](/competitor-analysis). To deepen the foundations, read our [local SEO guide](/ressources/guide-referencement-local), followed by the [Google Business Profile optimization](/ressources/optimiser-google-business-profile) method and our [local SEO audit](/ressources/audit-seo-local).",
    audienceHeading: "Who is it for?",
    audienceDescription:
      "FlowPoint supports teams that want to grow their local visibility with concrete and understandable tracking.",
    audiences: [
      {
        icon: "building",
        title: "Local businesses",
        description:
          "Track your establishment's presence and focus your efforts on optimizations that matter for your area.",
      },
      {
        icon: "globe",
        title: "Networks and multi-site",
        description:
          "Maintain a structured reading of multiple establishments and their local performance.",
      },
      {
        icon: "users",
        title: "Digital agencies",
        description:
          "Support your client recommendations with consolidated local analysis and easy-to-share indicators.",
      },
    ],
    faqs: [
      {
        question: "What is a local SEO tool?",
        answer:
          "A local SEO tool helps track signals that influence a business's visibility in a given area, such as its Google Business Profile, local positions, keywords, and competitors.",
      },
      {
        question: "What can be tracked with FlowPoint for local SEO?",
        answer:
          "FlowPoint includes tracking for Google Maps, geographic presence, Google Business Profile information, reviews, keywords, and competitor analysis.",
      },
      {
        question: "Is FlowPoint suitable for a business with a single location?",
        answer:
          "Yes. A local business can use FlowPoint to understand its visibility, identify its priorities, and track the evolution of its online presence from a single space.",
      },
      {
        question: "What is the difference between local SEO and classic SEO?",
        answer:
          "Local SEO focuses specifically on a business's visibility in a geographic area, particularly on Google Maps and Google Business Profile. It complements the work done on the site and keywords.",
      },
      {
        question: "How do I start improving local SEO?",
        answer:
          "Start by adding your site and business information into FlowPoint, check your local indicators, and then use the recommendations to organize your first actions.",
      },
    ],
    finalCtaHeading: "Ready to improve your local visibility?",
    finalCtaDescription:
      "Start your FlowPoint trial and gather your local SEO tracking in a clear space. You will then be able to structure your results in an [SEO report](/seo-reporting).",
  },
  "/website-monitoring": {
    path: "/website-monitoring",
    title: "Website Monitoring Software for Uptime and SEO | FlowPoint",
    description:
      "Monitor website uptime, SSL, latency, endpoints and Core Web Vitals with FlowPoint. Detect important changes and connect technical signals to SEO priorities.",
    preview: {
      route: "monitors",
      heading: "Review website monitoring in FlowPoint",
      description:
        "Preview the monitoring workspace for reviewing site availability and technical signals.",
      alt: "FlowPoint website monitoring dashboard preview",
    },
    badge: "SEO Monitoring",
    heroH1: "Monitor website uptime and SEO health",
    heroDescription:
      "FlowPoint helps you track your site's availability, technical signals, and performance to spot issues that could disrupt your business more quickly.",
    introHeading: "Website monitoring starts with availability",
    introDescription:
      "Downtime, an expiring certificate, or performance degradation can affect the browsing experience. SEO monitoring gathers these signals to make your tracking easier.",
    checks: [
      {
        icon: "activity",
        title: "Availability and uptime",
        description:
          "Track your site's availability and keep a history of important changes.",
      },
      {
        icon: "shield",
        title: "SSL and technical points",
        description:
          "Monitor your SSL certificates, latency, and important endpoints of your online presence.",
      },
      {
        icon: "gauge",
        title: "Core Web Vitals",
        description:
          "Consult performance indicators like LCP, CLS, and INP to identify areas for improvement.",
      },
      {
        icon: "bell",
        title: "Alerts and incidents",
        description:
          "Receive alerts when a change or an incident deserves your attention.",
      },
    ],
    overviewHeading: "What FlowPoint monitoring helps you track",
    overviewDescription:
      "Technical tracking integrates with other FlowPoint data to connect site health to your SEO performance and priority actions. To establish a complete assessment, supplement this tracking with an [SEO audit](/seo-audit).",
    overviewItems: [
      "Availability, regular checks, and SSL certificate tracking",
      "LCP, CLS, INP, and scheduled Core Web Vitals audits",
      "Change alerts and notifications to react more quickly",
    ],
    actionHeading: "Reduce the time between an incident and your reaction",
    actionDescription:
      "Useful SEO monitoring isn't just about noting a problem: it helps you understand its importance and decide what to do.",
    actionSteps: [
      {
        icon: "activity",
        title: "Observe signals",
        description:
          "Centralize availability, performance, and security checks that concern your site.",
      },
      {
        icon: "bell",
        title: "Get alerted at the right time",
        description:
          "Spot important changes thanks to the alerts and notifications available in your tracking.",
      },
      {
        icon: "sparkles",
        title: "Prioritize correction",
        description:
          "Use FlowPoint recommendations to transform technical findings into understandable actions.",
      },
    ],
    educationHeading: "Why implement SEO monitoring?",
    educationDescription:
      "Site performance is not static. An update, a certificate, an API, or a technical evolution can change the quality of a visit. FlowPoint SEO monitoring provides a regular framework for tracking availability, performance, and incidents, then linking this information to your SEO indicators and recommendations. To go deeper, read the [SEO monitoring guide](/ressources/monitoring-seo-guide), the guide on [monitoring indicators](/ressources/surveillance-site-web-indicateurs), and the method for handling [monitoring alerts](/ressources/alertes-monitoring-site).",
    audienceHeading: "Who is it for?",
    audienceDescription:
      "Monitoring is aimed at teams that want to detect problems likely to affect their online presence earlier.",
    audiences: [
      {
        icon: "building",
        title: "Businesses and SMEs",
        description:
          "Keep an eye on your site without having to manually check every technical signal daily.",
      },
      {
        icon: "users",
        title: "Marketing teams",
        description:
          "Link technical changes to your performance and facilitate coordination with people working on the site.",
      },
      {
        icon: "globe",
        title: "Agencies and web teams",
        description:
          "Track multiple sites, centralize alerts, and share a clear reading of their status.",
      },
    ],
    faqs: [
      {
        question: "What is SEO monitoring?",
        answer:
          "SEO monitoring involves regularly tracking a site's availability, performance, and certain technical signals to detect changes that could affect its visibility or activity.",
      },
      {
        question: "What does website monitoring software track?",
        answer:
          "FlowPoint highlights tracking for availability, SSL certificates, latency, API endpoints, Core Web Vitals, and alerts related to important changes.",
      },
      {
        question: "Why monitor Core Web Vitals?",
        answer:
          "Core Web Vitals provide benchmarks for a site's loading and interaction experience. Tracking them helps identify technical areas that deserve improvement.",
      },
      {
        question: "How am I informed when a problem is detected?",
        answer:
          "FlowPoint groups the available alerts and notifications to signal incidents or changes that require your attention.",
      },
      {
        question: "Does SEO monitoring replace an SEO audit?",
        answer:
          "No. An audit helps with an initial assessment, while monitoring tracks the site's evolution over time. Both approaches are complementary.",
      },
    ],
    finalCtaHeading: "Don't discover an incident too late",
    finalCtaDescription:
      "Start your FlowPoint trial and track your site's important signals from a single dashboard, then share progress in an [SEO report](/seo-reporting).",
  },
  "/seo-reporting": {
    path: "/seo-reporting",
    title: "SEO Reporting Software for Agencies and Teams | FlowPoint",
    description:
      "Bring SEO performance, keywords, local visibility and recommendations together in clear, shareable reports for agency teams and client updates with FlowPoint.",
    preview: {
      route: "reports",
      heading: "Preview SEO reporting in FlowPoint",
      description:
        "See how report views bring trends and next steps together for team or client review.",
      alt: "FlowPoint SEO reporting dashboard preview",
    },
    badge: "SEO Reporting",
    heroH1: "Automate SEO reporting and share clearer results",
    heroDescription:
      "FlowPoint centralizes your SEO indicators and recommendations to help you produce clearer reports, track your progress, and share next steps.",
    introHeading: "A good SEO report should help you decide",
    introDescription:
      "Accumulating data is not enough. Useful reporting highlights trends, priorities, and elements that your teams or clients need to understand.",
    checks: [
      {
        icon: "barChart",
        title: "Consolidated data",
        description:
          "Gather visibility, performance, keyword, and competitor indicators in readable dashboards.",
      },
      {
        icon: "fileText",
        title: "Structured reports",
        description:
          "Transform your analyses into clear reports to maintain a history and present essential results.",
      },
      {
        icon: "share",
        title: "Sharing and white label",
        description:
          "Present your reports with sharing, customization, and presentation options provided by FlowPoint.",
      },
      {
        icon: "sparkles",
        title: "AI recommendations",
        description:
          "Add actionable insights to your data thanks to personalized AI recommendations and tasks.",
      },
    ],
    overviewHeading: "The elements of actionable SEO reporting",
    overviewDescription:
      "FlowPoint reporting connects numbers to context and actions to facilitate the tracking of a business, a site, or a client portfolio.",
    overviewItems: [
      "Executive reports and indicators gathered in a centralized dashboard",
      "Templates and tasks to organize technical, local, content, and growth topics",
      "PDF reports, public sharing, and white-label options according to your space's capabilities",
    ],
    actionHeading: "Transform your data into more useful meetings",
    actionDescription:
      "SEO reporting software saves you time when it makes progress and upcoming decisions immediately understandable.",
    actionSteps: [
      {
        icon: "lineChart",
        title: "Gather trends",
        description:
          "Track important indicators over time instead of rebuilding your analysis for every report.",
      },
      {
        icon: "fileText",
        title: "Shape the essential",
        description:
          "Organize your results around progress, detected problems, and priorities to present.",
      },
      {
        icon: "share",
        title: "Share next steps",
        description:
          "Give your teams or clients a clear reading of the recommendations to implement.",
      },
    ],
    educationHeading: "Why automate SEO reporting?",
    educationDescription:
      "Recurring reporting becomes more reliable when collection, reading, and presentation follow a consistent method. FlowPoint brings together visibility, performance, competition, and recommendation data to help you produce reports that don't just describe the past, but clarify future actions. To go deeper, consult the [SEO reporting guide](/ressources/reporting-seo-guide), the selection of [SEO KPIs](/ressources/tableau-de-bord-seo-kpi), and the interpretation of [Google Search Console](/ressources/rapport-google-search-console) data.",
    audienceHeading: "Who is it for?",
    audienceDescription:
      "FlowPoint helps teams that need to track SEO results and explain them to others.",
    audiences: [
      {
        icon: "building",
        title: "Marketing teams",
        description:
          "Maintain an overview of performance and priorities without multiplying tracking files.",
      },
      {
        icon: "users",
        title: "Digital agencies",
        description:
          "Present your client analyses with structured, shareable reports adapted to your context.",
      },
      {
        icon: "globe",
        title: "Multi-site businesses",
        description:
          "Compare the progress of multiple projects and keep a common reporting base.",
      },
    ],
    faqs: [
      {
        question: "What is an automatic SEO report?",
        answer:
          "An automatic SEO report regularly gathers a site's indicators and recommendations to present its progress, problems, and next actions with less manual work.",
      },
      {
        question: "What does FlowPoint SEO reporting include?",
        answer:
          "FlowPoint includes performance, keywords, local visibility, competition, recommendations, and AI tasks in dashboards and reports.",
      },
      {
        question: "Can SEO reports be shared?",
        answer:
          "FlowPoint provides options for public sharing and client presentation, as well as customization and white-label possibilities depending on your space's capabilities.",
      },
      {
        question: "Is SEO reporting useful for an agency?",
        answer:
          "Yes. An agency can use structured reporting to track multiple clients, present results more clearly, and link every finding to recommended actions.",
      },
      {
        question: "How do I start creating reports with FlowPoint?",
        answer:
          "Add your site to FlowPoint, check the available dashboards, and then use the reports and recommendations to structure your next review.",
      },
    ],
    finalCtaHeading: "Ready to simplify your SEO reporting?",
    finalCtaDescription:
      "Start your FlowPoint trial to centralize your data and reports in a single space.",
  },
  "/competitor-analysis": {
    path: "/competitor-analysis",
    title: "SEO Competitor Analysis Tool for Rankings | FlowPoint",
    description:
      "Compare competitor rankings, keywords and local visibility with FlowPoint. Find search gaps and prioritize practical SEO actions for your business or agency.",
    preview: {
      route: "competitor",
      heading: "Compare competitor signals in FlowPoint",
      description:
        "Preview the competitor workspace for reviewing tracked competitors and search opportunities.",
      alt: "FlowPoint competitor analysis dashboard preview",
    },
    badge: "SEO competitive analysis",
    heroH1: "Use SEO competitor analysis to find opportunities",
    heroDescription:
      "FlowPoint helps you compare your digital presence to that of your competitors, track important keywords, and spot opportunities to act on.",
    introHeading: "Understand your competitors to better prioritize",
    introDescription:
      "Competitive analysis is not about copying other sites. It serves to understand your environment, measure gaps, and identify topics that can strengthen your visibility.",
    checks: [
      {
        icon: "search",
        title: "Identify competitors",
        description:
          "Structure your tracking around businesses and local players that influence your visibility.",
      },
      {
        icon: "barChart",
        title: "Compare positions",
        description:
          "Compare positions and trends to better understand presence gaps in important searches.",
      },
      {
        icon: "target",
        title: "Analyze keywords",
        description:
          "Spot competitor keywords and opportunities that deserve to be worked on as a priority.",
      },
      {
        icon: "trophy",
        title: "Track competition index",
        description:
          "Use competition indicators and recommendations to give context to your SEO decisions.",
      },
    ],
    overviewHeading: "What you can compare with FlowPoint",
    overviewDescription:
      "The FlowPoint competitor analysis tool connects competitor tracking to keywords, local visibility, and recommendations.",
    overviewItems: [
      "Positions, trends, and digital presence of your competitors",
      "Competitor keywords and visibility opportunities to work on",
      "Local competitor analysis, competition index, and personalized recommendations",
    ],
    actionHeading: "Move from observation to a more targeted strategy",
    actionDescription:
      "SEO competitive analysis becomes useful when it helps you choose your next actions rather than just accumulating comparisons.",
    actionSteps: [
      {
        icon: "search",
        title: "Define your landscape",
        description:
          "Identify the competitors and searches that really matter for your business.",
      },
      {
        icon: "lineChart",
        title: "Compare trends",
        description:
          "Track positions and trends to distinguish a one-time gap from a lasting evolution.",
      },
      {
        icon: "sparkles",
        title: "Choose your opportunities",
        description:
          "Rely on FlowPoint recommendations to focus your efforts on the most relevant topics.",
      },
    ],
    educationHeading: "Why track SEO competition?",
    educationDescription:
      "Your visibility also depends on businesses that target the same customers and the same searches. Regular competitor tracking helps you contextualize your results, spot new opportunities, and avoid making decisions based solely on your own indicators' evolution. FlowPoint connects this analysis to keyword tracking, local SEO, and recommendations. Then, present these gaps in a readable [SEO report](/seo-reporting). To specify the method, consult the [SEO competitive analysis guide](/ressources/analyse-concurrentielle-seo-guide), the distinction between commercial and SEO competitors in [identifying SEO competitors](/ressources/identifier-concurrents-seo), and the method to [spot opportunities](/ressources/opportunites-seo-concurrence).",
    audienceHeading: "Who is it for?",
    audienceDescription:
      "Competitive analysis is aimed at teams that want to make SEO decisions with a better understanding of their market.",
    audiences: [
      {
        icon: "building",
        title: "Growth businesses",
        description:
          "Understand the gaps with players that target the same customers and choose your next topics.",
      },
      {
        icon: "users",
        title: "SEO and marketing teams",
        description:
          "Track positions, keywords, and competitive trends in a centralized dashboard.",
      },
      {
        icon: "globe",
        title: "Digital agencies",
        description:
          "Enrich your client recommendations with local competitive context and readable comparisons.",
      },
    ],
    faqs: [
      {
        question: "What is an SEO competitive analysis?",
        answer:
          "An SEO competitive analysis compares your site's presence to that of other players regarding positions, keywords, and opportunities that matter for your visibility.",
      },
      {
        question: "What can an SEO competitor analysis tool compare?",
        answer:
          "FlowPoint highlights position comparison, competitor keyword analysis, local competitor tracking, and competition indicators.",
      },
      {
        question: "Does competitive analysis replace an SEO strategy?",
        answer:
          "No. It provides context for your strategy. Comparisons serve to choose better priorities, but actions must remain adapted to your business and resources.",
      },
      {
        question: "Is competitor tracking useful for a local business?",
        answer:
          "Yes. Competitors visible in your area can evolve quickly. Tracking their local presence and keywords helps to better understand your market's opportunities.",
      },
      {
        question: "How do I start analyzing my competitors?",
        answer:
          "Add your site to FlowPoint, define relevant competitors, and then consult the available positions, keywords, and recommendations to organize your tracking.",
      },
    ],
    finalCtaHeading: "Ready to better understand your competition?",
    finalCtaDescription:
      "Start your FlowPoint trial and give your SEO decisions more precise context.",
  },
};
