import { useState } from "react";
import { toast } from "sonner";
import { SessionsMutation } from "../../sessions.mutation";
import type { SessionView } from "../../sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
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
import { Field, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatSessionTime } from "~/core/utils/date.util";

const PACKAGE_CHOICES = [
  { value: "keep", label: "Keep the package, as one of its own" },
  { value: "delete", label: "Delete the package too" },
] as const;

interface DeleteSessionDialogProps {
  session: SessionView | null;
  clientName: string;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deletes a session that didn't happen (or a booking the client cancelled),
 * from the calendar too, with what was recorded on it. A package bought in
 * it is kept or deleted, as the user chooses here. What can't go (money received,
 * an issued invoice, credits other sessions use) is refused with what to do
 * first.
 */
export function DeleteSessionDialog({ session, clientName, onClose, onDeleted }: DeleteSessionDialogProps) {
  return (
    <AlertDialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {session && (
          <DeleteSession key={session.id} session={session} clientName={clientName} onClose={onClose} onDeleted={onDeleted} />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteSession({ session, clientName, onClose, onDeleted }: Required<Omit<DeleteSessionDialogProps, "session">> & { session: SessionView }) {
  const remove = SessionsMutation.useDelete();
  const [pkg, setPkg] = useState<"keep" | "delete">("keep");

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {clientName}'s session?</AlertDialogTitle>
        <AlertDialogDescription>
          {formatSessionTime(session.start)}. The event is deleted from your calendar too
          {session.record.summary || session.record.hasNotes || session.record.files > 0
            ? ", with the notes and files recorded here"
            : ""}
          .
        </AlertDialogDescription>
      </AlertDialogHeader>
      {session.bought && (
        <Field>
          <FieldLabel>The package bought in it</FieldLabel>
          <Select items={PACKAGE_CHOICES} value={pkg} onValueChange={(value) => value && setPkg(value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PACKAGE_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(
              { id: session.id, keepPackage: pkg === "keep" },
              {
                onSuccess: () => {
                  toast.success("Session deleted");
                  onDeleted();
                  onClose();
                },
                onError: toastRefusal,
              },
            )
          }
        >
          {remove.isPending ? "Deleting…" : "Delete"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
