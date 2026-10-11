import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage, LAPSE_MONTHS } from "~/features/clients/clients-page.component";
import { oneOf } from "~/core/utils/search.util";

export interface ClientsSearch {
  view?: "follow-up" | undefined;
  lapse?: "6" | "12" | undefined;
}

export const Route = createFileRoute("/clients/")({
  validateSearch: (search: Record<string, unknown>): ClientsSearch => ({
    view: oneOf(search.view, ["follow-up"] as const),
    // Numbers in the URL parse as numbers.
    lapse: oneOf(String(search.lapse), ["6", "12"] as const),
  }),
  component: ClientsRoute,
});

function ClientsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ClientsPage
      view={search.view ?? "all"}
      lapse={search.lapse ?? LAPSE_MONTHS[0]}
      onViewChange={(view) =>
        void navigate({ search: (prev) => ({ ...prev, view: view === "all" ? undefined : view }) })
      }
      onLapseChange={(lapse) =>
        void navigate({ search: (prev) => ({ ...prev, lapse: lapse === "3" ? undefined : lapse }) })
      }
    />
  );
}
