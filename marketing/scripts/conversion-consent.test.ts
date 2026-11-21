import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  captureMarketingAttribution,
  addFunnelAttributionToSignupLink,
  getFunnelAttribution,
  getFunnelVisitorId,
  sendFunnelEvent,
} from "../client/src/lib/funnel-tracking";
import { trackEvent, trackSignupCta } from "../client/src/lib/analytics";
import { TrialDisclosure } from "../client/src/components/TrialDisclosure";
import {
  PRICING_TRIAL_FAQ_ANSWER_FR,
  PRICING_FAQS,
  getPricingFaqs,
} from "../shared/structured-data-content";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalFetch = globalThis.fetch;

function installWindow(
  consent: string | null,
  pageUrl = "https://flowpoint.pro/",
  language = "en",
) {
  const values = new Map<string, string>([["cookie_consent", consent]]);
  if (!consent) values.delete("cookie_consent");
  const sessionValues = new Map<string, string>();
  const analyticsEvents: Array<{ name: string; data?: Record<string, unknown> }> = [];
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const sessionStorage = {
    getItem: (key: string) => sessionValues.get(key) ?? null,
    setItem: (key: string, value: string) => sessionValues.set(key, value),
    removeItem: (key: string) => sessionValues.delete(key),
  };
  const parsedUrl = new URL(pageUrl);
  const documentState = {
    cookie: "",
    referrer: "",
    documentElement: { lang: language, dataset: { language } },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      sessionStorage,
      location: {
        search: parsedUrl.search,
        origin: parsedUrl.origin,
        hostname: parsedUrl.hostname,
        protocol: parsedUrl.protocol,
        href: parsedUrl.href,
      },
      umami: {
        track: (name: string, data?: Record<string, unknown>) =>
          analyticsEvents.push({ name, data }),
      },
    } as unknown as Window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentState as unknown as Document,
  });

  return { values, sessionValues, analyticsEvents };
}

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
  if (originalDocument) {
    Object.defineProperty(globalThis, "document", originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
  globalThis.fetch = originalFetch;
});

test("refusal sends no funnel or Umami event and creates no visitor ID", () => {
  const { values, analyticsEvents } = installWindow("refused");
  const fetchCalls: unknown[] = [];
  globalThis.fetch = ((...args: unknown[]) => {
    fetchCalls.push(args);
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  const signupLink = {
    href: "https://app.flowpoint.pro/signin.html",
  } as HTMLAnchorElement;

  trackEvent("cta_clique");
  trackSignupCta("home_hero");
  sendFunnelEvent("landing_vue");
  addFunnelAttributionToSignupLink(signupLink);

  assert.deepEqual(analyticsEvents, []);
  assert.deepEqual(fetchCalls, []);
  assert.equal(signupLink.href, "https://app.flowpoint.pro/signin.html?lang=en");
  assert.equal(getFunnelVisitorId(), null);
  assert.deepEqual(getFunnelAttribution(), {});
  assert.deepEqual([...values.keys()], ["cookie_consent"]);
});

test("marketing attribution is validated and preserved without adding a visitor ID", () => {
  const fpLid = "Abcdefghijklmnopqrst12";
  assert.equal(fpLid.length, 22);
  installWindow(
    null,
    `https://flowpoint.pro/?fp_lid=${fpLid}&utm_source=Google&utm_medium=cpc&utm_campaign=Launch_1&fp_source=social&fp_ref=Seller%2F4&utm_term=ignored`,
  );
  captureMarketingAttribution();
  const signupLink = {
    href: "https://app.flowpoint.pro/signin.html?plan=pro",
  } as HTMLAnchorElement;

  addFunnelAttributionToSignupLink(signupLink);

  const url = new URL(signupLink.href);
  assert.equal(url.origin, "https://app.flowpoint.pro");
  assert.equal(url.searchParams.get("plan"), "pro");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(url.searchParams.get("fp_lid"), fpLid);
  assert.equal(url.searchParams.get("utm_source"), "google");
  assert.equal(url.searchParams.get("utm_medium"), "cpc");
  assert.equal(url.searchParams.get("utm_campaign"), "launch_1");
  assert.equal(url.searchParams.get("fp_source"), "social");
  assert.equal(url.searchParams.get("fp_ref"), "Seller/4");
  assert.equal(url.searchParams.has("utm_term"), false);
  assert.equal(url.searchParams.has("fp_vid"), false);
});

test("invalid acquisition values are dropped and non-supported languages omit lang", () => {
  installWindow(
    null,
    "https://flowpoint.pro/?fp_lid=short&utm_source=Campaign%20Name&utm_medium=Valid_1&fp_source=unknown",
    "zz",
  );
  captureMarketingAttribution();
  const signupLink = {
    href: "https://app.flowpoint.pro/signin.html",
  } as HTMLAnchorElement;

  addFunnelAttributionToSignupLink(signupLink);

  const url = new URL(signupLink.href);
  assert.equal(url.searchParams.has("lang"), false);
  assert.equal(url.searchParams.has("fp_lid"), false);
  assert.equal(url.searchParams.has("utm_source"), false);
  assert.equal(url.searchParams.get("utm_medium"), "valid_1");
  assert.equal(url.searchParams.has("fp_source"), false);
});

test("accepted consent enables the existing Umami event wrapper", () => {
  const { analyticsEvents, values } = installWindow("accepted");

  trackSignupCta("pricing_plan", { plan: "pro" });
  const visitorId = getFunnelVisitorId();

  assert.deepEqual(analyticsEvents, [
    {
      name: "signup_cta_clicked",
      data: { plan: "pro", location: "pricing_plan" },
    },
  ]);
  assert.ok(visitorId);
  assert.equal(values.get("flowpoint_funnel_visitor"), visitorId);
  assert.match(visitorId || "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("public-audit analytics stay consent-gated and contain only bounded dimensions", () => {
  const safeAuditEvents = [
    ["public_audit_started", { location: "homepage" }],
    ["public_audit_completed", {
      location: "homepage",
      measuredCategories: 8,
      scoreAvailable: true,
    }],
    ["public_audit_failed", { location: "homepage", reason: "network_error" }],
  ] as const;
  const refused = installWindow("refused");

  for (const [name, data] of safeAuditEvents) trackEvent(name, data);
  assert.deepEqual(refused.analyticsEvents, []);

  const accepted = installWindow("accepted");
  for (const [name, data] of safeAuditEvents) trackEvent(name, data);
  assert.deepEqual(
    accepted.analyticsEvents.map((event) => event.name),
    safeAuditEvents.map(([name]) => name),
  );
  for (const event of accepted.analyticsEvents) {
    const serialized = JSON.stringify(event);
    assert.doesNotMatch(serialized, /https?:|(?:\d{1,3}\.){3}\d{1,3}|@|query-canary/);
    assert.ok(
      Object.keys(event.data ?? {}).every((key) =>
        ["location", "measuredCategories", "scoreAvailable", "reason"].includes(key),
      ),
    );
  }
});

test("funnel events are limited to the two allowed steps and deduplicated daily", async () => {
  installWindow("accepted", "https://flowpoint.pro/?utm_source=Google&utm_medium=organic");
  captureMarketingAttribution();
  const fetchCalls: Array<{ url: string; options: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), options: init || {} });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  sendFunnelEvent("landing_vue");
  sendFunnelEvent("landing_vue");
  sendFunnelEvent("cta_clique");

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls.every((call) =>
    call.url === "https://app.flowpoint.pro/api/public/funnel-event"
      && call.options.credentials === "include",
  ));
  const payload = JSON.parse(String(fetchCalls[0].options.body));
  assert.equal(payload.etape, "landing_vue");
  assert.equal(payload.source, "google");
  assert.equal(payload.utm_source, "google");
  assert.equal(payload.utm_medium, "organic");
  assert.equal("fp_lid" in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), [
    "etape", "source", "utm_medium", "utm_source", "visiteurId",
  ]);
});

test("trial disclosure states the card requirement and links to pricing", () => {
  const withPricing = renderToStaticMarkup(createElement(TrialDisclosure));
  const withoutPricing = renderToStaticMarkup(
    createElement(TrialDisclosure, { showPricingLink: false }),
  );

  assert.match(
    withPricing,
    /Card required · billed automatically after 14 days unless cancelled/,
  );
  assert.match(withPricing, /href="\/pricing"[^>]*>View pricing<\/a>/);
  assert.doesNotMatch(withoutPricing, />View pricing<\/a>/);
});

test("pricing trial FAQ contains the exact English and French disclosures", () => {
  const enTrialFaq = PRICING_FAQS.find((faq) => faq.question === "What happens after the 14-day trial?");
  const frTrialFaq = getPricingFaqs("fr").find((faq) => faq.question === "What happens after the 14-day trial?");

  assert.equal(
    enTrialFaq?.answer,
    "All plans include a free 14-day trial with full access. You choose your plan before you start, and a credit card is required at sign-up. Nothing is charged during the trial. When the 14 days end, your subscription to the chosen plan starts and your card is charged automatically, unless you cancel before that date. You can cancel at any time before the trial ends, at no cost.",
  );
  assert.equal(frTrialFaq?.answer, PRICING_TRIAL_FAQ_ANSWER_FR);
});
