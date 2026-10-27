import { opensKeyboard, revealBy } from "./keyboard-inset.util";
import { cssLength, headersHeight } from "~/core/scroll-spy/scroll-spy.util";

// How long the keyboard may take to come up before the box is revealed anyway
// (a hardware keyboard, or none: the visual viewport never resizes).
const KEYBOARD_WAIT_MS = 600;

/**
 * Runs `then` once a box just focused can be seen as it will stay: when the
 * keyboard it brings up is up (the visual viewport resized), at once when
 * one was up already or it brings none, and after KEYBOARD_WAIT_MS at the
 * latest. Two frames on, so what rides above the keyboard (the dock) has
 * been lifted.
 */
export function whenKeyboardReady(box: HTMLElement, keyboardWasUp: boolean, then: () => void) {
  const viewport = window.visualViewport;
  const reveal = () => requestAnimationFrame(() => requestAnimationFrame(then));
  if (keyboardWasUp || !opensKeyboard(box) || !viewport) {
    reveal();
    return;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    viewport.removeEventListener("resize", once);
    reveal();
  };
  viewport.addEventListener("resize", once);
  window.setTimeout(once, KEYBOARD_WAIT_MS);
}

/**
 * Puts the cursor in a box a button opened (a row's inline field, the
 * first field with an error) and brings it into view as tapping it would.
 * A tap scrolls the box above the keyboard; focus given by code comes
 * before the keyboard, so the browser scrolls (if at all) to where the
 * keyboard then covers it. So the box is focused without scrolling, and
 * once the keyboard is up the page is scrolled to put it in the middle of
 * what is left: under the sticky headers, over the keyboard and the dock.
 */
export function focusInView(box: HTMLElement) {
  const keyboardWasUp = opensKeyboard(document.activeElement);
  box.focus({ preventScroll: true });
  whenKeyboardReady(box, keyboardWasUp, () => revealOnPage(box));
}

/** Scrolls the page to bring a box to the middle of what can be seen of it, if it isn't in view. */
function revealOnPage(box: HTMLElement) {
  if (!box.isConnected) return;
  const viewport = window.visualViewport;
  const visibleTop = viewport?.offsetTop ?? 0;
  const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
  const { top, bottom } = box.getBoundingClientRect();
  const by = revealBy({
    boxTop: top,
    boxBottom: bottom,
    viewTop: Math.max(visibleTop, headersHeight()),
    // The dock rides above the keyboard, at the bottom of what can be seen.
    viewBottom: visibleBottom - cssLength("--dock-height"),
  });
  if (by === 0) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollBy({ top: by, behavior: reduce ? "auto" : "smooth" });
}
