import { useSyncExternalStore } from "react";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Theme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;
  /** What is showing: the preference, or the device's for "system". */
  theme: Theme;
}

/**
 * Kept per device, like the device's own light/dark setting. The pre-paint
 * script in index.html reads the same key, so keep the two in step.
 */
export const THEME_STORAGE_KEY = "bizzy.theme";

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

function isPreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

// Storage can throw (private mode, blocked site data); the theme then just
// isn't remembered.
function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

const listeners = new Set<() => void>();
let state: ThemeState = { preference: "system", theme: "light" };

function apply(preference: ThemePreference) {
  const theme = resolveTheme(preference, darkQuery().matches);
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // Native controls and scrollbars follow too.
  root.style.colorScheme = theme;
  state = { preference, theme };
  listeners.forEach((listener) => listener());
}

export const ThemeService = {
  /** Applies the saved preference and follows the device and other tabs. */
  init() {
    apply(readPreference());
    darkQuery().addEventListener("change", () => state.preference === "system" && apply("system"));
    window.addEventListener("storage", (event) => {
      if (event.key === THEME_STORAGE_KEY) apply(readPreference());
    });
  },

  setPreference(preference: ThemePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Still applies for this visit.
    }
    apply(preference);
  },

  getState: (): ThemeState => state,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useTheme(): ThemeState {
  return useSyncExternalStore(ThemeService.subscribe, ThemeService.getState);
}
