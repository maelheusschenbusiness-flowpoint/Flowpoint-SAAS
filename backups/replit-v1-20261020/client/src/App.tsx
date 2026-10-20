import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CookieBanner } from "@/components/CookieBanner";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { FunnelTracking } from "@/components/FunnelTracking";
import { ApolloTracker } from "@/components/ApolloTracker";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ScrollRestoration } from "@/components/ScrollRestoration";
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
import { getActiveFpLid, installFpLidPropagation } from "@/lib/fp-lid";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/merci" component={ThankYou} />
      <Route path="/a-propos" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/carrieres" component={Careers} />
      <Route path="/mentions-legales" component={Legal} />
      <Route path="/informations-legales" component={LegalInfo} />
      <Route path="/mises-a-jour" component={Updates} />
      <Route path="/ressources" component={Resources} />
      <Route path="/ressources/:slug" component={ResourceArticle} />
      <Route path="/fonctionnalites" component={Features} />
      <Route path="/seo-audit" component={SeoAudit} />
      <Route path="/local-seo" component={LocalSeo} />
      <Route path="/website-monitoring" component={WebsiteMonitoring} />
      <Route path="/seo-reporting" component={SeoReporting} />
      <Route path="/competitor-analysis" component={CompetitorAnalysis} />
      <Route path="/tarifs" component={Pricing} />
      <Route path="/avantages" component={Benefits} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => installFpLidPropagation(getActiveFpLid()), []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <ScrollRestoration />
          <GoogleAnalytics />
          <FunnelTracking />
          <ApolloTracker />
          <Router />
          <CookieBanner />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
