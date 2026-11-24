import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, Zap } from "lucide-react";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ThemePicker } from "@/components/ThemePicker";
import { trackSignupCta } from "@/lib/analytics";

const EXTERNAL_URL = "https://app.flowpoint.pro/signin.html";
type NavigationLink = { name: string; href: string; anchor?: string };

function scrollToAnchor(anchor: string) {
  if (window.location.pathname === "/") {
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  } else {
    sessionStorage.setItem("scrollTo", anchor);
    window.location.assign("/");
  }
}

export function Navigation({
  variant = "default",
  language,
}: {
  variant?: "default" | "landing";
  language?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isLanding = variant === "landing";
  const useEnglishCopy = language?.toLowerCase().startsWith("en") ?? true;

  const navLinks: NavigationLink[] = useEnglishCopy
    ? [
        { name: "Home", href: "/" },
        { name: "Features", href: "/features" },
        { name: "Pricing", href: "/pricing" },
      ]
    : isLanding
    ? [
        { name: "Accueil", href: "/" },
        { name: "Plateforme", href: "#platform", anchor: "platform" },
        { name: "Comment ça marche", href: "#how-it-works", anchor: "how-it-works" },
        { name: "Fonctionnalités", href: "/features" },
        { name: "Tarifs", href: "/pricing" },
      ]
    : [
        { name: "Accueil", href: "/" },
        { name: "Fonctionnalités", href: "/features" },
        { name: "Tarifs", href: "/pricing" },
      ];

  const mobileExtraLinks = useEnglishCopy
    ? [
        { name: "Benefits", href: "/benefits" },
        { name: "About", href: "/about" },
        { name: "Contact", href: "/contact" },
        { name: "Resources", href: "/resources" },
        { name: "Legal information", href: "/legal-information" },
        { name: "Legal notice", href: "/legal-notice" },
      ]
    : isLanding
    ? [
        { name: "Avantages", href: "/benefits" },
        { name: "À propos", href: "/about" },
        { name: "Contact", href: "/contact" },
        { name: "Ressources", href: "/resources" },
        { name: "Informations légales", href: "/legal-information" },
        { name: "Mentions légales", href: "/legal-notice" },
      ]
    : [
        { name: "Avantages", href: "/benefits" },
        { name: "À propos", href: "/about" },
        { name: "Contact", href: "/contact" },
        { name: "Ressources", href: "/resources" },
        { name: "Informations légales", href: "/legal-information" },
        { name: "Mentions légales", href: "/legal-notice" },
      ];

  return (
    <>
      <nav className={`fixed w-full z-50 backdrop-blur-lg border-b ${isLanding ? "bg-slate-950/95 border-slate-800" : "bg-white/90 dark:bg-slate-900/90 border-gray-100 dark:border-slate-700"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            
            <a href="/" className="flex items-center gap-2 group cursor-pointer">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white p-2 rounded-lg group-hover:from-blue-700 group-hover:to-indigo-700 transition-all">
                <Zap className="h-6 w-6" />
              </div>
              <span
                className={`font-display font-bold text-2xl ${isLanding ? "text-white" : "text-slate-900 dark:text-white"} tracking-tight ${isLanding || useEnglishCopy ? "notranslate" : ""}`}
                translate={isLanding || useEnglishCopy ? "no" : undefined}
              >
                {isLanding || useEnglishCopy ? "FlowPoint" : "Flowpoint"}
              </span>
            </a>

            <div className="hidden md:flex items-center space-x-8">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={link.anchor ? (e) => { e.preventDefault(); scrollToAnchor(link.anchor!); } : undefined}
                  className={`inline-flex min-h-11 items-center ${isLanding ? "text-slate-300 hover:text-blue-300" : "text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"} font-medium transition-colors`}
                >
                  {link.name}
                </a>
              ))}
              <LanguagePicker />
              <ThemePicker className="h-10 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
              <div className="flex flex-row items-center gap-2">
                <Button
                  asChild
                  className="min-h-11 bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30"
                >
                  <a
                    href={EXTERNAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackSignupCta("navigation_desktop")}
                  >
                    {useEnglishCopy ? "Start my 14-day trial" : "Essai gratuit de 14 jours"}
                  </a>
                </Button>
              </div>
            </div>

            <div className="md:hidden flex items-center gap-2">
              <LanguagePicker />
              <ThemePicker className="h-10 max-w-24 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
              <button
                onClick={() => setIsOpen(!isOpen)}
                className={`min-h-11 min-w-11 p-2 ${isLanding ? "text-slate-300 hover:text-blue-300" : "text-slate-600 dark:text-slate-300 hover:text-blue-600"}`}
                aria-label={
                  isOpen
                    ? useEnglishCopy ? "Close menu" : "Fermer le menu"
                    : useEnglishCopy ? "Open menu" : "Ouvrir le menu"
                }
                aria-expanded={isOpen}
              >
                {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {isOpen && (
          <div className={`md:hidden border-b ${isLanding ? "bg-slate-950 border-slate-800" : "bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-700"}`}>
            <div className="px-4 pt-2 pb-6 space-y-2">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className={`flex min-h-11 items-center px-3 py-2 text-base font-medium rounded-md transition-colors ${isLanding ? "text-slate-300 hover:text-blue-300 hover:bg-slate-800" : "text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800"}`}
                  onClick={(e) => {
                    setIsOpen(false);
                    if (link.anchor) {
                      e.preventDefault();
                      scrollToAnchor(link.anchor);
                    }
                  }}
                >
                  {link.name}
                </a>
              ))}
              <div className="border-t border-gray-100 dark:border-slate-700 pt-2 mt-2">
                {mobileExtraLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                  className={`flex min-h-11 items-center px-3 py-2 text-base font-medium rounded-md transition-colors ${isLanding ? "text-slate-300 hover:text-blue-300 hover:bg-slate-800" : "text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800"}`}
                    onClick={() => setIsOpen(false)}
                  >
                    {link.name}
                  </a>
                ))}
              </div>
              <div className="pt-4">
                <Button
                  asChild
                  className="min-h-11 w-full bg-blue-600 border-blue-600 text-white"
                >
                  <a
                    href={EXTERNAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setIsOpen(false);
                      trackSignupCta("navigation_mobile");
                    }}
                  >
                    {useEnglishCopy ? "Start my 14-day trial" : "Essai gratuit de 14 jours"}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>

    </>
  );
}
