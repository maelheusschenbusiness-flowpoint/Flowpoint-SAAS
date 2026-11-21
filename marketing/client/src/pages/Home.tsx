import { useEffect } from "react";
import LandingV2 from "@/components/home/flowpoint-landing/LandingV2";
import { HOME_FAQS } from "@shared/home-faqs";
import { buildFaqPageJsonLd } from "@shared/structured-data-content";
import { useJsonLd } from "@/hooks/use-json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { HOME_PAGE_TITLE } from "@shared/site-metadata";

export default function Home() {
  usePageTitle(HOME_PAGE_TITLE);
  useJsonLd(buildFaqPageJsonLd(HOME_FAQS));

  useEffect(() => {
    const anchor = sessionStorage.getItem("scrollTo");
    if (!anchor) return;
    sessionStorage.removeItem("scrollTo");
    const attempt = () => {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      } else {
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
  }, []);

  return <LandingV2 />;
}
