import { ExternalLinkIcon } from "lucide-react";
import { contactUrl } from "../../contacts.util";
import type { ContactSummaryValue } from "../../contacts.types";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";

/** A linked contact's details, with a link to it in Google Contacts. */
export function ContactSummary({ contact, actions }: { contact: ContactSummaryValue; actions?: ReactNode }) {
  const lines = [contact.phone, contact.email, contact.address].filter(Boolean);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{contact.displayName || "(no name)"}</span>
        {lines.length > 0 ? (
          lines.map((line) => (
            <span key={line} className="text-xs whitespace-pre-line text-muted-foreground">
              {line}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No phone, email or address yet.</span>
        )}
      </div>
      <div className="-ml-2.5 flex flex-wrap gap-1">
        {actions}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          render={<a href={contactUrl(contact.resourceName)} target="_blank" rel="noreferrer" />}
          nativeButton={false}
        >
          <ExternalLinkIcon /> Google Contacts
        </Button>
      </div>
    </div>
  );
}
