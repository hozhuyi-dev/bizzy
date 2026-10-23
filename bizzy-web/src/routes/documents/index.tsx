import { createFileRoute } from "@tanstack/react-router";
import type { DocumentsSearch } from "~/features/documents/documents.types";
import { DocumentsPage } from "~/features/documents/documents-page.component";
import { documentsUrl } from "~/features/documents/documents.util";

export const Route = createFileRoute("/documents/")({
  validateSearch: (search: Record<string, unknown>): DocumentsSearch => documentsUrl.validate(search),
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const navigate = Route.useNavigate();
  // This month unless the URL says otherwise.
  const filter = documentsUrl.toFilter(Route.useSearch());

  return (
    <DocumentsPage
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: documentsUrl.toSearch(next), replace: next.text !== filter.text })
      }
    />
  );
}
