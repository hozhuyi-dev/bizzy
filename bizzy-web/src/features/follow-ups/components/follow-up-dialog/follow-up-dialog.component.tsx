import { useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { daysFromToday, toCreateFollowUp, toFollowUpFields, toFollowUpValues } from "../../follow-ups.form";
import { FollowUpsMutation } from "../../follow-ups.mutation";
import type { FollowUpTarget } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { InlineConfirm } from "~/components/shared/actions/inline-action/inline-action.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { Button } from "~/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
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
          <div className="flex flex-wrap items-start gap-2">
            <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Pick a day") }}>
              {(field) => (
                <field.TextField
                  label="When"
                  type="date"
                  className="w-auto"
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
                    {(field) => <field.TextField label="Time" type="time" step={300} className="w-auto" />}
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

      {/* One row of buttons on a phone too (SheetDialog): Delete first, kept to the left on a wide screen. */}
      <DialogFooter>
        {editing && confirmingDelete ? (
          <InlineConfirm
            question="Delete it from your calendar too?"
            yes="Delete"
            pending={remove.isPending}
            onNo={() => setConfirmingDelete(false)}
            onYes={() =>
              remove.mutate(editing.id, {
                onSuccess: () => {
                  toast.success("Follow-up deleted from your calendar");
                  form.reset();
                  onClose();
                },
                onError: toastRefusal,
              })
            }
          />
        ) : (
          <>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive sm:mr-auto"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2Icon /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton label={editing ? "Save" : "Add follow-up"} />
            </form.AppForm>
          </>
        )}
      </DialogFooter>
      <UnsavedChangesDialog when={hasChanges} />
    </form>
  );
}
