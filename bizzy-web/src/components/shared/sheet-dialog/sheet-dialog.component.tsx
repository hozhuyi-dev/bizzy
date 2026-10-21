import { cn } from "cn";
import type { ReactNode } from "react";
import { AlertDialog, AlertDialogContent } from "~/components/ui/alert-dialog";
import { Dialog, DialogContent } from "~/components/ui/dialog";

/**
 * Roomy on a wide screen; on a phone, a sheet from the bottom, so a form
 * keeps its room above the keyboard. Taller than the screen, it scrolls,
 * its footer's buttons kept in view at the bottom; the title scrolls away,
 * leaving the room to the fields.
 */
const SHEET = [
  "max-h-[90dvh] overflow-y-auto sm:max-w-lg",
  "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0",
  "max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
  "max-sm:data-open:slide-in-from-bottom-8 max-sm:data-closed:slide-out-to-bottom-8",
  // Sticky over the fields scrolling under it: its muted tint laid on the
  // popover's colour, so nothing shows through.
  "[&_[data-slot$=dialog-footer]]:sticky [&_[data-slot$=dialog-footer]]:bottom-0 [&_[data-slot$=dialog-footer]]:z-10",
  "[&_[data-slot$=dialog-footer]]:bg-popover [&_[data-slot$=dialog-footer]]:bg-linear-to-b",
  "[&_[data-slot$=dialog-footer]]:from-muted/50 [&_[data-slot$=dialog-footer]]:to-muted/50",
  // The footer runs to the sheet's square bottom edge, and keeps clear of
  // the phone's home bar itself, as it is pinned there.
  "max-sm:[&_[data-slot$=dialog-footer]]:rounded-b-none",
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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={SHEET}>{children}</DialogContent>
    </Dialog>
  );
}

/** A confirmation, laid out as SheetDialog; a click outside leaves it open. */
export function SheetAlertDialog({ open, onClose, children }: SheetDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent className={ALERT_SHEET}>{children}</AlertDialogContent>
    </AlertDialog>
  );
}
