import { useState } from "react";
import type { ReactNode } from "react";
import type { QuipPool } from "~/core/constants/quips.constant";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * A line from the pool, picked when the component mounts: it stays put while
 * the page re-renders and changes on the next visit. Give a component a key
 * when its pool can change in place.
 */
export function useQuip(pool: QuipPool): string {
  const [quip] = useState(() => pool[Math.floor(Math.random() * pool.length)] ?? "");
  return quip;
}

/** An empty list: the quip, with the plain explanation under it. */
export function EmptyState({ quips, children }: { quips: QuipPool; children?: ReactNode }) {
  const quip = useQuip(quips);
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <p className="text-sm font-medium">{quip}</p>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

/** Stands in for "Loading…". */
export function Loading() {
  const quip = useQuip(QUIPS.loading);
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {quip}
    </p>
  );
}
