import { useState } from "react";
import { toast } from "sonner";
import { PackagesMutation } from "../../packages.mutation";
import { PackagesService } from "../../packages.service";
import { ClientFeeField } from "../../packages-impact.hook";
import type { Package } from "../../packages.types";
import type { Impact } from "~/features/billing/billing.types";
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
import { formatCents, parseCents } from "~/core/utils/money.util";

interface DeletePackageDialogProps {
  pkg: Package | null;
  clientName: string;
  onClose: () => void;
}

/**
 * Deletes a package (one added here, or one the calendar no longer buys).
 * What that leaves to fix (sessions losing its credits) is shown before it
 * goes (packages.impact), with the offer of a usual fee for a client who
 * has none.
 */
export function DeletePackageDialog({ pkg, clientName, onClose }: DeletePackageDialogProps) {
  return (
    <AlertDialog open={pkg !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {pkg && <DeletePackage key={pkg.id} pkg={pkg} clientName={clientName} onClose={onClose} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeletePackage({ pkg, clientName, onClose }: { pkg: Package; clientName: string; onClose: () => void }) {
  const remove = PackagesMutation.useDelete();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [clientFee, setClientFee] = useState("");
  const [checking, setChecking] = useState(false);

  const send = (confirm: boolean) =>
    remove.mutate(
      { id: pkg.id, options: { confirm, clientFeeCents: parseCents(clientFee) ?? undefined } },
      {
        onSuccess: () => {
          toast.success("Package deleted");
          onClose();
        },
        onError: (error) => toast.error(error.message),
      },
    );

  const onDelete = async () => {
    if (impact) return send(true);
    setChecking(true);
    try {
      const preview = await PackagesService.impact({ id: pkg.id, delete: true });
      if (preview.refused) return void toast.error(preview.refused);
      if (preview.needsConfirm) return void setImpact(preview);
      send(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this package?</AlertDialogTitle>
        <AlertDialogDescription>
          {clientName}, {pkg.sessions} sessions for {formatCents(pkg.priceCents)}. Sessions on its credits go back to
          their usual fee. This can't be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {impact && (
        <div className="flex flex-col gap-2 text-sm">
          <p>This leaves these to fix, on your to-do list:</p>
          <ul className="flex max-h-48 flex-col divide-y overflow-y-auto">
            {impact.brings.map((b) => (
              <li key={`${b.kind}-${b.id}-${b.rule}`} className="flex flex-col py-1.5">
                <span>{formatSessionTime(b.start)}</span>
                <span className="text-muted-foreground">{b.problem}</span>
              </li>
            ))}
          </ul>
          <ClientFeeField impact={impact} value={clientFee} onChange={setClientFee} />
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <Button variant="destructive" disabled={remove.isPending || checking} onClick={() => void onDelete()}>
          {remove.isPending ? "Deleting…" : impact ? "Delete anyway" : "Delete"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
