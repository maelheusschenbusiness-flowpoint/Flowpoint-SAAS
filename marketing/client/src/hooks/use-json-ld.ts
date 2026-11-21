import { useEffect } from "react";

export function useJsonLd(schema: object) {
  const serializedSchema = JSON.stringify(schema);
  useEffect(() => {
    const existing = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"][data-json-ld="true"]',
    );
    if (existing) {
      existing.textContent = serializedSchema;
      return;
    }

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = serializedSchema;
    script.setAttribute("data-json-ld", "true");
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, [serializedSchema]);
}
