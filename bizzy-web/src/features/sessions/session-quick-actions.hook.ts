import { CheckIcon, PencilLineIcon, XIcon } from "lucide-react";
import { useConfirmBooking } from "./session-booking.hook";
import { sessionPayables } from "./session-payment.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { SessionView } from "./sessions.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ANOTHER_DAY, usePaidAction } from "~/features/payments/paid-action.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

interface QuickActionOptions {
  /** The session's page, as its row opens it: Another day goes to its payment, Add summary (without onAddSummary) to its notes. */
  page: LinkOptions;
  /** Asks to cancel it (a dialog the list keeps). */
  onCancel: (session: SessionView) => void;
  /** Writes the summary in place (the to-do list, a timeline); without it, Add summary opens the page at its notes. */
  onAddSummary?: (() => void) | undefined;
}

/**
 * Makes a session's quick actions: the fix for each thing left to do on it,
 * as far as its `can` allows, and the same wherever it is listed (a table
 * row, a card, the to-do list, a timeline). Confirm or Cancel session while
 * it isn't confirmed; then Add summary and Paid ▾. None when nothing is
 * left; everything else is on its page.
 */
export function useSessionQuickActions(): (session: SessionView, options: QuickActionOptions) => Array<Action> {
  const booking = useConfirmBooking();
  const paid = usePaidAction();
  return (session, { page, onCancel, onAddSummary }) => {
    const { todo, can } = session;
    if (todo.includes("confirm")) {
      return [
        {
          type: "button",
          label: "Confirm",
          icon: CheckIcon,
          disabled: booking.pending,
          onClick: () => void booking.confirm(session.id).catch(toastRefusal),
        },
        { type: "button", label: "Cancel session", icon: XIcon, can: can.cancel, onClick: () => onCancel(session) },
      ];
    }
    const actions: Array<Action> = [];
    if (todo.includes("record") && can.record.ok) {
      actions.push(
        onAddSummary
          ? { type: "button", label: "Add summary", icon: PencilLineIcon, onClick: onAddSummary }
          : { type: "link", label: "Add summary", icon: PencilLineIcon, link: { ...page, hash: "record" } },
      );
    }
    const payables = sessionPayables(session).filter((p) => !p.paid);
    if (todo.includes("collect") && can.pay.ok && payables.length > 0) {
      actions.push(paid(payables, { type: "link", label: ANOTHER_DAY, link: { ...page, hash: "payment" } }));
    }
    return actions;
  };
}
