import { useNavigate } from "@tanstack/react-router";
import { CalendarX2Icon } from "lucide-react";
import { SessionsQuery } from "../../sessions.query";
import { BookingForm } from "../booking-form/booking-form.component";
import { useBookingSave } from "../../session-booking.hook";
import { draftOf, newSessionDraft } from "../../sessions.form";
import type { SessionFullView, SessionReturnTo } from "../../sessions.types";
import { conflictKind } from "~/features/conflicts/conflicts.util";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { formatSessionTime } from "~/core/utils/date.util";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface NewSessionDialogProps {
  open: boolean;
  /** Where the session's page goes back to, once it opens. */
  returnTo?: SessionReturnTo | undefined;
  /** The client it is for, chosen already (from their page). */
  clientId?: string | undefined;
  onClose: () => void;
}

/**
 * Adds a session to the calendar. One booked ahead stays where it was added
 * from, with Open in the toast; one that already happened goes straight to
 * its page, for its notes and payment.
 */
export function NewSessionDialog({ open, returnTo, clientId, onClose }: NewSessionDialogProps) {
  return (
    <SheetDialog open={open} onClose={onClose}>
      {open && <NewSession returnTo={returnTo} clientId={clientId} onClose={onClose} />}
    </SheetDialog>
  );
}

function NewSession({ returnTo, clientId, onClose }: Omit<NewSessionDialogProps, "open">) {
  const navigate = useNavigate();
  const open = (id: string) =>
    void navigate({ to: "/sessions/$id", params: { id }, search: { from: returnTo }, ignoreBlocker: true });
  const save = useBookingSave(undefined, undefined, (draft, id) => {
    onClose();
    if (new Date(draft.start) <= new Date()) {
      toastWithQuip("Session added", QUIPS.booked);
      open(id);
      return;
    }
    toastWithQuip(`Booked for ${formatSessionTime(draft.start)}`, QUIPS.booked, {
      action: { label: "Open", onClick: () => open(id) },
    });
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>New session</DialogTitle>
        <DialogDescription>Added to your calendar.</DialogDescription>
      </DialogHeader>
      <BookingForm initial={{ ...newSessionDraft(), clientId: clientId ?? "" }} submitLabel="Add session" onSubmit={(draft) => save.submit(draft)} onCancel={onClose} />
    </>
  );
}

interface EditBookingDialogProps {
  /** With what its update can't change (`locked`), shown on the form. */
  session: SessionFullView;
  open: boolean;
  onClose: () => void;
  /** Once saved, with what the toast says; left out, it is toasted here. */
  onSaved?: ((done: string) => void) | undefined;
}

/**
 * Changes a session's booking, and its event in the calendar with it. An
 * edit made in the calendar that bizzy refused is shown at the top, so
 * settling it here can follow what the event says.
 */
export function EditBookingDialog({ session, open, onClose, onSaved }: EditBookingDialogProps) {
  return (
    <SheetDialog open={open} onClose={onClose}>
      {open && <EditBooking session={session} onClose={onClose} onSaved={onSaved} />}
    </SheetDialog>
  );
}

function EditBooking({ session, onClose, onSaved }: Omit<EditBookingDialogProps, "open">) {
  const conflicts = SessionsQuery.useConflicts(session.id);
  const draft = draftOf(session);
  const save = useBookingSave(session, draft, (next) => {
    const done = new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved";
    onClose();
    if (onSaved) onSaved(done);
    else toastWithQuip(done, QUIPS.booked);
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit booking</DialogTitle>
        <DialogDescription>Its calendar event changes with it.</DialogDescription>
      </DialogHeader>
      {(conflicts.data ?? []).map((conflict) => (
        <p
          key={conflict.eventId}
          className="flex items-start gap-2 rounded-lg bg-status-attention px-3 py-2 text-sm text-status-attention-foreground"
        >
          <CalendarX2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">{conflictKind(conflict)}.</span>{" "}
            {!conflict.gone && <>It says “{conflict.title}”. </>}
            {conflict.message}
          </span>
        </p>
      ))}
      <BookingForm
        // Restarts whenever the booking changes, here or in the calendar.
        key={JSON.stringify(draft)}
        initial={draft}
        session={session}
        locked={session.locked}
        submitLabel="Save booking"
        onSubmit={(next, updatePayment) => save.submit(next, updatePayment)}
        onCancel={onClose}
      />
    </>
  );
}
