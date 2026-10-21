import { useBlocker } from "@tanstack/react-router";
import type { ShouldBlockFn } from "@tanstack/react-router";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";

// Every form with changes blocks on its own and the router asks them in turn,
// so one "Leave" answers for the others on the same navigation.
let leavingTo: string | undefined;

// The same page with other search params keeps the form on screen.
const leavesPage: ShouldBlockFn = ({ current, next }) =>
  current.pathname !== next.pathname && next.pathname !== leavingTo;

interface UnsavedChangesPromptProps {
  /** Whether there is anything to lose. */
  when: boolean;
}

/**
 * Asks before leaving with changes not saved yet: a link, going back, or
 * closing or reloading the tab (which the browser asks in its own words).
 * It only stops blocking on the next render, so a navigation straight after
 * a save or a delete passes ignoreBlocker.
 */
export function UnsavedChangesPrompt({ when }: UnsavedChangesPromptProps) {
  const blocker = useBlocker({ shouldBlockFn: leavesPage, disabled: !when, withResolver: true });

  return (
    <SheetAlertDialog open={blocker.status === "blocked"} onClose={() => blocker.reset?.()}>
      <AlertDialogHeader>
        <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
        <AlertDialogDescription>What you changed here will be lost.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep editing</AlertDialogCancel>
        <Button
          variant="destructive"
          onClick={() => {
            leavingTo = blocker.next?.pathname;
            // The other blockers are asked before any timer runs.
            setTimeout(() => (leavingTo = undefined));
            blocker.proceed?.();
          }}
        >
          Leave
        </Button>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}
