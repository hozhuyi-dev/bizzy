import { useRouter } from "@tanstack/react-router";
import { opensRow } from "./open-row.util";
import type { MouseEvent } from "react";
import type { LinkOptions } from "@tanstack/react-router";

/**
 * A click on a row (a table's, or a DataRow) that isn't on something of its
 * own (see opensRow): opens `link`, with Ctrl or ⌘ in a new tab, or else
 * calls `onOpen`. The row's own link or button stays the way there by
 * keyboard.
 */
export function useOpenRow() {
  const router = useRouter();
  return (event: MouseEvent<Element>, link: LinkOptions | undefined, onOpen?: () => void) => {
    if (!opensRow(event.target as Element, event.currentTarget, window.getSelection()?.toString() ?? "")) return;
    if (!link) {
      onOpen?.();
      return;
    }
    if (event.ctrlKey || event.metaKey) window.open(router.buildLocation(link).href, "_blank", "noopener");
    else void router.navigate(link);
  };
}
