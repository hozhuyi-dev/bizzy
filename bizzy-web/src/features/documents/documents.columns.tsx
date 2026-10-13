import { DOCUMENT_STATUS } from "./documents.constant";
import { documentLabel, documentRoute } from "./documents.util";
import { DocumentStatusBadge } from "./components/document-status-badge/document-status-badge.component";
import type { DocumentSummary } from "./documents.types";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Card, CardContent } from "~/components/ui/card";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

export function DocumentLink({ doc }: { doc: DocumentSummary }) {
  return (
    <TextLink to={documentRoute(doc.type)} params={{ id: doc.id }}>
      {documentLabel(doc.number, doc.revision)}
    </TextLink>
  );
}

const helper = createDataTableColumnHelper<DocumentSummary>();

export const documentColumns = helper.columns([
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

/** The phone layout of a table row. */
export function DocumentCard({ doc }: { doc: DocumentSummary }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <DocumentLink doc={doc} />
          <span className="text-sm text-muted-foreground">
            {doc.recipientName} · {formatDate(doc.date)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-sm">{formatCents(doc.totalCents)}</span>
          <DocumentStatusBadge status={doc.status} revising={doc.revising} />
        </div>
      </CardContent>
    </Card>
  );
}
