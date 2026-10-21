import { cn } from "cn";
import type { ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import { useOpenRow } from "~/components/shared/data-table/data-table-row.hook";

interface ListRowProps {
  /** Who or what, with its badges. */
  title: ReactNode;
  /** The line under it: when, what is owed. */
  meta?: ReactNode;
  /** The last line: a summary, notes, why it was refused. */
  detail?: ReactNode;
  /** The detail in full, for when it is cut short. */
  detailTitle?: string | undefined;
  /** Its buttons, or what they are swapped for (see inline-action). */
  actions?: ReactNode;
  /** Its page: a click anywhere on the row opens it. Keep a button for it in `actions`. */
  open?: LinkOptions | undefined;
  /** For one without a page: what a click anywhere on it does instead (open it to edit). Keep a button for it too. */
  onOpen?: (() => void) | undefined;
}

/**
 * One row of a list of things to do: who and what on the left, with the
 * buttons on the right on a wide screen; on a phone, the buttons go under
 * it, full width and big enough for a thumb, while the text stays as it is.
 *
 * Every row is the same height: three lines, each one line long (cut short
 * with an ellipsis), the last kept even when empty. So a row that gains a
 * summary, or a list that mixes rows with and without one, never shifts.
 *
 * With an `open` (or `onOpen`), a click anywhere on it opens it, like a
 * table row, except on its own links, buttons and fields. Inside a
 * RowListItem it reaches out over the item's padding, so the whole item
 * answers the click and lights up on hover.
 */
export function ListRow({ title, meta, detail, detailTitle, actions, open, onOpen }: ListRowProps) {
  const openRow = useOpenRow();
  const tappable = open !== undefined || onOpen !== undefined;

  return (
    <div
      className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4", tappable && TAPPABLE)}
      onClick={tappable ? (event) => openRow(event, open, onOpen) : undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex h-6 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap [&>a]:min-w-0 [&>a]:truncate [&>span]:min-w-0 [&>span]:truncate">
          {title}
        </div>
        <div className="h-5 truncate text-sm text-muted-foreground">{meta}</div>
        <div title={detailTitle} className="h-4 truncate text-xs text-muted-foreground">
          {detail}
        </div>
      </div>
      {actions && <div className={ROW_ACTIONS}>{actions}</div>}
    </div>
  );
}

// The hover band is a ::before over the RowListItem's padding (its px and
// py), behind the row's content (z-0 keeps it above the item's background).
const TAPPABLE = [
  "relative z-0 cursor-pointer",
  "before:absolute before:-inset-x-(--card-spacing) before:-inset-y-3 before:-z-10 before:transition-colors hover:before:bg-muted/30",
].join(" ");

/**
 * A row's buttons: on a phone every control 40px high, those with words
 * sharing the row, icon-only ones (with an aria-label) square. For any row
 * of things to do (a timeline's item too), so buttons are one size.
 */
export const ROW_ACTIONS = [
  "flex items-center gap-1.5 sm:shrink-0 sm:justify-end",
  "max-sm:[&_[data-slot=button]]:h-10 max-sm:[&_[data-slot=dropdown-menu-trigger]]:h-10 max-sm:[&_[data-slot=input]]:h-10",
  "max-sm:[&>[data-slot=button]:not([aria-label])]:flex-1 max-sm:[&>[data-slot=dropdown-menu-trigger]:not([aria-label])]:flex-1",
  "max-sm:[&_[aria-label][data-slot=button]]:min-w-10 max-sm:[&_[aria-label][data-slot=dropdown-menu-trigger]]:min-w-10",
].join(" ");
