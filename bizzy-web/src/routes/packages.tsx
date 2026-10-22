import { createFileRoute } from "@tanstack/react-router";
import type { ListFilter } from "~/core/list/filter.types";
import { PackagesPage } from "~/features/packages/packages-page.component";
import { packagesView } from "~/features/packages/packages.util";
import { oneOf, textParam } from "~/core/utils/url-param.util";
import { sortParam } from "~/core/list/filter.util";

export interface PackagesSearch {
  q?: string | undefined;
  /** "all" when the Open chip is removed. */
  view?: "all" | undefined;
  client?: Array<string> | undefined;
  /** The column sorted by (see ListFilter). */
  sort?: string | undefined;
  /** Opens a new package for this client. */
  new?: string | undefined;
  /** The calendar edit it was opened to settle: once the package is added, back to the to-do list. */
  settle?: string | undefined;
}

export const Route = createFileRoute("/packages")({
  validateSearch: (search: Record<string, unknown>): PackagesSearch => ({
    q: textParam(search.q),
    view: oneOf(search.view, ["all"] as const),
    client: Array.isArray(search.client) ? search.client.filter((id): id is string => typeof id === "string") : undefined,
    sort: sortParam(search.sort),
    new: textParam(search.new),
    settle: textParam(search.settle),
  }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter: ListFilter = {
    text: search.q ?? "",
    when: undefined,
    chips: { status: search.view === "all" ? [] : ["open"], client: search.client ?? [] },
    sort: search.sort,
  };

  return (
    <PackagesPage
      filter={filter}
      newFor={search.new}
      settle={search.settle}
      onFilterChange={(next) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            q: next.text.trim() || undefined,
            view: packagesView(next) === "all" ? "all" : undefined,
            client: next.chips.client?.length ? [...next.chips.client] : undefined,
            sort: next.sort,
          }),
          replace: next.text !== filter.text,
        })
      }
    />
  );
}
