import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { DocumentCard, documentColumns } from "./documents.columns";
import { DOCUMENT_TYPES } from "./documents.constant";
import { DocumentsQuery } from "./documents.query";
import type { DocumentSummary, DocumentType } from "./documents.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { MonthPicker } from "~/components/shared/month-picker/month-picker.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { formatMonth, monthKey } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

const NO_DOCUMENTS: Array<DocumentSummary> = [];

interface DocumentsPageProps {
  type: DocumentType;
  /** "2026-10": one month at a time, like the sessions history. */
  month: string;
  onMonthChange: (month: string) => void;
}

/**
 * One month of one type of document, newest first. Invoices and receipts
 * are made from a session or a package, so there is no "new" button here.
 */
export function DocumentsPage({ type, month, onMonthChange }: DocumentsPageProps) {
  const documents = DocumentsQuery.useList(type, month);
  const spec = DOCUMENT_TYPES[type];
  const [search, setSearch] = useState("");
  const data = useMemo(() => documents.data ?? NO_DOCUMENTS, [documents.data]);

  const table = useTable({
    features: dataTableFeatures,
    columns: documentColumns,
    data,
    getRowId: (doc) => doc.id,
    initialState: { sorting: [{ id: "date", desc: true }] },
  });

  return (
    <>
      <PageHeader
        title={spec.plural}
        toolbar={
          <>
            <MonthPicker value={month} onChange={onMonthChange} max={monthKey(new Date())} />
            <SearchInput label={`Search ${spec.plural.toLowerCase()}`} value={search} onChange={setSearch} />
          </>
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
          <DataTable
            table={table}
            query={search}
            empty={
              // Keyed by month: each empty month gets its own line.
              <EmptyState key={month} quips={type === "invoice" ? QUIPS.invoices : QUIPS.receipts}>
                No {spec.plural.toLowerCase()} in {formatMonth(month)}. Make one from{" "}
                {type === "invoice" ? "a session" : "a paid session"} or a package.
              </EmptyState>
            }
            renderCard={(row) => <DocumentCard doc={row.original} />}
          />
        ),
      })}
    </>
  );
}
