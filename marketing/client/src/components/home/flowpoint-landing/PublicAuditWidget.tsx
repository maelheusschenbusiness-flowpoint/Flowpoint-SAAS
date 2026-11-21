import { useId, useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Globe2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import type {
  PublicAuditCategory,
  PublicAuditCheck,
  PublicAuditReport,
} from "@shared/public-audit";
import "./PublicAuditWidget.css";

export type { PublicAuditCheck, PublicAuditCategory, PublicAuditReport };

export type PublicAuditWidgetProps = {
  variant?: "default" | "hero";
  onSubmit: (url: string) => Promise<void>;
  isLoading: boolean;
  report: PublicAuditReport | null;
  error: string | null;
  quotaRemaining: number | null;
  onRecommendationClick?: () => void;
};

const REPORT_CATEGORIES = [
  { key: "seo", title: "SEO" },
  { key: "performance", title: "Performance" },
  { key: "accessibility", title: "Accessibility" },
  { key: "security", title: "Security & Trust" },
  { key: "mobile", title: "Mobile Experience" },
  { key: "conversion", title: "Conversion & UX" },
  { key: "technical", title: "Technical Health" },
  { key: "content", title: "Content Quality" },
] as const;

const statusLabels: Record<PublicAuditCheck["status"], string> = {
  passed: "Passed",
  failed: "Needs attention",
  warning: "Review",
  not_measured: "Not measured",
};

const difficultyLabels = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Advanced",
} as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function getCategoryStatus(category?: PublicAuditCategory) {
  if (!category || category.status === "not_measured") return "Not measured";
  if (category.status === "partial") return "Partially measured";
  return "Measured";
}

function getScoreLabel(score: number | null): string {
  return score === null ? "Not measured" : `${score} / 100`;
}

export default function PublicAuditWidget({
  variant = "default",
  onSubmit,
  isLoading,
  report,
  error,
  quotaRemaining,
  onRecommendationClick,
}: PublicAuditWidgetProps) {
  const inputId = useId();
  const errorId = useId();
  const privacyId = useId();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const exhausted = quotaRemaining !== null && quotaRemaining <= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading || exhausted) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    let normalized: string;
    try {
      const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      const parsed = new URL(candidate);
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) {
        throw new Error("Enter a complete public website address.");
      }
      normalized = parsed.toString();
      if (normalized.length > 2048) {
        throw new Error("That website address is too long.");
      }
    } catch (validationError) {
      setUrlError(validationError instanceof Error ? validationError.message : "Enter a valid website address.");
      return;
    }
    setUrlError("");
    try {
      await onSubmit(normalized);
    } catch (submitError) {
      setUrlError(submitError instanceof Error ? submitError.message : "The audit could not be completed. Please try again.");
    }
  }

  const displayCategories = REPORT_CATEGORIES.map((item) => {
    const category = report?.categories.find((candidate) => candidate.key === item.key);
    return {
      key: item.key,
      title: item.title,
      category,
    };
  });

  return (
    <section
      id="public-audit"
      className={`fp-audit${variant === "hero" ? " fp-audit--hero" : ""}`}
      aria-label={variant === "hero" ? "Free website audit" : undefined}
      aria-labelledby={variant === "default" ? "fp-audit-title" : undefined}
    >
      <div className="fp-audit__intro">
        <span className="fp-audit__eyebrow"><span /> FREE WEBSITE CHECK</span>
        <h2 id="fp-audit-title">A clearer picture of your website.</h2>
        <p>Run a quick public audit and see what is working, what needs a closer look, and what has not been measured.</p>
        <div className="fp-audit__trust">
          <span><LockKeyhole size={14} /> No account needed</span>
          <span><ShieldCheck size={14} /> URL, cookie &amp; IP-based quota</span>
          <span><Clock3 size={14} /> Results in one report</span>
        </div>
      </div>

      <div className="fp-audit__panel">
        <form className="fp-audit__form" onSubmit={handleSubmit}>
          <label htmlFor={inputId}>Website address</label>
          <div className="fp-audit__input-row">
            <div className="fp-audit__input-wrap">
              <Globe2 aria-hidden="true" size={17} />
              <input
                id={inputId}
                type="text"
                inputMode="url"
                autoComplete="url"
                maxLength={2048}
                placeholder="yourbusiness.com"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError("");
                }}
                aria-describedby={`${privacyId}${error || urlError ? ` ${errorId}` : ""}`}
                required
              />
            </div>
            <button type="submit" disabled={isLoading || exhausted || !url.trim()}>
              {isLoading ? "Checking…" : exhausted ? "Quota reached" : "Run free audit"}
              {!isLoading && !exhausted && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
          <p className="fp-audit__form-note">We check this public page and a small sample of same-site files and links. Query strings are ignored.</p>
          <p className="fp-audit__form-note fp-audit__privacy-note" id={privacyId}>
            Your page URL is used for the check but is not saved in quota records. A signed visitor cookie lasts 48 hours. We store a protected key based on your IP, not your raw IP. Quota records expire at 00:00 UTC two days after the quota date. Pilot limits are 3 audits per visitor, 5 per shared public IP and 10 total per UTC day. People sharing an IP share its 5-audit limit.
          </p>
          {exhausted ? (
            <p className="fp-audit__quota is-exhausted" aria-live="polite">
              You&apos;ve used your 3 free audits for this UTC day. Need more analyses?{" "}
              <a href="/pricing">Explore FlowPoint plans.</a>
            </p>
          ) : (
            <p className="fp-audit__quota" aria-live="polite">
              {quotaRemaining !== null && quotaRemaining < 3
                ? `${quotaRemaining} free ${quotaRemaining === 1 ? "audit" : "audits"} remaining this UTC day · No signup required · No credit card`
                : "3 free audits per visitor per UTC day · No signup required · No credit card"}
            </p>
          )}
          {(error || urlError) && (
            <div className="fp-audit__message fp-audit__message--error" id={errorId} role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <span>{urlError || error}</span>
            </div>
          )}
        </form>

        {isLoading && (
          <div className="fp-audit__loading" role="status" aria-live="polite">
            <div className="fp-audit__loading-top">
              <span className="fp-audit__pulse" />
              <span><strong>Checking your website</strong><small>This can take a little while. Keep this page open.</small></span>
            </div>
            <div className="fp-audit__skeleton-line" />
            <div className="fp-audit__skeleton-grid"><i /><i /><i /><i /></div>
          </div>
        )}

        {!isLoading && report && (
          <div className="fp-audit__report" aria-live="polite">
            <header className="fp-audit__report-head">
              <div>
                <span className="fp-audit__eyebrow">AUDIT REPORT</span>
                <h3>{report.finalUrl || report.url}</h3>
                <p>Checked {formatDate(report.checkedAt)}</p>
              </div>
              <div className={`fp-audit__score ${report.overallScore === null ? "is-unmeasured" : ""}`}>
                <span>OVERALL</span>
                <strong>{getScoreLabel(report.overallScore)}</strong>
              </div>
            </header>

            <div className="fp-audit__section-label">
              <h4>Website health</h4>
              <span>8 areas reviewed</span>
            </div>
            <div className="fp-audit__category-list">
              {displayCategories.map(({ key, title, category }) => (
                <section className="fp-audit__category" key={key}>
                  <div className="fp-audit__category-head">
                    <div>
                      <h5>{category?.title || title}</h5>
                      <span className={`fp-audit__measure fp-audit__measure--${category?.status ?? "not_measured"}`}>
                        {getCategoryStatus(category)}
                      </span>
                    </div>
                    <strong>{getScoreLabel(category?.status === "not_measured" ? null : category?.score ?? null)}</strong>
                  </div>
                  {category?.summary && <p className="fp-audit__category-summary">{category.summary}</p>}
                  {category?.checks.length ? (
                    <div className="fp-audit__checks">
                      {category.checks.map((check) => (
                        <details className="fp-audit__check" key={check.id}>
                          <summary>
                            <span className={`fp-audit__status-icon fp-audit__status-icon--${check.status}`} aria-hidden="true">
                              {check.status === "passed" ? <Check size={13} /> : check.status === "not_measured" ? <span>—</span> : <CircleAlert size={13} />}
                            </span>
                            <span className="fp-audit__check-title">{check.title}</span>
                            <span className={`fp-audit__check-status fp-audit__check-status--${check.status}`}>{statusLabels[check.status]}</span>
                            <ArrowDownRight className="fp-audit__disclosure" size={15} aria-hidden="true" />
                          </summary>
                          <div className="fp-audit__check-body">
                            <p>{check.explanation}</p>
                            {check.evidence && <div><b>Evidence</b><p>{check.evidence}</p></div>}
                            {check.impact && <div><b>Why it matters</b><p>{check.impact}</p></div>}
                            {check.recommendation && <div><b>Suggested next step</b><p>{check.recommendation}</p></div>}
                            <div className="fp-audit__check-meta">
                              <span>Severity: {check.severity}</span>
                              {check.difficulty && <span>Effort: {difficultyLabels[check.difficulty]}</span>}
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="fp-audit__not-measured">
                      {category?.status === "not_measured" || !category
                        ? "This area was not measured in this audit."
                        : "No individual checks were returned for this area."}
                    </p>
                  )}
                </section>
              ))}
            </div>

            {report.actionPlan.length > 0 && (
              <section className="fp-audit__actions" aria-labelledby="fp-audit-actions">
                <div className="fp-audit__section-label">
                  <h4 id="fp-audit-actions">Suggested priorities</h4>
                  <span>Based on this audit</span>
                </div>
                <ol>
                  {report.actionPlan.map((action, index) => (
                    <li key={`${action.title}-${index}`}>
                      <span className="fp-audit__action-index">{String(index + 1).padStart(2, "0")}</span>
                      <div><h5>{action.title}</h5><p>{action.reason}</p><small>{action.category}{action.difficulty ? ` · ${difficultyLabels[action.difficulty]} effort` : ""}</small></div>
                      <span className="fp-audit__impact">{action.impact}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <aside className="fp-audit__recommendation">
              <div className="fp-audit__recommendation-copy">
                <span className="fp-audit__eyebrow">A WAY TO KEEP GOING</span>
                <h4>{report.recommendation.plan} may fit your needs</h4>
                <p>{report.recommendation.reason}</p>
                <small>{formatPrice(report.recommendation.priceEur)} / month</small>
              </div>
              <a
                href={report.recommendation.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onRecommendationClick}
              >
                Explore {report.recommendation.plan} <ExternalLink size={15} aria-hidden="true" />
              </a>
            </aside>
            <p className="fp-audit__report-foot"><ShieldCheck size={14} /> This report reflects the checks available at the time shown. PageSpeed Insights was not queried; Core Web Vitals are marked Not measured.</p>
          </div>
        )}
      </div>
    </section>
  );
}
