import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A card's list of rows (ListRows, usually), split by lines that run to the
 * card's edges. Put it straight in a CardContent: it reaches out over the
 * card's padding sideways, and its rows' padding takes the place of the
 * room above and below, so it sits where a plain list would.
 */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="-mx-(--card-spacing) -my-3 flex flex-col divide-y">
      {children}
    </ul>
  );
}

interface RowListItemProps {
  children: ReactNode;
  /**
   * Just done: it folds away (in 300ms) instead of the list jumping, and
   * can't be used meanwhile. Leave it out for a list whose rows don't leave.
   */
  gone?: boolean | undefined;
}

/** One row of a RowList, padded evenly so a tappable ListRow's hover band fills it. */
export function RowListItem({ children, gone }: RowListItemProps) {
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
