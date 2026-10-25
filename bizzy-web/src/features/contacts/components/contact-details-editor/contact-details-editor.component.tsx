import { ContactsMutation } from "../../contacts.mutation";
import { ContactsQuery } from "../../contacts.query";
import { ContactDetailsForm } from "../contact-details-form/contact-details-form.component";
import type { ContactView } from "../../contacts.types";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { isApiError } from "~/core/utils/api-error.util";
import { queryMatch } from "~/core/utils/query.util";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";

interface ContactDetailsEditorProps {
  resourceName: string;
  onClose: () => void;
  onSaved?: ((contact: ContactView) => void) | undefined;
}

/**
 * Edits a contact's details in Google, in place of their summary, starting
 * from a fresh read. It saves on its own, apart from the page around it.
 * The name is changed in Google Contacts itself.
 */
export function ContactDetailsEditor({ resourceName, onClose, onSaved }: ContactDetailsEditorProps) {
  const detail = ContactsQuery.useDetail(resourceName);
  const update = ContactsMutation.useUpdate();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {detail.data?.displayName ? `${detail.data.displayName}'s details` : "The contact's details"}, saved to Google
        Contacts. Rename the contact there.
      </p>
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
                // Changed on the user's phone meanwhile: reload it, to redo
                // the edit on top.
                if (isApiError(error, "conflict")) void detail.refetch();
              }
            }}
          />
        ),
      })}
    </div>
  );
}
