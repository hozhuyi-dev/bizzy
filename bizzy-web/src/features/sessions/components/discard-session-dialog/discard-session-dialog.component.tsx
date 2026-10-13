import { toast } from "sonner";
import { allSessionDocuments } from "../../session-stage.util";
import { SessionsMutation } from "../../sessions.mutation";
import type { Session } from "../../sessions.types";
import { PackagesQuery } from "~/features/packages/packages.query";
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

/** Discarding drops what she recorded; a document must be cancelled first. */
export function DiscardSessionDialog({
  session,
  onClose,
  onDiscarded,
}: {
  session: Session | null;
  onClose: () => void;
  onDiscarded?: () => void;
}) {
  const discard = SessionsMutation.useDiscard();
  const packages = PackagesQuery.useList(true);
  const bought = session ? packages.data?.find((pkg) => pkg.id === session.eventId) : undefined;
  const documents = session ? allSessionDocuments(session, bought) : [];

  return (
    <AlertDialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this session?</AlertDialogTitle>
          <AlertDialogDescription>
            {documents.length > 0
              ? "An invoice or receipt covers it. Cancel or discard those first."
              : "Its notes and payment are deleted for good. It is already gone from your calendar."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={discard.isPending || documents.length > 0}
            onClick={() =>
              session &&
              discard.mutate(session.eventId, {
                onSuccess: () => {
                  toast.success("Session discarded");
                  onDiscarded?.();
                },
                onError: (error) => toast.error(error.message),
                onSettled: onClose,
              })
            }
          >
            Discard
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
