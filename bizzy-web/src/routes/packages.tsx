import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/list/filter.types";
import type { PACKAGE_FACETS } from "~/features/packages/packages.constant";
import { PackagesPage } from "~/features/packages/packages-page.component";
import { packagesUrl } from "~/features/packages/packages.util";
import { textParam } from "~/core/utils/url-param.util";

export type PackagesSearch = FilterSearch<(typeof PACKAGE_FACETS)[number]> & {
  /** Opens a new package for this client. */
  new?: string | undefined;
  /** The calendar edit it was opened to settle: once the package is added, back to the to-do list. */
  settle?: string | undefined;
};

export const Route = createFileRoute("/packages")({
  validateSearch: (search: Record<string, unknown>): PackagesSearch => ({
    ...packagesUrl.validate(search),
    new: textParam(search.new),
    settle: textParam(search.settle),
  }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = packagesUrl.toFilter(search);

  return (
    <PackagesPage
      filter={filter}
      newFor={search.new}
      settle={search.settle}
      onFilterChange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, ...packagesUrl.toSearch(next) }),
          replace: next.text !== filter.text,
        })
      }
    />
  );
}
