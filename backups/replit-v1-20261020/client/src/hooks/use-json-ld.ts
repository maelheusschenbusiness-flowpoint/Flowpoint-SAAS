import { useEffect } from "react";

export function useJsonLd(schema: object) {
  useEffect(() => {
    if (document.head.querySelector('script[type="application/ld+json"][data-json-ld="true"]')) {
      return;
    }

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify(schema);
    script.setAttribute("data-json-ld", "true");
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);
}
