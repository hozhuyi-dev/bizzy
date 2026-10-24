import type { ReactNode } from "react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionMenu } from "~/components/shared/actions/action-bar/action-bar.component";
import { InlineConfirm } from "~/components/shared/actions/inline-action/inline-action.component";
import { useCompactLayout } from "~/components/shared/layout/page-header/page-header.hook";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";

/** A destructive action asking first, in the footer: what it asks, and what doing it says on its button. */
export interface DialogConfirm {
  question: string;
  yes: string;
  pending: boolean;
  onYes: () => void;
  onNo: () => void;
}

interface DialogActionsProps {
  /**
   * Everything else that can be done to the item, behind ⋯ at the start, in
   * a page header's ⋯ order: the frequent (WhatsApp ▾, Mark done), the
   * rare, then its lifecycle, destructive last. Each says why by its `can`.
   */
  menu?: ReadonlyArray<Action> | undefined;
  onCancel: () => void;
  /** Set while a destructive action asks first: the footer is its question. */
  confirm?: DialogConfirm | null | undefined;
  /** The main action, at the end: the form's submit (Save, Add X). */
  children: ReactNode;
  className?: string | undefined;
}

/**
 * The footer of a dialog that is an item's home, as a page is: every action
 * on the item is here, so its rows need only the next step. ⋯ first (kept
 * to the left on a wide screen, an icon on a phone, its menu a sheet
 * there), then Cancel, then the main one. A destructive action asks in
 * place of the buttons, never in a dialog over the dialog.
 */
export function DialogActions({ menu = [], onCancel, confirm, children, className }: DialogActionsProps) {
  const compact = useCompactLayout();
  return (
    <DialogFooter className={className}>
      {confirm ? (
        <InlineConfirm {...confirm} />
      ) : (
        <>
          <ActionMenu
            actions={menu}
            menus={compact ? "sheet" : "dropdown"}
            // Its own width in the phone's row, where each button shares it.
            className="sm:mr-auto max-sm:w-(--touch-target)! max-sm:flex-none!"
          />
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {children}
        </>
      )}
    </DialogFooter>
  );
}
