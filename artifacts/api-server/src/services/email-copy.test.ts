import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_COPY,
  EMAIL_TEMPLATE_IDS,
  selectEmailCopy,
  type EmailCopyBlock,
  type EmailCopyCatalog,
} from "./email-copy.js";
import { EMAIL_LANGUAGES, resolveEmailLocaleFromSources } from "./email-localization.js";
import {
  formatEmailCurrency,
  formatEmailDate,
  mailer,
  renderEmailForLocale,
} from "./mailer.js";

const SAMPLE_VALUES: Record<string, string> = {
  name: "Taylor",
  plan: "Pro",
  endDate: "14 October 2026",
  daysPhrase: "3 days",
  paymentDetails: "Payment details",
  amountSentence: "Payment received",
  periodSentence: "Next billing",
  planDetails: "Plan details",
  attemptText: " (attempt 2)",
  retryText: "Retry scheduled",
  monitorName: "Example Monitor",
  url: "https://example.test",
  since: "10:30",
  statusCode: " (HTTP 503)",
  durationText: " after 12 minutes",
  reportName: "Quarterly report",
  inviterName: "Alex",
  orgName: "Example Ltd",
  role: "Editor",
  memberName: "Sam",
  missionCount: "2 AI missions",
  siteLabel: "https://example.test",
  missionList: "• Improve titles — High — 12%",
  ruleName: "SEO threshold",
  operatorPhrase: "fell below",
  threshold: "80",
  score: "72",
  cancellationDetails: "Cancellation details",
  activationDetails: "Activation details",
  severity: "High",
  message: "Alert message",
  metricLine: "Value: 72",
  typeLabel: "Type: SEO score",
  alertNote: "Manage alerts in settings",
  expiresMinutes: "15",
  magicLinkUrl: "https://example.test/login?token=abc123&source=email",
};

describe("translated email catalog", () => {
  it("has a complete translation block for all 20 models in all 12 locales", () => {
    expect(EMAIL_TEMPLATE_IDS).toHaveLength(20);
    expect(EMAIL_LANGUAGES).toHaveLength(12);
    for (const language of EMAIL_LANGUAGES) {
      for (const templateId of EMAIL_TEMPLATE_IDS) {
        const selected = selectEmailCopy(language, templateId);
        expect(selected.language, `${language}/${templateId}`).toBe(language);
      }
    }
  });

  it("renders HTML and plain text for all 240 locale/model combinations", () => {
    const ctaUrl = "https://example.test/action?token=abc123&source=email";
    for (const language of EMAIL_LANGUAGES) {
      const locale = resolveEmailLocaleFromSources({ explicitLanguage: language });
      for (const templateId of EMAIL_TEMPLATE_IDS) {
        const rendered = renderEmailForLocale(templateId, locale, SAMPLE_VALUES, ctaUrl);
        expect(rendered.subject, `${language}/${templateId} subject`).toBeTruthy();
        expect(rendered.html, `${language}/${templateId} HTML`).toContain(`lang="${locale.htmlLang}"`);
        expect(rendered.text, `${language}/${templateId} text`).toContain(ctaUrl);
        expect(rendered.html, `${language}/${templateId} placeholders`).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
        expect(rendered.text, `${language}/${templateId} placeholders`).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
      }
    }
  });

  it("falls back to the complete English template when any required key is missing", () => {
    const incomplete = structuredClone(EMAIL_COPY) as EmailCopyCatalog;
    const welcome = incomplete.fr?.templates?.welcome as Partial<EmailCopyBlock>;
    delete welcome.body;

    const selected = selectEmailCopy("fr", "welcome", incomplete);
    expect(selected.language).toBe("en");
    expect(selected.template).toEqual(EMAIL_COPY.en.templates.welcome);
    expect(selected.phrases.footerSupport).toBe(EMAIL_COPY.en.phrases.footerSupport);
  });

  it("falls back to English when a required translated phrase is missing", () => {
    const incomplete = structuredClone(EMAIL_COPY) as EmailCopyCatalog;
    delete incomplete.fr?.phrases?.footerSupport;
    const selected = selectEmailCopy("fr", "welcome", incomplete);

    expect(selected.language).toBe("en");
    expect(selected.template).toEqual(EMAIL_COPY.en.templates.welcome);
    expect(selected.phrases.footerSupport).toBe(EMAIL_COPY.en.phrases.footerSupport);
  });

  it("keeps security URLs intact in text and safely escapes them in HTML", () => {
    const locale = resolveEmailLocaleFromSources({ explicitLanguage: "en" });
    const link = "https://example.test/login?token=abc123&source=email";
    const rendered = renderEmailForLocale("login_link", locale, {
      expiresMinutes: "15",
      magicLinkUrl: link,
    }, link);

    expect(rendered.text).toContain(link);
    expect(rendered.html).toContain('href="https://example.test/login?token=abc123&amp;source=email"');
  });

  it("formats dates and amounts using the selected email locale", () => {
    const french = resolveEmailLocaleFromSources({ explicitLanguage: "fr" });
    const english = resolveEmailLocaleFromSources({ explicitLanguage: "en" });
    expect(formatEmailDate("2026-01-02T12:00:00.000Z", french)).toContain("janvier");
    expect(formatEmailDate("2026-01-02T12:00:00.000Z", english)).toContain("January");
    expect(formatEmailCurrency(1234.5, french)).toContain("1");
    expect(formatEmailCurrency(1234.5, french)).toContain(",");
    expect(formatEmailCurrency(1234.5, english)).toContain(".");
  });

  it("fails closed in tests instead of contacting a live email provider", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_MAIL_DIR", "");
    vi.stubEnv("ENABLE_TEST_MAILER", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PASS", "");
    try {
      const result = await mailer.sendLoginLink({
        to: "recipient@example.test",
        magicLinkUrl: "https://example.test/login?token=fake",
        expiresMinutes: 15,
        country: "Spain",
        lookupByEmail: false,
      });
      expect(result).toEqual({ ok: false, error: "TEST_MAILER_NOT_ENABLED" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
