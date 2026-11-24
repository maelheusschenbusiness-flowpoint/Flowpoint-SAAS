import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import App from "./App";
import { MarketingLanguageContext } from "./lib/marketing-language";
import type { MarketingThemeMode } from "@shared/marketing-theme";

export function render(
  url: string,
  language = "en",
  themeMode: MarketingThemeMode = "system",
): string {
  return renderToString(
    <Router ssrPath={url}>
      <MarketingLanguageContext.Provider value={language}>
        <App initialThemeMode={themeMode} />
      </MarketingLanguageContext.Provider>
    </Router>
  );
}
