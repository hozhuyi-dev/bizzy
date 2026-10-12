import { useState } from "react";
import { toast } from "sonner";
import { ResetMutation } from "../../reset.query";
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

/** Wipes the environment's data, keeping the Google connection. */
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
              Deletes every session, client, package, receipt and setting here. Google stays
              connected, and nothing in your calendar or contacts changes, so syncing all time
              brings the sessions back. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep data</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: ({ deleted }) => {
                    toast.success(`Reset: ${deleted} items deleted`);
                    setConfirming(false);
                  },
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              {reset.isPending ? "Resetting…" : "Reset"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
