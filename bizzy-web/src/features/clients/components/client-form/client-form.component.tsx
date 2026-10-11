import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { extraAliases } from "../../clients.columns";
import { ClientsMutation } from "../../clients.mutation";
import type { Client, SaveClientInput } from "../../clients.types";
import type { Contact, ContactDetails } from "~/features/contacts/contacts.types";
import type { ContactSummaryValue } from "~/features/contacts/components/contact-summary/contact-summary.component";
import { ContactsQuery } from "~/features/contacts/contacts.query";
import { ContactEditDialog } from "~/features/contacts/components/contact-edit-dialog/contact-edit-dialog.component";
import { ContactPicker } from "~/features/contacts/components/contact-picker/contact-picker.component";
import { ContactSummary } from "~/features/contacts/components/contact-summary/contact-summary.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DialogFooter } from "~/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** A contact chosen for the client, with whatever details are known. */
interface ChosenContact extends ContactSummaryValue {
  postcode?: string | undefined;
  missing?: boolean | undefined;
}

interface ClientFormProps {
  /** Omitted when creating a client. */
  client?: Client | undefined;
  /** Prefills a new client, e.g. from an unmatched calendar name. */
  initialName?: string | undefined;
  /** Prefills the contact, e.g. one the calendar name matched. */
  initialContact?: { resourceName: string; displayName: string } | undefined;
  onDone: (client: Client) => void;
}

interface ClientFormValues {
  name: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  defaultFee: string;
  homeVisits: boolean;
}

function toFormValues(client: Client | undefined, initialName: string | undefined): ClientFormValues {
  return {
    name: client?.name ?? initialName ?? "",
    aliases: client ? extraAliases(client).join(", ") : "",
    defaultFee: centsToInput(client?.defaultFeeCents),
    homeVisits: client?.homeVisits ?? false,
  };
}

function chosenFromContact(contact: Contact): ChosenContact {
  return {
    resourceName: contact.resourceName,
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    address: contact.address.formatted,
    postcode: contact.address.postcode,
  };
}

/** Adapts TanStack Form's string errors to the shape FieldError renders. */
function fieldErrors(errors: ReadonlyArray<string | undefined>) {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}

function toInput(values: ClientFormValues, id: string | undefined, resourceName: string): SaveClientInput {
  const fee = values.defaultFee.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    contact: { resourceName },
    aliases: values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    ...(fee ? { defaultFeeCents: parseCents(fee) ?? 0 } : {}),
    ...(values.homeVisits ? { homeVisits: true } : {}),
  };
}

export function ClientForm({ client, initialName, initialContact, onDone }: ClientFormProps) {
  const save = ClientsMutation.useSave();
  const [contact, setContact] = useState<ChosenContact | null>(client?.contact ?? initialContact ?? null);
  const [contactRequired, setContactRequired] = useState(false);

  const form = useForm({
    defaultValues: toFormValues(client, initialName),
    onSubmit: async ({ value }) => {
      if (!contact) {
        setContactRequired(true);
        return;
      }
      try {
        const saved = await save.mutateAsync(toInput(value, client?.id, contact.resourceName));
        toast.success(client ? "Client updated" : "Client added");
        onDone(saved);
      } catch {
        // Shown through save.error.
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }) =>
              value.trim() ? undefined : "Name is required",
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                autoComplete="off"
              />
              <FieldDescription>
                How you know them here; the contact can be named differently.
              </FieldDescription>
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <Field data-invalid={contactRequired && !contact}>
          <FieldLabel>Google contact</FieldLabel>
          <ContactSection
            contact={contact}
            searchFor={form.getFieldValue("name") || initialName || ""}
            clientName={client?.name}
            onChange={(next) => {
              setContact(next);
              setContactRequired(false);
              // A new client takes the contact's name unless she typed one.
              if (next?.displayName && !form.getFieldValue("name").trim()) {
                form.setFieldValue("name", next.displayName);
              }
            }}
          />
          {contactRequired && !contact && (
            <FieldError errors={[{ message: "Choose a contact, or create one" }]} />
          )}
        </Field>

        <form.Field name="aliases">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Other calendar names</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Jane S, Janey"
                autoComplete="off"
              />
              <FieldDescription>
                Comma-separated. The name above always matches.
              </FieldDescription>
            </Field>
          )}
        </form.Field>

        <form.Field
          name="defaultFee"
          validators={{
            onChange: ({ value }) =>
              !value.trim() || parseCents(value) !== null
                ? undefined
                : "Enter an amount like 95 or 95.50",
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Default fee</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                inputMode="decimal"
                placeholder="95"
              />
              <FieldDescription>
                Used when a calendar entry has no amount and no package credit.
              </FieldDescription>
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <form.Field name="homeVisits">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={field.name}>Usually a home visit</FieldLabel>
                <FieldDescription>
                  An event colour set in the calendar still wins.
                </FieldDescription>
              </FieldContent>
            </Field>
          )}
        </form.Field>

        {save.error && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
      </FieldGroup>

      <DialogFooter className="mt-6">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

interface ContactSectionProps {
  contact: ChosenContact | null;
  /** What the picker searches for first. */
  searchFor: string;
  clientName: string | undefined;
  onChange: (contact: ChosenContact | null) => void;
}

/**
 * The client's Google contact: a summary with edit and change once chosen,
 * otherwise a picker. A deleted contact can be recreated from the copy.
 */
function ContactSection({ contact, searchFor, clientName, onChange }: ContactSectionProps) {
  const contacts = ContactsQuery.useList();
  const [changing, setChanging] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const pick = (picked: Contact) => {
    onChange(chosenFromContact(picked));
    setChanging(false);
    setRecreating(false);
  };

  if (!contact || changing || recreating) {
    return (
      <div className="flex flex-col gap-2">
        <ContactPicker
          initialQuery={searchFor}
          createFrom={recreating && contact ? recreateFrom(contact, clientName) : undefined}
          onPick={pick}
        />
        {contact && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setChanging(false);
                setRecreating(false);
              }}
            >
              Keep {contact.displayName || "the current contact"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // A contact chosen from a calendar suggestion arrives with only its name.
  const listed = contacts.data?.find((c) => c.resourceName === contact.resourceName);
  const shown = contact.missing || !listed ? contact : chosenFromContact(listed);

  return (
    <>
      {contact.missing && (
        <p role="alert" className="text-sm text-destructive">
          This contact is no longer in Google Contacts. Recreate it from the details kept here, or
          choose another.
        </p>
      )}
      <ContactSummary
        contact={shown}
        actions={
          contact.missing ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecreating(true)}>
              Recreate contact
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(contact.resourceName)}>
              Edit details
            </Button>
          )
        }
      />
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(true)}>
          Choose another contact
        </Button>
      </div>
      <ContactEditDialog
        resourceName={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => onChange(chosenFromContact(saved))}
      />
    </>
  );
}

/** A new contact prefilled from a deleted one's copy, for her to check. */
function recreateFrom(contact: ChosenContact, clientName: string | undefined): ContactDetails {
  return {
    givenName: contact.displayName || clientName || "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    address: {
      street: contact.address ?? "",
      ...(contact.postcode ? { postcode: contact.postcode } : {}),
    },
  };
}
