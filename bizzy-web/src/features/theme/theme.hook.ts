import { useSyncExternalStore } from "react";
import { ThemeService } from "./theme.service";
import type { ThemePreference } from "./theme.constant";
import type { ThemeState } from "./theme.types";

/** The theme showing, and a setter that applies and remembers a new preference. */
export function useTheme(): ThemeState & { setPreference: (preference: ThemePreference) => void } {
  const state = useSyncExternalStore(ThemeService.subscribe, ThemeService.getState);
  return { ...state, setPreference: ThemeService.setPreference };
}
