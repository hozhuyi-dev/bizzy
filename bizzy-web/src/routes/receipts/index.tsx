import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/filter/filter.types";
import { DocumentsPage } from "~/features/documents/documents-page.component";
import { DOCUMENT_FACETS } from "~/features/documents/documents.constant";
import { filterSearch, toFilter, toSearch } from "~/core/filter/filter.util";
import { monthKey } from "~/core/utils/date.util";

export type ReceiptsSearch = FilterSearch<(typeof DOCUMENT_FACETS)[number]>;

export const Route = createFileRoute("/receipts/")({
  validateSearch: (search: Record<string, unknown>): ReceiptsSearch => filterSearch(search, DOCUMENT_FACETS),
  component: ReceiptsRoute,
});

function ReceiptsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // This month unless the URL says otherwise.
  const thisMonth = monthKey(new Date());
  const filter = toFilter(search, DOCUMENT_FACETS, thisMonth);

  return (
    <DocumentsPage
      type="receipt"
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: toSearch(next, DOCUMENT_FACETS, thisMonth), replace: next.text !== filter.text })
      }
    />
  );
}
