import { createFileRoute } from "@tanstack/react-router";
import { ClientPage } from "~/features/clients/client-page.component";
import { oneOf, textParam } from "~/core/utils/search.util";

/** Prefills for a client started from an unmatched calendar name. */
export interface NewClientSearch {
  name?: string | undefined;
  /** Where to go back to once saved. */
  from?: "home" | undefined;
}

export const Route = createFileRoute("/clients/new")({
  validateSearch: (search: Record<string, unknown>): NewClientSearch => ({
    name: textParam(search.name),
    from: oneOf(search.from, ["home"] as const),
  }),
  component: NewClientRoute,
});

function NewClientRoute() {
  const { name, from } = Route.useSearch();
  return <ClientPage mode="new" initialName={name} returnTo={from} />;
}
