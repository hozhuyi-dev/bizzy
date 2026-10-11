import { toast } from "sonner";
import { ContactsMutation, ContactsQuery } from "../../contacts.query";
import { ContactDetailsForm } from "../contact-details-form/contact-details-form.component";
import type { Contact } from "../../contacts.types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ApiError } from "~/core/lambda/lambda.client";
import { queryMatch } from "~/core/utils/query.util";

interface ContactEditDialogProps {
  /** The contact to edit; null keeps the dialog closed. */
  resourceName: string | null;
  onClose: () => void;
  onSaved?: ((contact: Contact) => void) | undefined;
}

/** Edits a contact's details in Google, starting from a fresh read. */
export function ContactEditDialog({ resourceName, onClose, onSaved }: ContactEditDialogProps) {
  return (
    <Dialog open={resourceName !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contact details</DialogTitle>
          <DialogDescription>Saved to Google Contacts. Rename the contact there.</DialogDescription>
        </DialogHeader>
        {resourceName && <EditBody resourceName={resourceName} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function EditBody({
  resourceName,
  onClose,
  onSaved,
}: {
  resourceName: string;
  onClose: () => void;
  onSaved?: ((contact: Contact) => void) | undefined;
}) {
  const detail = ContactsQuery.useDetail(resourceName);
  const update = ContactsMutation.useUpdate();

  return queryMatch(detail, {
    pending: () => <p className="text-sm text-muted-foreground">Loading…</p>,
    error: (error) => (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    ),
    success: (contact) => (
      <>
        <p className="text-sm font-medium">{contact.displayName}</p>
        <ContactDetailsForm
          // A refetch after a conflict restarts the form from the latest.
          key={contact.etag}
          mode="edit"
          initial={{ email: contact.email ?? "", phone: contact.phone ?? "", address: contact.address }}
          submitLabel="Save to Google"
          error={update.error?.message}
          onCancel={onClose}
          onSubmit={async (details) => {
            try {
              const saved = await update.mutateAsync({ contact, details });
              toast.success("Contact updated");
              onSaved?.(saved);
              onClose();
            } catch (error) {
              // Changed on her phone meanwhile: reload it and let her redo
              // the edit on top.
              if (error instanceof ApiError && error.code === "conflict") void detail.refetch();
            }
          }}
        />
      </>
    ),
  });
}
