import { useEffect, useRef, useState } from "react";
import { DESKTOP_GAP, PHONE_GAP } from "./scroll-spy.constant";
import { headersHeight } from "./scroll-spy.util";

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
