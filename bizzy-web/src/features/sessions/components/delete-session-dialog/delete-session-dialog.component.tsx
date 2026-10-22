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
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
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
 * Deletes a session booked by mistake, from the calendar too. One with
 * history is cancelled instead (its `can.delete` says so). A package bought
 * in it is kept or, where its `can.deleteWithPackage` allows, deleted too.
 */
export function DeleteSessionDialog({ session, clientName, onClose, onDeleted }: DeleteSessionDialogProps) {
  return (
    <SheetAlertDialog open={session !== null} onClose={onClose}>
      {session && (
        <DeleteSession key={session.id} session={session} clientName={clientName} onClose={onClose} onDeleted={onDeleted} />
      )}
    </SheetAlertDialog>
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
          {formatSessionTime(session.start)}. For a booking made by mistake: it goes, and its event leaves your
          calendar.
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
                <SelectItem
                  key={choice.value}
                  value={choice.value}
                  disabled={choice.value === "delete" && !session.can.deleteWithPackage.ok}
                >
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!session.can.deleteWithPackage.ok && (
            <FieldDescription>It stays: {session.can.deleteWithPackage.why}</FieldDescription>
          )}
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
