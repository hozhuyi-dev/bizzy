import { createFileRoute } from "@tanstack/react-router";
import { PackagesPage } from "~/features/packages/packages-page.component";
import { oneOf } from "~/core/utils/search.util";

export interface PackagesSearch {
  view?: "all" | undefined;
}

export const Route = createFileRoute("/packages")({
  validateSearch: (search: Record<string, unknown>): PackagesSearch => ({
    view: oneOf(search.view, ["all"] as const),
  }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <PackagesPage
      view={search.view ?? "open"}
      onViewChange={(view) => void navigate({ search: { view: view === "open" ? undefined : view } })}
    />
  );
}
