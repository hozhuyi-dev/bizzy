import { createLink } from "@tanstack/react-router";
import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";

interface CellTextProps {
  /** The line that matters: a name, a date, an amount. */
  children: ReactNode;
  /** A quieter line under it: what helps tell rows apart. Kept short; cut with an ellipsis. */
  sub?: ReactNode;
  /** The full text of a line cut short, on hover. */
  title?: string | undefined;
  className?: string | undefined;
}

/**
 * A table cell's text: one line, and a quieter one under it. Neither wraps,
 * so every row keeps the table's one height whatever it holds.
 */
export function CellText({ children, sub, title, className }: CellTextProps) {
  return (
    <div title={title} className={cn("flex min-w-0 flex-col", className)}>
      <span className="truncate">{children}</span>
      {sub !== undefined && sub !== null && sub !== false && sub !== "" && (
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

/** What a cell shows when there is nothing: a quiet dash. */
export function CellEmpty() {
  return <span className="text-muted-foreground/60">—</span>;
}

/**
 * The row's name, where the whole row already opens its page: plain text to
 * the eye, but still a link, so the keyboard and screen readers have a way
 * in (a table row can't be one).
 */
function PlainAnchor({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "rounded-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

/** The router's Link with the row-name look; takes the same props. */
export const RowLink = createLink(PlainAnchor);
