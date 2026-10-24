/**
 * Less than a phone's keyboard (250px and up), more than the screen loses
 * to the browser's bars coming back or to the page bouncing at an end.
 */
export const KEYBOARD_MIN_PX = 120;

/** What the browser says of the screen at one moment. */
export interface ViewportReading {
  /** The layout viewport's height (innerHeight), which a phone's keyboard leaves alone. */
  layoutHeight: number;
  /** The visual viewport's: what is left to see. */
  height: number;
  /** How far the visual viewport is scrolled down the layout one; under 0 while the page bounces. */
  offsetTop: number;
  scale: number;
  /** Whether what has focus brings up the keyboard. */
  editing: boolean;
}

/**
 * How much of the bottom of the layout viewport a phone's keyboard covers,
 * in px: 0 unless something is being typed into and the screen lost at
 * least a keyboard's height. The browser's bars folding and the page
 * bouncing at either end also change these numbers, and read as no
 * keyboard. Not while zoomed in, when the difference is the zoom's.
 */
export function keyboardInset({ layoutHeight, height, offsetTop, scale, editing }: ViewportReading): number {
  if (!editing || scale > 1.01) return 0;
  const covered = layoutHeight - height - Math.max(0, offsetTop);
  return covered >= KEYBOARD_MIN_PX ? Math.round(covered) : 0;
}

// Inputs typed into with the keyboard. A date or time opens the system's
// picker instead, and the rest are tapped.
const TYPED = new Set(["", "email", "number", "password", "search", "tel", "text", "url"]);

/** Whether an element brings up the keyboard while it has focus. */
export function opensKeyboard(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !element.disabled && TYPED.has(element.getAttribute("type") ?? "");
  }
  return element instanceof HTMLElement && element.isContentEditable === true;
}

/** Where a box is, and the part of its scrolling container that can be seen, in px down the screen. */
export interface RevealReading {
  boxTop: number;
  boxBottom: number;
  viewTop: number;
  viewBottom: number;
}

/**
 * How far to scroll a container down (up, when under 0) to bring a box to
 * the middle of what can be seen of it: 0 while it is already in view.
 */
export function revealBy({ boxTop, boxBottom, viewTop, viewBottom }: RevealReading): number {
  if (boxTop >= viewTop && boxBottom <= viewBottom) return 0;
  return Math.round(boxTop - viewTop - (viewBottom - viewTop - (boxBottom - boxTop)) / 2);
}
