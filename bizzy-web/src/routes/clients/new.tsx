import { createFileRoute } from "@tanstack/react-router";
import { ClientPage } from "~/features/clients/client-page.component";
import { oneOf } from "~/core/utils/search.util";

/** Prefills for a client started from an unmatched calendar name. */
export interface NewClientSearch {
  name?: string | undefined;
  /** The matched contact's resource name and display name. */
  contact?: string | undefined;
  contactName?: string | undefined;
  /** Where to go back to once saved. */
  from?: "sessions" | undefined;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export const Route = createFileRoute("/clients/new")({
  validateSearch: (search: Record<string, unknown>): NewClientSearch => ({
    name: text(search.name),
    contact: text(search.contact),
    contactName: text(search.contactName),
    from: oneOf(search.from, ["sessions"] as const),
  }),
  component: NewClientRoute,
});

function NewClientRoute() {
  const { name, contact, contactName, from } = Route.useSearch();
  return (
    <ClientPage
      mode="new"
      initialName={name}
      initialContact={contact ? { resourceName: contact, displayName: contactName ?? "" } : undefined}
      returnTo={from}
    />
  );
}
