import { useState } from "react";
import { ArrowLeftRightIcon, PencilIcon, RotateCcwIcon, Undo2Icon, UnlinkIcon } from "lucide-react";
import { chosenFromContact, recreateFrom } from "../../clients.util";
import type { ChosenContact } from "../../clients.types";
import type { ContactView } from "~/features/contacts/contacts.types";
import { ContactsQuery } from "~/features/contacts/contacts.query";
import { ContactDetailsEditor } from "~/features/contacts/components/contact-details-editor/contact-details-editor.component";
import { ContactPicker } from "~/features/contacts/components/contact-picker/contact-picker.component";
import { ContactSummary } from "~/features/contacts/components/contact-summary/contact-summary.component";
import { Button } from "~/components/ui/button";

interface ClientContactProps {
  contact: ChosenContact | null;
  /** The contact the saved client is linked to, to undo an unlink. */
  linked: ChosenContact | undefined;
  /** What the picker searches for first. */
  searchFor: string;
  clientName: string | undefined;
  onChange: (contact: ChosenContact | null) => void;
}

type Mode = "view" | "change" | "recreate" | "edit";

/**
 * The client's Google contact, all in place: a summary once chosen, with its
 * details edited, the contact changed or recreated, or the link removed,
 * right here instead of in a dialog. Without one, a picker that can also
 * create the contact.
 */
export function ClientContact({ contact, linked, searchFor, clientName, onChange }: ClientContactProps) {
  const contacts = ContactsQuery.useList();
  const [mode, setMode] = useState<Mode>("view");

  const pick = (picked: ContactView) => {
    onChange(chosenFromContact(picked));
    setMode("view");
  };

  if (!contact && linked) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Unlinked from {linked.displayName || "the contact"} when you save. Pick the right contact, or
          leave it unlinked.
        </p>
        <ContactPicker initialQuery={searchFor} onPick={pick} />
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(linked)}>
            <Undo2Icon /> Keep {linked.displayName || "the contact"}
          </Button>
        </div>
      </div>
    );
  }

  if (!contact || mode === "change" || mode === "recreate") {
    return (
      <div className="flex flex-col gap-3">
        <ContactPicker
          initialQuery={searchFor}
          createFrom={mode === "recreate" && contact ? recreateFrom(contact, clientName) : undefined}
          onPick={pick}
        />
        {contact && (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")}>
              <Undo2Icon /> Keep {contact.displayName || "the current contact"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (mode === "edit") {
    return (
      <ContactDetailsEditor
        resourceName={contact.resourceName}
        onDone={() => setMode("view")}
        onSaved={(saved) => onChange(chosenFromContact(saved))}
      />
    );
  }

  // A contact chosen from a calendar suggestion arrives with only its name.
  const listed = contacts.data?.find((c) => c.resourceName === contact.resourceName);
  const shown = contact.missing || !listed ? contact : chosenFromContact(listed);

  return (
    <div className="flex flex-col gap-3">
      {contact.missing && (
        <p className="text-sm text-status-attention-foreground">
          This contact is no longer in Google Contacts. Recreate it from the details kept here, or choose
          another.
        </p>
      )}
      <ContactSummary
        contact={shown}
        actions={
          contact.missing ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("recreate")}>
              <RotateCcwIcon /> Recreate
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("edit")}>
              <PencilIcon /> Edit details
            </Button>
          )
        }
      />
      <div className="-ml-2.5 flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("change")}>
          <ArrowLeftRightIcon /> Change
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onChange(null)}
        >
          <UnlinkIcon /> Unlink
        </Button>
      </div>
    </div>
  );
}
