import { useEffect } from "react";
import { HOME_PAGE_TITLE } from "@shared/site-metadata";

interface PageTitleOptions {
  noindex?: boolean;
}

export function usePageTitle(title: string, options: PageTitleOptions = {}) {
  useEffect(() => {
    const englishTitles: Record<string, string> = {
      "Avantages | Flowpoint": "Benefits | Flowpoint",
      "Outil d'audit SEO pour analyser votre site | Flowpoint": "SEO Audit Tool to Analyze Your Website | Flowpoint",
      "À propos | Flowpoint": "About | Flowpoint",
      "Fonctionnalités | Flowpoint": "Features | Flowpoint",
      "Guide SEO Local | Flowpoint": "Local SEO Guide | Flowpoint",
      "Centre de ressources | Flowpoint": "Resources | Flowpoint",
      "Informations légales | Flowpoint": "Legal Information | Flowpoint",
      "Contact | Flowpoint": "Contact | Flowpoint",
      "Merci | Flowpoint": "Thank You | Flowpoint",
      "Mises à jour | Flowpoint": "Updates | Flowpoint",
      "Mentions légales | FlowPoint": "Legal Notice | Flowpoint",
      "Carrières | Flowpoint": "Careers | Flowpoint",
      "Tarifs | Flowpoint": "Pricing | Flowpoint",
    };
    const language = document.documentElement.lang.toLowerCase();
    if (language === "fr") {
      document.title = title === HOME_PAGE_TITLE
        ? "Espace de croissance numérique"
        : title;
    } else {
      document.title = englishTitles[title] || title;
    }
    return () => {
      document.title = HOME_PAGE_TITLE;
    };
  }, [title]);

  useEffect(() => {
    if (!options.noindex) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [options.noindex]);
}
