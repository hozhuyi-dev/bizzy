import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage } from "~/features/clients/clients-page.component";
import { useClientsNavigate } from "~/features/clients/clients.hook";
import { textParam } from "~/core/utils/search.util";

export interface ClientsSearch {
  q?: string | undefined;
}

export const Route = createFileRoute("/clients/")({
  validateSearch: (search: Record<string, unknown>): ClientsSearch => ({ q: textParam(search.q) }),
  component: ClientsRoute,
});

function ClientsRoute() {
  const { q } = Route.useSearch();
  const filter = { text: q ?? "", when: undefined, chips: {} };
  return <ClientsPage filter={filter} onFilterChange={useClientsNavigate(filter)} />;
}
