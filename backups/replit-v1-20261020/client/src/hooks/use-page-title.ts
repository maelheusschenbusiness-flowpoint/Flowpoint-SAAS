import { useEffect } from "react";
import { HOME_PAGE_TITLE } from "@shared/site-metadata";

interface PageTitleOptions {
  noindex?: boolean;
}

export function usePageTitle(title: string, options: PageTitleOptions = {}) {
  useEffect(() => {
    document.title = title;
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
