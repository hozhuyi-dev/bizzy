import { useCallback, useEffect, useRef, useState } from "react";
import { DESKTOP_GAP, PHONE_GAP } from "./scroll-spy.constant";
import { headersHeight, scrollToSection } from "./scroll-spy.util";

// How long the page must be still before a jump counts as landed.
const SETTLE_MS = 150;

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
 *
 * With jumpTo, for the contents links: the section jumped to is current at
 * once and stays so while the page scrolls there, so the sections passed on
 * the way don't flicker through the list (or swing the phone's row). Reading
 * resumes once the page has been still a moment, wherever it stopped.
 */
export function useActiveSection(sectionIds: ReadonlyArray<string>) {
  const [active, setActive] = useState(sectionIds[0]);
  const ids = sectionIds.join(" ");
  const jumping = useRef(false);
  const settle = useRef<number | undefined>(undefined);
  const update = useRef<() => void>(() => undefined);

  // Each scroll during a jump puts off reading again until the page is still.
  const holdUntilStill = useCallback(() => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      jumping.current = false;
      update.current();
    }, SETTLE_MS);
  }, []);

  const jumpTo = useCallback(
    (id: string) => {
      jumping.current = true;
      setActive(id);
      scrollToSection(id);
      holdUntilStill();
    },
    [holdUntilStill],
  );

  useEffect(() => {
    const list = ids.split(" ");
    // A handful of sections: measuring on every scroll event is cheap.
    const read = () => {
      const offset = headersHeight() + (window.matchMedia("(min-width: 48rem)").matches ? DESKTOP_GAP : PHONE_GAP);
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = list[0];
      for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top - offset <= 8) current = id;
      }
      setActive(atBottom ? list.at(-1) : current);
    };
    const onScroll = () => (jumping.current ? holdUntilStill() : read());
    update.current = read;
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", read);
      window.clearTimeout(settle.current);
    };
  }, [ids, holdUntilStill]);

  return [active, jumpTo] as const;
}

/**
 * Keeps the current link of a sideways-scrolling list (the phone's row of
 * section links) in the row's middle, as far as its ends allow: the browser
 * stops the scroll at either end. Does nothing while the list fits (the
 * column on wider screens). Put the ref on the list; it finds the link by
 * aria-current.
 */
export function useCenteredCurrent<T extends HTMLElement>(active: string | undefined) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const list = ref.current;
    const link = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    // Sideways only: scrollIntoView would also move the page.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      left: link.offsetLeft + link.offsetWidth / 2 - list.clientWidth / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active]);
  return ref;
}
