import { createFileRoute } from "@tanstack/react-router";
import { ClientPage } from "~/features/clients/client-page.component";
import { textParam } from "~/core/utils/url-param.util";

export interface NewClientSearch {
  /** A prefill, e.g. from an unmatched calendar name. */
  name?: string | undefined;
  /** The calendar edit it was opened to settle: once saved, back to the to-do list. */
  settle?: string | undefined;
}

export const Route = createFileRoute("/clients/new")({
  validateSearch: (search: Record<string, unknown>): NewClientSearch => ({
    name: textParam(search.name),
    settle: textParam(search.settle),
  }),
  component: NewClientRoute,
});

function NewClientRoute() {
  const { name, settle } = Route.useSearch();
  return <ClientPage mode="new" initialName={name} settle={settle} />;
}
