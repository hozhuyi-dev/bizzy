import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "cn";
import type { ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import { ActionButton, ActionMenu } from "~/components/shared/action-bar/action-bar.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

interface DataCardProps {
  /** Who or what, linking to its page, with its badges. */
  title: ReactNode;
  /** At the top right, what matters at a glance: an amount. */
  value?: ReactNode;
  /** The line under the title: when, where, how much. */
  meta?: ReactNode;
  /** The last line: a summary, notes. */
  detail?: ReactNode;
  /** The detail in full, for when it is cut short. */
  detailTitle?: string | undefined;
  /** Its buttons, along the bottom. */
  actions?: ReadonlyArray<Action> | undefined;
  /** The rest, behind ⋯. */
  more?: ReadonlyArray<Action> | undefined;
  /** Its page, as an Open button after the actions. */
  open?: LinkOptions | undefined;
  /** For one without a page: what a tap on the card does instead (open it to edit); keep a button for it in `actions`. */
  onOpen?: (() => void) | undefined;
}

/**
 * A table row on a phone, laid out like a to-do row (ListRow): three lines
 * of text, each one line long (cut short with an ellipsis), the last kept
 * even when empty; then its buttons along the bottom, full width and big
 * enough for a thumb. Every card in a list is one height, so the list
 * never shifts. Give every card of a list an `open` (or none), so they all
 * have a row of buttons, or none do.
 *
 * With an `open` (or `onOpen`), a tap anywhere on the card opens it: a link stretched
 * under the content, which lets taps through to it except on its own links
 * and buttons. The Open button is the way there for screen readers and the
 * keyboard; the stretched link is hidden from both.
 */
export function DataCard({ title, value, meta, detail, detailTitle, actions = [], more = [], open, onOpen }: DataCardProps) {
  const tappable = open !== undefined || onOpen !== undefined;
  const hasButtons = actions.length > 0 || more.length > 0 || open !== undefined;
  // Alone, Open takes the row; beside actions it keeps to its label.
  const openAlone = actions.length === 0 && more.length === 0;

  return (
    <Card size="sm" className={cn(tappable && "relative transition-colors has-[[data-card-link]:active]:bg-muted/40")}>
      {open ? (
        <Link {...open} data-card-link="" tabIndex={-1} aria-hidden="true" className="absolute inset-0" />
      ) : (
        onOpen && (
          <button
            type="button"
            data-card-link=""
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 cursor-pointer"
            onClick={onOpen}
          />
        )
      )}
      <CardContent
        className={cn(
          "flex flex-col gap-3",
          tappable && "pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto",
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex h-6 min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap [&>a]:min-w-0 [&>a]:truncate [&>span]:min-w-0 [&>span]:truncate">
              {title}
            </div>
            {value !== undefined && <div className="shrink-0 font-medium tabular-nums">{value}</div>}
          </div>
          <div className="h-5 truncate text-sm text-muted-foreground">{meta}</div>
          <div title={detailTitle} className="h-4 truncate text-xs text-muted-foreground">
            {detail}
          </div>
        </div>

        {hasButtons && (
          <div className="flex h-10 items-center gap-1.5">
            {actions.map((action) => (
              <ActionButton key={action.label} action={action} className="h-10 min-w-0 flex-1" />
            ))}
            <ActionMenu actions={more} className="ml-auto size-10 border-border" />
            {open && (
              <Button
                variant="ghost"
                className={cn("h-10", openAlone && "flex-1")}
                render={<Link {...open} />}
                nativeButton={false}
              >
                Open <ArrowRightIcon />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
