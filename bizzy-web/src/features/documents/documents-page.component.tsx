import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { cn } from "cn";
import { DocumentCard, documentColumns, documentLink } from "./documents.columns";
import { DOCUMENT_TYPES } from "./documents.constant";
import { DocumentsQuery } from "./documents.query";
import { documentFacets } from "./documents.util";
import type { DocumentType } from "./documents.types";
import type { ListFilter } from "~/core/filter/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { FilterBar } from "~/components/shared/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/load-more/load-more.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { formatWhen, isNarrowed, pageItems } from "~/core/filter/filter.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface DocumentsPageProps {
  type: DocumentType;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * One type of document, latest first, searched on the server a page at a
 * time: by number, who it is for, client, status and days. Invoices and
 * receipts are made from a session or a package, so there is no "new"
 * button here.
 */
export function DocumentsPage({ type, filter, onFilterChange }: DocumentsPageProps) {
  const spec = DOCUMENT_TYPES[type];
  const clients = ClientsQuery.useList();
  const facets = useMemo(() => documentFacets(clients.data ?? []), [clients.data]);
  const documents = DocumentsQuery.useSearch(type, filter);
  const data = useMemo(() => pageItems(documents.data), [documents.data]);

  const table = useTable({
    features: dataTableFeatures,
    columns: documentColumns,
    data,
    getRowId: (doc) => doc.id,
    // Read a page at a time, latest first: sorting a page would only sort
    // what is loaded.
    enableSorting: false,
  });

  return (
    <>
      <PageHeader
        title={spec.plural}
        toolbar={
          <FilterBar
            label={`Search ${spec.plural.toLowerCase()}`}
            value={filter}
            onChange={onFilterChange}
            facets={facets}
            dates
          />
        }
      />
      {queryMatch(documents, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: () => (
          <div className={cn("transition-opacity", documents.isPlaceholderData && "opacity-60")}>
            <DataTable
              table={table}
              rowLink={documentLink}
              empty={
                isNarrowed(filter) || documents.hasNextPage ? (
                  <EmptyState quips={QUIPS.search}>
                    No {spec.plural.toLowerCase()} found{documents.hasNextPage ? " yet" : ""}.
                  </EmptyState>
                ) : (
                  // Keyed by the days: each empty stretch gets its own line.
                  <EmptyState key={filter.when} quips={type === "invoice" ? QUIPS.invoices : QUIPS.receipts}>
                    No {spec.plural.toLowerCase()}
                    {filter.when ? ` in ${formatWhen(filter.when)}` : " yet"}. Make one from{" "}
                    {type === "invoice" ? "a session" : "a paid session"} or a package.
                  </EmptyState>
                )
              }
              renderCard={(row) => <DocumentCard doc={row.original} />}
            />
            <LoadMore pages={documents} found={data.length > 0} />
          </div>
        ),
      })}
    </>
  );
}
