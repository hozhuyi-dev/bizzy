import { toast } from "sonner";
import { ClientsMutation } from "../../clients.mutation";
import type { ClientView } from "../../clients.types";
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
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";

interface DeleteClientDialogProps {
  client: ClientView;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deletes a client added by mistake, with nothing of theirs (its
 * `can.delete` says so); the others are archived. Their Google contact
 * stays.
 */
export function DeleteClientDialog({ client, open, onClose, onDeleted }: DeleteClientDialogProps) {
  const remove = ClientsMutation.useDelete();
  return (
    <SheetAlertDialog open={open} onClose={onClose}>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {client.name}?</AlertDialogTitle>
        <AlertDialogDescription>For a client added by mistake: they go for good. Their Google contact stays.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep them</AlertDialogCancel>
        <PendingButton
          variant="destructive"
          pending={remove.isPending}
          onClick={() =>
            remove.mutate(client.id, {
              onSuccess: () => {
                toast.success(`${client.name} deleted`);
                onDeleted();
                onClose();
              },
              onError: toastRefusal,
            })
          }
        >
          Delete
        </PendingButton>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}
