import { toast } from "sonner";
import { ContactsMutation, ContactsQuery } from "../../contacts.query";
import { Button } from "~/components/ui/button";

/**
 * Contacts she said are not clients. Their calendar entries stay personal
 * until she brings them back.
 */
export function DismissedContacts() {
  const dismissed = ContactsQuery.useDismissed();
  const restore = ContactsMutation.useDismiss();

  if (!dismissed.data?.length) {
    return <p className="text-sm text-muted-foreground">Nobody yet. Contacts you mark as not a client show up here.</p>;
  }

  const sorted = [...dismissed.data].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <ul className="flex flex-col divide-y">
      {sorted.map((contact) => (
        <li key={contact.resourceName} className="flex items-center justify-between gap-2 py-1.5">
          <span className="text-sm">{contact.displayName || contact.resourceName}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={restore.isPending}
            onClick={() =>
              restore.mutate(
                { contact, dismissed: false },
                {
                  onSuccess: () => toast.success(`${contact.displayName} will be suggested again`),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            Suggest again
          </Button>
        </li>
      ))}
    </ul>
  );
}
