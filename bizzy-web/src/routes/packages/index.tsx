import { createFileRoute } from "@tanstack/react-router";
import type { PackagesSearch } from "~/features/packages/packages.types";
import { PackagesPage } from "~/features/packages/packages-page.component";
import { packagesUrl } from "~/features/packages/packages.util";

export const Route = createFileRoute("/packages/")({
  validateSearch: (search: Record<string, unknown>): PackagesSearch => packagesUrl.validate(search),
  component: PackagesRoute,
});

function PackagesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = packagesUrl.toFilter(search);

  return (
    <PackagesPage
      filter={filter}
      onFilterChange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, ...packagesUrl.toSearch(next) }),
          replace: next.text !== filter.text,
        })
      }
    />
  );
}
