import { useEffect } from "react";
import { isTypedInto, keyboardInset } from "./keyboard-inset.util";

// After focus moves, a last look once the keyboard has finished coming up or
// going down: iOS doesn't always say so with an event of its own.
const SETTLE_MS = 400;

/**
 * Keeps `element` above a phone's keyboard by publishing how much of the
 * screen's bottom it covers as --keyboard-inset on it, for its classes to
 * lift it by (app.css). A phone's keyboard shrinks only the visual
 * viewport, and a fixed element sits at the bottom of the layout one,
 * under the keyboard. No CSS knows the keyboard on iOS (every browser
 * there is WebKit, which has neither interactive-widget nor the
 * VirtualKeyboard API), so this reads the visual viewport. With no
 * keyboard up it publishes 0 and leaves the element to CSS, which follows
 * the browser's bars folding away smoothly, as no script can.
 *
 * Read at most once a frame, and written only when it changes. It reads
 * again whenever the visual viewport moves, the page scrolls (iOS scrolls
 * the page itself to show the box being typed into) or focus moves.
 */
export function useKeyboardInset(element: HTMLElement | null) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!element || !viewport) return undefined;
    let frame = 0;
    let settle: number | undefined;
    let last = -1;
    const apply = () => {
      frame = 0;
      const inset = keyboardInset({
        layoutHeight: window.innerHeight,
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        scale: viewport.scale,
        editing: isTypedInto(document.activeElement),
      });
      if (inset === last) return;
      last = inset;
      element.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(apply);
    };
    const onFocus = () => {
      schedule();
      window.clearTimeout(settle);
      settle = window.setTimeout(schedule, SETTLE_MS);
    };
    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      element.style.removeProperty("--keyboard-inset");
    };
  }, [element]);
}
