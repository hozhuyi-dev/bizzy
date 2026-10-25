import { useEffect } from "react";
import { IOS, opensKeyboard, revealBy } from "./keyboard-inset.util";

// A finger moving further than this between down and up was scrolling, not tapping.
const TAP_SLOP_PX = 10;

// How long the keyboard may take to come up before the box is revealed anyway
// (a hardware keyboard, or none: the visual viewport never resizes).
const KEYBOARD_WAIT_MS = 600;

/**
 * Lets what is typed into inside `element` (the dock, a sheet) take focus
 * without iOS moving the page. iOS scrolls the whole page to bring a box
 * being focused to the middle of what the keyboard leaves, even a page that
 * can't scroll and a box in something fixed, which useKeyboardInset is
 * already lifting over the keyboard; the two fight, and what is fixed lands
 * too high. So a tap on such a box focuses it here, without scrolling, and
 * once the keyboard is up (and the element lifted over it) the box is
 * scrolled into view inside its own scrolling container, the page left
 * alone. So does focus moving to one from another (the keyboard's arrows).
 * React Aria's usePreventScroll does the same in its modals. Elsewhere
 * (not iOS) it does nothing.
 */
export function useFocusInPlace(element: HTMLElement | null) {
  useEffect(() => {
    if (!element || !IOS) return undefined;
    let start: { x: number; y: number } | undefined;
    let focusing = false;

    const focus = (box: HTMLElement) => {
      const keyboardUp = opensKeyboard(document.activeElement);
      focusing = true;
      box.focus({ preventScroll: true });
      focusing = false;
      revealWhenReady(box, element, keyboardUp);
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : undefined;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const tapped = event.target instanceof Element ? event.target : null;
      // A box's label focuses it too.
      const box = tapped?.closest("label")?.control ?? tapped;
      if (!start || !touch || !opensKeyboard(box) || box === document.activeElement) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP_PX) return;
      // Instead of iOS's own focus, and the scroll that comes with it.
      event.preventDefault();
      focus(box);
      // What else the tap would have done (a list of suggestions opens on a click).
      box.click();
    };
    const onBlur = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (focusing || !(next instanceof Element) || !element.contains(next) || !opensKeyboard(next)) return;
      focus(next);
    };

    element.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    element.addEventListener("touchend", onTouchEnd, { capture: true });
    element.addEventListener("blur", onBlur, true);
    return () => {
      element.removeEventListener("touchstart", onTouchStart, { capture: true });
      element.removeEventListener("touchend", onTouchEnd, { capture: true });
      element.removeEventListener("blur", onBlur, true);
    };
  }, [element]);
}

/** Scrolls the box into view once the keyboard is up: at once if it already was. */
function revealWhenReady(box: HTMLElement, within: HTMLElement, keyboardUp: boolean) {
  const viewport = window.visualViewport;
  // Two frames: useKeyboardInset lifts what the box is in on the next one.
  const reveal = () => requestAnimationFrame(() => requestAnimationFrame(() => scrollToReveal(box, within)));
  if (keyboardUp || !viewport) {
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

/** Brings the box to the middle of what can be seen of its scrolling container inside `within`, if any. */
function scrollToReveal(box: HTMLElement, within: HTMLElement) {
  const container = scrollingContainer(box, within);
  if (!container) return;
  const viewport = window.visualViewport;
  const view = container.getBoundingClientRect();
  const { top, bottom } = box.getBoundingClientRect();
  const by = revealBy({
    boxTop: top,
    boxBottom: bottom,
    viewTop: Math.max(view.top, viewport?.offsetTop ?? -Infinity),
    viewBottom: Math.min(view.bottom, viewport ? viewport.offsetTop + viewport.height : Infinity),
  });
  if (by === 0) return;
  const most = container.scrollHeight - container.clientHeight;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  container.scrollTo({ top: Math.max(0, Math.min(most, container.scrollTop + by)), behavior: reduce ? "auto" : "smooth" });
}

/** The nearest container of the box, up to and including `within`, that scrolls. */
function scrollingContainer(box: HTMLElement, within: HTMLElement): HTMLElement | undefined {
  for (let node = box.parentElement; node && within.contains(node); node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (/auto|scroll/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return undefined;
}
