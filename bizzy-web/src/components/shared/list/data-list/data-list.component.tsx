import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import type { ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import { ROW_ACTIONS } from "~/components/shared/actions/row-actions/row-actions.constant";
import { useOpenRow } from "~/core/list/open-row.hook";

/**
 * A card's list of rows (DataRows, usually), split by lines that run to the
 * card's edges. Put it straight in a CardContent: it reaches out over the
 * card's padding sideways, and its rows' padding takes the place of the
 * room above and below, so it sits where a plain list would.
 */
export function DataList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="-mx-(--card-spacing) -my-3 flex flex-col divide-y">
      {children}
    </ul>
  );
}

interface DataListItemProps {
  children: ReactNode;
  /**
   * Just done: it folds away (in 300ms) instead of the list jumping, and
   * can't be used meanwhile. Leave it out for a list whose rows don't leave.
   */
  gone?: boolean | undefined;
}

/** One row of a DataList, padded evenly so a tappable DataRow's hover band fills it. */
export function DataListItem({ children, gone }: DataListItemProps) {
  const row = <div className="px-(--card-spacing) py-3">{children}</div>;
  if (gone === undefined) return <li>{row}</li>;
  return (
    <li
      inert={gone}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        gone ? "grid-rows-[0fr] border-transparent opacity-0" : "grid-rows-[1fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">{row}</div>
    </li>
  );
}

interface DataRowProps {
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
  /** Its page: a click anywhere on the row, or Enter on it, opens it; no button or link in it need go there too. */
  open?: LinkOptions | undefined;
  /** For one without a page: what opening it does instead (open it to edit). */
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
 * table row, except on its own links, buttons and fields; so does Enter
 * once it has the keyboard. Inside a DataListItem it reaches out over the
 * item's padding, so the whole item answers the click and lights up on
 * hover. On a phone, with no hover to tell, a chevron at its side says so.
 */
export function DataRow({ title, meta, detail, detailTitle, actions, open, onOpen }: DataRowProps) {
  const openRow = useOpenRow();
  const tappable = open !== undefined || onOpen !== undefined;

  return (
    <div
      className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4", tappable && TAPPABLE)}
      {...(tappable ? openRow(open, onOpen) : {})}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex h-6 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap [&>a]:min-w-0 [&>a]:truncate [&>span]:min-w-0 [&>span]:truncate">
            {title}
          </div>
          <div className="h-5 truncate text-sm text-muted-foreground">{meta}</div>
          <div title={detailTitle} className="h-4 truncate text-xs text-muted-foreground">
            {detail}
          </div>
        </div>
        {tappable && <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60 sm:hidden" />}
      </div>
      {actions && <div className={ROW_ACTIONS}>{actions}</div>}
    </div>
  );
}

// The hover band is a ::before over the DataListItem's padding (its px and
// py), behind the row's content (z-0 keeps it above the item's background).
const TAPPABLE = [
  "relative z-0 cursor-pointer",
  // The keyboard's ring goes round the band, not the text.
  "outline-none focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-ring",
  "before:absolute before:-inset-x-(--card-spacing) before:-inset-y-3 before:-z-10 before:transition-colors hover:before:bg-muted/30",
].join(" ");
