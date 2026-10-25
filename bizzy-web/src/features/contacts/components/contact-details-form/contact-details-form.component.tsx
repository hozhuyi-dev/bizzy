import { useSelector } from "@tanstack/react-form";
import { toContactDetails, toContactValues } from "../../contacts.form";
import type { ContactDetails } from "../../contacts.types";
import { useAppForm } from "~/components/shared/form/form.hook";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { emailError } from "~/core/utils/form.util";

interface ContactDetailsFormProps {
  /** "create" also asks for the name; renaming happens in Google Contacts. */
  mode: "create" | "edit";
  initial: ContactDetails;
  submitLabel: string;
  onSubmit: (details: ContactDetails) => Promise<unknown>;
  onCancel: () => void;
  error?: string | undefined;
}

/**
 * A Google contact's details, written straight to Google, so saved on
 * their own, apart from the client's Save: its buttons end its fields,
 * where it is open in place. Enter saves.
 */
export function ContactDetailsForm({ mode, initial, submitLabel, onSubmit, onCancel, error }: ContactDetailsFormProps) {
  const form = useAppForm({
    defaultValues: toContactValues(initial),
    onSubmit: ({ value }) => onSubmit(toContactDetails(value, mode)),
  });

  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        {mode === "create" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField
              name="givenName"
              validators={{
                onChangeListenTo: ["familyName"],
                onChange: ({ value, fieldApi }) =>
                  value.trim() || fieldApi.form.getFieldValue("familyName").trim() ? undefined : "Give a first or last name",
              }}
            >
              {(field) => <field.TextField label="First name" autoComplete="off" />}
            </form.AppField>
            <form.AppField name="familyName">
              {(field) => <field.TextField label="Last name" autoComplete="off" />}
            </form.AppField>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="phone">
            {(field) => <field.TextField label="Phone" type="tel" placeholder="012-345 6789" />}
          </form.AppField>
          <form.AppField name="email" validators={{ onChange: ({ value }) => emailError(value) }}>
            {(field) => <field.TextField label="Email" type="email" />}
          </form.AppField>
        </div>
        <form.AppField name="street">{(field) => <field.TextareaField label="Address" rows={2} />}</form.AppField>
        <div className="grid gap-4 sm:grid-cols-3">
          <form.AppField name="postcode">
            {(field) => <field.TextField label="Postcode" inputMode="numeric" />}
          </form.AppField>
          <form.AppField name="city">{(field) => <field.TextField label="City" />}</form.AppField>
          <form.AppField name="region">{(field) => <field.TextField label="State" />}</form.AppField>
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}
      </FieldGroup>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton label={submitLabel} />
        </form.AppForm>
      </div>
      <UnsavedChangesDialog when={hasChanges} />
    </form>
  );
}
