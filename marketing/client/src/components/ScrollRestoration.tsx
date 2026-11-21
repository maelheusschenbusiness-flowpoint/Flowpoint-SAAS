import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

export function ScrollRestoration() {
  const [location] = useLocation();
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const lastLocation = useRef<string>(location);
  const isPopState = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      isPopState.current = true;
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (lastLocation.current === location) return;

    // Sauvegarder la position de la page qu'on quitte
    scrollPositions.current.set(lastLocation.current, window.scrollY);

    if (isPopState.current) {
      // Retour ou avance dans l'historique : restaurer la position mémorisée
      const saved = scrollPositions.current.get(location);
      if (saved !== undefined) {
        window.scrollTo({ top: saved, behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
      isPopState.current = false;
    } else {
      // Navigation normale (lien, menu) : remonter en haut
      window.scrollTo({ top: 0, behavior: "auto" });
    }

    lastLocation.current = location;
  }, [location]);

  return null;
}
