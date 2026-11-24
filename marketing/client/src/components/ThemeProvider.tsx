import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  normalizeMarketingThemeMode,
  type MarketingThemeMode,
} from "@shared/marketing-theme";

type ResolvedTheme = "light" | "dark" | "system";
type ThemeContextValue = {
  mode: MarketingThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: MarketingThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  return useThemeSettings().resolved;
}

export function useThemeSettings() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemeSettings must be used within ThemeProvider");
  return context;
}

function getDocumentThemeMode(): MarketingThemeMode {
  if (typeof document === "undefined") return "system";
  return normalizeMarketingThemeMode(document.documentElement.dataset.theme) ?? "system";
}

function getInitialResolvedTheme(mode: MarketingThemeMode): ResolvedTheme {
  if (typeof window === "undefined" && mode === "system") return "system";
  if (mode !== "system") return mode;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeProvider({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  initialMode?: MarketingThemeMode;
}) {
  const [mode, setModeState] = useState<MarketingThemeMode>(
    () => initialMode ?? getDocumentThemeMode(),
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    () => getInitialResolvedTheme(initialMode ?? getDocumentThemeMode()),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const resolved = mode === "system" ? (mq.matches ? "dark" : "light") : mode;
      document.documentElement.dataset.theme = mode;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.style.colorScheme = resolved;
      setResolvedTheme(resolved);
    };

    applyTheme();
    mq.addEventListener("change", applyTheme);
    return () => mq.removeEventListener("change", applyTheme);
  }, [mode]);

  const setMode = (nextMode: MarketingThemeMode) => {
    const normalizedMode = normalizeMarketingThemeMode(nextMode) ?? "system";
    document.cookie = `flowpoint-theme=${normalizedMode}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      window.localStorage.setItem("flowpoint-theme", normalizedMode);
    } catch {
      // The theme cookie still keeps the preference when storage is unavailable.
    }
    setModeState(normalizedMode);
  };

  const value = useMemo(
    () => ({ mode, resolved: resolvedTheme, setMode }),
    [mode, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
