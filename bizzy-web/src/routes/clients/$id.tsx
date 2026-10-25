import { createFileRoute } from "@tanstack/react-router";
import type { ClientsListSearch } from "~/features/clients/clients.types";
import { ClientPage } from "~/features/clients/client-page.component";
import { clientsUrl } from "~/features/clients/clients.util";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ActivityQuery } from "~/features/activity/activity.query";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/clients/$id")({
  // The clients list it steps through, too.
  validateSearch: (search: Record<string, unknown>): ClientsListSearch => clientsUrl.validate(search),
  // Its timeline, read a page at a time with its own filter, shows its own loading.
  loader: ({ params }) =>
    pageData(
      prefetch(ClientsQuery.list()),
      prefetch(ActivityQuery.list()),
      prefetch(DocumentsQuery.byClient(params.id)),
      prefetch(PackagesQuery.list(true)),
    ),
  component: ClientRoute,
});

function ClientRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ClientPage
      key={id}
      mode="edit"
      id={id}
      filter={clientsUrl.toFilter(search)}
      // A new list to step through replaces the entry: Back still returns to the list.
      onFilterChange={(next) =>
        void navigate({ search: (prev) => ({ ...prev, ...clientsUrl.toSearch(next) }), replace: true })
      }
    />
  );
}
