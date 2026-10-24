import { PackageForm } from "../package-form/package-form.component";
import type { ReactNode } from "react";
import type { PackageView } from "../../packages.types";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";

/**
 * The package a dialog is open for: a new one (for a client, to start
 * with), or one to edit, opened at its payment to pay for it.
 */
export type PackageTarget =
  | { mode: "new"; clientId?: string | undefined }
  | { mode: "edit"; pkg: PackageView; at?: "payment" | undefined }
  | null;

interface PackageDialogProps {
  target: PackageTarget;
  onClose: () => void;
  /** In place of "New package" ("Add package", on a client's page). */
  newTitle?: string | undefined;
  description?: ReactNode;
  /** Once saved, with what the toast says; it closes either way. */
  onDone?: ((done: string) => void) | undefined;
  /** Leaves the toast to onDone. */
  quiet?: boolean;
}

/**
 * Every package's one dialog, wherever it opens from: its home, as a page
 * is for a session. Its client, hours, price and day, and what was paid for
 * it, saved together (PackageForm); everything else done to it behind ⋯.
 */
export function PackageDialog({ target, onClose, newTitle = "New package", description, onDone, quiet }: PackageDialogProps) {
  return (
    <SheetDialog open={target !== null} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{target?.mode === "edit" ? "Edit package" : newTitle}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {target && (
        <PackageForm
          key={target.mode === "edit" ? target.pkg.id : "new"}
          pkg={target.mode === "edit" ? target.pkg : undefined}
          clientId={target.mode === "new" ? target.clientId : undefined}
          at={target.mode === "edit" ? target.at : undefined}
          quiet={quiet}
          onClose={onClose}
          onDone={(done) => {
            onClose();
            onDone?.(done);
          }}
        />
      )}
    </SheetDialog>
  );
}
