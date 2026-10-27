export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Kept per device, like the device's own light/dark setting. The pre-paint
 * script in index.html reads the same key, so keep the two in step.
 */
export const THEME_STORAGE_KEY = "bizzy.theme";

/** Each theme's --background (app.css) in hex, for the theme-color meta; index.html's script has them too. */
export const THEME_COLORS = { light: "#ffffff", dark: "#0a0a0a" } as const;
