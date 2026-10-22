import { toast } from "sonner";
import { PackagesMutation } from "../../packages.mutation";
import type { PackageView } from "../../packages.types";
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
import { formatCents } from "~/core/utils/money.util";
import { formatHours } from "~/core/utils/date.util";

interface DeletePackageDialogProps {
  pkg: PackageView | null;
  clientName: string;
  onClose: () => void;
}

/**
 * Deletes a package, with its draft invoice line. One that sessions use the
 * credits of, that was paid for, or that is on an issued invoice is refused
 * with what to do first.
 */
export function DeletePackageDialog({ pkg, clientName, onClose }: DeletePackageDialogProps) {
  const remove = PackagesMutation.useDelete();
  return (
    <SheetAlertDialog open={pkg !== null} onClose={onClose}>
      {pkg && (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this package?</AlertDialogTitle>
            <AlertDialogDescription>
              {clientName}, {formatHours(pkg.hours)} for {formatCents(pkg.priceCents)}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(pkg.id, {
                  onSuccess: () => {
                    toast.success("Package deleted");
                    onClose();
                  },
                  onError: toastRefusal,
                })
              }
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </>
      )}
    </SheetAlertDialog>
  );
}
