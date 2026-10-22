import { useState } from "react";
import { CheckIcon, PencilIcon } from "lucide-react";
import { EditBookingDialog } from "../booking-dialog/booking-dialog.component";
import { hasHappened, sessionMinutes } from "../../session-stage.util";
import { useConfirmBooking } from "../../sessions-booking.hook";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { SessionFullView } from "../../sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

function Lines({ children }: { children: Array<string | false | undefined> }) {
  return (
    <>
      {children.filter(Boolean).map((line) => (
        <span key={line as string} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * `settled`, when the page was opened to settle a calendar edit by changing
 * this booking: it starts open, and once saved goes back to the to-do list.
 */
export function bookingStep(session: SessionFullView, onCancel: () => void, settled?: (done: string) => void): PipelineStep {
  const happened = hasHappened(session);
  return {
    id: "booking",
    title: "Booking",
    state: session.tentative && !session.cancelledAt ? "current" : "done",
    meta: (
      <Lines>
        {[
          session.cancelledAt ? `Cancelled ${formatDate(session.cancelledAt)}` : undefined,
          session.tentative ? "Not confirmed" : session.confirmedAt ? `Confirmed ${formatDate(session.confirmedAt)}` : undefined,
          happened ? `Happened ${formatDate(session.start)}` : `Booked for ${formatSessionTime(session.start)}`,
        ]}
      </Lines>
    ),
    content: <BookingStep session={session} onCancel={onCancel} settled={settled} />,
  };
}

interface BookingStepProps {
  session: SessionFullView;
  onCancel: () => void;
  settled?: ((done: string) => void) | undefined;
}

function BookingStep({ session, onCancel, settled }: BookingStepProps) {
  const confirm = useConfirmBooking();
  const [editing, setEditing] = useState(Boolean(settled) && session.can.update.ok);

  return (
    <>
      {session.tentative && session.can.cancel.ok && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-waiting px-3 py-2 text-sm text-status-waiting-foreground">
          <span>Not confirmed with the client yet.</span>
          <span className="flex gap-2">
            <Button size="sm" disabled={confirm.pending} onClick={() => void confirm.confirm(session.id).catch(toastRefusal)}>
              <CheckIcon /> Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel booking
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {formatSessionTime(session.start)} · {sessionMinutes(session)} min ·{" "}
          {session.location === "visit" ? "Home visit" : "Your place"}
          {session.credits.length > 0 && <> · package credit</>}
          {session.invoice && <> · {formatCents(session.feeCents)}</>}
          {!session.tentative && session.confirmedAt && <> · confirmed {formatDate(session.confirmedAt)}</>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!session.can.update.ok}
          title={session.can.update.why}
          onClick={() => setEditing(true)}
        >
          <PencilIcon /> Edit booking
        </Button>
      </div>

      <EditBookingDialog session={session} open={editing} onClose={() => setEditing(false)} onSaved={settled} />
    </>
  );
}
