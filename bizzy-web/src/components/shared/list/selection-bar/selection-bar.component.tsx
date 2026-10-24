import { cn } from "cn";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { useSelectionTarget } from "./selection-bar.hook";
import type { ReactNode } from "react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionBar } from "~/components/shared/actions/action-bar/action-bar.component";
import { Button } from "~/components/ui/button";

interface SelectionBarProps {
  /** How many are ticked; none hides the bar. */
  count: number;
  /** Under the count: whose they are, what they come to. */
  summary?: ReactNode;
  /** What can be done with them, the main one last (at the edge). */
  actions: ReadonlyArray<Action>;
  /** Beside them on a wide screen, behind ⋯ on a phone. */
  more?: ReadonlyArray<Action> | undefined;
  /** Behind ⋯ always: Tick all. */
  menu?: ReadonlyArray<Action> | undefined;
  onClear: () => void;
}

/**
 * What can be done with the ticked, while any are, where the page keeps its
 * actions: on a phone it takes the dock over (PageDock), on a wide screen
 * the page header's action area, or its section's beside the heading when
 * the list is a section's (a client's documents); the actions it covers wait
 * under it, and the title stays. ✕ or Escape clears the ticks. Before any
 * is ticked, a SelectionHint can say there is something to tick for.
 */
export function SelectionBar({ count, summary, actions, more, menu, onClear }: SelectionBarProps) {
  const { target, compact, inSection } = useSelectionTarget();

  useEffect(() => {
    if (count === 0) return undefined;
    const onKey = (event: KeyboardEvent) => {
      // A field's or a dialog's own Escape comes first.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [role=dialog]")) return;
      onClear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onClear]);

  if (count === 0 || !target) return null;
  return createPortal(
    <div
      data-selecting=""
      role="region"
      aria-label="Ticked"
      className={cn("flex min-w-0 items-center", compact ? "flex-1 gap-1" : "gap-2")}
    >
      <Button
        variant="ghost"
        size={compact ? "icon-lg" : inSection ? "icon-sm" : "icon"}
        aria-label="Clear the ticks"
        onClick={onClear}
      >
        <XIcon />
      </Button>
      {/* As after the dock's ←: what leaves on the left, what it is about after the line. */}
      <div aria-hidden="true" className={cn("mx-0.5 w-px shrink-0 bg-border", inSection ? "h-4" : "h-6")} />
      <div
        className={cn("mr-2 flex min-w-0", inSection ? "items-baseline gap-1.5" : "flex-col", compact && "flex-1")}
        aria-live="polite"
      >
        <span className="shrink-0 text-sm font-medium">{count} ticked</span>
        {summary && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
      </div>
      <ActionBar
        actions={actions}
        more={more}
        menu={menu}
        size={compact ? "lg" : inSection ? "sm" : "default"}
        menus={compact ? "sheet" : "dropdown"}
        defaultStyle="secondary"
        className="gap-1"
      />
    </div>,
    target,
  );
}

/**
 * Where the SelectionBar will come, while nothing is ticked: one short line
 * saying ticking does something ("Tick documents for more actions"). Only
 * in room left empty: on a phone, not while the dock holds actions or a
 * search is being typed.
 */
export function SelectionHint({ children }: { children: ReactNode }) {
  const { target, compact, inSection } = useSelectionTarget();
  if (!target) return null;
  return createPortal(
    <p
      className={cn(
        "min-w-0 text-muted-foreground",
        compact
          ? "line-clamp-2 flex-1 px-2 text-right text-xs leading-tight group-has-data-searching/dock:hidden group-has-[.dock-actions]/dock:hidden"
          : cn("truncate", inSection ? "text-xs" : "text-sm"),
      )}
    >
      {children}
    </p>,
    target,
  );
}
