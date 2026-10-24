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
  /** Whether what has focus is typed into. */
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

// Inputs that are tapped, not typed into: no keyboard comes up.
const UNTYPED = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** Whether an element brings up the keyboard while it has focus. */
export function isTypedInto(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !UNTYPED.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable === true;
}
