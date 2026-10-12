import { toast } from "sonner";
import { SessionsMutation } from "../../sessions.mutation";
import type { Session } from "../../sessions.types";
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
import { formatSessionTime } from "~/core/utils/date.util";

interface DeleteSessionDialogProps {
  session: Session | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deletes a session that didn't happen (or a booking the client cancelled),
 * from her calendar too.
 */
export function DeleteSessionDialog({ session, onClose, onDeleted }: DeleteSessionDialogProps) {
  const remove = SessionsMutation.useDelete();

  return (
    <AlertDialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{session?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {session && formatSessionTime(session.start)}. The event is deleted from your calendar too
            {session?.record || session?.payment ? ", with the notes and payment recorded here" : ""}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              session &&
              remove.mutate(session.eventId, {
                onSuccess: () => {
                  toast.success("Session deleted");
                  onDeleted();
                },
                onError: (error) => toast.error(error.message),
                onSettled: onClose,
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
