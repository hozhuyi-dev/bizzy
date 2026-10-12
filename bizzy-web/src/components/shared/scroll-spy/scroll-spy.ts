import { useEffect, useRef, useState } from "react";

/**
 * The scrolling behind pages split into sections with a list of them to jump
 * between (SectionLayout, the session's PipelineLayout): which section is
 * being read, and where the sticky bars end. Shared so each layout keeps its
 * own look while the fiddly measuring lives in one place.
 */

// The page header (h-14) sticks under the nav, whose height is --nav-height.
const PAGE_HEADER = 56;

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
// Air between the stuck headers and a section heading scrolled to.
const DESKTOP_GAP = 24;
// Phones also have a sticky row of section links (h-11), plus air.
const PHONE_GAP = 44 + 16;

/** Scrolls a section's heading to just under the sticky bars. */
export function scrollToSection(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** An element's height, kept current as its content changes. */
export function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    // Rounded down: a fractional height (high-density phones) would otherwise
    // leave a sliver between the banner and what sticks below it, and content
    // would show through. Tucking under by a fraction is invisible.
    const observer = new ResizeObserver(() => setHeight(Math.floor(element.getBoundingClientRect().height)));
    observer.observe(element);
    return () => observer.disconnect();
  });
  return [ref, height] as const;
}

/**
 * The section being read: the last whose top has passed under the sticky
 * bars, or the last section once the page is scrolled to the bottom (a short
 * last section never reaches the top).
 */
export function useActiveSection(sectionIds: ReadonlyArray<string>, bannerHeight: number): string | undefined {
  const [active, setActive] = useState(sectionIds[0]);
  const ids = sectionIds.join(" ");

  useEffect(() => {
    const list = ids.split(" ");
    // A handful of sections: measuring on every scroll event is cheap.
    const update = () => {
      const offset = headersHeight() + bannerHeight + (window.matchMedia("(min-width: 48rem)").matches ? DESKTOP_GAP : PHONE_GAP);
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = list[0];
      for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top - offset <= 8) current = id;
      }
      setActive(atBottom ? list.at(-1) : current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ids, bannerHeight]);

  return active;
}
