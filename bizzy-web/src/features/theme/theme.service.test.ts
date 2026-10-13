import { THEME_STORAGE_KEY } from "./theme.constant";
import { ThemeService } from "./theme.service";
import { resolveTheme } from "./theme.util";

describe("theme", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  test("system follows the device", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  test("setting a preference applies and remembers it", () => {
    ThemeService.setPreference("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(ThemeService.getState()).toEqual({ preference: "dark", theme: "dark" });

    ThemeService.setPreference("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  test("init applies the saved preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    ThemeService.init();
    expect(document.documentElement).toHaveClass("dark");
  });

  test("an unknown saved value falls back to system", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    ThemeService.init();
    expect(ThemeService.getState().preference).toBe("system");
  });
});
