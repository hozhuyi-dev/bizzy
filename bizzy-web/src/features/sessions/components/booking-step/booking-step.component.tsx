import { useState } from "react";
import { CheckIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { BookingForm } from "../booking-form/booking-form.component";
import { hasHappened, sessionMinutes } from "../../session-stage.util";
import { useBookingSave, useConfirmBooking } from "../../sessions-booking.hook";
import { draftOf } from "../../sessions.form";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { SessionView } from "../../sessions.types";
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

export function bookingStep(session: SessionView, onCancel: () => void): PipelineStep {
  const happened = hasHappened(session);
  return {
    id: "booking",
    title: "Booking",
    state: session.tentative ? "current" : "done",
    meta: (
      <Lines>
        {[
          session.tentative ? "Not confirmed" : session.confirmedAt ? `Confirmed ${formatDate(session.confirmedAt)}` : undefined,
          happened ? `Happened ${formatDate(session.start)}` : `Booked for ${formatSessionTime(session.start)}`,
        ]}
      </Lines>
    ),
    content: <BookingStep session={session} onCancel={onCancel} />,
  };
}

function BookingStep({ session, onCancel }: { session: SessionView; onCancel: () => void }) {
  const confirm = useConfirmBooking();
  const [editing, setEditing] = useState(false);
  const draft = draftOf(session);
  const save = useBookingSave(session, draft, (next) => {
    toast.success(new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved");
    setEditing(false);
  });

  return (
    <>
      {session.tentative && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-waiting px-3 py-2 text-sm text-status-waiting-foreground">
          <span>Not confirmed with the client yet.</span>
          <span className="flex gap-2">
            <Button size="sm" disabled={confirm.pending} onClick={() => void confirm.confirm(session.id).catch(toastRefusal)}>
              <CheckIcon /> Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!session.can.delete.ok}
              title={session.can.delete.why}
              onClick={onCancel}
            >
              Cancel booking
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {formatSessionTime(session.start)} · {sessionMinutes(session)} min ·{" "}
          {session.location === "visit" ? "Home visit" : "Your place"}
          {session.packageId ? <> · package credit</> : <> · {formatCents(session.feeCents)}</>}
        </span>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon /> Edit booking
          </Button>
        )}
      </div>

      {editing && (
        <BookingForm
          // Restarts whenever the booking changes, here or in the calendar.
          key={JSON.stringify(draft)}
          initial={draft}
          session={session}
          submitLabel="Save booking"
          onSubmit={(next, updatePayment) => save.submit(next, updatePayment)}
          extraActions={
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          }
        />
      )}
    </>
  );
}
