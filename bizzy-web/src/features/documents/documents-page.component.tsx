import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { DOCUMENT_TYPES, currentContent, documentLabel } from "./documents.registry";
import { DocumentsQuery } from "./documents.query";
import type { BizDocument, DocumentStatus, DocumentType } from "./documents.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import {
  createDataTableColumnHelper,
  dataTableFeatures,
} from "~/components/shared/data-table/data-table.features";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";

const NO_DOCUMENTS: Array<BizDocument> = [];

export function DocumentStatusBadge({ doc }: { doc: BizDocument }) {
  const labels: Record<DocumentStatus, string> = { draft: "Draft", issued: "Issued", cancelled: "Cancelled" };
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={doc.status === "issued" ? "secondary" : "outline"}>{labels[doc.status]}</Badge>
      {doc.status === "issued" && doc.draft && <Badge variant="outline">Revising</Badge>}
    </span>
  );
}

function DocumentLink({ doc }: { doc: BizDocument }) {
  return (
    <Link to="/receipts/$id" params={{ id: doc.id }} className="font-medium underline-offset-4 hover:underline">
      {documentLabel(doc.number, doc.revision)}
    </Link>
  );
}

const helper = createDataTableColumnHelper<BizDocument>();

const columns = helper.columns([
  helper.accessor((doc) => doc.number ?? "", {
    id: "number",
    header: "No.",
    sortFn: "alphanumeric",
    cell: ({ row }) => <DocumentLink doc={row.original} />,
  }),
  helper.accessor("date", {
    header: "Date",
    sortFn: "alphanumeric",
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  helper.accessor((doc) => currentContent(doc)?.recipient.name ?? "", {
    id: "recipient",
    header: "For",
    sortFn: "alphanumeric",
  }),
  helper.accessor("totalCents", {
    header: "Total",
    sortFn: "basic",
    cell: ({ getValue }) => formatCents(getValue()),
  }),
  helper.accessor("status", {
    header: "Status",
    sortFn: "alphanumeric",
    cell: ({ row }) => <DocumentStatusBadge doc={row.original} />,
  }),
]);

/**
 * Every document of one type, newest first. Receipts are made from a session
 * or a package, so there is no "new" button here.
 */
export function DocumentsPage({ type }: { type: DocumentType }) {
  const documents = DocumentsQuery.useList(type);
  const spec = DOCUMENT_TYPES[type];
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
      <PageHeader title={spec.plural} />
      {queryMatch(documents, {
        pending: () => <p className="text-sm text-muted-foreground">Loading…</p>,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: () => (
          <DataTable
            table={table}
            emptyMessage={`No ${spec.plural.toLowerCase()} yet. Make one from a paid session or a package.`}
            renderCard={(row) => (
              <Card size="sm">
                <CardContent className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <DocumentLink doc={row.original} />
                    <span className="text-sm text-muted-foreground">
                      {currentContent(row.original)?.recipient.name} · {formatDate(row.original.date)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm">{formatCents(row.original.totalCents)}</span>
                    <DocumentStatusBadge doc={row.original} />
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
