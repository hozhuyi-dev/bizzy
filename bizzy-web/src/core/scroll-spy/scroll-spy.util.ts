/**
 * The scrolling behind pages split into sections with a list of them to jump
 * between (PageSections, the session's PipelineLayout): which section is
 * being read, and where the sticky bars end. Shared so each layout keeps its
 * own look while the fiddly measuring lives in one place.
 */

/** A length custom property (app.css) in px, as it applies to `element`: rem or px. */
export function cssLength(name: string, element: Element = document.documentElement): number {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const n = parseFloat(value) || 0;
  if (!value.endsWith("rem")) return n;
  return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
}

/**
 * The nav, the page header and its banners, in px: what sticks above every
 * page. The CSS twin is --sticky-top (app.css).
 */
export function headersHeight(): number {
  return cssLength("--nav-height") + cssLength("--page-header-height") + cssLength("--banners-height");
}

/**
 * Where a section's heading counts as reached, in px from the top: under
 * the headers, plus air, plus on a phone the row of section links the
 * section's layout sets (--contents-height, inherited from it).
 */
export function readingLine(section: Element | null, wide: boolean): number {
  const gap = cssLength("--section-gap");
  return headersHeight() + gap + (wide || !section ? 0 : cssLength("--contents-height", section));
}

/** Whether the screen is md (Tailwind's) or wider, where contents sit in a column. */
export function isWide(): boolean {
  const md = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-md").trim() || "48rem";
  return window.matchMedia(`(min-width: ${md})`).matches;
}

/** Publishes the page banners' height as --banners-height, for --sticky-top. */
export function setBannersHeight(height: number | undefined) {
  const root = document.documentElement.style;
  if (height === undefined) root.removeProperty("--banners-height");
  else root.setProperty("--banners-height", `${height}px`);
}

/** Scrolls a section's heading to just under the sticky bars. */
export function scrollToSection(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
