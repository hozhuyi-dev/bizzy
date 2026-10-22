import { useNavigate } from "@tanstack/react-router";
import { useBookingSave } from "../../session-booking.hook";
import type { SessionDraft } from "../../sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { FieldGroup } from "~/components/ui/field";
import { useAppForm } from "~/components/shared/form/form.hook";
import { requiredError } from "~/core/utils/form.util";
import { addDays, formatSessionTime, toISODate, toTimeInput, todayISO } from "~/core/utils/date.util";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface NextVisitDialogProps {
  /** The session to book after, as its draft; null closes the dialog. */
  from: SessionDraft | null;
  clientName: string;
  onClose: () => void;
}

/**
 * Books the client's next visit in a couple of taps: the same weekday and
 * time a week on, same length and place, priced as usual (a package credit
 * or the client's fee).
 */
export function NextVisitDialog({ from, clientName, onClose }: NextVisitDialogProps) {
  return (
    <SheetDialog open={from !== null} onClose={onClose}>
      {from && <NextVisitForm from={from} clientName={clientName} onClose={onClose} />}
    </SheetDialog>
  );
}

function NextVisitForm({ from, clientName, onClose }: { from: SessionDraft; clientName: string; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useBookingSave(undefined, undefined, (draft, id) => {
    toastWithQuip(`Booked ${clientName} for ${formatSessionTime(draft.start)}`, QUIPS.booked, {
      action: {
        label: "Open",
        onClick: () => void navigate({ to: "/sessions/$id", params: { id } }),
      },
    });
    onClose();
  });
  const start = new Date(from.start);

  const form = useAppForm({
    defaultValues: { date: toISODate(addDays(start, 7)), time: toTimeInput(start), tentative: false },
    onSubmit: async ({ value }) => {
      const draft: SessionDraft = {
        clientId: from.clientId,
        start: new Date(`${value.date}T${value.time}`).toISOString(),
        minutes: from.minutes,
        homeVisit: from.homeVisit,
        tentative: value.tentative,
      };
      // A refusal (no fee known, say) is shown with what would settle it.
      await save.submit(draft).catch(toastRefusal);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Book {clientName}'s next visit</DialogTitle>
        <DialogDescription>
          {from.minutes} minutes{from.homeVisit ? ", home visit" : ""}, added to your calendar.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="flex flex-wrap items-start gap-4">
          <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Pick a day") }}>
            {(field) => (
              <field.TextField
                label="Day"
                type="date"
                className="w-auto"
                description={field.state.value && field.state.value < todayISO() ? "That day has passed." : undefined}
              />
            )}
          </form.AppField>
          <form.AppField name="time" validators={{ onChange: ({ value }) => requiredError(value, "Pick a time") }}>
            {(field) => <field.TextField label="Start" type="time" step={300} className="w-auto" />}
          </form.AppField>
        </div>
        <form.AppField name="tentative">
          {(field) => (
            <field.CheckboxField
              label="Not confirmed yet"
              description="Comes up on your to-do list a few days before, to confirm."
            />
          )}
        </form.AppField>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton label="Book" pendingLabel="Booking…" />
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
