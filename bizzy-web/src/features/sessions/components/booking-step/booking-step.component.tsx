import { useState } from "react";
import { CheckIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { BookingForm } from "../booking-form/booking-form.component";
import { hasHappened, needsFix } from "../../session-stage.util";
import { SessionsMutation } from "../../sessions.mutation";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { Session, SessionDraft } from "../../sessions.types";
import { Button } from "~/components/ui/button";
import { isStaleEdit } from "~/core/utils/api-error.util";
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

export function bookingStep(session: Session, draft: SessionDraft, locked: boolean, onCancel: () => void): PipelineStep {
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
    content: <BookingStep session={session} draft={draft} locked={locked} onCancel={onCancel} />,
  };
}

function BookingStep({
  session,
  draft,
  locked,
  onCancel,
}: {
  session: Session;
  draft: SessionDraft;
  locked: boolean;
  onCancel: () => void;
}) {
  const update = SessionsMutation.useUpdate();
  const confirm = SessionsMutation.useConfirm();
  const [editing, setEditing] = useState(needsFix(session));
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
            <Button
              size="sm"
              disabled={confirm.isPending || locked}
              onClick={() =>
                confirm.mutate(session.eventId, {
                  onSuccess: () => toast.success("Confirmed"),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              <CheckIcon /> Confirm
            </Button>
            <Button size="sm" variant="outline" disabled={locked} onClick={onCancel}>
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
        {!locked && !session.removedAt && !editing && (
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
          locked={locked}
          submitLabel="Save booking"
          onSubmit={async (next) => {
            try {
              await update.mutateAsync({ eventId: session.eventId, draft: next });
            } catch (error) {
              toast.error((error as Error).message);
              throw error;
            }
            toast.success(new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved");
            setEditing(false);
          }}
          extraActions={
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          }
        />
      )}
      {update.error && !isStaleEdit(update.error) && <p className="text-sm text-destructive">{update.error.message}</p>}
    </>
  );
}
