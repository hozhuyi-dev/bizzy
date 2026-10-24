import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface Tick {
  /** Whether this one can be ticked now (something can be done with it, and it goes with what is ticked). */
  tickable: boolean;
  ticked: boolean;
  /** Whether any in the list is ticked: every slot that can be ticked then shows its circle. */
  ticking: boolean;
  onTickedChange: (ticked: boolean) => void;
  /** Its accessible name: "Tick Invoice INV-0012". */
  label: string;
}

interface TickSlotProps {
  /** What the slot shows while nothing is ticked: what kind of item it is. */
  icon: ReactNode;
  /** Left out, the slot is only its icon. */
  tick?: Tick | undefined;
}

/**
 * The round slot a row or card starts with: its icon, and its tick. A tap on
 * it ticks the item (a tap elsewhere opens it), and once one is ticked every
 * one that can be shows an empty circle, as a phone shows no hover; on a
 * wide screen a hover shows it first. One that can't be ticked keeps its
 * icon, faded while others are. The same size either way, so ticking moves
 * nothing.
 */
export function TickSlot({ icon, tick }: TickSlotProps) {
  const base = "flex size-9 shrink-0 items-center justify-center rounded-full";
  if (!tick?.tickable) {
    return (
      <span className={cn(base, "bg-muted/60 text-muted-foreground", tick?.ticking && "opacity-40")}>{icon}</span>
    );
  }
  const { ticked, ticking, onTickedChange, label } = tick;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ticked}
      aria-label={label}
      onClick={() => onTickedChange(!ticked)}
      className={cn(
        base,
        "group/slot cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        ticked ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted",
      )}
    >
      {ticked ? (
        <CheckIcon className="size-4" strokeWidth={3} />
      ) : (
        <>
          <span className={cn(ticking ? "hidden" : "contents group-hover/slot:hidden")}>{icon}</span>
          <span
            aria-hidden="true"
            className={cn(
              "size-4.5 rounded-full border-2 border-muted-foreground/50 bg-background",
              !ticking && "hidden group-hover/slot:block",
            )}
          />
        </>
      )}
    </button>
  );
}
