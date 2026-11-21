import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import App from "./App";
import { MarketingLanguageContext } from "./lib/marketing-language";

export function render(url: string, language = "en"): string {
  return renderToString(
    <Router ssrPath={url}>
      <MarketingLanguageContext.Provider value={language}>
        <App />
      </MarketingLanguageContext.Provider>
    </Router>
  );
}
