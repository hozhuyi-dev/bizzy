import { createFileRoute } from "@tanstack/react-router";
import type { DocumentSearch } from "~/features/documents/documents.types";
import { DocumentPage } from "~/features/documents/document-page.component";
import { documentsUrl, validateDocumentSearch } from "~/features/documents/documents.util";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/invoices/$id")({
  // The list it steps through: the invoices list's, or a session's or package's documents.
  validateSearch: (search: Record<string, unknown>): DocumentSearch => validateDocumentSearch(search),
  loader: ({ params }) => pageData(prefetch(DocumentsQuery.detail(params.id)), prefetch(ClientsQuery.list())),
  component: InvoiceRoute,
});

function InvoiceRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DocumentPage
      key={id}
      id={id}
      type="invoice"
      within={{ session: search.session, package: search.package, timeline: search.timeline }}
      filter={documentsUrl.toFilter(search)}
      // A new list to step through replaces the entry: Back still returns to the list.
      onFilterChange={(next) => void navigate({ search: documentsUrl.toSearch(next), replace: true })}
    />
  );
}
