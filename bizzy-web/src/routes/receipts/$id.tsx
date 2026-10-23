import { createFileRoute } from "@tanstack/react-router";
import type { DocumentsSearch } from "~/features/documents/documents.types";
import { DocumentPage } from "~/features/documents/document-page.component";
import { documentsUrl } from "~/features/documents/documents.util";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/receipts/$id")({
  // The receipts list it steps through.
  validateSearch: (search: Record<string, unknown>): DocumentsSearch => documentsUrl.validate(search),
  loader: ({ params }) => pageData(prefetch(DocumentsQuery.detail(params.id)), prefetch(ClientsQuery.list())),
  component: ReceiptRoute,
});

function ReceiptRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <DocumentPage
      key={id}
      id={id}
      type="receipt"
      filter={documentsUrl.toFilter(Route.useSearch())}
      // A new list to step through replaces the entry: Back still returns to the list.
      onFilterChange={(next) => void navigate({ search: documentsUrl.toSearch(next), replace: true })}
    />
  );
}
