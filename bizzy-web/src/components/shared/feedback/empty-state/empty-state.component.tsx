import type { ReactNode } from "react";
import type { QuipPool } from "~/core/constants/quips.constant";
import { BeeArt } from "~/components/shared/feedback/bee-art/bee-art.component";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";

/** An empty list or part: a drawing, the quip, and the plain explanation under it. */
export function EmptyState({ quips, children }: { quips: QuipPool; children?: ReactNode }) {
  const quip = useQuip(quips);
  return (
    <EmptyStateFrame art={<BeeArt pool="empty" quip={quip} />} title={quip}>
      {children}
    </EmptyStateFrame>
  );
}

interface EmptyStateFrameProps {
  art: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  role?: "status" | undefined;
}

/**
 * The shape of every quiet state in a list or a part of a page (empty, or
 * loading: see LoadingState): a drawing beside a line and a quieter one
 * under it, no taller than a table's row, so one gives way to another, or
 * to rows, without a jump.
 */
export function EmptyStateFrame({ art, title, children, role }: EmptyStateFrameProps) {
  return (
    <div role={role} className="flex min-w-0 items-center justify-center gap-3">
      <span aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:size-7">
        {art}
      </span>
      <div className="flex min-w-0 flex-col text-left">
        <p className="text-sm font-medium">{title}</p>
        {children && <p className="text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}
