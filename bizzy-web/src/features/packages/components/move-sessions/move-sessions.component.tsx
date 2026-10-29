import { useState } from "react";
import { toast } from "sonner";
import type { PackageView } from "../../packages.types";
import { SessionsMutation } from "~/features/sessions/sessions.mutation";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { ClientsQuery } from "~/features/clients/clients.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface MoveSessionsProps {
  pkg: PackageView;
  /** Once they are moved, or it is closed. */
  onDone: () => void;
}

/**
 * The sessions of its clients their own fee pays, latest first, ticked to
 * be paid by this package instead: from before it was bought too, as when
 * a client buys a package after a session and counts it in. One paid, or
 * on an issued document, says why it can't move (its `can.changePay`).
 * All the ticked move, or none.
 */
export function MoveSessions({ pkg, onDone }: MoveSessionsProps) {
  const movable = SessionsQuery.useMovable(pkg.id, true);
  const clientsById = ClientsQuery.useById();
  const move = SessionsMutation.useMoveToPackage();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  if (movable.error) return <ErrorState error={movable.error} retry={movable.refetch} />;
  if (!movable.data) return <LoadingState />;
  if (movable.data.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState quips={QUIPS.packages}>No sessions of theirs are paid by their own fee.</EmptyState>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  const toggle = (id: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const shared = pkg.sharedWith.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-md border">
        {movable.data.map((session) => {
          const can = session.can.changePay;
          const id = `move-${session.id}`;
          return (
            <li key={session.id} className="flex items-start gap-3 p-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={ticked.has(session.id)}
                disabled={!can.ok}
                onCheckedChange={(checked) => toggle(session.id, checked)}
              />
              <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span>
                  {formatSessionTime(session.start)}
                  {shared && <> · {clientsById.get(session.clientId)?.name ?? session.clientName}</>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.invoice ? `${formatCents(session.feeCents)} fee` : "No fee yet"}
                  {!can.ok && can.why && ` · ${can.why}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <PendingButton
          type="button"
          size="sm"
          disabled={ticked.size === 0}
          pending={move.isPending}
          onClick={() =>
            move.mutate(
              { packageId: pkg.id, sessionIds: [...ticked] },
              {
                onSuccess: () => {
                  toast.success(ticked.size === 1 ? "1 session paid by this package" : `${ticked.size} sessions paid by this package`);
                  onDone();
                },
                onError: toastRefusal,
              },
            )
          }
        >
          Pay with this package{ticked.size > 0 ? ` (${ticked.size})` : ""}
        </PendingButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
