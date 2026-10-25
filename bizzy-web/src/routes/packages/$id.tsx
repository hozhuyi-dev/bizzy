import { createFileRoute } from "@tanstack/react-router";
import type { PackageSearch } from "~/features/packages/packages.types";
import { PackagePage } from "~/features/packages/package-page.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { packagesUrl, validatePackageSearch } from "~/features/packages/packages.util";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/packages/$id")({
  // The list it steps through: the packages list's, or Home's.
  validateSearch: (search: Record<string, unknown>): PackageSearch => validatePackageSearch(search),
  loader: () => pageData(prefetch(PackagesQuery.list(true)), prefetch(ClientsQuery.list())),
  component: PackageRoute,
});

function PackageRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PackagePage
      key={id}
      id={id}
      stepping={{
        from: search.from,
        timeline: search.timeline,
        filter: packagesUrl.toFilter(search),
        // A new list to step through replaces the entry: Back still returns to the list.
        onFilterChange: (next) => void navigate({ search: packagesUrl.toSearch(next), replace: true }),
      }}
    />
  );
}
