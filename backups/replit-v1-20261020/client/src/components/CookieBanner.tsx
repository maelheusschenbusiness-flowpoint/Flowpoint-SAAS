import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie } from "lucide-react";

const CONSENT_CHANGE_EVENT = "flowpoint-cookie-consent-change";
const SHARED_CONSENT_COOKIE = "fp_analytics_consent";

function saveConsent(consent: "accepted" | "refused") {
  try {
    localStorage.setItem("cookie_consent", consent);
  } catch {
    // The shared cookie can still carry the visitor's choice to the app.
  }

  const host = window.location.hostname.toLowerCase();
  const sharedDomain =
    host === "flowpoint.pro" || host.endsWith(".flowpoint.pro")
      ? "; Domain=.flowpoint.pro"
      : "";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  document.cookie =
    `${SHARED_CONSENT_COOKIE}=${consent}; Path=/; Max-Age=31536000; SameSite=Lax${sharedDomain}${secure}`;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let consent: string | null = null;
    try {
      consent = localStorage.getItem("cookie_consent");
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }

    if (consent === "accepted" || consent === "refused") {
      try {
        saveConsent(consent);
      } catch {
        // A blocked cookie must not affect the consent choice or page.
      }
    } else {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      saveConsent("accepted");
    } catch {
      // Keep the interaction functional even when browser storage is blocked.
    }
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    setVisible(false);
  };

  const handleRefuse = () => {
    try {
      saveConsent("refused");
    } catch {
      // Keep the interaction functional even when browser storage is blocked.
    }
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    setVisible(false);
  };

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="fixed bottom-4 left-4 z-[59] rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        data-testid="button-cookie-settings"
        aria-label="Gérer les préférences cookies"
      >
        Préférences cookies
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[60] bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-2xl px-4 py-4 sm:px-6"
      data-testid="cookie-banner"
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <Cookie className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Les cookies analytiques ne sont activés qu’après votre accord. Vous pouvez accepter ou refuser et modifier votre choix à tout moment depuis le bouton « Préférences cookies ».{" "}
            <a href="/informations-legales#confidentialite" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300">
              politique de confidentialité
            </a>.
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <Button
            variant="outline"
            onClick={handleRefuse}
            className="rounded-lg text-sm"
            data-testid="button-cookie-refuse"
          >
            Refuser
          </Button>
          <Button
            onClick={handleAccept}
            className="bg-blue-600 border-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm"
            data-testid="button-cookie-accept"
          >
            Accepter
          </Button>
        </div>
      </div>
    </div>
  );
}
