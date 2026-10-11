import { toast } from "sonner";
import { ContactsMutation, ContactsQuery } from "../../contacts.query";
import { ContactDetailsForm } from "../contact-details-form/contact-details-form.component";
import type { Contact } from "../../contacts.types";
import { Loading } from "~/components/shared/quip/quip.component";
import { ApiError } from "~/core/lambda/lambda.client";
import { queryMatch } from "~/core/utils/query.util";

interface ContactDetailsEditorProps {
  resourceName: string;
  onDone: () => void;
  onSaved?: ((contact: Contact) => void) | undefined;
}

/**
 * Edits a contact's details in Google, in place where the contact is shown,
 * starting from a fresh read. The name is changed in Google Contacts itself.
 */
export function ContactDetailsEditor({ resourceName, onDone, onSaved }: ContactDetailsEditorProps) {
  const detail = ContactsQuery.useDetail(resourceName);
  const update = ContactsMutation.useUpdate();

  return queryMatch(detail, {
    pending: () => <Loading />,
    error: (error) => (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    ),
    success: (contact) => (
      <div className="flex flex-col gap-3 rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">{contact.displayName}</p>
          <p className="text-xs text-muted-foreground">Saved to Google Contacts. Rename the contact there.</p>
        </div>
        <ContactDetailsForm
          // A refetch after a conflict restarts the form from the latest.
          key={contact.etag}
          mode="edit"
          initial={{ email: contact.email ?? "", phone: contact.phone ?? "", address: contact.address }}
          submitLabel="Save to Google"
          error={update.error?.message}
          onCancel={onDone}
          onSubmit={async (details) => {
            try {
              const saved = await update.mutateAsync({ contact, details });
              toast.success("Contact updated");
              onSaved?.(saved);
              onDone();
            } catch (error) {
              // Changed on her phone meanwhile: reload it and let her redo
              // the edit on top.
              if (error instanceof ApiError && error.code === "conflict") void detail.refetch();
            }
          }}
        />
      </div>
    ),
  });
}
