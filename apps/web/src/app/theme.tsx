import { createContext, use, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_COOKIE = "pd-theme";
const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  return PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme preference is local UI state (React context), not Redux: nothing in the domain
 * depends on it. It is persisted in a cookie rather than localStorage so the *server*
 * can render the right `data-theme` — no flash of the wrong theme on load.
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: ThemePreference;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState(initial);

  const setTheme = (next: ThemePreference) => {
    setThemeState(next);
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) throw new Error("useTheme() requires <ThemeProvider>");
  return context;
}
