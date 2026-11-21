import { usePageTitle } from "@/hooks/use-page-title";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import {
  Shield, FileText, ShoppingCart, Lock, Cookie, Gift, RefreshCw, Bot, Database, Mail,
  ChevronUp, ChevronRight, Activity, Code, Zap, Scale, Settings, Sliders
} from "lucide-react";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const sections = [
  { id: "mentions-legales", label: "Legal notice", icon: FileText },
  { id: "cgu", label: "Terms of service", icon: Shield },
  { id: "cgv", label: "Terms of sale", icon: ShoppingCart },
  { id: "confidentialite", label: "Privacy", icon: Lock },
  { id: "cookies", label: "Cookies", icon: Cookie },
  { id: "essai-gratuit", label: "Free trial", icon: Gift },
  { id: "remboursement", label: "Refund policy", icon: RefreshCw },
  { id: "politique-ia", label: "AI policy", icon: Bot },
  { id: "dpa", label: "DPA", icon: Database },
  { id: "sla", label: "SLA", icon: Activity },
  { id: "api-policy", label: "API", icon: Code },
  { id: "donnees", label: "Data", icon: Sliders },
  { id: "force-majeure", label: "Force majeure", icon: Zap },
  { id: "droit-applicable", label: "Governing law", icon: Scale },
  { id: "evolution-service", label: "Service changes & fair use", icon: Settings },
  { id: "services-tiers", label: "Third-party services", icon: Zap },
  { id: "modification-conditions", label: "Changes to terms", icon: Settings },
  { id: "contact-juridique", label: "Legal contact", icon: Mail },
];

function SectionCard({ id, icon: Icon, title, children }: {
  id: string; icon: any; title: string; children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-blue-600" />
        </div>
        <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-8 space-y-5 text-slate-600 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
        <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0" />
        {title}
      </h3>
      <div className="pl-6 text-sm space-y-1">{children}</div>
    </div>
  );
}

export default function LegalInfo() {
  usePageTitle("Legal information | FlowPoint");
  const [activeSection, setActiveSection] = useState("mentions-legales");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
      const offsets = sections.map(s => {
        const el = document.getElementById(s.id);
        return { id: s.id, top: el ? el.getBoundingClientRect().top : Infinity };
      });
      const visible = offsets.filter(o => o.top <= 120);
      if (visible.length > 0) setActiveSection(visible[visible.length - 1].id);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const btn = btnRefs.current[activeSection];
    const container = navScrollRef.current;
    if (!btn || !container) return;
    const btnLeft = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;
    const containerWidth = container.offsetWidth;
    const scrollTarget = btnLeft - containerWidth / 2 + btnWidth / 2;
    container.scrollTo({ left: scrollTarget, behavior: "smooth" });
  }, [activeSection]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation language="en" />

      {/* Hero */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-6">
              <Shield className="h-4 w-4" />
              Transparency & compliance
            </span>
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">
              Legal information
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              FlowPoint's legal information, terms of service and policies in one place.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {/* Sticky section navigation */}
        <div className="sticky top-20 z-40 -mx-4 sm:-mx-6 lg:-mx-8 mb-12">
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 shadow-sm">
            <div ref={navScrollRef} className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="flex gap-1 py-2 px-4 sm:px-6 lg:px-8 min-w-max">
                {sections.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      ref={el => { btnRefs.current[s.id] = el; }}
                      onClick={() => scrollTo(s.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                        activeSection === s.id
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Icon className="h-3 w-3 flex-shrink-0" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-12">

          {/* 1. Legal notice */}
          <SectionCard id="mentions-legales" icon={FileText} title="Legal notice">
            <SubSection title="Website publisher">
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Company name:</span> FlowPoint</p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Operator:</span> Heusschen Maël</p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Company number:</span> BE1038.273.845</p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Email :</span>{" "}
                <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>
              </p>
              <p><span className="font-medium text-slate-800 dark:text-slate-200">Website:</span>{" "}
                <a href="https://flowpoint.pro" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">https://flowpoint.pro</a>
              </p>
            </SubSection>
            <SubSection title="Infrastructure">
              <p>The FlowPoint application is hosted by Render. The database is hosted by MongoDB Atlas. These providers process data needed to operate the service under the terms and safeguards applicable to their services.</p>
            </SubSection>
            <SubSection title="Intellectual property">
              <p>All content on this website (including software, interfaces, databases, text, illustrations, logos, graphics and other materials) is the exclusive property of FlowPoint and is protected by Belgian and international copyright law. Reproduction in whole or in part is prohibited without prior written permission.</p>
            </SubSection>
          </SectionCard>

          {/* 2. Terms of service */}
          <SectionCard id="cgu" icon={Shield} title="Terms of service">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Last updated: October 24, 2026</p>
            <SubSection title="Access to the platform">
              <p>Access to FlowPoint is intended for professionals and businesses seeking to improve their online visibility. Users must be at least 18 years old and have the legal capacity to enter into an agreement.</p>
            </SubSection>
            <SubSection title="Account creation">
              <p>Registration requires accurate and complete information. Users are responsible for keeping their login credentials confidential and for all activity under their account.</p>
            </SubSection>
            <SubSection title="Newsletter subscription">
              <p>When creating an account, users are automatically subscribed to the FlowPoint newsletter and agree to receive product news, tips, offers and service information by email. Users can unsubscribe at any time using the link in each newsletter or by contacting <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>.</p>
            </SubSection>
            <SubSection title="User responsibilities">
              <p>Users agree to use the platform in accordance with applicable law, not to bypass security mechanisms and not to use the service for illegal, fraudulent or abusive purposes.</p>
            </SubSection>
            <SubSection title="Suspension and termination">
              <p>FlowPoint may suspend or terminate an account if these terms are violated. In cases of serious breach, this may occur without notice or refund.</p>
            </SubSection>
            <SubSection title="Abuse">
              <p>Attempts to abuse the service (including bypassing quotas, creating multiple fraudulent accounts or large-scale scraping) may result in immediate account termination and legal action.</p>
            </SubSection>
            <SubSection title="Service availability">
              <p>FlowPoint aims to keep the service highly available but cannot guarantee uninterrupted availability. Planned or unplanned maintenance may occur. FlowPoint is not liable for interruptions.</p>
            </SubSection>
            <SubSection title="Limitation of liability">
              <p>To the extent permitted by applicable law, FlowPoint is not liable for indirect damages or loss of profits or data resulting from use of, or inability to use, the service.</p>
              <p className="mt-1">In all cases, FlowPoint's total liability will not exceed the amount paid by the user during the 12 months before the event giving rise to the claim.</p>
            </SubSection>
            <SubSection title="SEO results">
              <p>FlowPoint provides analysis, recommendations and optimization tools but does not guarantee any specific search ranking, increase in traffic or business result. SEO performance depends on many external factors outside FlowPoint's control. FlowPoint's recommendations support decision-making and do not replace the user's professional expertise or judgment.</p>
            </SubSection>
          </SectionCard>

          {/* 3. Terms of sale */}
          <SectionCard id="cgv" icon={ShoppingCart} title="Terms of sale">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Last updated: October 24, 2026</p>
            <SubSection title="Subscriptions">
              <p>FlowPoint offers three paid plans (Standard, Pro and Ultra) with different feature sets, available by monthly subscription. New accounts are eligible for a 14-day free trial.</p>
            </SubSection>
            <SubSection title="Payment terms">
              <p>Payments are processed by Stripe. FlowPoint does not store payment card details. Prices are shown in euros, including VAT. FlowPoint may change its prices with 30 days' notice.</p>
            </SubSection>
            <SubSection title="Automatic renewal">
              <p>Subscriptions renew automatically each month unless the user cancels before the renewal date.</p>
            </SubSection>
            <SubSection title="Failed payments">
              <p>If a payment fails, several automatic retry attempts will be made. If they are unsuccessful, access to the service will be suspended until payment is resolved.</p>
            </SubSection>
            <SubSection title="Account suspension">
              <p>An account may be suspended for non-payment. Data is retained for 90 days after suspension or termination before permanent deletion.</p>
            </SubSection>
            <SubSection title="Cancellation">
              <p>Users can cancel their subscription at any time from their account. Cancellation takes effect at the end of the current billing period. No prorated refund will be issued.</p>
            </SubSection>
            <SubSection title="Invoicing">
              <p>An electronic invoice is generated automatically for each renewal and sent to the email address associated with the account. Invoices can be downloaded from the account.</p>
            </SubSection>
            <SubSection title="Add-ons">
              <p>Add-ons are billed separately from the main subscription. Some may be charged immediately and activated once payment is confirmed. Recurring add-ons renew automatically until the user cancels them.</p>
            </SubSection>
            <SubSection title="VAT">
              <p>VAT is applied in accordance with applicable regulations and may vary based on the customer's billing country and tax status. VAT-registered businesses in the EU may provide a valid VAT number to request VAT-exempt invoicing, subject to validation.</p>
            </SubSection>
          </SectionCard>

          {/* 4. Privacy */}
          <SectionCard id="confidentialite" icon={Lock} title="Privacy policy (GDPR)">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Last updated: November 19, 2026 — Under Regulation (EU) 2016/679</p>
            <SubSection title="Data we collect">
              <p>We collect the following information: first and last name, business email address, company name, billing data, IP address, platform usage data and account preferences.</p>
              <p>For the free public website audit, we use the public-page address you submit to fetch the page and generate its report. Query strings and fragments are removed before fetching. The address is not stored in the audit quota tables or application route logs; infrastructure and proxy log retention must be confirmed with the providers. To enforce quotas, the site sets a signed, pseudonymous visitor cookie for 48 hours and stores HMAC-derived keys for that visitor and the normalized exact IP address in PostgreSQL, not the raw IP address. People sharing a public IP share the same per-IP limit. Each quota row is assigned an expiry at 00:00 UTC two days after its quota date, approximately 24–48 hours after the audit. When the service starts enabled, cleanup runs at startup, hourly and during reservations; actual deletion can be later if cleanup fails.</p>
              <p>For the pilot, the configurable limits are three audits per visitor per UTC day, five per exact public IP per UTC day, ten audits total per UTC day, and two audits at a time. These are pilot limits, not a promise of commercial capacity.</p>
            </SubSection>
            <SubSection title="How we use data">
              <p>Your data is used to provide the service, process payments, send account communications and the FlowPoint newsletter, improve the platform and keep the service secure. We do not sell your data to third parties.</p>
            </SubSection>
            <SubSection title="Google User Data Sharing and Disclosure">
              <p>FlowPoint only accesses Google user data after you have explicitly authorized access through Google's OAuth consent flow. Google user data is used exclusively to provide the FlowPoint features you request, including SEO dashboards, Analytics reporting, Search Console insights, Google Business Profile management, automated reports, monitoring, and recommendations.</p>
              <p>Google user data is never sold, never shared with advertisers, and never used to train artificial intelligence or machine learning models. FlowPoint does not disclose Google user data to third parties except when strictly necessary to operate and provide the requested service, or when disclosure is required by law.</p>
              <p>When strictly necessary to operate the service, the following categories of service providers may process the minimum information required to perform their services on behalf of FlowPoint:</p>
              <ul className="mt-2 space-y-1 list-none">
                {[
                  "Google Cloud for OAuth authentication and Google API access",
                  "MongoDB Atlas for database hosting",
                  "Render for application hosting",
                  "Stripe for billing and payment processing only",
                  "Resend for transactional emails",
                  "OpenAI for providing artificial intelligence features and generating analyses, recommendations, and other AI-assisted content requested through FlowPoint",
                  "Other infrastructure providers strictly required for service operation",
                ].map((provider) => (
                  <li key={provider} className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    {provider}
                  </li>
                ))}
              </ul>
              <p>These providers act as processors on behalf of FlowPoint and receive only the minimum information necessary to perform their specific services. Users may disconnect their Google account at any time, request deletion of stored Google-related data, or contact <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a> with any privacy request.</p>
            </SubSection>
            <SubSection title="Artificial Intelligence and OpenAI">
              <p>FlowPoint uses OpenAI's API to provide certain artificial intelligence features, including AI-assisted analyses, recommendations, summaries, reports, and conversational assistance.</p>
              <p>When a user requests an AI-powered feature, information necessary to process that request may be transmitted to OpenAI. This may include the content submitted by the user and, where required to provide the requested feature, relevant business, SEO, analytics, Search Console, Google Business Profile, or other account data available within FlowPoint.</p>
              <p>FlowPoint configures its production use of the OpenAI API so that customer inputs and outputs are not voluntarily shared with OpenAI for the purpose of training or improving OpenAI's models. FlowPoint does not enable optional data-sharing programs for production customer traffic where those programs would permit customer inputs or outputs to be used for model improvement.</p>
              <p>Data transmitted to OpenAI is limited to what is reasonably necessary to provide the AI-powered feature requested by the user and is processed in accordance with the applicable contractual and data-protection arrangements.</p>
            </SubSection>
            <SubSection title="Newsletter and unsubscribe">
              <p>The email address provided when creating an account is used to automatically subscribe to the FlowPoint newsletter, which may include news, tips, offers and service information. Each newsletter includes an unsubscribe link. Unsubscribing does not affect platform access or communications needed to manage the account.</p>
            </SubSection>
            <SubSection title="Data retention">
              <p>Data is retained for the duration of the contractual relationship and for three years after account closure for legal and accounting purposes.</p>
            </SubSection>
            <SubSection title="Right of access">
              <p>You can request a copy of your personal data at any time by contacting <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>.</p>
            </SubSection>
            <SubSection title="Right to rectification">
              <p>You can correct inaccurate data from your account or by contacting support.</p>
            </SubSection>
            <SubSection title="Right to erasure">
              <p>You can request deletion of your personal data. We will process the request within 30 days, subject to legal retention requirements.</p>
            </SubSection>
            <SubSection title="Right to data portability">
              <p>You can request your data in a structured, machine-readable format such as JSON or CSV.</p>
            </SubSection>
            <SubSection title="Data location">
              <p>Data may be hosted in the European Union or, depending on the provider, in countries with safeguards recognized under the GDPR, such as standard contractual clauses or an adequacy decision.</p>
            </SubSection>
            <SubSection title="Public website audit">
              <p>The authenticated FlowPoint platform is hosted by Render and uses MongoDB Atlas for its database. The public marketing website and free-audit quota service are hosted on Replit; quota counters are stored in its managed PostgreSQL database.</p>
            </SubSection>
            <SubSection title="GDPR contact">
              <p>To exercise your GDPR rights, contact <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>. You may also lodge a complaint with the Belgian Data Protection Authority (APD).</p>
            </SubSection>
          </SectionCard>

          {/* 5. Cookies */}
          <SectionCard id="cookies" icon={Cookie} title="Cookie policy">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">Last updated: November 19, 2026</p>
            <SubSection title="Essential cookies">
              <p>These cookies are required for the website to work, including user sessions, theme preferences and cookie consent. They cannot be disabled because the service depends on them.</p>
            </SubSection>
            <SubSection title="Free website audit quota cookie">
              <p>When the free public audit is available, the website sets the first-party <code>fp_public_audit_visitor</code> cookie to enforce the limit of three audits per visitor per UTC day and help prevent abuse. It contains a random pseudonymous identifier and its signature, is marked <code>HttpOnly</code> and <code>SameSite=Lax</code>, is marked <code>Secure</code> over HTTPS, and expires after 48 hours. It is an essential service cookie, not an analytics or advertising cookie. The planned pilot also has a shared limit of five audits per exact public IP per UTC day and a total limit of ten per UTC day.</p>
            </SubSection>
            <SubSection title="Analytics cookies">
              <p>These cookies help us measure website traffic and improve the user experience. They are used in aggregated and anonymized form and require your prior consent.</p>
            </SubSection>
            <SubSection title="Functional cookies">
              <p>These cookies remember preferences such as language, region and display settings for future visits.</p>
            </SubSection>
            <SubSection title="Managing consent">
              <p>You can manage cookie preferences at any time through the consent banner or by clearing cookies in your browser. Refusing non-essential cookies does not affect access to the service.</p>
            </SubSection>
            <SubSection title="Cookie list">
              <p>A detailed list of cookies is available through the consent settings or on request from <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>.</p>
            </SubSection>
          </SectionCard>

          {/* 6. Free trial */}
          <SectionCard id="essai-gratuit" icon={Gift} title="Free trial policy">
            <SubSection title="Trial duration">
              <p>Each new account receives a 14-day free trial with access to all platform features, with no restrictions or purchase obligation.</p>
            </SubSection>
            <SubSection title="Eligibility">
              <p>The free trial is limited to one trial per individual, normalized email address, business domain and company. Attempts to bypass this limit may result in immediate account suspension.</p>
            </SubSection>
            <SubSection title="Paid subscription conversion">
              <p>At the end of the free trial, the account converts to the paid plan selected at signup, provided a valid payment method is available.</p>
            </SubSection>
            <SubSection title="Cancel during the trial">
              <p>You can cancel at any time from your account before the free trial ends. No amount will be charged if you cancel before the conversion date.</p>
            </SubSection>
          </SectionCard>

          {/* 7. Refunds */}
          <SectionCard id="remboursement" icon={RefreshCw} title="Refund policy">
            <SubSection title="Refund conditions">
              <p>FlowPoint reviews refund requests on a case-by-case basis. Refunds may be granted at FlowPoint's discretion when the service could not be provided properly due to FlowPoint.</p>
            </SubSection>
            <SubSection title="Eligible cases">
              <p>Eligible cases include a service outage lasting more than 72 consecutive hours, confirmed duplicate billing, or billing after confirmed cancellation. Change-of-mind requests are not eligible for a refund.</p>
            </SubSection>
            <SubSection title="Processing time">
              <p>Refund requests are processed within 5 to 10 business days. Approved refunds are issued to the original payment method used for the subscription.</p>
            </SubSection>
            <p className="text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg p-3">
              For refund requests, contact us at{" "}
              <a href="mailto:support@flowpoint.pro" className="font-medium hover:underline">support@flowpoint.pro</a>{" "}
               with your order number and the reason for your request.
            </p>
          </SectionCard>

          {/* 8. AI policy */}
          <SectionCard id="politique-ia" icon={Bot} title="FlowPoint AI policy">
            <SubSection title="Use of artificial intelligence">
              <p>FlowPoint uses artificial intelligence for SEO analysis, personalized recommendations and customer support. These features are powered by advanced language models.</p>
            </SubSection>
            <SubSection title="Quotas and technical limits">
              <p>AI quotas shown as “unlimited” in some commercial offers are intended to cover normal professional use at a high level. To help maintain service stability and prevent abuse, the Ultra plan has a technical limit of <strong className="text-slate-900 dark:text-slate-100">10,000,000 AI tokens per month</strong>. This limit is expected to cover the needs of most professional users.</p>
              <p className="mt-2">Exceeding the quota may result in slower service, temporary suspension of AI features or an offer to purchase an additional package.</p>
            </SubSection>
            <SubSection title="Usage cycle">
              <p>AI usage limits are calculated monthly and reset at each billing cycle.</p>
            </SubSection>
            <SubSection title="Changes to limits">
              <p>FlowPoint may adjust this limit in response to changes in AI provider costs and market conditions, with 30 days' notice by email to affected users.</p>
            </SubSection>
            <SubSection title="AI credits">
              <p>AI credits purchased in one-off packages are deducted as they are used. Credits are non-refundable after partial or full use and do not expire unless stated at the time of purchase.</p>
            </SubSection>
            <SubSection title="Quality and accuracy">
              <p>AI-generated recommendations are provided for informational purposes. FlowPoint does not guarantee that results are completely accurate and encourages users to apply their professional judgment.</p>
            </SubSection>
            <SubSection title="User responsibility">
              <p>Users remain responsible for decisions based on AI-generated recommendations. FlowPoint is not liable for decisions made without independent verification. AI models may produce incomplete or inaccurate results.</p>
            </SubSection>
            <SubSection title="Data and AI">
              <p>FlowPoint may use anonymized and aggregated data to improve the service. Information sent to third-party AI providers is limited to what is strictly necessary to process the requested feature. Google data remains subject to the protections described in “Google User Data Sharing and Disclosure” and is never used to train or improve AI or machine-learning models.</p>
            </SubSection>
          </SectionCard>

          {/* 9. DPA */}
          <SectionCard id="dpa" icon={Database} title="Data processing agreement (DPA)">
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">GDPR-compliant — Article 28</p>
            <SubSection title="Customer data processing">
              <p>FlowPoint acts as a processor for data you enter into the platform for your business activities. You remain the controller of that data in relation to your own customers.</p>
            </SubSection>
            <SubSection title="Technical subprocessors">
              <p>FlowPoint may use technical subprocessors for hosting, payment processing, transactional email, artificial intelligence and cloud infrastructure. An up-to-date list is available on request and may change over time. Subprocessors are selected based on their security and compliance safeguards.</p>
            </SubSection>
            <SubSection title="Security">
              <p>FlowPoint uses appropriate technical and organizational measures to protect data, including:</p>
              <ul className="mt-2 space-y-1 list-none">
                {["HTTPS required for all exchanges", "TLS encryption in transit", "Secure authentication", "Recognized hashing algorithms", "CSRF protection", "XSS protection", "Brute-force protection", "Access logging", "Regular encrypted backups"].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </SubSection>
            <SubSection title="GDPR compliance">
              <p>If a personal data breach is likely to create a risk to your rights and freedoms, FlowPoint will notify you within 72 hours of becoming aware of it, in accordance with Article 33 of the GDPR.</p>
            </SubSection>
          </SectionCard>

          {/* SLA */}
          <SectionCard id="sla" icon={Activity} title="Service availability (SLA)">
            <SubSection title="Availability target">
              <p>FlowPoint aims for annual availability above 99.9%. No contractual availability level is guaranteed unless agreed in writing.</p>
            </SubSection>
            <SubSection title="Maintenance">
              <p>Scheduled maintenance may take place, preferably outside peak usage hours. Emergency maintenance may occur at any time to address risks to security or data integrity.</p>
            </SubSection>
          </SectionCard>

          {/* API */}
          <SectionCard id="api-policy" icon={Code} title="API usage policy">
            <p>Use of the FlowPoint API is subject to the same terms as the main platform.</p>
            <SubSection title="Access restrictions">
              <p>Depending on usage, FlowPoint may apply measures such as:</p>
              <ul className="mt-2 space-y-1 list-none">
                {["Request quotas per period", "Rate limiting", "Usage restrictions based on the selected plan", "Suspension or revocation of API keys in cases of abuse or violation of these terms"].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </SubSection>
          </SectionCard>

          {/* Data */}
          <SectionCard id="donnees" icon={Sliders} title="Data ownership and export">
            <SubSection title="Data ownership">
              <p>Data imported or created by users on the platform remains their exclusive property. FlowPoint does not acquire ownership rights to that data or use it commercially without explicit consent.</p>
            </SubSection>
            <SubSection title="Data export">
              <p>Users may export their data when export functionality is available on their plan. Available formats (CSV, JSON or PDF) depend on the plan and feature.</p>
            </SubSection>
          </SectionCard>

          {/* Force majeure */}
          <SectionCard id="force-majeure" icon={Zap} title="Force majeure">
            <p>FlowPoint is not liable for delays or service interruptions caused by force majeure, including:</p>
            <ul className="mt-3 space-y-1 list-none">
              {["Natural disaster (flood, earthquake or storm)", "Major internet or network outage", "Unavailability of a critical provider (cloud, AI or payments)", "Widespread cyberattack or major national security incident", "Government action, regulation or embargo"].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">FlowPoint will notify users as soon as reasonably possible and work to restore the service promptly.</p>
          </SectionCard>

          {/* Governing law */}
          <SectionCard id="droit-applicable" icon={Scale} title="Governing law and jurisdiction">
            <SubSection title="Governing law">
              <p>These terms are governed by Belgian law. If a dispute concerning their interpretation or performance cannot be resolved amicably, the competent courts of Belgium will have exclusive jurisdiction, except where mandatory consumer law provides otherwise.</p>
            </SubSection>
            <SubSection title="Amicable resolution">
              <p>If you have a dispute, please first contact us at <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline">support@flowpoint.pro</a>. We aim to reply within 10 business days and seek an amicable solution.</p>
            </SubSection>
          </SectionCard>

          {/* Service changes & fair use */}
          <SectionCard id="evolution-service" icon={Settings} title="Service changes & fair use">
            <SubSection title="Service changes">
              <p>FlowPoint may change, improve, remove or add features to develop the platform and improve its quality. These changes do not automatically entitle users to a refund unless a core feature expressly included in their plan is removed.</p>
            </SubSection>
            <SubSection title="Fair use">
              <p>Even when a feature is described as unlimited, its use must remain consistent with normal professional use. Automated or large-scale use, or attempts to bypass technical limits, may lead to temporary or permanent service restrictions without a refund.</p>
            </SubSection>
          </SectionCard>

          {/* Third-party services */}
          <SectionCard id="services-tiers" icon={Zap} title="Third-party services">
            <p>Some FlowPoint features rely on third-party services, such as Google, Stripe, OpenAI, DataForSEO and other data providers. FlowPoint is not responsible for the unavailability, changes or interruptions of external services that may affect platform features.</p>
          </SectionCard>

          {/* Changes to terms */}
          <SectionCard id="modification-conditions" icon={Settings} title="Changes to these terms">
            <p>FlowPoint may amend these terms to reflect legal, regulatory, technical or feature changes. Users will be notified by email or through the platform before material changes take effect.</p>
          </SectionCard>

          {/* Legal contact */}
          <SectionCard id="contact-juridique" icon={Mail} title="Legal contact">
            <p>For legal questions, personal data requests or complaints:</p>
            <div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 inline-block">
                <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm mb-1">Legal email</p>
                <a href="mailto:support@flowpoint.pro" className="text-blue-600 hover:underline text-sm">
                  support@flowpoint.pro
                </a>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">We aim to respond as soon as possible, usually within 5 business days.</p>
              </div>
            </div>
            <div className="mt-4">
              <a
                href="/contact"
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Mail className="h-4 w-4" />
                Legal contact form
              </a>
            </div>
          </SectionCard>

        </div>
      </div>

      {/* Back-to-top button */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-6 z-40 w-10 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
          aria-label="Back to top"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}

      <Footer language="en" />
    </div>
  );
}
