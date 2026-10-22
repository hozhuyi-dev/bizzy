import { createLink } from "@tanstack/react-router";
import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionBar } from "~/components/shared/actions/action-bar/action-bar.component";
import { useOpenRow } from "~/core/list/open-row.hook";
import { ROW_ACTIONS } from "~/components/shared/actions/row-actions/row-actions.constant";

/** How an item stands, as its marker shows it: the status tones of badges. */
export type TimelineTone = "neutral" | "done" | "info" | "waiting" | "attention";

const TONES: Record<TimelineTone, string> = {
  neutral: "bg-status-neutral text-status-neutral-foreground",
  done: "bg-status-done text-status-done-foreground",
  info: "bg-status-info text-status-info-foreground",
  waiting: "bg-status-waiting text-status-waiting-foreground",
  attention: "bg-status-attention text-status-attention-foreground",
};

/** An upcoming item's marker: the tone's colour as an outline, not yet filled in. */
const HOLLOW: Record<TimelineTone, string> = {
  neutral: "border-status-neutral-foreground/40 text-status-neutral-foreground",
  done: "border-status-done-foreground/40 text-status-done-foreground",
  info: "border-status-info-foreground/40 text-status-info-foreground",
  waiting: "border-status-waiting-foreground/40 text-status-waiting-foreground",
  attention: "border-status-attention-foreground/60 text-status-attention-foreground",
};

/**
 * What happened and what is coming, along a rail, newest first: what is
 * coming above a Now line (TimelineNow), what happened below it, in groups
 * (a month) when it runs long. Put it straight in a CardContent.
 */
export function Timeline({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {children}
    </ol>
  );
}

/** A stretch of the rail under a heading: "Oct 2026". */
export function TimelineGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-col">
      <h3 className="pt-3 pb-1 pl-10 text-xs font-medium text-muted-foreground">{label}</h3>
      <ol className="flex flex-col">{children}</ol>
    </li>
  );
}

/** The line between what is coming (above) and what happened (below). */
export function TimelineNow({ label = "Now" }: { label?: string }) {
  return (
    <li aria-label={label} className="flex items-center gap-2 py-2">
      <span aria-hidden="true" className="w-8 shrink-0 border-t-2 border-foreground" />
      <span className="text-xs font-semibold tracking-wide text-foreground uppercase">{label}</span>
      <span aria-hidden="true" className="flex-1 border-t-2 border-foreground" />
    </li>
  );
}

interface TimelineItemProps {
  /** On its marker; without one, a dot. */
  icon?: LucideIcon | undefined;
  /** How it stands; neutral unless said. */
  tone?: TimelineTone | undefined;
  /** Coming, not happened yet: a hollow marker on a dashed rail. */
  upcoming?: boolean | undefined;
  /** When, leading: "Tue 12 Oct · 10:00", a link to its page if it has one. */
  when: ReactNode;
  /** Beside when: its badges. */
  badges?: ReactNode;
  /** What it was: a summary, a document's name. Up to two lines. */
  title?: ReactNode;
  /** Quieter, under it: how long and where, what it comes to. */
  meta?: ReactNode;
  /** What it is tied to, as chips along the bottom (TimelineLink, TimelineChip). */
  links?: ReactNode;
  /** What to do with it now, beside it: Done on a follow-up waiting. */
  actions?: ReadonlyArray<Action> | undefined;
  /** Its page: a click anywhere on it opens it. Keep a link for it in `when` or `title`. */
  open?: LinkOptions | undefined;
  /** For one without a page: what a click on it does instead (open it to edit). */
  onOpen?: (() => void) | undefined;
}

/**
 * One thing on the rail: its marker, when, what, and what it is tied to.
 * Unlike a to-do row its height follows what it says, so a story reads
 * through; a long summary is cut at two lines.
 */
export function TimelineItem({
  icon: Icon,
  tone = "neutral",
  upcoming = false,
  when,
  badges,
  title,
  meta,
  links,
  actions,
  open,
  onOpen,
}: TimelineItemProps) {
  const openRow = useOpenRow();
  const tappable = open !== undefined || onOpen !== undefined;
  return (
    <li
      className={cn(
        // The rail runs through every marker, down the item's full height.
        "relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 py-2.5",
        "before:absolute before:top-0 before:bottom-0 before:left-3.75 before:border-l-2",
        upcoming ? "before:border-dashed before:border-border" : "before:border-border",
        tappable && [
          "z-0 cursor-pointer",
          "after:absolute after:inset-0 after:-z-10 after:rounded-md after:transition-colors hover:after:bg-muted/30",
        ],
      )}
      onClick={tappable ? (event) => openRow(event, open, onOpen) : undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative z-10 mt-0.5 flex size-6 items-center justify-center justify-self-center rounded-full ring-4 ring-card",
          upcoming ? cn("border-2 border-dashed bg-card", HOLLOW[tone]) : TONES[tone],
        )}
      >
        {Icon ? <Icon className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {when}
            {badges}
          </div>
          {title && <div className="line-clamp-2 text-sm">{title}</div>}
          {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
          {links && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">{links}</div>}
        </div>
        {/* On a phone under it, full width and big enough for a thumb, as on a to-do row. */}
        <ActionBar actions={actions} size="sm" className={ROW_ACTIONS} />
      </div>
    </li>
  );
}

/** A link along an item's bottom, as a small chip: "INV-0012 (+3)". */
function ChipAnchor({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

/** The router's Link as a timeline item's chip; takes the same props. */
export const TimelineLink = createLink(ChipAnchor);

/** What an item is tied to that has no page of its own, as a chip like its links. */
export function TimelineChip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{children}</span>;
}
