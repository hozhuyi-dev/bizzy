import { createFileRoute } from "@tanstack/react-router";
import type { DocumentsSearch } from "~/features/documents/documents.types";
import { DocumentPage } from "~/features/documents/document-page.component";
import { documentsUrl } from "~/features/documents/documents.util";

export const Route = createFileRoute("/invoices/$id")({
  // The invoices list it steps through.
  validateSearch: (search: Record<string, unknown>): DocumentsSearch => documentsUrl.validate(search),
  component: InvoiceRoute,
});

function InvoiceRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <DocumentPage
      key={id}
      id={id}
      type="invoice"
      filter={documentsUrl.toFilter(Route.useSearch())}
      // A new list to step through replaces the entry: Back still returns to the list.
      onFilterChange={(next) => void navigate({ search: documentsUrl.toSearch(next), replace: true })}
    />
  );
}
