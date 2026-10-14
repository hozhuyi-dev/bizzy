import type { Impact } from "../../billing.types";
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

interface ImpactDialogProps {
  /** What saving would bring on; the dialog is open while set. */
  impact: Impact | null;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** What the confirm button says, e.g. "Delete anyway". */
  confirmLabel?: string;
  /** More choices that change what saving does, e.g. updating the payment. */
  children?: React.ReactNode;
}

/**
 * Shows what a save would leave on her to-do list to fix, before it does:
 * the API refuses it unless she confirms (see useImpactSave).
 */
export function ImpactDialog({ impact, saving, onConfirm, onCancel, confirmLabel = "Save anyway", children }: ImpactDialogProps) {
  const brings = impact?.brings ?? [];
  return (
    <AlertDialog open={impact !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            This leaves {brings.length} {brings.length === 1 ? "thing" : "things"} to fix
          </AlertDialogTitle>
          <AlertDialogDescription>Each goes on your to-do list. Go back to change it first, or save anyway.</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-72 flex-col divide-y overflow-y-auto text-sm">
          {brings.map((b) => (
            <li key={`${b.kind}-${b.id}-${b.rule}`} className="flex flex-col gap-0.5 py-2">
              <span>
                {b.kind === "package" ? "Package bought " : ""}
                {b.id === "new" ? "This one" : formatSessionTime(b.start)}
              </span>
              <span className="text-muted-foreground">{b.problem}</span>
            </li>
          ))}
        </ul>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <Button disabled={saving} onClick={onConfirm}>
            {saving ? "Saving…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
