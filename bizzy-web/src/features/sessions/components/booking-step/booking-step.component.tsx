import { useState } from "react";
import { CheckIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { BookingForm } from "../booking-form/booking-form.component";
import { hasHappened, needsFix } from "../../session-stage.util";
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
  const tentative = session.status === "tentative";
  const problem = tentative || needsFix(session);
  const happened = hasHappened(session);
  return {
    id: "booking",
    title: "Booking",
    state: problem ? "current" : "done",
    meta: (
      <Lines>
        {[
          tentative ? "Not confirmed" : session.confirmedAt ? `Confirmed ${formatDate(session.confirmedAt)}` : undefined,
          session.removedAt
            ? `Deleted ${formatDate(session.removedAt)}`
            : happened
              ? `Happened ${formatDate(session.start)}`
              : `Booked for ${formatSessionTime(session.start)}`,
        ]}
      </Lines>
    ),
    content: <BookingStep session={session} draft={draft} onCancel={onCancel} />,
  };
}

function BookingStep({ session, draft, onCancel }: { session: Session; draft: SessionDraft; onCancel: () => void }) {
  const confirm = useConfirmBooking();
  const [editing, setEditing] = useState(needsFix(session));
  // What it would bring on is shown first; an edit that would contradict an
  // issued document is refused with why.
  const save = useBookingSave(session, (next) => {
    toast.success(new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved");
    setEditing(false);
  });
  const tentative = session.status === "tentative";
  const end = new Date(session.end);
  const minutes = Math.round((end.getTime() - new Date(session.start).getTime()) / 60_000);
  // Restarts from the calendar whenever the event changes.
  const calendarKey = `${session.title}|${session.start}|${session.end}|${session.colorId ?? ""}`;

  return (
    <>
      {tentative && !session.removedAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-waiting px-3 py-2 text-sm text-status-waiting-foreground">
          <span>Not confirmed with the client yet.</span>
          <span className="flex gap-2">
            <Button size="sm" disabled={confirm.pending} onClick={() => confirm.confirm(session.eventId)}>
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
          {formatSessionTime(session.start)} · {minutes} min · {session.location === "home" ? "Home visit" : "Your place"}
          {session.feeCents !== undefined && <> · {formatCents(session.feeCents)}</>}
          {session.status === "package" && <> · package credit</>}
        </span>
        {!session.removedAt && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon /> Edit booking
          </Button>
        )}
      </div>

      {editing && (
        <BookingForm
          key={calendarKey}
          initial={draft}
          session={session}
          submitLabel="Save booking"
          onSubmit={async (next) => {
            try {
              await save.submit(next);
            } catch (error) {
              toast.error((error as Error).message);
              throw error;
            }
          }}
          extraActions={
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          }
        />
      )}
      {save.dialog}
      {confirm.dialog}
    </>
  );
}
