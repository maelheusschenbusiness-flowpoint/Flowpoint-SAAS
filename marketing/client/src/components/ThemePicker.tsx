import { useThemeSettings } from "@/components/ThemeProvider";
import type { MarketingThemeMode } from "@shared/marketing-theme";

export function ThemePicker({ className = "" }: { className?: string }) {
  const { mode, setMode } = useThemeSettings();

  return (
    <select
      aria-label="Color theme"
      className={className}
      data-testid="theme-picker"
      data-theme-picker
      value={mode}
      onChange={(event) => setMode(event.currentTarget.value as MarketingThemeMode)}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
