import React from "react";
import { useMarketingLanguage } from "@/lib/marketing-language";

type TrialDisclosureProps = {
  showPricingLink?: boolean;
  tone?: "standard" | "inverse";
  align?: "center" | "left";
  className?: string;
};

export function TrialDisclosure({
  showPricingLink = true,
  tone = "standard",
  align = "center",
  className = "",
}: TrialDisclosureProps) {
  const language = useMarketingLanguage();

  const disclosure =
    language === "fr"
      ? "Carte bancaire requise · débit automatique après 14 jours sauf annulation"
      : "Card required · billed automatically after 14 days unless cancelled";
  const toneClasses =
    tone === "inverse"
      ? "text-blue-100"
      : "text-slate-500 dark:text-slate-400";
  const linkClasses =
    tone === "inverse"
      ? "text-white underline underline-offset-4 hover:text-blue-100"
      : "text-blue-700 underline underline-offset-4 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200";
  const alignmentClasses =
    align === "left" ? "justify-start text-left" : "justify-center text-center";

  return (
    <p
      className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm ${alignmentClasses} ${toneClasses} ${className}`}
    >
      <span lang={language} translate="no">{disclosure}</span>
      {showPricingLink && (
        <a href="/pricing" className={linkClasses}>
          View pricing
        </a>
      )}
    </p>
  );
}
