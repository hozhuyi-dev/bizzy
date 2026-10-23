import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import type { ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionButton, ActionMenu } from "~/components/shared/actions/action-bar/action-bar.component";
import { Card, CardContent } from "~/components/ui/card";

interface DataCardProps {
  /** Who or what, with its badges; it names the card for screen readers. */
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
  /** Its page: a tap anywhere on the card opens it. */
  open?: LinkOptions | undefined;
  /** For one without a page: what a tap on the card does instead (open it to edit). */
  onOpen?: (() => void) | undefined;
}

/**
 * A table row on a phone, laid out like a to-do row (DataRow): three lines
 * of text, each one line long (cut short with an ellipsis), the last kept
 * even when empty; then its buttons along the bottom, full width and big
 * enough for a thumb. Every card in a list is one height, so the list
 * never shifts.
 *
 * With an `open` (or `onOpen`), a tap anywhere on the card opens it: a link
 * (or button) stretched under the content, which lets taps through to it
 * except on its own links and buttons, with a chevron at the side to say
 * so. The stretched link is also the way in by keyboard and screen reader,
 * named by the title; no button or link in the card need go there too.
 */
export function DataCard({ title, value, meta, detail, detailTitle, actions = [], more = [], open, onOpen }: DataCardProps) {
  const titleId = useId();
  const tappable = open !== undefined || onOpen !== undefined;
  const hasButtons = actions.length > 0 || more.length > 0;

  return (
    <Card size="sm" className={cn(tappable && "relative transition-colors has-[[data-card-link]:active]:bg-muted/40")}>
      {open ? (
        <Link {...open} data-card-link="" aria-labelledby={titleId} className={STRETCHED} />
      ) : (
        onOpen && (
          <button
            type="button"
            data-card-link=""
            aria-labelledby={titleId}
            className={cn(STRETCHED, "cursor-pointer")}
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
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex h-6 min-w-0 items-center gap-2">
              <div
                id={titleId}
                className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap [&>a]:min-w-0 [&>a]:truncate [&>span]:min-w-0 [&>span]:truncate"
              >
                {title}
              </div>
              {value !== undefined && <div className="shrink-0 font-medium tabular-nums">{value}</div>}
            </div>
            <div className="h-5 truncate text-sm text-muted-foreground">{meta}</div>
            <div title={detailTitle} className="h-4 truncate text-xs text-muted-foreground">
              {detail}
            </div>
          </div>
          {tappable && <ChevronRightIcon aria-hidden="true" className="-mr-1 size-4 shrink-0 text-muted-foreground/60" />}
        </div>

        {hasButtons && (
          <div className="flex h-(--touch-target) items-center gap-1.5">
            {actions.map((action) => (
              <ActionButton key={action.label} action={action} className="h-(--touch-target) min-w-0 flex-1" />
            ))}
            <ActionMenu actions={more} className="ml-auto size-(--touch-target) border-border" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Under the content, the card's full size; its ring shows on the card's edge.
const STRETCHED = "absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
