import { ContactsMutation } from "../../contacts.mutation";
import { ContactsQuery } from "../../contacts.query";
import { ContactDetailsForm } from "../contact-details-form/contact-details-form.component";
import type { ContactView } from "../../contacts.types";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { isApiError } from "~/core/utils/api-error.util";
import { queryMatch } from "~/core/utils/query.util";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";

interface ContactDetailsDialogProps {
  /** The contact to edit; null closes the dialog. */
  resourceName: string | null;
  onClose: () => void;
  onSaved?: ((contact: ContactView) => void) | undefined;
}

/**
 * Edits a contact's details in Google, starting from a fresh read. It saves
 * on its own, apart from the page behind it. The name is changed in Google
 * Contacts itself.
 */
export function ContactDetailsDialog({ resourceName, onClose, onSaved }: ContactDetailsDialogProps) {
  return (
    <SheetDialog open={resourceName !== null} onClose={onClose}>
      {resourceName && <ContactDetailsEditor resourceName={resourceName} onClose={onClose} onSaved={onSaved} />}
    </SheetDialog>
  );
}

function ContactDetailsEditor({
  resourceName,
  onClose,
  onSaved,
}: ContactDetailsDialogProps & { resourceName: string }) {
  const detail = ContactsQuery.useDetail(resourceName);
  const update = ContactsMutation.useUpdate();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{detail.data?.displayName ? `Edit ${detail.data.displayName}` : "Edit contact"}</DialogTitle>
        <DialogDescription>Saved to Google Contacts. Rename the contact there.</DialogDescription>
      </DialogHeader>
      {queryMatch(detail, {
        pending: () => <LoadingState />,
        error: (error) => (
          <ErrorState error={error} retry={detail.refetch} />
        ),
        success: (contact) => (
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
                toastWithQuip("Contact updated", QUIPS.saved);
                onSaved?.(saved);
                onClose();
              } catch (error) {
                // Changed on her phone meanwhile: reload it and let her redo
                // the edit on top.
                if (isApiError(error, "conflict")) void detail.refetch();
              }
            }}
          />
        ),
      })}
    </>
  );
}
