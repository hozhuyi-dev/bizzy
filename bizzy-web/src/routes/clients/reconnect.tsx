import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage } from "~/features/clients/clients-page.component";
import { LAPSE_MONTHS } from "~/features/clients/clients.constant";
import { oneOf } from "~/core/utils/search.util";

export interface ReconnectSearch {
  lapse?: "6" | "12" | undefined;
}

export const Route = createFileRoute("/clients/reconnect")({
  validateSearch: (search: Record<string, unknown>): ReconnectSearch => ({
    // Numbers in the URL parse as numbers.
    lapse: oneOf(String(search.lapse), ["6", "12"] as const),
  }),
  component: ReconnectRoute,
});

function ReconnectRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ClientsPage
      view="reconnect"
      lapse={search.lapse ?? LAPSE_MONTHS[0]}
      onLapseChange={(lapse) => void navigate({ search: { lapse: lapse === "3" ? undefined : lapse } })}
    />
  );
}
