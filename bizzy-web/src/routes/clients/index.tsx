import { createFileRoute } from "@tanstack/react-router";
import type { ClientsListSearch } from "~/features/clients/clients.types";
import { ClientsPage } from "~/features/clients/clients-page.component";
import { useClientsNavigate } from "~/features/clients/clients.hook";
import { clientsUrl } from "~/features/clients/clients.util";

export const Route = createFileRoute("/clients/")({
  validateSearch: (search: Record<string, unknown>): ClientsListSearch => clientsUrl.validate(search),
  component: ClientsRoute,
});

function ClientsRoute() {
  const filter = clientsUrl.toFilter(Route.useSearch());
  return <ClientsPage filter={filter} onFilterChange={useClientsNavigate(filter)} />;
}
