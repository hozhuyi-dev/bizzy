import { THEME_PREFERENCES } from "./theme.constant";
import type { ThemePreference } from "./theme.constant";
import type { Theme } from "./theme.types";

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}
