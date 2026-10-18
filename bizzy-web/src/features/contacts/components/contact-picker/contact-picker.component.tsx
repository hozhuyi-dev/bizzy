import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { ContactsMutation } from "../../contacts.mutation";
import { ContactsQuery } from "../../contacts.query";
import { searchContacts } from "../../contacts.util";
import { ContactDetailsForm } from "../contact-details-form/contact-details-form.component";
import type { ContactDetails, ContactView } from "../../contacts.types";
import { useQuip } from "~/components/shared/quip/quip.hook";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { isApiError } from "~/core/utils/api-error.util";
import { QUIPS } from "~/core/constants/quips.constant";

const SHOWN = 6;

interface ContactPickerProps {
  /** What to search for first, e.g. the name in the calendar. */
  initialQuery: string;
  /** Prefills a new contact instead of the search text, e.g. to recreate one. */
  createFrom?: ContactDetails | undefined;
  onPick: (contact: ContactView) => void;
}

/** Finds one of her Google contacts, or creates one, for a client. */
export function ContactPicker({ initialQuery, createFrom, onPick }: ContactPickerProps) {
  const contacts = ContactsQuery.useList();
  const [query, setQuery] = useState(initialQuery);
  const [creating, setCreating] = useState(Boolean(createFrom));

  const matches = useMemo(() => searchContacts(contacts.data ?? [], query), [contacts.data, query]);

  if (creating) {
    return (
      <NewContact
        initial={createFrom ?? { givenName: query.trim(), email: "", phone: "", address: {} }}
        onCreated={onPick}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (contacts.error) {
    const disconnected = isApiError(contacts.error, "disconnected");
    return (
      <p role="alert" className="text-sm text-destructive">
        {contacts.error.message}{" "}
        {disconnected && (
          <Link to="/settings" className="underline underline-offset-4">
            Open Settings
          </Link>
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search your contacts"
          className="pl-8"
          placeholder="Search your contacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      <ul className="flex flex-col divide-y rounded-md border">
        {contacts.isPending && <li className="p-2 text-sm text-muted-foreground">Loading your contacts…</li>}
        {!contacts.isPending && matches.length === 0 && (
          <NoMatch query={query} />
        )}
        {matches.slice(0, SHOWN).map((contact) => (
          <li key={contact.resourceName}>
            <button
              type="button"
              className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => onPick(contact)}
            >
              <span className="text-sm font-medium">{contact.displayName || contact.email || "(no name)"}</span>
              <span className="text-xs text-muted-foreground">
                {[contact.phone, contact.email].filter(Boolean).join(" · ") || "No phone or email"}
              </span>
            </button>
          </li>
        ))}
        {matches.length > SHOWN && (
          <li className="p-2 text-xs text-muted-foreground">
            {matches.length - SHOWN} more; keep typing to narrow it down.
          </li>
        )}
      </ul>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> New contact
        </Button>
      </div>
    </div>
  );
}

function NewContact({
  initial,
  onCreated,
  onCancel,
}: {
  initial: ContactDetails;
  onCreated: (contact: ContactView) => void;
  onCancel: () => void;
}) {
  const create = ContactsMutation.useCreate();

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">Saved to your Google contacts, so it's on your phone too.</p>
      <ContactDetailsForm
        mode="create"
        initial={initial}
        submitLabel="Create contact"
        error={create.error?.message}
        onCancel={onCancel}
        onSubmit={async (details) => {
          try {
            const contact = await create.mutateAsync(details);
            toast.success(`${contact.displayName ?? "Contact"} added to your contacts`);
            onCreated(contact);
          } catch {
            // Shown through create.error.
          }
        }}
      />
    </div>
  );
}

function NoMatch({ query }: { query: string }) {
  const quip = useQuip(QUIPS.contactSearch);
  return (
    <li className="flex flex-col gap-0.5 p-2 text-sm">
      <span className="font-medium">{quip}</span>
      <span className="text-muted-foreground">No contact matches “{query}”.</span>
    </li>
  );
}
