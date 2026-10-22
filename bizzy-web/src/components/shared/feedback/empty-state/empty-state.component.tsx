import type { ReactNode } from "react";
import type { QuipPool } from "~/core/constants/quips.constant";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";

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
