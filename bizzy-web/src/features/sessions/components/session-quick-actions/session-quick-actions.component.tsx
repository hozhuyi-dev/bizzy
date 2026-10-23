import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckIcon, NotebookPenIcon, PencilLineIcon, XIcon } from "lucide-react";
import { useConfirmBooking } from "../../session-booking.hook";
import { sessionPayables } from "../../session-payment.util";
import { SessionsMutation } from "../../sessions.mutation";
import type { SessionReturnTo, SessionView } from "../../sessions.types";
import type { Payable } from "~/features/payments/payments.types";
import { PaidMenu } from "~/features/payments/components/paid-menu/paid-menu.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { InlineField } from "~/components/shared/actions/inline-action/inline-action.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { Button } from "~/components/ui/button";
import { QUIPS } from "~/core/constants/quips.constant";

interface SessionQuickActionsProps {
  session: SessionView;
  /** Asks to cancel it (a dialog the list keeps). */
  onCancel: (session: SessionView) => void;
  /** Paid another day: the payment form (a dialog the list keeps). */
  onPayOther: (payables: Array<Payable>) => void;
  /** Where the session's page goes back to, from Write full notes. */
  from?: SessionReturnTo | undefined;
}

/**
 * The fix for each thing left to do on a session, as far as its `can`
 * allows: Confirm (or Cancel), a one-line summary, Paid. Nothing when
 * nothing is left. Wherever a session is listed with what is left to do
 * (the to-do list, a client's timeline), these are its buttons, in place:
 * Add summary swaps them for the one line until it is saved.
 */
export function SessionQuickActions({ session, onCancel, onPayOther, from }: SessionQuickActionsProps) {
  const [writing, setWriting] = useState(false);
  const confirm = useConfirmBooking();
  const { todo, can } = session;

  if (writing) return <SummaryField session={session} from={from} onDone={() => setWriting(false)} />;
  if (todo.includes("confirm")) {
    return (
      <>
        <Button size="sm" disabled={confirm.pending} onClick={() => void confirm.confirm(session.id).catch(toastRefusal)}>
          <CheckIcon /> Confirm
        </Button>
        <Button size="sm" variant="outline" disabled={!can.cancel.ok} title={can.cancel.why} onClick={() => onCancel(session)}>
          <XIcon /> Cancel session
        </Button>
      </>
    );
  }
  const payables = sessionPayables(session).filter((p) => !p.paid);
  const record = todo.includes("record") && can.record.ok;
  const collect = todo.includes("collect") && can.pay.ok && payables.length > 0;
  if (!record && !collect) return null;
  return (
    <>
      {record && (
        <Button size="sm" variant="outline" onClick={() => setWriting(true)}>
          <PencilLineIcon /> Add summary
        </Button>
      )}
      {collect && <PaidMenu payables={payables} onOther={() => onPayOther(payables)} />}
    </>
  );
}

interface SummaryFieldProps {
  session: SessionView;
  from: SessionReturnTo | undefined;
  onDone: () => void;
}

/**
 * The one line that clears "Record", written in place of the buttons.
 * Long notes are on the session's page; the summary alone leaves them as
 * they are.
 */
function SummaryField({ session, from, onDone }: SummaryFieldProps) {
  const save = SessionsMutation.useSaveSummary();

  return (
    <InlineField
      label="Summary"
      placeholder="One line on the session"
      maxLength={300}
      pending={save.isPending}
      onCancel={onDone}
      onSave={(summary) =>
        save.mutate(
          { id: session.id, summary },
          {
            onSuccess: () => {
              toastWithQuip("Summary saved", QUIPS.todoDone);
              onDone();
            },
            onError: toastRefusal,
          },
        )
      }
      extra={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Write full notes"
          title="Write full notes"
          render={<Link to="/sessions/$id" params={{ id: session.id }} search={{ from }} hash="record" />}
          nativeButton={false}
        >
          <NotebookPenIcon />
        </Button>
      }
    />
  );
}
