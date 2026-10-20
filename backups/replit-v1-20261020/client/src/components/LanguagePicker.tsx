import { useState, useEffect, useRef, useId } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

const LANGUAGES = [
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "uk", label: "Українська", flag: "🇺🇦" },
  { code: "cs", label: "Čeština", flag: "🇨🇿" },
  { code: "ro", label: "Română", flag: "🇷🇴" },
  { code: "hu", label: "Magyar", flag: "🇭🇺" },
  { code: "sv", label: "Svenska", flag: "🇸🇪" },
  { code: "da", label: "Dansk", flag: "🇩🇰" },
  { code: "no", label: "Norsk", flag: "🇳🇴" },
  { code: "fi", label: "Suomi", flag: "🇫🇮" },
  { code: "el", label: "Ελληνικά", flag: "🇬🇷" },
  { code: "tr", label: "Türkçe", flag: "🇹🇷" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "he", label: "עברית", flag: "🇮🇱" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "zh-CN", label: "中文（简体）", flag: "🇨🇳" },
  { code: "zh-TW", label: "中文（繁體）", flag: "🇹🇼" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "th", label: "ภาษาไทย", flag: "🇹🇭" },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { code: "id", label: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ms", label: "Bahasa Melayu", flag: "🇲🇾" },
];

function getGoogleTranslateCookieLang(): string | null {
  const match = document.cookie.match(/googtrans=\/[a-z-]+\/([a-z-]+)/i);
  return match ? match[1] : null;
}

function getBrowserLang(): string {
  const raw = navigator.language?.split("-")[0] || "fr";
  if (raw === "zh") {
    return navigator.language?.toLowerCase().includes("tw") ? "zh-TW" : "zh-CN";
  }
  return raw;
}

function triggerGoogleTranslate(langCode: string) {
  if (langCode === "fr") {
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=" + window.location.hostname;
  } else {
    document.cookie = `googtrans=/fr/${langCode}; path=/`;
    document.cookie = `googtrans=/fr/${langCode}; path=/; domain=${window.location.hostname}`;
  }
  window.location.reload();
}

export function LanguagePicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("fr");
  const ref = useRef<HTMLDivElement>(null);
  const choicesId = useId();

  useEffect(() => {
    const cookieLang = getGoogleTranslateCookieLang();
    if (cookieLang) {
      setCurrent(cookieLang);
    } else {
      const browser = getBrowserLang();
      const supported = LANGUAGES.find(l => l.code === browser);
      if (supported && browser !== "fr") {
        setCurrent(browser);
        triggerGoogleTranslate(browser);
      }
    }
  }, []);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const currentLang = LANGUAGES.find(l => l.code === current) || LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        data-testid="button-language-picker"
        aria-label="Changer de langue"
        aria-expanded={open}
        aria-controls={choicesId}
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline">{currentLang.flag} {currentLang.code.toUpperCase()}</span>
        <span className="sm:hidden">{currentLang.flag}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={choicesId} className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
          <div className="max-h-80 overflow-y-auto py-1 notranslate">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setOpen(false);
                  if (lang.code !== current) {
                    trackEvent("language_changed", {
                      language: lang.code,
                      location: "language_picker",
                    });
                    triggerGoogleTranslate(lang.code);
                  }
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left ${
                  lang.code === current
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span className="flex-1">{lang.label}</span>
                {lang.code === current && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
