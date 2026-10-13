import { PAGE_HEADER } from "./scroll-spy.constant";

/**
 * The scrolling behind pages split into sections with a list of them to jump
 * between (SectionLayout, the session's PipelineLayout): which section is
 * being read, and where the sticky bars end. Shared so each layout keeps its
 * own look while the fiddly measuring lives in one place.
 */

/** The nav and the page header, in px: what sticks above every page. */
export function headersHeight(): number {
  const root = getComputedStyle(document.documentElement);
  const rem = parseFloat(root.fontSize) || 16;
  return parseFloat(root.getPropertyValue("--nav-height")) * rem + PAGE_HEADER;
}

/**
 * Where content sticks under the headers and a page banner of this height,
 * as a CSS length, for --sticky-top.
 */
export function stickyTop(bannerHeight: number): string {
  return `calc(var(--nav-height) + ${PAGE_HEADER + bannerHeight}px)`;
}

/** Scrolls a section's heading to just under the sticky bars. */
export function scrollToSection(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
