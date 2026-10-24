import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { ContactsMutation } from "../../contacts.mutation";
import { ContactsQuery } from "../../contacts.query";
import { searchContacts } from "../../contacts.util";
import { ContactDetailsForm } from "../contact-details-form/contact-details-form.component";
import type { ContactDetails, ContactView } from "../../contacts.types";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { isApiError } from "~/core/utils/api-error.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

const SHOWN = 6;

interface ContactPickerProps {
  /** What to search for first, e.g. the name in the calendar. */
  initialQuery: string;
  /** Prefills a new contact instead of the search text, e.g. to recreate one. */
  createFrom?: ContactDetails | undefined;
  onPick: (contact: ContactView) => void;
}

/**
 * Finds one of her Google contacts, or creates one for a client in a
 * dialog, as it is saved to Google at once.
 */
export function ContactPicker({ initialQuery, createFrom, onPick }: ContactPickerProps) {
  const contacts = ContactsQuery.useList();
  const [query, setQuery] = useState(initialQuery);
  const [creating, setCreating] = useState(Boolean(createFrom));

  const matches = useMemo(() => searchContacts(contacts.data ?? [], query), [contacts.data, query]);

  return (
    <>
      <Matches query={query} onQueryChange={setQuery} matches={matches} onPick={onPick} onCreate={() => setCreating(true)} />
      <SheetDialog open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <NewContact
            initial={createFrom ?? { givenName: query.trim(), email: "", phone: "", address: {} }}
            recreating={Boolean(createFrom)}
            onCreated={(contact) => {
              setCreating(false);
              onPick(contact);
            }}
            onCancel={() => setCreating(false)}
          />
        )}
      </SheetDialog>
    </>
  );
}

interface MatchesProps {
  query: string;
  onQueryChange: (query: string) => void;
  matches: Array<ContactView>;
  onPick: (contact: ContactView) => void;
  onCreate: () => void;
}

function Matches({ query, onQueryChange, matches, onPick, onCreate }: MatchesProps) {
  const contacts = ContactsQuery.useList();

  if (contacts.error) {
    const disconnected = isApiError(contacts.error, "disconnected");
    return (
      <ErrorMessage>
        {contacts.error.message}{" "}
        {disconnected && (
          <Link to="/settings" className="underline underline-offset-4">
            Open Settings
          </Link>
        )}
      </ErrorMessage>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search your contacts"
          className="h-(--control-height) pl-8"
          placeholder="Search your contacts"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
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
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          <PlusIcon /> New contact
        </Button>
      </div>
    </div>
  );
}

/** A new Google contact, made at once: picked for the client once saved. */
function NewContact({
  initial,
  recreating,
  onCreated,
  onCancel,
}: {
  initial: ContactDetails;
  recreating: boolean;
  onCreated: (contact: ContactView) => void;
  onCancel: () => void;
}) {
  const create = ContactsMutation.useCreate();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{recreating ? "Recreate the contact" : "New contact"}</DialogTitle>
        <DialogDescription>Saved to your Google contacts, so it's on your phone too.</DialogDescription>
      </DialogHeader>
      <ContactDetailsForm
        mode="create"
        initial={initial}
        submitLabel="Create contact"
        error={create.error?.message}
        onCancel={onCancel}
        onSubmit={async (details) => {
          try {
            const contact = await create.mutateAsync(details);
            toastWithQuip(`${contact.displayName ?? "Contact"} added to your contacts`, QUIPS.saved);
            onCreated(contact);
          } catch {
            // Shown through create.error.
          }
        }}
      />
    </>
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
