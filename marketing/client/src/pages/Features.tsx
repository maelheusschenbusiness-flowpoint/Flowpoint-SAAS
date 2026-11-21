import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { FeatureScreenshot } from "@/components/FeatureScreenshot";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  Users,
  MapPin,
  TrendingUp,
  BarChart3,
  Target,
  ArrowRight,
  CheckCircle2,
  Zap,
  Globe,
  Star,
  MessageSquare,
  Bell,
  Shield,
  Monitor,
  Bot,
  Gauge,
  LineChart,
  DollarSign,
  Activity,
  Sparkles,
  Building2,
  Trophy,
} from "lucide-react";
import { trackSignupCta } from "@/lib/analytics";
import { getMarketingTranslationSourceLanguage } from "@/lib/marketing-locale";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";

type AgencyReportsCopy = {
  whiteLabelTitle: string;
  whiteLabelDescription: string;
  aiTitle: string;
  aiDescription: string;
};

const AGENCY_REPORTS_COPY: Record<string, AgencyReportsCopy> = {
  fr: {
    whiteLabelTitle: "Rapports en marque blanche",
    whiteLabelDescription: "Rapports à votre marque",
    aiTitle: "Rapports IA",
    aiDescription: "Générés automatiquement",
  },
  en: {
    whiteLabelTitle: "White-label reports",
    whiteLabelDescription: "Branded reports",
    aiTitle: "AI reports",
    aiDescription: "Automatically generated",
  },
  es: {
    whiteLabelTitle: "Informes de marca blanca",
    whiteLabelDescription: "Informes con tu marca",
    aiTitle: "Informes con IA",
    aiDescription: "Generados automáticamente",
  },
  de: {
    whiteLabelTitle: "White-Label-Berichte",
    whiteLabelDescription: "Berichte mit Ihrem Branding",
    aiTitle: "KI-Berichte",
    aiDescription: "Automatisch erstellt",
  },
  it: {
    whiteLabelTitle: "Report white label",
    whiteLabelDescription: "Report con il tuo brand",
    aiTitle: "Report con IA",
    aiDescription: "Generati automaticamente",
  },
  pt: {
    whiteLabelTitle: "Relatórios white label",
    whiteLabelDescription: "Relatórios com a sua marca",
    aiTitle: "Relatórios com IA",
    aiDescription: "Gerados automaticamente",
  },
  nl: {
    whiteLabelTitle: "White-labelrapporten",
    whiteLabelDescription: "Rapporten in uw huisstijl",
    aiTitle: "AI-rapporten",
    aiDescription: "Automatisch gegenereerd",
  },
  pl: {
    whiteLabelTitle: "Raporty white label",
    whiteLabelDescription: "Raporty z Twoją marką",
    aiTitle: "Raporty AI",
    aiDescription: "Generowane automatycznie",
  },
  ru: {
    whiteLabelTitle: "Отчёты с вашим брендом",
    whiteLabelDescription: "Отчёты в фирменном стиле",
    aiTitle: "Отчёты ИИ",
    aiDescription: "Создаются автоматически",
  },
  uk: {
    whiteLabelTitle: "Звіти з вашим брендом",
    whiteLabelDescription: "Звіти у фірмовому стилі",
    aiTitle: "Звіти зі ШІ",
    aiDescription: "Створюються автоматично",
  },
  cs: {
    whiteLabelTitle: "White-label reporty",
    whiteLabelDescription: "Reporty s vaší značkou",
    aiTitle: "AI reporty",
    aiDescription: "Generované automaticky",
  },
  ro: {
    whiteLabelTitle: "Rapoarte white-label",
    whiteLabelDescription: "Rapoarte cu brandul dvs.",
    aiTitle: "Rapoarte AI",
    aiDescription: "Generate automat",
  },
  hu: {
    whiteLabelTitle: "White-label jelentések",
    whiteLabelDescription: "Saját márkás jelentések",
    aiTitle: "AI-jelentések",
    aiDescription: "Automatikusan generálva",
  },
  sv: {
    whiteLabelTitle: "White label-rapporter",
    whiteLabelDescription: "Rapporter med ditt varumärke",
    aiTitle: "AI-rapporter",
    aiDescription: "Skapas automatiskt",
  },
  da: {
    whiteLabelTitle: "White label-rapporter",
    whiteLabelDescription: "Rapporter med dit brand",
    aiTitle: "AI-rapporter",
    aiDescription: "Genereres automatisk",
  },
  no: {
    whiteLabelTitle: "White-label-rapporter",
    whiteLabelDescription: "Rapporter med din merkevare",
    aiTitle: "KI-rapporter",
    aiDescription: "Genereres automatisk",
  },
  fi: {
    whiteLabelTitle: "White label -raportit",
    whiteLabelDescription: "Raportit omalla brändilläsi",
    aiTitle: "Tekoälyraportit",
    aiDescription: "Luodaan automaattisesti",
  },
  el: {
    whiteLabelTitle: "Αναφορές white-label",
    whiteLabelDescription: "Αναφορές με το brand σας",
    aiTitle: "Αναφορές AI",
    aiDescription: "Δημιουργούνται αυτόματα",
  },
  tr: {
    whiteLabelTitle: "White-label raporlar",
    whiteLabelDescription: "Markanızla raporlar",
    aiTitle: "Yapay zekâ raporları",
    aiDescription: "Otomatik oluşturulur",
  },
  ar: {
    whiteLabelTitle: "تقارير بعلامتك التجارية",
    whiteLabelDescription: "تقارير تحمل هويتك التجارية",
    aiTitle: "تقارير الذكاء الاصطناعي",
    aiDescription: "تُنشأ تلقائيًا",
  },
  he: {
    whiteLabelTitle: "דוחות White Label",
    whiteLabelDescription: "דוחות במיתוג שלך",
    aiTitle: "דוחות AI",
    aiDescription: "נוצרים באופן אוטומטי",
  },
  hi: {
    whiteLabelTitle: "व्हाइट-लेबल रिपोर्ट",
    whiteLabelDescription: "आपके ब्रांड वाले रिपोर्ट",
    aiTitle: "AI रिपोर्ट",
    aiDescription: "अपने-आप जनरेट होते हैं",
  },
  "zh-CN": {
    whiteLabelTitle: "白标报告",
    whiteLabelDescription: "带有您品牌的报告",
    aiTitle: "AI 报告",
    aiDescription: "自动生成",
  },
  "zh-TW": {
    whiteLabelTitle: "白標報告",
    whiteLabelDescription: "採用您品牌的報告",
    aiTitle: "AI 報告",
    aiDescription: "自動產生",
  },
  ja: {
    whiteLabelTitle: "ホワイトラベルレポート",
    whiteLabelDescription: "自社ブランドのレポート",
    aiTitle: "AIレポート",
    aiDescription: "自動生成",
  },
  ko: {
    whiteLabelTitle: "화이트 라벨 보고서",
    whiteLabelDescription: "브랜드 맞춤 보고서",
    aiTitle: "AI 보고서",
    aiDescription: "자동 생성",
  },
  th: {
    whiteLabelTitle: "รายงานไวท์เลเบล",
    whiteLabelDescription: "รายงานในแบรนด์ของคุณ",
    aiTitle: "รายงาน AI",
    aiDescription: "สร้างโดยอัตโนมัติ",
  },
  vi: {
    whiteLabelTitle: "Báo cáo nhãn trắng",
    whiteLabelDescription: "Báo cáo mang thương hiệu của bạn",
    aiTitle: "Báo cáo AI",
    aiDescription: "Tự động tạo",
  },
  id: {
    whiteLabelTitle: "Laporan white label",
    whiteLabelDescription: "Laporan dengan merek Anda",
    aiTitle: "Laporan AI",
    aiDescription: "Dibuat otomatis",
  },
  ms: {
    whiteLabelTitle: "Laporan label putih",
    whiteLabelDescription: "Laporan dengan jenama anda",
    aiTitle: "Laporan AI",
    aiDescription: "Dijana secara automatik",
  },
};

const AGENCY_ALERTS_COPY: Record<string, string> = {
  fr: "Centre d’alertes : e-mail, Slack et webhooks",
  en: "Alert center: email, Slack, and webhooks",
  es: "Centro de alertas: email, Slack y webhooks",
  de: "Alarmzentrale: E-Mail, Slack und Webhooks",
  it: "Centro avvisi: email, Slack e webhook",
  pt: "Centro de alertas: e-mail, Slack e webhooks",
  nl: "Meldingencentrum: e-mail, Slack en webhooks",
  pl: "Centrum alertów: e-mail, Slack i webhooki",
  ru: "Центр уведомлений: электронная почта, Slack и вебхуки",
  uk: "Центр сповіщень: електронна пошта, Slack і вебхуки",
  cs: "Centrum upozornění: e-mail, Slack a webhooky",
  ro: "Centru de alerte: e-mail, Slack și webhookuri",
  hu: "Riasztási központ: e-mail, Slack és webhookok",
  sv: "Aviseringscenter: e-post, Slack och webhooks",
  da: "Alarmcenter: e-mail, Slack og webhooks",
  no: "Varslingssenter: e-post, Slack og webhooks",
  fi: "Hälytyskeskus: sähköposti, Slack ja webhookit",
  el: "Κέντρο ειδοποιήσεων: email, Slack και webhooks",
  tr: "Uyarı merkezi: e-posta, Slack ve webhook'lar",
  ar: "مركز التنبيهات: البريد الإلكتروني وSlack وواجهات الويب",
  he: "מרכז התראות: דוא״ל, Slack ו-webhooks",
  hi: "अलर्ट केंद्र: ईमेल, Slack और वेबहुक",
  "zh-CN": "提醒中心：电子邮件、Slack 和 Webhook",
  "zh-TW": "通知中心：電子郵件、Slack 與 Webhook",
  ja: "アラートセンター：メール、Slack、Webhook",
  ko: "알림 센터: 이메일, Slack, 웹훅",
  th: "ศูนย์การแจ้งเตือน: อีเมล Slack และเว็บฮุก",
  vi: "Trung tâm cảnh báo: email, Slack và webhook",
  id: "Pusat notifikasi: email, Slack, dan webhook",
  ms: "Pusat amaran: e-mel, Slack dan webhook",
};

const GOOGLE_MAPS_OPTIMIZATION_COPY: Record<string, string> = {
  fr: "Optimisation Google Maps",
  en: "Google Maps optimization",
  es: "Optimización de Google Maps",
  de: "Google-Maps-Optimierung",
  it: "Ottimizzazione di Google Maps",
  pt: "Otimização do Google Maps",
  nl: "Google Maps-optimalisatie",
  pl: "Optymalizacja Google Maps",
  ru: "Оптимизация Google Maps",
  uk: "Оптимізація Google Maps",
  cs: "Optimalizace Google Maps",
  ro: "Optimizare Google Maps",
  hu: "Google Maps-optimalizálás",
  sv: "Google Maps-optimering",
  da: "Google Maps-optimering",
  no: "Google Maps-optimalisering",
  fi: "Google Maps -optimointi",
  el: "Βελτιστοποίηση Google Maps",
  tr: "Google Haritalar optimizasyonu",
  ar: "تحسين Google Maps",
  he: "אופטימיזציה של Google Maps",
  hi: "Google Maps अनुकूलन",
  "zh-CN": "Google 地图优化",
  "zh-TW": "Google 地圖最佳化",
  ja: "Google マップの最適化",
  ko: "Google 지도 최적화",
  th: "การเพิ่มประสิทธิภาพ Google Maps",
  vi: "Tối ưu hóa Google Maps",
  id: "Optimasi Google Maps",
  ms: "Pengoptimuman Google Maps",
};

function getSelectedLanguage(): string {
  if (typeof document === "undefined") return "en";
  try {
    const savedLanguage = window.localStorage.getItem("flowpoint-language");
    if (savedLanguage) return savedLanguage.toLowerCase();
  } catch {
    // Read the translation cookie below when browser storage is unavailable.
  }
  const sourceLanguage = getMarketingTranslationSourceLanguage(window.location.pathname);
  return document.cookie.match(
    new RegExp(`(?:^|;\\s*)googtrans=/${sourceLanguage}/([^;]+)`, "i"),
  )?.[1]?.toLowerCase() || document.documentElement.lang.toLowerCase() || "en";
}

const featureLandingLinks: Record<string, { href: string; label: string }> = {
  "SEO audit": {
    href: "/seo-audit",
    label: "Explore the SEO audit tool",
  },
  "Google Maps optimization": {
    href: "/local-seo",
    label: "Explore the local SEO tool",
  },
  "Performance monitoring": {
    href: "/website-monitoring",
    label: "View SEO monitoring",
  },
  "AI recommendations": {
    href: "/seo-reporting",
    label: "Explore SEO reporting",
  },
  "Competitive analysis": {
    href: "/competitor-analysis",
    label: "Analyze the competition",
  },
};

export default function Features() {
  usePageTitle("FlowPoint Platform Features for SEO & Digital Growth");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  useEffect(() => {
    setSelectedLanguage(getSelectedLanguage());
  }, []);
  const agencyReportsCopy = AGENCY_REPORTS_COPY[selectedLanguage] || AGENCY_REPORTS_COPY.en;
  const agencyAlertsCopy = AGENCY_ALERTS_COPY[selectedLanguage] || AGENCY_ALERTS_COPY.en;

  const mainFeatures = [
    {
      icon: Search,
      title: "SEO audit",
      description: "Instantly analyze the strengths and weaknesses of your online presence.",
      details: [
        "Complete website analysis",
        "Meta tag and title checks",
        "Page speed audit",
        "Technical issue detection",
      ],
    },
    {
      icon: Users,
      title: "Competitive analysis",
      description: "Analyze competitors, compare their performance and identify new opportunities.",
      details: [
        "Automatic competitor identification",
        "Ranking comparisons",
        "Competitor keyword analysis",
        "Personalized recommendations",
      ],
    },
    {
      icon: MapPin,
      title: "Google Maps optimization",
      description: "Improve your Google Business Profile to attract more local customers.",
      details: [
        "Google Business Profile optimization",
        "Category suggestions",
        "Photo guidance",
        "Attribute improvements",
      ],
    },
    {
      icon: Target,
      title: "SEO & keywords",
      description: "Find relevant keywords and track how they change over time.",
      details: [
        "Keyword research",
        "Ranking tracking",
        "Keyword opportunities",
        "Trend analysis",
      ],
    },
    {
      icon: BarChart3,
      title: "Performance monitoring",
      description: "Track performance with clear dashboards and actionable metrics.",
      details: [
        "Intuitive dashboards",
        "Weekly reports",
        "Ranking change alerts",
        "Performance history",
      ],
    },
    {
      icon: TrendingUp,
      title: "AI recommendations",
      description: "Get personalized recommendations to improve performance and accelerate growth.",
      details: [
        "Conversion optimization",
        "Contact forms",
        "Call tracking",
        "Customer journey analysis",
      ],
    },
  ];

  const platformFeatures = [
    {
      icon: Monitor,
      badge: "Uptime & SSL",
      badgeCls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
      iconCls: "bg-cyan-100 dark:bg-cyan-900/30",
      iconColor: "text-cyan-600",
      title: "Real-time monitoring",
      description: "Monitor your website, SSL, latency and API endpoints around the clock. Get an alert as soon as an incident is detected.",
      points: ["Checks every 5 minutes", "SSL certificate tracking", "Slack and email alerts"],
    },
    {
      icon: Bot,
      badge: "IA",
      badgeCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      iconCls: "bg-blue-100 dark:bg-blue-900/30",
      iconColor: "text-blue-600",
      title: "Automated AI missions",
      description: "An AI-generated action plan with prioritized tasks, impact and effort scores, and a Kanban view.",
      points: ["Personalized AI action plan", "High-impact, low-effort priorities", "Kanban and calendar views"],
    },
    {
      icon: Gauge,
      badge: "Performance",
      badgeCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
      iconCls: "bg-violet-100 dark:bg-violet-900/30",
      iconColor: "text-violet-600",
      title: "Core Web Vitals",
      description: "Automatically monitor Core Web Vitals and identify areas to improve.",
      points: ["Scheduled audits", "LCP / CLS / INP", "Export results to CSV"],
    },
    {
      icon: LineChart,
      badge: "Analytics",
      badgeCls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      iconCls: "bg-orange-100 dark:bg-orange-900/30",
      iconColor: "text-orange-600",
      title: "Integrated GA4 analytics",
      description: "See performance in centralized dashboards connected to Google Analytics 4.",
      points: ["Native GA4 connection", "Conversion funnels", "Live user view"],
    },
    {
      icon: Trophy,
      badge: "Competition",
      badgeCls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
      iconCls: "bg-red-100 dark:bg-red-900/30",
      iconColor: "text-red-600",
      title: "Competitive intelligence",
      description: "Real-time AI competitive scoring and analysis of local competitors.",
      points: ["Competition index", "Local competitor analysis", "Cross-module AI correlations"],
    },
    {
      icon: DollarSign,
      badge: "CRO",
      badgeCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      iconCls: "bg-emerald-100 dark:bg-emerald-900/30",
      iconColor: "text-emerald-600",
      title: "Revenue Leak AI",
      description: "Find growth opportunities and friction points that limit conversions, with a CRO score and actionable AI recommendations.",
      points: ["Growth opportunities", "UX friction analysis", "CRO score and recommendations"],
    },
  ];

  const additionalFeatures = [
    { icon: Globe, title: "Multilingual", description: "Language selector with 30 available options" },
    { icon: Star, title: "Review management", description: "Monitor and reply to your Google reviews" },
    { icon: MessageSquare, title: "24/7 AI support", description: "An intelligent assistant available at any time" },
    { icon: Bell, title: "Real-time alerts", description: "Notifications about important changes" },
    { icon: Shield, title: "Secure data", description: "Your data is protected in accordance with the GDPR" },
    { icon: Zap, title: "Regular updates", description: "Regular improvements and new features" },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation language="en" />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Explore FlowPoint's digital-growth platform
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Connect SEO audits, local search, competitor analysis, website monitoring, analytics, reporting and AI-supported workflows in one workspace.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Main Features Grid */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {mainFeatures.map((feature, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border hover:border-blue-200 dark:border-blue-700 hover:shadow-lg transition-all">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
                      <feature.icon className="h-6 w-6 text-blue-600" />
                    </div>
                    <CardTitle asChild className="text-lg">
                      <h2>
                        {feature.title === "Google Maps optimization" ? (
                          <span translate="no" className="notranslate">
                            {GOOGLE_MAPS_OPTIMIZATION_COPY[selectedLanguage] || GOOGLE_MAPS_OPTIMIZATION_COPY.en}
                          </span>
                        ) : feature.title}
                      </h2>
                    </CardTitle>
                    <CardDescription className="text-base">{feature.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {feature.details.map((detail, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                    {featureLandingLinks[feature.title] && (
                      <a
                        href={featureLandingLinks[feature.title].href}
                        className="inline-flex items-center mt-5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline"
                      >
                        {featureLandingLinks[feature.title].label}
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </a>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Feature Spotlight — alternating left/right */}
      <section className="py-24 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-32">

          {/* Spotlight 1: SEO Local & GBP */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={fadeInUp} className="relative z-0 order-2 lg:order-1 hover:z-30">
              <FeatureScreenshot
                route="local-seo"
                alt="FlowPoint local SEO dashboard with a local presence map and opportunities"
              />
            </motion.div>
            <motion.div variants={fadeInUp} className="order-1 lg:order-2">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <MapPin className="h-3.5 w-3.5" /> Local SEO & Google Business Profile
              </span>
              <h3 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Grow your local presence
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-6">
                FlowPoint helps optimize your Google Business Profile, track your Maps rankings and monitor your local presence and performance.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Real-time Google Maps ranking tracking",
                  "Automated customer review management",
                  "Geographic visibility heatmap",
                  "Keywords and competitor analysis",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-blue-600 flex-shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="bg-blue-600 border-blue-600 text-white rounded-lg">
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_local_seo")}
                >
                  Start my 14-day trial <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
          </motion.div>

          {/* Spotlight 2: AI Missions */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={fadeInUp}>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <Bot className="h-3.5 w-3.5" /> AI Missions & Automation
              </span>
              <h3 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Your AI assistant
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-6">
                AI analyzes your data and creates personalized recommendations to help prioritize the actions with the greatest impact.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "AI action plan tailored to your industry",
                  "SEO templates: technical, local, content and growth",
                  "Impact score and effort estimate for each mission",
                  "Kanban, list and calendar views",
                  "AI priorities: high impact, low effort",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-blue-700 flex-shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="bg-blue-700 border-blue-700 text-white rounded-lg hover:bg-blue-800">
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_ai_missions")}
                >
                  Start my 14-day trial <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
            <motion.div variants={fadeInUp} className="relative z-0 hover:z-30">
              <FeatureScreenshot
                route="missions"
                alt="FlowPoint AI Missions dashboard with prioritized SEO recommendations"
              />
            </motion.div>
          </motion.div>

          {/* Spotlight 3: Agencies */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={fadeInUp} className="relative z-0 order-2 lg:order-1 hover:z-30">
              <FeatureScreenshot
                route="reports"
                alt="FlowPoint reports and activity dashboard for SEO agencies"
              />
            </motion.div>
            <motion.div variants={fadeInUp} className="order-1 lg:order-2">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <Building2 className="h-3.5 w-3.5" /> For digital agencies
              </span>
              <h3 className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
                Manage all your clients from one workspace
              </h3>
              <p className="text-slate-600 dark:text-slate-300 mb-6">
                Bring client data together, automate reports and manage multiple businesses from one platform.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "AI-generated executive reports",
                  "White-label export (client logo and colors)",
                  "Isolated, secure client workspace",
                  "Multi-site management from a single dashboard",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-blue-700 flex-shrink-0" /> {item}
                  </li>
                ))}
                <li className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="h-5 w-5 text-blue-700 flex-shrink-0" />
                  <span translate="no" className="notranslate">{agencyAlertsCopy}</span>
                </li>
              </ul>
              <Button asChild className="bg-blue-700 border-blue-700 text-white rounded-lg hover:bg-blue-800">
                <a
                  href="/pricing"
                >
                  View pricing <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
          </motion.div>

        </div>
      </section>

      {/* Platform features */}
      <section className="py-24 bg-slate-50 dark:bg-slate-800/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center mb-16">
            <motion.div variants={fadeInUp} className="mb-4">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                The complete platform
              </span>
            </motion.div>
            <motion.h2 variants={fadeInUp} className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              One platform to grow your business
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              FlowPoint brings together what you need to grow online in one dashboard.
            </motion.p>
          </motion.div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {platformFeatures.map((feature, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-lg transition-all bg-white dark:bg-slate-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-11 h-11 rounded-xl ${feature.iconCls} flex items-center justify-center`}>
                        <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${feature.badgeCls}`}>{feature.badge}</span>
                    </div>
                    <CardTitle asChild className="text-lg leading-snug"><h3>{feature.title}</h3></CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <CardDescription className="text-sm mb-4">{feature.description}</CardDescription>
                    <ul className="space-y-1.5">
                      {feature.points.map((point, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          {point}
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

      {/* For Agencies Strip — La plateforme des agences digitales */}
      <section id="agencies" className="py-20 bg-blue-50 dark:bg-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
            <motion.div variants={fadeInUp} className="text-center mb-12">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-blue-600/40 dark:border-blue-400/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-6">
                 <Building2 className="h-4 w-4" /> For agencies
              </span>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-slate-900 dark:text-white mb-4">
                The platform for digital agencies
              </h2>
              <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                Manage clients, create white-label reports and grow your agency with FlowPoint.
              </p>
            </motion.div>
            <motion.div variants={fadeInUp} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {[
                { icon: Globe, title: agencyReportsCopy.whiteLabelTitle, desc: agencyReportsCopy.whiteLabelDescription, localized: true },
                 { icon: Users, title: "Client workspace", desc: "Isolated client access" },
                 { icon: Activity, title: "Multi-site", desc: "See all your clients at a glance" },
                { icon: Sparkles, title: agencyReportsCopy.aiTitle, desc: agencyReportsCopy.aiDescription, localized: true },
              ].map((item, i) => (
                <div key={i} className="bg-white dark:bg-white/5 border border-blue-100 dark:border-white/10 rounded-xl p-5 text-center hover:border-blue-300 dark:hover:bg-white/10 transition-colors shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center mx-auto mb-3">
                    <item.icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div translate={item.localized ? "no" : undefined} className={`${item.localized ? "notranslate " : ""}text-sm font-semibold text-slate-900 dark:text-white mb-1`}>{item.title}</div>
                  <div translate={item.localized ? "no" : undefined} className={`${item.localized ? "notranslate " : ""}text-xs text-slate-500 dark:text-slate-400`}>{item.desc}</div>
                </div>
              ))}
            </motion.div>
            <motion.div variants={fadeInUp} className="text-center">
              <Button asChild size="lg" className="bg-blue-600 border-blue-600 text-white rounded-lg hover:bg-blue-700">
                <a
                  href="/pricing"
                >
                  View pricing <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* More features */}
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
            {additionalFeatures.map((feature, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                className="flex items-start gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{feature.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
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
            <motion.div variants={fadeInUp}>
              <Button
                size="lg"
                asChild
                className="bg-white text-blue-600 border-white rounded-lg py-4 px-6 text-base"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("features_final_cta")}
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
