import { createContext, useContext } from "react";
import { getDisplayedMarketingLanguage } from "./funnel-tracking";

export const MarketingLanguageContext = createContext<string | null>(null);

export function useMarketingLanguage(): string {
  const serverLanguage = useContext(MarketingLanguageContext);
  if (serverLanguage) return serverLanguage;
  if (typeof window === "undefined") return "en";
  if (window.location.pathname !== "/pricing" && window.location.pathname !== "/tarifs") {
    return "en";
  }
  return serverLanguage || getDisplayedMarketingLanguage() || "en";
}
