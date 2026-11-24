import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FREE_SEO_AUDIT_FAQS,
  buildFaqPageJsonLd,
} from "@shared/structured-data-content";
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Gauge,
  Link2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const PAGE_TITLE = "Free Website SEO Audit, One Page at a Time | FlowPoint";

const checks = [
  {
    icon: FileSearch,
    title: "Page-level SEO signals",
    description:
      "Review the page title, meta description, canonical, indexing directives, H1 count, and structured-data syntax.",
  },
  {
    icon: Gauge,
    title: "Basic technical responses",
    description:
      "See selected response, page-size, and security-header signals, plus robots.txt and sitemap availability.",
  },
  {
    icon: Link2,
    title: "A limited site sample",
    description:
      "Check a small sample of same-site links and assets without crawling every URL on the site.",
  },
];

const notMeasured = [
  "Core Web Vitals such as LCP, CLS, and INP",
  "Search rankings, impressions, clicks, or website traffic",
  "A complete site crawl or a browser-based visual review",
  "Application vulnerability scans or penetration tests",
];

const steps = [
  {
    number: "01",
    title: "Submit one public URL",
    description:
      "Choose the page you want to check. The audit is scoped to that URL, not your whole site.",
  },
  {
    number: "02",
    title: "Review collected signals",
    description:
      "The report summarizes page-level checks and a limited sample of related links and assets.",
  },
  {
    number: "03",
    title: "Verify before acting",
    description:
      "Use findings as starting points, then confirm them against the pages and data that matter to your site.",
  },
];

export default function FreeSeoAudit() {
  usePageTitle(PAGE_TITLE);
  useJsonLd(buildFaqPageJsonLd(FREE_SEO_AUDIT_FAQS));

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />
      <main>
        <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-28">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
            <div>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <CheckCircle2 className="h-4 w-4" />
                Free one-page check
              </span>
              <h1 className="mb-6 max-w-3xl font-display text-4xl font-bold text-slate-900 dark:text-slate-100 sm:text-5xl lg:text-6xl">
                Get a free SEO audit of one web page
              </h1>
              <p className="mb-8 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300 sm:text-xl">
                Check page-level SEO and technical signals with a free report.
                No account is required, and the audit explains what it does
                and does not measure.
              </p>
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <Button
                  asChild
                  size="lg"
                  className="bg-blue-600 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30"
                >
                  <a href="/#public-audit">
                    Run a free audit
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <a
                  href="#what-it-checks"
                  className="font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-4 dark:text-blue-300"
                >
                  See what the audit checks
                </a>
              </div>
              <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">
                One page per check · No signup · Fair-use limits apply
              </p>
            </div>

            <Card className="border-blue-100 bg-white/90 shadow-xl shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900/90">
              <CardHeader>
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                  <FileSearch className="h-6 w-6 text-blue-600 dark:text-blue-300" />
                </div>
                <CardTitle asChild className="text-xl text-slate-900 dark:text-slate-100">
                  <h2>A focused first look</h2>
                </CardTitle>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  A clear scope helps you understand what each finding means.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-4">
                  {[
                    "The URL you submit",
                    "A small sample of same-site links and assets",
                    "Checks and limitations explained in the report",
                  ].map((item) => (
                    <li key={item} className="flex gap-3 text-sm text-slate-700 dark:text-slate-200">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
                  <p>
                    This is not a full-site crawl, ranking report, or security
                    vulnerability scan.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="what-it-checks" className="scroll-mt-24 bg-white py-20 dark:bg-slate-900">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                What the free audit checks
              </p>
              <h2 className="mb-4 font-display text-3xl font-bold text-slate-900 dark:text-slate-100 sm:text-4xl">
                A page-level check with clear boundaries
              </h2>
              <p className="text-lg text-slate-600 dark:text-slate-300">
                The report gathers practical signals from one public page and a
                limited sample. It is a useful starting point, not a substitute
                for a complete technical or content audit.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {checks.map((check) => (
                <Card key={check.title} className="h-full border-slate-200 dark:border-slate-700">
                  <CardHeader>
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                      <check.icon className="h-6 w-6 text-blue-600 dark:text-blue-300" />
                    </div>
                    <CardTitle asChild className="text-lg text-slate-900 dark:text-slate-100">
                      <h3>{check.title}</h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {check.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-20 dark:bg-slate-800/40">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                Know what is outside the scope
              </p>
              <h2 className="mb-4 font-display text-3xl font-bold text-slate-900 dark:text-slate-100">
                What this free SEO checker does not measure
              </h2>
              <p className="mb-7 text-slate-600 dark:text-slate-300">
                Some SEO questions require other tools and data. The free audit
                does not claim to provide those measurements.
              </p>
              <ul className="space-y-4">
                {notMeasured.map((item) => (
                  <li key={item} className="flex gap-3 text-slate-700 dark:text-slate-200">
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="mb-6 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                How to use your results
              </h3>
              <ol className="space-y-6">
                {steps.map((step) => (
                  <li key={step.number} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      {step.number}
                    </span>
                    <div>
                      <h4 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">
                        {step.title}
                      </h4>
                      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 dark:bg-slate-900">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-10 text-center font-display text-3xl font-bold text-slate-900 dark:text-slate-100">
              Free SEO audit questions
            </h2>
            <Accordion type="single" collapsible className="w-full">
              {FREE_SEO_AUDIT_FAQS.map((faq, index) => (
                <AccordionItem key={faq.question} value={`faq-${index}`}>
                  <AccordionTrigger className="text-left font-display font-semibold text-slate-900 dark:text-slate-100">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent
                    forceMount
                    className="leading-relaxed text-slate-600 dark:text-slate-300"
                  >
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="bg-blue-50 py-16 dark:bg-slate-950">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="mb-4 font-display text-3xl font-bold text-slate-900 dark:text-slate-100">
              Start with one page
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-slate-600 dark:text-slate-300">
              Run a free check, then explore our{" "}
              <a className="font-medium text-blue-700 underline underline-offset-4 dark:text-blue-300" href="/resources/technical-seo-audit-checklist">
                technical SEO audit checklist
              </a>{" "}
              or learn how FlowPoint supports ongoing SEO analysis on the{" "}
              <a className="font-medium text-blue-700 underline underline-offset-4 dark:text-blue-300" href="/seo-audit">
                SEO audit software page
              </a>
              .
            </p>
            <Button asChild size="lg" className="bg-blue-600 text-white">
              <a href="/#public-audit">
                Run a free audit
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
      <SupportChat />
    </div>
  );
}
