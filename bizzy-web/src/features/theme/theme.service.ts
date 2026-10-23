import { THEME_STORAGE_KEY } from "./theme.constant";
import { isThemePreference, resolveTheme } from "./theme.util";
import type { ThemePreference } from "./theme.constant";
import type { ThemeState } from "./theme.types";

// Storage can throw (private mode, blocked site data); the theme then just
// isn't remembered.
function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
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
