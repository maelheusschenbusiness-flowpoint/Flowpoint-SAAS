import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, Zap } from "lucide-react";
import { LanguagePicker } from "@/components/LanguagePicker";
import { trackSignupCta } from "@/lib/analytics";

const EXTERNAL_URL = "https://app.flowpoint.pro/index.html";

function scrollToAnchor(anchor: string) {
  if (window.location.pathname === "/") {
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  } else {
    sessionStorage.setItem("scrollTo", anchor);
    window.location.assign("/");
  }
}

export function Navigation() {
  const [isOpen, setIsOpen] = useState(false);

  const navLinks = [
    { name: "Accueil", href: "/" },
    { name: "Fonctionnalités", href: "/fonctionnalites" },
    { name: "Tarifs", href: "/tarifs" },
  ];

  const mobileExtraLinks = [
    { name: "Avantages", href: "/avantages" },
    { name: "À propos", href: "/a-propos" },
    { name: "Contact", href: "/contact" },
    { name: "Ressources", href: "/ressources" },
    { name: "Informations légales", href: "/informations-legales" },
    { name: "Mentions légales", href: "/mentions-legales" },
  ];

  return (
    <>
      <nav className="fixed w-full z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg border-b border-gray-100 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            
            <a href="/" className="flex items-center gap-2 group cursor-pointer">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white p-2 rounded-lg group-hover:from-blue-700 group-hover:to-indigo-700 transition-all">
                <Zap className="h-6 w-6" />
              </div>
              <span className="font-display font-bold text-2xl text-slate-900 dark:text-white tracking-tight">
                Flowpoint
              </span>
            </a>

            <div className="hidden md:flex items-center space-x-8">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={link.anchor ? (e) => { e.preventDefault(); scrollToAnchor(link.anchor!); } : undefined}
                  className="text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  {link.name}
                </a>
              ))}
              <LanguagePicker />
              <Button
                asChild
                className="bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30"
              >
                <a
                  href={EXTERNAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSignupCta("navigation_desktop")}
                >
                  Essai Gratuit
                </a>
              </Button>
            </div>

            <div className="md:hidden flex items-center gap-2">
              <LanguagePicker />
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-slate-600 dark:text-slate-300 hover:text-blue-600 p-2"
                aria-label={isOpen ? "Fermer le menu" : "Ouvrir le menu"}
                aria-expanded={isOpen}
              >
                {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {isOpen && (
          <div className="md:hidden bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700">
            <div className="px-4 pt-2 pb-6 space-y-2">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="block px-3 py-2 text-base font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-md transition-colors"
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
                    className="block px-3 py-2 text-base font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-md transition-colors"
                    onClick={() => setIsOpen(false)}
                  >
                    {link.name}
                  </a>
                ))}
              </div>
              <div className="pt-4">
                <Button
                  asChild
                  className="w-full bg-blue-600 border-blue-600 text-white"
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
                    Essai Gratuit
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
