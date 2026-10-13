import type { FeeChange, FeeImpact } from "~/features/billing/billing.types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

interface FeeImpactDialogProps {
  impact: FeeImpact | null;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before new fees reprice sessions that were already paid or put on an
 * invoice or receipt: saving puts each of those on the to-do list to fix.
 */
export function FeeImpactDialog({ impact, saving, onConfirm, onCancel }: FeeImpactDialogProps) {
  const changes = impact?.changes ?? [];
  const settled = changes.filter((change) => change.paid || change.documents.length > 0).length;

  return (
    <AlertDialog open={impact !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Change the fee of {changes.length} {changes.length === 1 ? "session" : "sessions"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {settled} of them {settled === 1 ? "was" : "were"} already paid or put on an invoice or receipt. Each
            goes on your to-do list, to fix the payment or revise the document. To leave them as they are, start the
            new fee on a later day.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-72 flex-col divide-y overflow-y-auto text-sm">
          {changes.map((change) => (
            <ChangeRow key={change.eventId} change={change} />
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <Button disabled={saving} onClick={onConfirm}>
            {saving ? "Saving…" : "Change them"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ChangeRow({ change }: { change: FeeChange }) {
  const fee = (cents: number | undefined) => (cents === undefined ? "no fee" : formatCents(cents));
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span>{formatSessionTime(change.start)}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">
          {fee(change.beforeCents)} → <span className="text-foreground">{fee(change.afterCents)}</span>
        </span>
        {change.paid && <Badge variant="attention">Paid</Badge>}
        {change.documents.map((label) => (
          <Badge key={label} variant="attention">
            {label}
          </Badge>
        ))}
      </span>
    </li>
  );
}
