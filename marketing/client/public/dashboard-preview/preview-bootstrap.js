(function () {
  "use strict";

  const supportedLanguages = new Set([
    "fr", "en", "es", "de", "it", "pt", "nl", "pl", "sv", "ro", "cs", "pt-br",
  ]);
  const params = new URLSearchParams(window.location.search);
  const requestedLanguageKey = (params.get("lang") || "fr").trim().toLowerCase();
  const requestedLanguage = ({
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
    "pt-br": "pt-BR",
  })[requestedLanguageKey] || requestedLanguageKey;
  const hasCatalog = supportedLanguages.has(requestedLanguageKey);
  const language = hasCatalog
    ? requestedLanguageKey
    : "fr";
  const theme = params.get("theme") === "dark" ? "dark" : "light";

  window.__FP_PREVIEW__ = true;
  window.__FP_PREVIEW_TARGET_LANGUAGE__ = requestedLanguage;
  document.documentElement.setAttribute("lang", requestedLanguage);
  document.documentElement.setAttribute(
    "dir",
    requestedLanguageKey === "ar" || requestedLanguageKey === "he" ? "rtl" : "ltr",
  );
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute(
    "translate",
    requestedLanguageKey === "en" || requestedLanguageKey === "fr" ? "no" : "yes",
  );

  function createPreviewStorage() {
    const values = new Map();
    return {
      get length() { return values.size; },
      key(index) { return Array.from(values.keys())[index] ?? null; },
      getItem(key) {
        const normalizedKey = String(key);
        return values.has(normalizedKey) ? values.get(normalizedKey) : null;
      },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); },
      clear() { values.clear(); },
    };
  }

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createPreviewStorage(),
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createPreviewStorage(),
    });
  } catch (_) {}

  try {
    localStorage.setItem("fp:language", language);
    localStorage.setItem("fp:theme", theme);
  } catch (_) {}

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let url;
    try {
      url = new URL(
        typeof input === "string" ? input : input.url,
        window.location.href,
      );
    } catch (_) {
      return Promise.reject(new Error("Invalid preview request"));
    }
    const isPreviewAsset =
      url.origin === window.location.origin &&
      url.pathname.startsWith("/dashboard-preview/");
    const isTranslationRequest = [
      "translate.google.com",
      "translate.googleapis.com",
      "translate-pa.googleapis.com",
    ].includes(url.hostname);
    if (!isPreviewAsset && !isTranslationRequest) {
      return Promise.reject(new Error("Dashboard preview API is disabled"));
    }
    return originalFetch(input, init);
  };

  window.EventSource = class PreviewEventSource {
    constructor() {
      this.readyState = 2;
      this.onopen = null;
      this.onerror = null;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };

  if (requestedLanguageKey !== "en" && requestedLanguageKey !== "fr") {
    window.addEventListener("DOMContentLoaded", function () {
      const mount = document.createElement("div");
      mount.id = "google_translate_element";
      mount.hidden = true;
      document.body.appendChild(mount);

      window.googleTranslateElementInit = function () {
        new window.google.translate.TranslateElement({
          pageLanguage: hasCatalog ? "en" : "fr",
          includedLanguages: requestedLanguage,
          autoDisplay: false,
          multilanguagePage: true,
        }, mount.id);

        let attempts = 0;
        const selectLanguage = function () {
          const select = document.querySelector(".goog-te-combo");
          if (select) {
            select.value = requestedLanguage;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (attempts++ < 20) {
            window.setTimeout(selectLanguage, 100);
          }
        };
        window.setTimeout(selectLanguage, 100);
      };

      const script = document.createElement("script");
      script.src =
        "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      script.async = true;
      document.head.appendChild(script);
    }, { once: true });
  }
})();
