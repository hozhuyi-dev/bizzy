export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Kept per device, like the device's own light/dark setting. The pre-paint
 * script in index.html reads the same key, so keep the two in step.
 */
export const THEME_STORAGE_KEY = "bizzy.theme";
