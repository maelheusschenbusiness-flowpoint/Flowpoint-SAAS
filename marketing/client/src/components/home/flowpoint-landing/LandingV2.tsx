import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MotionConfig, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  FileText,
  Gauge,
  Globe2,
  MapPin,
  Menu,
  Search,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ThemePicker } from "@/components/ThemePicker";
import { trackEvent, trackSignupCta } from "@/lib/analytics";
import { useTheme } from "@/components/ThemeProvider";
import PublicAuditWidget from "./PublicAuditWidget";
import type { PublicAuditReport, PublicAuditQuota } from "@shared/public-audit";
import Current from "./Current";
import "./LandingV2.css";
import "./ConnectedView.css";

const signupUrl = "https://app.flowpoint.pro/signin.html";

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="fp2-eyebrow">{children}</span>;
}

function DashboardPreview({ language }: { language: string }) {
  const isFrench = language.startsWith("fr");
  const exampleLabel = isFrench
    ? "VUE ILLUSTRATIVE · AUCUNE DONNÉE EN DIRECT"
    : "EXAMPLE DATA · NOT LIVE";
  const translateManually = language === "en" || language === "fr";

  return (
    <motion.div
      className="fp2-dashboard-wrap"
      initial={{ opacity: 1, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="fp2-dashboard">
          <div className="fp2-dash-bar">
          <div className="fp2-dash-brand"><span className="fp2-mark">F</span><b>FlowPoint</b><span className="fp2-dash-divider" />Workspace</div>
            <span
              className={`fp2-demo-pill fp2-dashboard-demo-pill ${isFrench ? "fp2-dashboard-demo-pill-fr" : ""} ${translateManually ? "notranslate" : ""}`}
              title={isFrench
                ? "Aperçu illustratif. Aucune donnée client en direct."
                : "Illustrative preview. Example figures, not live customer data."}
              lang={isFrench ? "fr" : "en"}
              translate={translateManually ? "no" : undefined}
            >
              {exampleLabel}
            </span>
          <div className="fp2-dash-user"><span>Northstar Studio</span><i>NS</i></div>
        </div>
        <div className="fp2-dash-body">
          <aside className="fp2-dash-side">
            <span className="fp2-side-caption">WORKSPACE</span>
            <span className="fp2-side-link active"><Globe2 /> Overview</span>
            <span className="fp2-side-link"><Search /> Search & SEO</span>
            <span className="fp2-side-link"><Activity /> Website health</span>
            <span className="fp2-side-link"><BarChart3 /> Analytics</span>
            <span className="fp2-side-link"><Sparkles /> AI insights</span>
            <span className="fp2-side-link"><FileText /> Reports</span>
            <div className="fp2-side-plan"><span>YOUR WORKSPACE</span><b>6 connected areas</b><small>Review signals in context.</small></div>
          </aside>
          <div className="fp2-dash-main">
            <div className="fp2-dash-title">
              <div><small>MONDAY, 26 OCTOBER</small><h3>Good morning, Maya</h3><p>Here’s what’s happening across your digital presence.</p></div>
              <button type="button" className="fp2-date">Last 30 days <ChevronDown size={13} /></button>
            </div>
            <div className="fp2-stat-grid">
              <div className="fp2-stat"><span>SEARCH VISIBILITY</span><b>68.4 <em>+8.2%</em></b><small>Compared with previous period</small><div className="fp2-sparkline"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
              <div className="fp2-stat"><span>WEBSITE HEALTH</span><b>98.7 <small>/ 100</small></b><small>Core Web Vitals overview</small><div className="fp2-progress"><i /></div></div>
              <div className="fp2-stat"><span>GA4 SESSIONS</span><b>12,846 <em>+4.6%</em></b><small>Across connected properties</small><div className="fp2-mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            </div>
            <div className="fp2-dash-lower">
              <div className="fp2-chart-card">
                <div className="fp2-card-head"><span><b>Visibility over time</b><small>Search and local discovery</small></span><span className="fp2-legend"><i /> Visibility</span></div>
                <div className="fp2-chart">
                  <div className="fp2-chart-labels"><span>80</span><span>60</span><span>40</span><span>20</span></div>
                  <svg viewBox="0 0 520 145" preserveAspectRatio="none" aria-label="Illustrative upward visibility trend">
                    <defs><linearGradient id="fp2ChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4e81ff" stopOpacity=".28" /><stop offset="100%" stopColor="#4e81ff" stopOpacity="0" /></linearGradient></defs>
                    <path className="fp2-chart-area" d="M0 116 C28 104 37 107 58 112 S94 89 115 96 S153 72 174 83 S212 66 232 77 S264 50 289 62 S331 76 352 51 S392 57 413 45 S454 31 475 38 S504 21 520 18 L520 145 L0 145Z" />
                    <path className="fp2-chart-line" d="M0 116 C28 104 37 107 58 112 S94 89 115 96 S153 72 174 83 S212 66 232 77 S264 50 289 62 S331 76 352 51 S392 57 413 45 S454 31 475 38 S504 21 520 18" />
                  </svg>
                  <div className="fp2-chart-dates"><span>OCT 01</span><span>OCT 08</span><span>OCT 15</span><span>OCT 22</span><span>OCT 30</span></div>
                </div>
              </div>
              <div className="fp2-action-card">
                <div className="fp2-card-head"><span><b>Worth a closer look</b><small>Suggested for your review</small></span><span className="fp2-count">03</span></div>
                <div className="fp2-action-item"><span className="fp2-action-icon"><Search /></span><span><b>Service page visibility dipped</b><small>Search · 2 days ago</small></span><ArrowUpRight /></div>
                <div className="fp2-action-item"><span className="fp2-action-icon"><Gauge /></span><span><b>Mobile speed can improve</b><small>Performance · 5 days ago</small></span><ArrowUpRight /></div>
                <div className="fp2-action-foot"><Check size={13} /> Review and decide what happens next</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="fp2-float-note fp2-float-note-ga"><span className="fp2-ga-mark">4A</span><span><b>GA4 analytics</b><small>Connected workspace</small></span></div>
    </motion.div>
  );
}

function LandingV2() {
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useTheme();
  const [technicalIconTarget, setTechnicalIconTarget] = useState<HTMLElement | null>(null);
  const [auditReport, setAuditReport] = useState<PublicAuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditQuota, setAuditQuota] = useState<PublicAuditQuota | null>(null);

  useEffect(() => {
    const heading = Array.from(document.querySelectorAll(".fp2-current-redesign h3")).find(element => element.textContent === "Technical complexity");
    const iconTarget = heading?.parentElement?.parentElement?.querySelector(".lucide-zap")?.parentElement;
    if (iconTarget) {
      iconTarget.classList.add("fp2-technical-icon");
      setTechnicalIconTarget(iconTarget);
    }
    return () => { iconTarget?.classList.remove("fp2-technical-icon"); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public-audit/quota", {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as PublicAuditQuota;
      })
      .then((quota) => {
        if (quota && !controller.signal.aborted) setAuditQuota(quota);
      })
      .catch(() => {
        // The form stays usable when quota status cannot be loaded; the server remains authoritative.
      });
    return () => controller.abort();
  }, []);

  async function runPublicAudit(url: string): Promise<void> {
    setAuditLoading(true);
    setAuditError(null);
    setAuditReport(null);
    trackEvent("public_audit_started", { location: "homepage" });
    try {
      const response = await fetch("/api/public-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json().catch(() => null)) as
        | (Partial<PublicAuditReport> & {
            code?: string;
            message?: string;
            quota?: PublicAuditQuota;
          })
        | null;
      if (!response.ok || !data || !Array.isArray(data.categories)) {
        if (data?.quota && typeof data.quota.remaining === "number") {
          setAuditQuota(data.quota as PublicAuditQuota);
        }
        setAuditError(
          data?.message ?? "The audit could not be completed. Please try again later.",
        );
        trackEvent("public_audit_failed", {
          location: "homepage",
          reason: data?.code ?? "unknown",
        });
        return;
      }

      const report = data as PublicAuditReport;
      setAuditReport(report);
      setAuditQuota(report.quota);
      trackEvent("public_audit_completed", {
        location: "homepage",
        measuredCategories: report.categories.filter(
          (category) => category.score !== null,
        ).length,
        scoreAvailable: report.overallScore !== null,
      });
    } catch {
      setAuditError("The audit could not be completed. Please try again later.");
      trackEvent("public_audit_failed", {
        location: "homepage",
        reason: "network_error",
      });
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("theme")) {
      url.searchParams.delete("theme");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#connected-preview") return;
    const frame = requestAnimationFrame(() => document.getElementById("connected-preview")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="fp2-page fp2-current-redesign" data-theme={theme}>
        <header className="fp2-header">
          <a className="fp2-brand fp2-official-brand" href="#top" aria-label="FlowPoint home">
            <img src="/images/flowpoint-landing-v2/landing-v2-official-mark.svg" alt="" aria-hidden="true" />
            <span>FlowPoint</span>
          </a>
          <div className="fp2-header-tools">
            <span className="fp2-mobile-language"><LanguagePicker /></span>
            <span className="fp2-mobile-theme"><ThemePicker className="fp2-theme-picker" /></span>
            <button className="fp2-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} type="button">
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
          <nav className={`fp2-nav ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation">
            <a href="#top" onClick={() => setMenuOpen(false)}>Home</a>
            <a href="/features" target="_top" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="/pricing" target="_top" onClick={() => setMenuOpen(false)}>Pricing</a>
            <span className="fp2-desktop-language"><LanguagePicker /></span>
            <span className="fp2-desktop-theme"><ThemePicker className="fp2-theme-picker" /></span>
            <div className="fp2-nav-cta-group">
              <a className="fp2-nav-cta" href={signupUrl} target="_blank" rel="noreferrer" onClick={() => trackSignupCta("navigation_desktop")}>
                Start my 14-day trial <ArrowUpRight size={15} />
              </a>
            </div>
          </nav>
        </header>

        <section className="fp2-hero" id="top">
          <div className="fp2-hero-grid" aria-hidden="true" />
          <div className="fp2-wrap">
            <div className="fp2-hero-copy">
              <motion.div className="fp2-hero-text" initial={{ opacity: 1, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65 }}>
                <Eyebrow>Free website health audit</Eyebrow>
                <h1><span className="fp2-title-nowrap">Find what&apos;s</span><br /><em>holding your website back.</em></h1>
                <p>Get a clear report on SEO, performance, accessibility, security and more. No account, email or payment details are needed. For ongoing monitoring and deeper analysis, FlowPoint brings website health and growth tools into one workspace.</p>
                <div className="fp2-hero-actions">
                  <a className="fp2-button" href="#public-audit" onClick={() => trackEvent("public_audit_scroll_clicked", { location: "homepage" })}>Start free audit <ArrowRight size={16} /></a>
                  <a className="fp2-link" href="/pricing" target="_top">Compare plans <ArrowRight size={15} /></a>
                </div>
                <div className="fp2-hero-proof"><span className="fp2-proof-line" /><span><b>Eight clear categories.</b> Real checks where available; “Not measured” where evidence is missing.</span></div>
              </motion.div>
              <PublicAuditWidget
                variant="hero"
                onSubmit={runPublicAudit}
                isLoading={auditLoading}
                report={auditReport}
                error={auditError}
                quotaRemaining={auditQuota?.remaining ?? null}
                onRecommendationClick={() =>
                  trackSignupCta("public_audit_recommendation", {
                    plan: "standard",
                    source: "public_audit",
                  })
                }
              />
            </div>
          </div>
          <div className="fp2-hero-bottom"><span>SEARCH</span><i /><span>WEBSITE HEALTH</span><i /><span>ANALYTICS</span><i /><span>AI WORKFLOWS</span><i /><span>REPORTING</span></div>
        </section>

        <div className="fp2-current-body">
          <Current />
        </div>
        {technicalIconTarget && createPortal(<Workflow aria-label="Connected technical workflows" />, technicalIconTarget)}
      </main>
    </MotionConfig>
  );
}

export default LandingV2;
