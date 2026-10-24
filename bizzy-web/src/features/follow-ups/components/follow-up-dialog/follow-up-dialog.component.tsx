import { useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { toast } from "sonner";
import { CheckIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { daysFromToday, toCreateFollowUp, toFollowUpFields, toFollowUpValues } from "../../follow-ups.form";
import { FollowUpsMutation } from "../../follow-ups.mutation";
import { useMarkDone } from "../../follow-ups.hook";
import type { FollowUpTarget } from "../../follow-ups.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DialogActions } from "~/components/shared/dialog/dialog-actions/dialog-actions.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { Button } from "~/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { FieldGroup } from "~/components/ui/field";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { todayISO } from "~/core/utils/date.util";
import { requiredError } from "~/core/utils/form.util";

// As the API keeps them: the summary is the calendar title, the notes its description.
const MAX_SUMMARY = 200;
const MAX_NOTES = 8000;

interface FollowUpDialogProps {
  target: FollowUpTarget | null;
  onClose: () => void;
}

/**
 * Adds or edits a follow-up. It is written to the calendar as
 * `! Name: summary` with the notes as the event's description, so it shows
 * on the user's phone too.
 */
export function FollowUpDialog({ target, onClose }: FollowUpDialogProps) {
  return (
    <SheetDialog open={target !== null} onClose={onClose}>
      {target && <FollowUpForm key={target.mode === "edit" ? target.followUp.id : "new"} target={target} onClose={onClose} />}
    </SheetDialog>
  );
}

/** Quick picks, counted from today. */
const IN = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
];

function FollowUpForm({ target, onClose }: { target: FollowUpTarget; onClose: () => void }) {
  const clientsById = ClientsQuery.useById();
  const create = FollowUpsMutation.useCreate();
  const update = FollowUpsMutation.useUpdate();
  const remove = FollowUpsMutation.useDelete();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const markDone = useMarkDone();
  const editing = target.mode === "edit" ? target.followUp : undefined;
  const sessionId = target.mode === "new" ? target.sessionId : undefined;
  const fixedClient = target.mode === "new" && Boolean(target.clientId);

  const form = useAppForm({
    defaultValues: toFollowUpValues(target),
    onSubmit: async ({ value, formApi }) => {
      try {
        if (editing) await update.mutateAsync({ id: editing.id, fields: toFollowUpFields(value, editing) });
        else await create.mutateAsync(toCreateFollowUp(value, sessionId));
        // Saved: closing isn't leaving with changes.
        formApi.reset(value);
        toastWithQuip(editing ? "Follow-up updated" : "Follow-up added to your calendar", QUIPS.saved);
        onClose();
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  // Closes once something done to it from ⋯ is done: its edits aren't asked about.
  const leave = () => {
    form.reset();
    onClose();
  };
  const clientId = useSelector(form.store, (state) => state.values.clientId);
  const summary = useSelector(form.store, (state) => state.values.summary);
  const clientName = clientsById.get(clientId)?.name;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit follow-up" : clientName ? `Follow up with ${clientName}` : "New follow-up"}</DialogTitle>
        <DialogDescription>
          Added to your calendar as “! {clientName ?? "Name"}
          {summary.trim() ? `: ${summary.trim()}` : ""}”.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {!fixedClient && (
          <form.AppField name="clientId" validators={{ onChange: ({ value }) => requiredError(value, "Choose a client") }}>
            {() => <ClientSelectField keepId={editing?.clientId} />}
          </form.AppField>
        )}

        <form.AppField name="summary">
          {(field) => (
            <field.TextField label="What to follow up" maxLength={MAX_SUMMARY} placeholder="Check MRI results" />
          )}
        </form.AppField>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)] items-start gap-2 sm:grid-cols-[10rem_8rem]">
            <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Pick a day") }}>
              {(field) => (
                <field.TextField
                  label="When"
                  type="date"
                  // Fine for a note of a call made; most often a slip.
                  description={field.state.value && field.state.value < todayISO() ? "That day has passed." : undefined}
                />
              )}
            </form.AppField>
            <form.Subscribe selector={(state) => state.values.allDay}>
              {(allDay) =>
                !allDay && (
                  <form.AppField
                    name="time"
                    validators={{
                      onChangeListenTo: ["allDay"],
                      onChange: ({ value, fieldApi }) =>
                        fieldApi.form.getFieldValue("allDay") ? undefined : requiredError(value, "Pick a time"),
                    }}
                  >
                    {(field) => <field.TextField label="Time" type="time" step={300} />}
                  </form.AppField>
                )
              }
            </form.Subscribe>
          </div>
          <div className="flex flex-wrap gap-1">
            {IN.map(({ label, days }) => (
              <Button key={label} type="button" variant="outline" size="xs" onClick={() => form.setFieldValue("date", daysFromToday(days))}>
                In {label}
              </Button>
            ))}
          </div>
        </div>

        <form.AppField name="allDay">
          {(field) => <field.CheckboxField label="All day" description="Untick to block a time for the call." />}
        </form.AppField>

        <form.AppField name="notes">
          {(field) => (
            <field.TextareaField
              label="Notes"
              rows={4}
              maxLength={MAX_NOTES}
              description="Saved as the calendar event's description."
            />
          )}
        </form.AppField>
      </FieldGroup>

      <DialogActions
        // Its rows' one step (Done, Not done), then Delete; each closes the dialog once done, its edits left.
        menu={editing && [
          editing.doneAt
            ? { type: "button", label: "Not done", icon: RotateCcwIcon, disabled: markDone.isPending, onClick: () => markDone.mark(editing, false, leave) }
            : { type: "button", label: "Mark done", icon: CheckIcon, disabled: markDone.isPending, onClick: () => markDone.mark(editing, true, leave) },
          { type: "button", label: "Delete", icon: Trash2Icon, style: "destructive", onClick: () => setConfirmingDelete(true) },
        ] satisfies Array<Action>}
        onCancel={onClose}
        confirm={
          editing && confirmingDelete
            ? {
                question: "Delete it from your calendar too?",
                yes: "Delete",
                pending: remove.isPending,
                onNo: () => setConfirmingDelete(false),
                onYes: () =>
                  remove.mutate(editing.id, {
                    onSuccess: () => {
                      toast.success("Follow-up deleted from your calendar");
                      leave();
                    },
                    onError: toastRefusal,
                  }),
              }
            : null
        }
      >
        <form.AppForm>
          <form.SubmitButton label={editing ? "Save" : "Add follow-up"} />
        </form.AppForm>
      </DialogActions>
      <UnsavedChangesDialog when={hasChanges} />
    </form>
  );
}
