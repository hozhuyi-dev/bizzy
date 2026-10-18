import { PAGE_HEADER } from "./scroll-spy.constant";

/**
 * The scrolling behind pages split into sections with a list of them to jump
 * between (SectionLayout, the session's PipelineLayout): which section is
 * being read, and where the sticky bars end. Shared so each layout keeps its
 * own look while the fiddly measuring lives in one place.
 */

/**
 * The nav, the page header and its banners, in px: what sticks above every
 * page. The CSS twin is --sticky-top (app.css).
 */
export function headersHeight(): number {
  const root = getComputedStyle(document.documentElement);
  const rem = parseFloat(root.fontSize) || 16;
  const banners = parseFloat(root.getPropertyValue("--banners-height")) || 0;
  return parseFloat(root.getPropertyValue("--nav-height")) * rem + PAGE_HEADER + banners;
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
