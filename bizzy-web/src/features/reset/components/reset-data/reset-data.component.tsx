import { useState } from "react";
import { toast } from "sonner";
import { ResetMutation } from "../../reset.mutation";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

/** Wipes the environment's data, keeping the Google connection, and syncs the whole calendar back in. */
export function ResetData() {
  const [confirming, setConfirming] = useState(false);
  const reset = ResetMutation.useReset();

  return (
    <>
      <div>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Reset data
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(isOpen) => !isOpen && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all data?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes every session, client, package, payment, invoice, receipt and setting here.
              Google stays connected and nothing in your calendar or contacts changes: the whole
              calendar is synced back in straight after, with every session unmatched until you add
              its client again. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep data</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: ({ deleted, synced, syncError }) => {
                    if (syncError) toast.error(`Reset: ${deleted} items deleted, but the sync failed. ${syncError}`);
                    else toast.success(`Reset: ${deleted} items deleted, ${synced?.read ?? 0} calendar changes synced back`);
                    setConfirming(false);
                  },
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              {reset.isPending ? "Resetting and syncing…" : "Reset"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
