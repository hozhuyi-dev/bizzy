import { createFileRoute } from "@tanstack/react-router";
import { PackagePage } from "~/features/packages/package-page.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/packages/$id")({
  loader: () => pageData(prefetch(PackagesQuery.list(true)), prefetch(ClientsQuery.list())),
  component: PackageRoute,
});

function PackageRoute() {
  const { id } = Route.useParams();
  return <PackagePage key={id} id={id} />;
}
