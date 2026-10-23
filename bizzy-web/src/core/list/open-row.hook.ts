import { useRouter } from "@tanstack/react-router";
import { opensRow } from "./open-row.util";
import type { KeyboardEvent, MouseEvent } from "react";
import type { LinkOptions } from "@tanstack/react-router";

/** What a row takes to open: spread on it (a table's row, a DataRow, a timeline item). */
export interface RowOpenProps {
  tabIndex: 0;
  onClick: (event: MouseEvent<Element>) => void;
  onKeyDown: (event: KeyboardEvent<Element>) => void;
}

/**
 * Makes a row open, as a whole: `link` (with Ctrl or ⌘ in a new tab), or
 * else `onOpen`. A click that isn't on something of its own (see opensRow)
 * opens it; so does Enter on the row itself, which takes a turn in the tab
 * order, so the row is the one way in by keyboard as by mouse, with no
 * link inside it to the same place.
 */
export function useOpenRow() {
  const router = useRouter();
  const open = (newTab: boolean, link: LinkOptions | undefined, onOpen: (() => void) | undefined) => {
    if (!link) onOpen?.();
    else if (newTab) window.open(router.buildLocation(link).href, "_blank", "noopener");
    else void router.navigate(link);
  };
  return (link: LinkOptions | undefined, onOpen?: () => void): RowOpenProps => ({
    tabIndex: 0,
    onClick: (event) => {
      if (!opensRow(event.target as Element, event.currentTarget, window.getSelection()?.toString() ?? "")) return;
      open(event.ctrlKey || event.metaKey, link, onOpen);
    },
    onKeyDown: (event) => {
      // Enter on a button or field in the row is theirs.
      if (event.key !== "Enter" || event.target !== event.currentTarget) return;
      event.preventDefault();
      open(event.ctrlKey || event.metaKey, link, onOpen);
    },
  });
}

/** How a row shows it has the keyboard: a ring inside its edges (a table row can't take a box-shadow). */
export const ROW_FOCUS = "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
