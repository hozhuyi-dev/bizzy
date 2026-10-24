import { cn } from "cn";
import { useState } from "react";
import type { ReactNode } from "react";
import { AlertDialog, AlertDialogContent } from "~/components/ui/alert-dialog";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { useKeyboardInset } from "~/core/viewport/keyboard-inset.hook";

/**
 * Roomy on a wide screen; on a phone, a sheet from the bottom, so a form
 * keeps its room above the keyboard. Taller than the screen, it scrolls,
 * its footer's buttons kept in view at the bottom; the title scrolls away,
 * leaving the room to the fields. On a phone it rides above the keyboard
 * (useKeyboardInset), so the footer's buttons stay in reach while typing.
 */
const SHEET = [
  "max-h-[calc(90dvh-var(--keyboard-inset))] overflow-y-auto sm:max-w-lg",
  "max-sm:top-auto max-sm:bottom-(--keyboard-inset) max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0",
  "max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
  "max-sm:data-open:slide-in-from-bottom-8 max-sm:data-closed:slide-out-to-bottom-8",
  // Sticky over the fields scrolling under it: its muted tint laid on the
  // popover's colour, so nothing shows through. It sticks inside the
  // dialog's padding, so it is pulled down by that (p-4, and pb-4 below on
  // a phone) to sit on the bottom edge.
  "[&_[data-slot$=dialog-footer]]:sticky [&_[data-slot$=dialog-footer]]:-bottom-4 [&_[data-slot$=dialog-footer]]:z-10",
  "[&_[data-slot$=dialog-footer]]:bg-popover [&_[data-slot$=dialog-footer]]:bg-linear-to-b",
  "[&_[data-slot$=dialog-footer]]:from-muted/50 [&_[data-slot$=dialog-footer]]:to-muted/50",
  // The footer runs to the sheet's square bottom edge, and keeps clear of
  // the phone's home bar itself, as it is pinned there.
  "max-sm:[&_[data-slot$=dialog-footer]]:rounded-b-none",
  // On a phone its buttons share one row, each as wide as the next and a
  // thumb's height, as a DataCard's: Cancel first, the main one at the edge.
  "max-sm:[&_[data-slot$=dialog-footer]]:flex-row",
  "max-sm:[&_[data-slot$=dialog-footer]>*]:h-(--touch-target) max-sm:[&_[data-slot$=dialog-footer]>*]:min-w-0 max-sm:[&_[data-slot$=dialog-footer]>*]:flex-1",
  "max-sm:has-[[data-slot$=dialog-footer]]:pb-4 max-sm:[&_[data-slot$=dialog-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))]",
].join(" ");

/** The alert dialog sizes itself by data-size, so it is widened the same way. */
const ALERT_SHEET = cn(SHEET, "data-[size=default]:max-w-none data-[size=default]:sm:max-w-lg");

interface SheetDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Every dialog in the app: a form, or a panel to act on. */
export function SheetDialog({ open, onClose, children }: SheetDialogProps) {
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  useKeyboardInset(sheet);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent ref={setSheet} className={SHEET}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A confirmation, laid out as SheetDialog; a click outside leaves it open. */
export function SheetAlertDialog({ open, onClose, children }: SheetDialogProps) {
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  useKeyboardInset(sheet);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent ref={setSheet} className={ALERT_SHEET}>
        {children}
      </AlertDialogContent>
    </AlertDialog>
  );
}
