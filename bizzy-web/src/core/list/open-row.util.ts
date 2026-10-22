/** What answers a click on its own, so a click on it isn't a click on the row. */
const OWN_CLICK = "a, button, input, select, textarea, label, [role=menuitem], [role=checkbox]";

/**
 * Whether a click on a row should open the row's page: it landed on the row
 * itself (not on a menu portaled out of it, whose clicks still bubble
 * through React), not on something with a click of its own, and isn't the
 * end of selecting text.
 */
export function opensRow(target: Element, row: Element, selectedText: string): boolean {
  if (!row.contains(target)) return false;
  if (target.closest(OWN_CLICK)) return false;
  return selectedText === "";
}
