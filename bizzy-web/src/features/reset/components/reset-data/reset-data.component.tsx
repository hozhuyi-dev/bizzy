import { useState } from "react";
import { toast } from "sonner";
import { ResetMutation } from "../../reset.mutation";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";
import { useBackfill } from "~/features/sync/sync.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/** Wipes the environment's data, keeping the Google connection, and syncs the whole calendar back in: the sync, then the backfill. */
export function ResetData() {
  const [confirming, setConfirming] = useState(false);
  const reset = ResetMutation.useReset();
  const backfill = useBackfill();

  return (
    <>
      <div>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Reset data
        </Button>
      </div>

      <SheetAlertDialog open={confirming} onClose={() => setConfirming(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset all data?</AlertDialogTitle>
          <AlertDialogDescription>
            Deletes every session, client, package, payment, invoice, receipt and setting here.
            Google stays connected and nothing in your calendar or contacts changes: the whole
            calendar is synced back in straight after, older events a month at a time, with every
            session unmatched until you add its client again. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep data</AlertDialogCancel>
          <PendingButton
            variant="destructive"
            pending={reset.isPending}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: ({ deleted, synced, syncError }) => {
                  if (syncError) toast.error(`Reset: ${deleted} items deleted, but the sync failed. ${syncError}`);
                  else toast.success(`Reset: ${deleted} items deleted, ${synced?.read ?? 0} calendar changes synced back`);
                  setConfirming(false);
                  backfill(synced?.back);
                },
                onError: toastRefusal,
              })
            }
          >
            Reset
          </PendingButton>
        </AlertDialogFooter>
      </SheetAlertDialog>
    </>
  );
}
