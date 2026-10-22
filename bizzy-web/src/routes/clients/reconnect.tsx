import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage } from "~/features/clients/clients-page.component";
import { LAPSE_FACET, LAPSE_MONTHS } from "~/features/clients/clients.constant";
import { useClientsNavigate } from "~/features/clients/clients.hook";
import { oneOf, textParam } from "~/core/utils/url-param.util";
import { sortParam } from "~/core/list/filter.util";

export interface ReconnectSearch {
  q?: string | undefined;
  lapse?: "6" | "12" | undefined;
  sort?: string | undefined;
}

export const Route = createFileRoute("/clients/reconnect")({
  validateSearch: (search: Record<string, unknown>): ReconnectSearch => ({
    q: textParam(search.q),
    // Numbers in the URL parse as numbers.
    lapse: oneOf(String(search.lapse), ["6", "12"] as const),
    sort: sortParam(search.sort),
  }),
  component: ReconnectRoute,
});

function ReconnectRoute() {
  const { q, lapse, sort } = Route.useSearch();
  const filter = { text: q ?? "", when: undefined, chips: { [LAPSE_FACET]: [lapse ?? LAPSE_MONTHS[0]] }, sort };
  return <ClientsPage view="reconnect" filter={filter} onFilterChange={useClientsNavigate("reconnect", filter)} />;
}
