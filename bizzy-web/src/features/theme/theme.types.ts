import type { ThemePreference } from "./theme.constant";

export type Theme = "light" | "dark";

export interface ThemeState {
  preference: ThemePreference;
  /** What is showing: the preference, or the device's for "system". */
  theme: Theme;
}
