import { useState, useEffect, useRef, useId } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { getMarketingTranslationSourceLanguage } from "@/lib/marketing-locale";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
  { code: "cs", label: "Čeština" },
  { code: "ro", label: "Română" },
  { code: "hu", label: "Magyar" },
  { code: "sv", label: "Svenska" },
  { code: "da", label: "Dansk" },
  { code: "no", label: "Norsk" },
  { code: "fi", label: "Suomi" },
  { code: "el", label: "Ελληνικά" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "zh-CN", label: "中文（简体）" },
  { code: "zh-TW", label: "中文（繁體）" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "th", label: "ภาษาไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ms", label: "Bahasa Melayu" },
];

const RTL_LANGUAGES = new Set(["ar", "he"]);
const LANGUAGE_CONTROL_LABELS: Record<string, string> = {
  en: "Change language",
  fr: "Changer de langue",
  es: "Cambiar idioma",
  de: "Sprache ändern",
  it: "Cambia lingua",
  pt: "Alterar idioma",
  nl: "Taal wijzigen",
  pl: "Zmień język",
  ru: "Сменить язык",
  uk: "Змінити мову",
  cs: "Změnit jazyk",
  ro: "Schimbă limba",
  hu: "Nyelv váltása",
  sv: "Byt språk",
  da: "Skift sprog",
  no: "Bytt språk",
  fi: "Vaihda kieltä",
  el: "Αλλαγή γλώσσας",
  tr: "Dili değiştir",
  ar: "تغيير اللغة",
  he: "שינוי שפה",
  hi: "भाषा बदलें",
  "zh-CN": "切换语言",
  "zh-TW": "切換語言",
  ja: "言語を変更",
  ko: "언어 변경",
  th: "เปลี่ยนภาษา",
  vi: "Đổi ngôn ngữ",
  id: "Ganti bahasa",
  ms: "Tukar bahasa",
};

function getTranslationSourceLanguage(): string {
  return getMarketingTranslationSourceLanguage(window.location.pathname);
}

function getGoogleTranslateCookieLang(): string | null {
  const sourceLanguage = getTranslationSourceLanguage();
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)googtrans=/${sourceLanguage}/([^;]+)`, "i"),
  );
  return match ? match[1] : null;
}

function setGoogleTranslateCookie(langCode: string) {
  const sourceLanguage = getTranslationSourceLanguage();
  document.cookie = `googtrans=/${sourceLanguage}/${langCode}; path=/; SameSite=Lax`;
  document.cookie = `googtrans=/${sourceLanguage}/${langCode}; path=/; domain=${window.location.hostname}; SameSite=Lax`;
}

function applyLanguage(langCode: string) {
  const language = LANGUAGES.find((item) => item.code.toLowerCase() === langCode.toLowerCase());
  if (!language) return;

  try {
    window.localStorage.setItem("flowpoint-language", language.code);
  } catch {
    // The Google Translate cookie still allows the preference to work without storage.
  }
  setGoogleTranslateCookie(language.code);
  document.documentElement.lang = language.code;
  document.documentElement.dir = RTL_LANGUAGES.has(language.code.toLowerCase()) ? "rtl" : "ltr";
  document.documentElement.dataset.language = language.code;
  window.location.reload();
}

export function LanguagePicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const choicesId = useId();

  useEffect(() => {
    try {
      const activeLang = window.localStorage.getItem("flowpoint-language") || getGoogleTranslateCookieLang() || document.documentElement.lang || "en";
      const language = LANGUAGES.find((item) => item.code.toLowerCase() === activeLang.toLowerCase());
      setCurrent(language?.code || "en");
    } catch {
      setCurrent("en");
    }
  }, []);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const currentLang = LANGUAGES.find(l => l.code === current);
  const languageControlLabel = LANGUAGE_CONTROL_LABELS[currentLang?.code || "en"];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        type="button"
        className="flex min-h-11 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        data-testid="button-language-picker"
        aria-label={languageControlLabel}
        title={languageControlLabel}
        aria-expanded={open}
        aria-controls={choicesId}
      >
        <Globe className="h-4 w-4" />
        <span className="notranslate min-w-[5ch] text-center" translate="no">{currentLang?.code.toUpperCase() || ""}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={choicesId} className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
          <div className="max-h-80 overflow-y-auto py-1 notranslate">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (lang.code !== currentLang?.code) {
                    trackEvent("language_changed", {
                      language: lang.code,
                      location: "language_picker",
                    });
                    applyLanguage(lang.code);
                  }
                }}
                aria-current={lang.code === currentLang?.code ? "true" : undefined}
                className={`w-full min-h-11 flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left ${
                  lang.code === currentLang?.code
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                }`}
              >
                <span className="flex-1">{lang.label}</span>
                {lang.code === currentLang?.code && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
