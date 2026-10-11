import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { DOCUMENT_TYPES, documentLabel } from "./documents.registry";
import { DocumentsQuery } from "./documents.query";
import type { DocumentStatus, DocumentSummary, DocumentType } from "./documents.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { MonthPicker } from "~/components/shared/month-picker/month-picker.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import {
  createDataTableColumnHelper,
  dataTableFeatures,
} from "~/components/shared/data-table/data-table.features";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { formatCents } from "~/core/utils/money.util";
import { formatDate, formatMonth } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

const NO_DOCUMENTS: Array<DocumentSummary> = [];

const DOCUMENT_STATUS: Record<DocumentStatus, { label: string; variant: "waiting" | "done" | "neutral" }> = {
  draft: { label: "Draft", variant: "waiting" },
  issued: { label: "Issued", variant: "done" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

export function DocumentStatusBadge({ status, revising }: { status: DocumentStatus; revising?: boolean | undefined }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={DOCUMENT_STATUS[status].variant}>{DOCUMENT_STATUS[status].label}</Badge>
      {revising && <Badge variant="waiting">Revising</Badge>}
    </span>
  );
}

function DocumentLink({ doc }: { doc: DocumentSummary }) {
  return (
    <TextLink to="/receipts/$id" params={{ id: doc.id }}>
      {documentLabel(doc.number, doc.revision)}
    </TextLink>
  );
}

const helper = createDataTableColumnHelper<DocumentSummary>();

const columns = helper.columns([
  helper.accessor((doc) => doc.number ?? "", {
    id: "number",
    header: "No.",
    sortFn: "alphanumeric",
    meta: { search: (doc: DocumentSummary) => documentLabel(doc.number, doc.revision) },
    cell: ({ row }) => <DocumentLink doc={row.original} />,
  }),
  helper.accessor("date", {
    header: "Date",
    sortFn: "alphanumeric",
    meta: { search: (doc: DocumentSummary) => formatDate(doc.date) },
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  helper.accessor("recipientName", {
    header: "For",
    sortFn: "alphanumeric",
  }),
  helper.accessor("totalCents", {
    header: "Total",
    sortFn: "basic",
    meta: { search: (doc: DocumentSummary) => formatCents(doc.totalCents) },
    cell: ({ getValue }) => formatCents(getValue()),
  }),
  helper.accessor("status", {
    header: "Status",
    sortFn: "alphanumeric",
    meta: {
      search: (doc: DocumentSummary) => [DOCUMENT_STATUS[doc.status].label, doc.revising ? "Revising" : undefined],
    },
    cell: ({ row }) => <DocumentStatusBadge status={row.original.status} revising={row.original.revising} />,
  }),
]);

interface DocumentsPageProps {
  type: DocumentType;
  /** "2026-10": one month at a time, like the sessions history. */
  month: string;
  onMonthChange: (month: string) => void;
}

/**
 * One month of one type of document, newest first. Receipts are made from a
 * session or a package, so there is no "new" button here.
 */
export function DocumentsPage({ type, month, onMonthChange }: DocumentsPageProps) {
  const documents = DocumentsQuery.useList(type, month);
  const spec = DOCUMENT_TYPES[type];
  const [search, setSearch] = useState("");
  const data = useMemo(() => documents.data ?? NO_DOCUMENTS, [documents.data]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
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
            <MonthPicker value={month} onChange={onMonthChange} />
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
              <EmptyState key={month} quips={QUIPS.receipts}>
                No {spec.plural.toLowerCase()} in {formatMonth(month)}. Make one from a paid session or a
                package.
              </EmptyState>
            }
            renderCard={(row) => (
              <Card size="sm">
                <CardContent className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <DocumentLink doc={row.original} />
                    <span className="text-sm text-muted-foreground">
                      {row.original.recipientName} · {formatDate(row.original.date)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm">{formatCents(row.original.totalCents)}</span>
                    <DocumentStatusBadge status={row.original.status} revising={row.original.revising} />
                  </div>
                </CardContent>
              </Card>
            )}
          />
        ),
      })}
    </>
  );
}
