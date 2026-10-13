import { useForm } from "@tanstack/react-form";
import { toContactDetails, toContactValues } from "../../contacts.form";
import type { ComponentProps } from "react";
import type { ContactValues } from "../../contacts.form";
import type { ContactDetails } from "../../contacts.types";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

interface ContactDetailsFormProps {
  /** "create" also asks for the name; renaming happens in Google Contacts. */
  mode: "create" | "edit";
  initial: ContactDetails;
  submitLabel: string;
  onSubmit: (details: ContactDetails) => Promise<unknown>;
  onCancel?: (() => void) | undefined;
  error?: string | undefined;
}

/**
 * A Google contact's details, written straight to Google. Not a <form>: it
 * sits inside the client form when she creates a contact there.
 */
export function ContactDetailsForm({ mode, initial, submitLabel, onSubmit, onCancel, error }: ContactDetailsFormProps) {
  const form = useForm({
    defaultValues: toContactValues(initial),
    onSubmit: ({ value }) => onSubmit(toContactDetails(value, mode)),
  });

  const text = (name: Exclude<keyof ContactValues, "street">, label: string, props: ComponentProps<typeof Input> = {}) => (
    <form.Field name={name}>
      {(field) => (
        <Field>
          <FieldLabel htmlFor={`contact-${name}`}>{label}</FieldLabel>
          <Input
            id={`contact-${name}`}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            {...props}
          />
        </Field>
      )}
    </form.Field>
  );

  return (
    <FieldGroup>
      {mode === "create" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("givenName", "First name", { autoComplete: "off" })}
          {text("familyName", "Last name", { autoComplete: "off" })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("phone", "Phone", { type: "tel", placeholder: "012-345 6789" })}
        {text("email", "Email", { type: "email" })}
      </div>
      <form.Field name="street">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="contact-street">Address</FieldLabel>
            <Textarea
              id="contact-street"
              rows={2}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <FieldDescription>Printed on receipts.</FieldDescription>
          </Field>
        )}
      </form.Field>
      <div className="grid gap-4 sm:grid-cols-3">
        {text("postcode", "Postcode", { inputMode: "numeric" })}
        {text("city", "City")}
        {text("region", "State")}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <form.Subscribe selector={(state) => [state.values.givenName, state.values.familyName, state.isSubmitting] as const}>
          {([givenName, familyName, isSubmitting]) => (
            <Button
              type="button"
              disabled={isSubmitting || (mode === "create" && !givenName.trim() && !familyName.trim())}
              onClick={() => void form.handleSubmit()}
            >
              {isSubmitting ? "Saving…" : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </FieldGroup>
  );
}
