import { Zap } from "lucide-react";

export function Footer({
  variant = "default",
  language,
}: {
  variant?: "default" | "landing";
  language?: string;
}) {
  const isLanding = variant === "landing";
  const useEnglishCopy = isLanding || (language?.toLowerCase().startsWith("en") ?? true);
  const FooterHeading = isLanding ? "h2" : "h4";
  return (
    <footer className={`bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 py-16 border-t border-slate-200 dark:border-slate-800 ${isLanding ? "fp-home-footer" : ""}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white">
              <Zap className="h-6 w-6 text-blue-500" />
              <span
                className={`font-display font-bold text-xl ${useEnglishCopy ? "notranslate" : ""}`}
                translate={useEnglishCopy ? "no" : undefined}
              >
                FlowPoint
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {useEnglishCopy
                ? "A workspace for the digital growth of local businesses and the teams that support them. Bring website health, performance, analytics, search, AI-assisted insights and reports together to make better decisions."
                : "Un espace de travail dédié à la croissance numérique des entreprises locales et des équipes qui les accompagnent. Réunissez santé du site, performances, analyses, recherche, recommandations assistées par IA et rapports pour mieux décider."}
            </p>
          </div>

          <div>
            <FooterHeading className="text-slate-900 dark:text-white font-bold mb-4 font-display">{useEnglishCopy ? "Product" : "Produit"}</FooterHeading>
            <ul className="space-y-2 text-sm">
              <li><a href="/features" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Features" : "Fonctionnalités"}</a></li>
              <li><a href="/benefits" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Benefits" : "Avantages"}</a></li>
              <li><a href="/pricing" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Pricing" : "Tarifs"}</a></li>
              <li><a href="/updates" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Updates" : "Mises à jour"}</a></li>
              <li><a href="/resources" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Resource center" : "Centre de ressources"}</a></li>
            </ul>
          </div>

          <div>
            <FooterHeading className="text-slate-900 dark:text-white font-bold mb-4 font-display">{useEnglishCopy ? "Company" : "Entreprise"}</FooterHeading>
            <ul className="space-y-2 text-sm">
              <li><a href="/about" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "About" : "À propos"}</a></li>
              <li><a href="/contact" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Contact</a></li>
              <li><a href="/careers" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Careers" : "Carrières"}</a></li>
              <li><a href="/legal-notice" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Legal notice" : "Mentions légales"}</a></li>
              <li><a href="/legal-information" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{useEnglishCopy ? "Legal information" : "Informations légales"}</a></li>
            </ul>
          </div>

        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 mt-12 pt-8 text-center text-sm text-slate-500 dark:text-slate-500">
          © {new Date().getFullYear()} FlowPoint. {useEnglishCopy ? "All rights reserved." : "Tous droits réservés."}
        </div>
      </div>
    </footer>
  );
}
