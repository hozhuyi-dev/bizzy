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
import { SheetAlertDialog } from "~/components/shared/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";

interface DeleteClientDialogProps {
  client: ClientView;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deletes a client with nothing left: one with sessions, packages,
 * documents or follow-ups is refused, saying which go first. Their Google
 * contact stays.
 */
export function DeleteClientDialog({ client, open, onClose, onDeleted }: DeleteClientDialogProps) {
  const remove = ClientsMutation.useDelete();
  return (
    <SheetAlertDialog open={open} onClose={onClose}>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {client.name}?</AlertDialogTitle>
        <AlertDialogDescription>Only a client with nothing recorded can go. Their Google contact stays.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep them</AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={remove.isPending}
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
          {remove.isPending ? "Deleting…" : "Delete"}
        </Button>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}
