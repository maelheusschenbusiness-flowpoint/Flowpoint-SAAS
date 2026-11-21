import { createContext, useContext, useEffect, useState } from "react";

type ResolvedTheme = "light" | "dark";
const ThemeContext = createContext<ResolvedTheme | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    try { window.localStorage.removeItem("flowpoint-theme"); } catch { /* Storage can be disabled. */ }

    const applySystemTheme = () => {
      document.documentElement.classList.toggle("dark", mq.matches);
      document.documentElement.style.colorScheme = mq.matches ? "dark" : "light";
      setResolvedTheme(mq.matches ? "dark" : "light");
    };

    applySystemTheme();
    mq.addEventListener("change", applySystemTheme);
    return () => mq.removeEventListener("change", applySystemTheme);
  }, []);

  return <ThemeContext.Provider value={resolvedTheme}>{children}</ThemeContext.Provider>;
}
