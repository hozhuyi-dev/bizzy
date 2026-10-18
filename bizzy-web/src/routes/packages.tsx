import { createFileRoute } from "@tanstack/react-router";
import { PackagesPage } from "~/features/packages/packages-page.component";
import { oneOf, textParam } from "~/core/utils/search.util";

export interface PackagesSearch {
  view?: "all" | undefined;
  /** Opens a new package for this client. */
  new?: string | undefined;
  /** The calendar edit it was opened to settle: once the package is added, back to the to-do list. */
  settle?: string | undefined;
}

export const Route = createFileRoute("/packages")({
  validateSearch: (search: Record<string, unknown>): PackagesSearch => ({
    view: oneOf(search.view, ["all"] as const),
    new: textParam(search.new),
    settle: textParam(search.settle),
  }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <PackagesPage
      view={search.view ?? "open"}
      newFor={search.new}
      settle={search.settle}
      onViewChange={(view) => void navigate({ search: { view: view === "open" ? undefined : view } })}
    />
  );
}
