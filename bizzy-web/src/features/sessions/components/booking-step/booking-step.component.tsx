import { useState } from "react";
import { CheckIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { BookingForm } from "../booking-form/booking-form.component";
import { hasHappened } from "../../session-stage.util";
import { useBookingSave, useConfirmBooking } from "../../sessions-booking.hook";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { Session, SessionDraft } from "../../sessions.types";
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

export function bookingStep(session: Session, draft: SessionDraft, onCancel: () => void): PipelineStep {
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
    content: <BookingStep session={session} draft={draft} onCancel={onCancel} />,
  };
}

function BookingStep({ session, draft, onCancel }: { session: Session; draft: SessionDraft; onCancel: () => void }) {
  const confirm = useConfirmBooking();
  const [editing, setEditing] = useState(false);
  const save = useBookingSave(session, (next) => {
    toast.success(new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved");
    setEditing(false);
  });
  const minutes = Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60_000);

  return (
    <>
      {session.tentative && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-waiting px-3 py-2 text-sm text-status-waiting-foreground">
          <span>Not confirmed with the client yet.</span>
          <span className="flex gap-2">
            <Button size="sm" disabled={confirm.pending} onClick={() => confirm.confirm(session.id)}>
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
          {formatSessionTime(session.start)} · {minutes} min · {session.location === "visit" ? "Home visit" : "Your place"}
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
          // Restarts whenever the session changes, here or in the calendar.
          key={session.version}
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
