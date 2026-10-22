import { useState } from "react";
import { toast } from "sonner";
import { SessionsMutation } from "../../sessions.mutation";
import type { SessionView } from "../../sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { AutocompleteInput } from "~/components/shared/form/autocomplete-input/autocomplete-input.component";
import { formatSessionTime } from "~/core/utils/date.util";

const REASON_SUGGESTIONS = ["Client cancelled", "No-show", "I cancelled"].map((value) => ({ value }));

interface CancelSessionDialogProps {
  session: SessionView | null;
  clientName: string;
  onClose: () => void;
}

/**
 * Calls a session off: the client cancelled, didn't come, or the user did.
 * It stays, with what was recorded on it, as a record; it no longer holds
 * its time or costs anything, and its event leaves the calendar. What
 * stands in the way (money received, an issued invoice) is refused with
 * what to do first.
 */
export function CancelSessionDialog({ session, clientName, onClose }: CancelSessionDialogProps) {
  return (
    <SheetAlertDialog open={session !== null} onClose={onClose}>
      {session && <CancelSession key={session.id} session={session} clientName={clientName} onClose={onClose} />}
    </SheetAlertDialog>
  );
}

function CancelSession({ session, clientName, onClose }: Omit<CancelSessionDialogProps, "session"> & { session: SessionView }) {
  const cancel = SessionsMutation.useCancel();
  const [reason, setReason] = useState("");

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel {clientName}'s session?</AlertDialogTitle>
        <AlertDialogDescription>
          {formatSessionTime(session.start)}. It stays here as cancelled, with anything recorded on it, and leaves your
          calendar. It costs nothing; a package bought in it stays, on its own.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Field>
        <FieldLabel htmlFor="cancel-reason">Why (optional)</FieldLabel>
        <AutocompleteInput id="cancel-reason" value={reason} onValueChange={setReason} suggestions={REASON_SUGGESTIONS} />
      </Field>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate(
              { id: session.id, reason },
              {
                onSuccess: () => {
                  toast.success("Session cancelled");
                  onClose();
                },
                onError: toastRefusal,
              },
            )
          }
        >
          {cancel.isPending ? "Cancelling…" : "Cancel session"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
