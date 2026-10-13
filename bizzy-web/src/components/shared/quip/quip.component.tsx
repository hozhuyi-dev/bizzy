import { useQuip } from "./quip.hook";
import type { ReactNode } from "react";
import type { QuipPool } from "~/core/constants/quips.constant";
import { QUIPS } from "~/core/constants/quips.constant";

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
