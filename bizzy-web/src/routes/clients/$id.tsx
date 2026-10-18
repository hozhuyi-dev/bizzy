import { createFileRoute } from "@tanstack/react-router";
import { ClientPage } from "~/features/clients/client-page.component";
import { textParam } from "~/core/utils/search.util";

export interface ClientSearch {
  /** The calendar edit it was opened to settle: once saved, back to the to-do list. */
  settle?: string | undefined;
}

export const Route = createFileRoute("/clients/$id")({
  validateSearch: (search: Record<string, unknown>): ClientSearch => ({ settle: textParam(search.settle) }),
  component: ClientRoute,
});

function ClientRoute() {
  const { id } = Route.useParams();
  const { settle } = Route.useSearch();
  return <ClientPage key={id} mode="edit" id={id} settle={settle} />;
}
