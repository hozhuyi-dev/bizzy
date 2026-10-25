import { useEffect } from "react";
import { IOS, keyboardInset, opensKeyboard } from "./keyboard-inset.util";

// After focus moves, a last look once the keyboard has finished coming up or
// going down: iOS doesn't always say so with an event of its own.
const SETTLE_MS = 400;

// How long the screen must keep still before what hid while it moved shows again.
const QUIET_MS = 150;

interface KeyboardInsetOptions {
  /**
   * On iOS, hides the element (data-keyboard-moving) while the keyboard
   * comes or goes and while the page moves under it, and shows it again
   * once all is still, where it then belongs. iOS moves what is fixed
   * before any script hears of it, so following it shows the element
   * overshooting and settling back; hidden, it is only ever seen in place.
   */
  hideWhileMoving?: boolean | undefined;
}

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
export function useKeyboardInset(element: HTMLElement | null, { hideWhileMoving = false }: KeyboardInsetOptions = {}) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!element || !viewport) return undefined;
    const hides = hideWhileMoving && IOS;
    let frame = 0;
    let settle: number | undefined;
    let quiet: number | undefined;
    let last = -1;
    // Until when a keyboard may still be coming: a while after focus goes
    // into a box. Not for as long as one has focus: iOS's own button puts
    // the keyboard away and leaves the box focused, and the page's scrolling
    // after that is only scrolling.
    let coming = 0;

    // Hidden at once (no fade, the move is under way), shown again after
    // the quiet; anything moving meanwhile starts the quiet again.
    const moving = () => {
      if (!hides) return;
      element.dataset.keyboardMoving = "";
      window.clearTimeout(quiet);
      quiet = window.setTimeout(still, QUIET_MS);
    };
    const still = () => {
      quiet = undefined;
      apply();
      // Shown a frame after its last move is drawn, unless that moved it again.
      requestAnimationFrame(() => {
        if (quiet === undefined) delete element.dataset.keyboardMoving;
      });
    };
    const apply = () => {
      frame = 0;
      const inset = keyboardInset({
        layoutHeight: window.innerHeight,
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        scale: viewport.scale,
        editing: opensKeyboard(document.activeElement),
      });
      if (inset === last) return;
      // The first reading is where it starts, not a move.
      if (last !== -1) moving();
      last = inset;
      element.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(apply);
    };
    // The screen moving while a keyboard is up, or coming: iOS moves what
    // is fixed with it, before this hears of it. One coming back to a box
    // still focused (tapped again) changes the inset, which hides it too.
    const onMove = () => {
      if (last > 0 || performance.now() < coming) moving();
      schedule();
    };
    const onFocus = (event: FocusEvent) => {
      if (event.type === "focusin" && event.target instanceof Element && opensKeyboard(event.target)) {
        coming = performance.now() + SETTLE_MS;
      }
      onMove();
      window.clearTimeout(settle);
      settle = window.setTimeout(schedule, SETTLE_MS);
    };
    apply();
    viewport.addEventListener("resize", onMove);
    viewport.addEventListener("scroll", onMove);
    window.addEventListener("scroll", onMove, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    return () => {
      viewport.removeEventListener("resize", onMove);
      viewport.removeEventListener("scroll", onMove);
      window.removeEventListener("scroll", onMove);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.clearTimeout(quiet);
      element.style.removeProperty("--keyboard-inset");
      delete element.dataset.keyboardMoving;
    };
  }, [element, hideWhileMoving]);
}
