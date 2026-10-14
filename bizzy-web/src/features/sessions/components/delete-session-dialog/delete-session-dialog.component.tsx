import { useState } from "react";
import { toast } from "sonner";
import { SessionsMutation } from "../../sessions.mutation";
import { SessionsService } from "../../sessions.service";
import type { PackageChoice, Session } from "../../sessions.types";
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
import { Field, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatSessionTime } from "~/core/utils/date.util";

const PACKAGE_CHOICES: Array<{ value: PackageChoice; label: string }> = [
  { value: "keep", label: "Keep the package, as one of its own" },
  { value: "delete", label: "Delete the package too" },
];

interface DeleteSessionDialogProps {
  session: Session | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deletes a session that didn't happen (or a booking the client cancelled),
 * from her calendar too. A package bought in it is kept or deleted, as she
 * chooses here. What that leaves to fix (sessions losing its credits) is
 * shown before it goes (sessions.deleteImpact).
 */
export function DeleteSessionDialog({ session, onClose, onDeleted }: DeleteSessionDialogProps) {
  return (
    <AlertDialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {session && <DeleteSession key={session.eventId} session={session} onClose={onClose} onDeleted={onDeleted} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteSession({ session, onClose, onDeleted }: { session: Session; onClose: () => void; onDeleted: () => void }) {
  const remove = SessionsMutation.useDelete();
  const [pkg, setPkg] = useState<PackageChoice>("keep");
  // What deleting would leave to fix, once seen: deleting then confirms it.
  const [impact, setImpact] = useState<Impact | null>(null);
  const [checking, setChecking] = useState(false);
  const bought = (session.boughtCents ?? 0) > 0;

  const send = (confirm: boolean) =>
    remove.mutate(
      { eventId: session.eventId, pkg, confirm },
      {
        onSuccess: () => {
          toast.success("Session deleted");
          onDeleted();
          onClose();
        },
        onError: (error) => toast.error(error.message),
      },
    );

  const onDelete = async () => {
    if (impact) return send(true);
    setChecking(true);
    try {
      const preview = await SessionsService.deleteImpact(session.eventId, pkg);
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
        <AlertDialogTitle>Delete “{session.title}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {formatSessionTime(session.start)}. The event is deleted from your calendar too
          {session.record ? ", with the notes and files recorded here" : ""}.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {bought && (
        <Field>
          <FieldLabel>The package bought in it</FieldLabel>
          <Select
            items={PACKAGE_CHOICES}
            value={pkg}
            onValueChange={(value) => {
              if (!value) return;
              setPkg(value);
              setImpact(null);
            }}
          >
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
      {impact && (
        <div className="flex flex-col gap-1 text-sm">
          <p>This leaves these to fix, on your to-do list:</p>
          <ul className="flex max-h-48 flex-col divide-y overflow-y-auto">
            {impact.brings.map((b) => (
              <li key={`${b.kind}-${b.id}-${b.rule}`} className="flex flex-col py-1.5">
                <span>{formatSessionTime(b.start)}</span>
                <span className="text-muted-foreground">{b.problem}</span>
              </li>
            ))}
          </ul>
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
