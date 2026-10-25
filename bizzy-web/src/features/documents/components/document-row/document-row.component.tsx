import { FileTextIcon, ReceiptIcon } from "lucide-react";
import { DocumentStatusBadge } from "../../documents.columns";
import { documentRoute, refLabel } from "../../documents.util";
import { IssueButton } from "../issue-button/issue-button.component";
import type { ReactNode } from "react";
import type { DocumentLink, DocumentSearch } from "../../documents.types";
import { DataRow } from "~/components/shared/list/data-list/data-list.component";

interface DocumentRowProps {
  doc: DocumentLink;
  /** The line under its number: what it is and what it comes to. */
  meta?: ReactNode;
  /** The last line: what it charges for. */
  detail?: string | undefined;
  /** The list its page steps through: the documents of the page it is on. */
  search?: DocumentSearch | undefined;
}

/**
 * A document covering something on its page (a session's invoice), laid out
 * like every to-do row (DataRow): its number and whether it is issued, then
 * Issue while it is a draft. A click anywhere on the row opens it.
 */
export function DocumentRow({ doc, meta, detail, search }: DocumentRowProps) {
  const { type, ref, issued } = doc;
  const page = { to: documentRoute(type), params: { id: ref.id }, search: search ?? {} };
  const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;

  return (
    <DataRow
      title={
        <>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{refLabel(type, ref, issued)}</span>
          <DocumentStatusBadge status={issued ? "issued" : "draft"} />
        </>
      }
      meta={meta}
      detail={detail}
      detailTitle={detail}
      open={page}
      actions={!issued && <IssueButton id={ref.id} />}
    />
  );
}
