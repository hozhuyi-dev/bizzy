import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/list/filter.types";
import type { StandingFacet } from "~/features/clients/clients.constant";
import { ClientsPage } from "~/features/clients/clients-page.component";
import { useClientsNavigate } from "~/features/clients/clients.hook";
import { clientsUrl } from "~/features/clients/clients.util";

export type ClientsSearch = FilterSearch<StandingFacet>;

export const Route = createFileRoute("/clients/")({
  validateSearch: (search: Record<string, unknown>): ClientsSearch => clientsUrl.validate(search),
  component: ClientsRoute,
});

function ClientsRoute() {
  const filter = clientsUrl.toFilter(Route.useSearch());
  return <ClientsPage view="all" filter={filter} onFilterChange={useClientsNavigate("all", filter)} />;
}
