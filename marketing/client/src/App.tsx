import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { getMarketingTranslationSourceLanguage } from "@/lib/marketing-locale";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CookieBanner } from "@/components/CookieBanner";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { FunnelTracking } from "@/components/FunnelTracking";
import { ApolloTracker } from "@/components/ApolloTracker";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ScrollRestoration } from "@/components/ScrollRestoration";

const ANALYTICS_DISABLED = import.meta.env.VITE_ANALYTICS_DISABLED === "true";
import Home from "@/pages/Home";
import ThankYou from "@/pages/ThankYou";
import About from "@/pages/About";
import Contact from "@/pages/Contact";
import Careers from "@/pages/Careers";
import Legal from "@/pages/Legal";
import LegalInfo from "@/pages/LegalInfo";
import Updates from "@/pages/Updates";
import Resources from "@/pages/Resources";
import ResourceArticle from "@/pages/ResourceArticle";
import Features from "@/pages/Features";
import Pricing from "@/pages/Pricing";
import Benefits from "@/pages/Benefits";
import SeoAudit from "@/pages/SeoAudit";
import LocalSeo from "@/pages/LocalSeo";
import WebsiteMonitoring from "@/pages/WebsiteMonitoring";
import SeoReporting from "@/pages/SeoReporting";
import CompetitorAnalysis from "@/pages/CompetitorAnalysis";
import NotFound from "@/pages/not-found";
import { getActiveFpLid } from "@/lib/fp-lid";
import {
  captureMarketingAttribution,
  installMarketingAppLinkPropagation,
} from "@/lib/funnel-tracking";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/thank-you" component={ThankYou} />
      <Route path="/merci" component={ThankYou} />
      <Route path="/about" component={About} />
      <Route path="/a-propos" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/careers" component={Careers} />
      <Route path="/carrieres" component={Careers} />
      <Route path="/legal-notice" component={Legal} />
      <Route path="/mentions-legales" component={Legal} />
      <Route path="/legal-information" component={LegalInfo} />
      <Route path="/informations-legales" component={LegalInfo} />
      <Route path="/updates" component={Updates} />
      <Route path="/mises-a-jour" component={Updates} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ResourceArticle} />
      <Route path="/ressources" component={Resources} />
      <Route path="/ressources/:slug" component={ResourceArticle} />
      <Route path="/features" component={Features} />
      <Route path="/fonctionnalites" component={Features} />
      <Route path="/seo-audit" component={SeoAudit} />
      <Route path="/local-seo" component={LocalSeo} />
      <Route path="/website-monitoring" component={WebsiteMonitoring} />
      <Route path="/seo-reporting" component={SeoReporting} />
      <Route path="/competitor-analysis" component={CompetitorAnalysis} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/tarifs" component={Pricing} />
      <Route path="/benefits" component={Benefits} />
      <Route path="/avantages" component={Benefits} />
      <Route component={NotFound} />
    </Switch>
  );
}

function GoogleTranslateLoader() {
  useEffect(() => {
    const sourceLanguage = getMarketingTranslationSourceLanguage(window.location.pathname);
    const targetLanguage = document.documentElement.lang.toLowerCase();
    if (sourceLanguage === targetLanguage) return;
    if (document.getElementById("google-translate-script")) return;

    // Google Translate rewrites server-rendered DOM, so wait until React hydrates first.
    const script = document.createElement("script");
    script.id = "google-translate-script";
    script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return null;
}

function App() {
  useEffect(() => {
    captureMarketingAttribution();
    getActiveFpLid();
    return installMarketingAppLinkPropagation();
  }, []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <ScrollRestoration />
          {!ANALYTICS_DISABLED && <GoogleAnalytics />}
          <FunnelTracking />
          {!ANALYTICS_DISABLED && <ApolloTracker />}
          <Router />
          <CookieBanner />
          <GoogleTranslateLoader />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
