import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, FileTextIcon, ReceiptIcon, StampIcon } from "lucide-react";
import { toast } from "sonner";
import { DocumentStatusBadge } from "../../documents.columns";
import { DocumentsMutation } from "../../documents.mutation";
import { documentLabel, documentRoute, refLabel } from "../../documents.util";
import type { ReactNode } from "react";
import type { DocumentLink } from "../../documents.types";
import { ListRow } from "~/components/shared/list-row/list-row.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

interface DocumentRowProps {
  doc: DocumentLink;
  /** The line under its number: what it is and what it comes to. */
  meta?: ReactNode;
  /** The last line: what it charges for. */
  detail?: string | undefined;
}

/**
 * A document covering something on its page (a session's invoice), laid out
 * like every to-do row (ListRow): its number and whether it is issued, then
 * Issue while it is a draft, and Open, which a click anywhere on the row
 * does too.
 */
export function DocumentRow({ doc, meta, detail }: DocumentRowProps) {
  const issue = DocumentsMutation.useIssue();
  const { type, ref, issued } = doc;
  const page = { to: documentRoute(type), params: { id: ref.id } };
  const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;

  return (
    <ListRow
      title={
        <>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <TextLink {...page}>{refLabel(type, ref, issued)}</TextLink>
          <DocumentStatusBadge status={issued ? "issued" : "draft"} />
        </>
      }
      meta={meta}
      detail={detail}
      detailTitle={detail}
      open={page}
      actions={
        <>
          {!issued && (
            <Button
              size="sm"
              variant="outline"
              disabled={issue.isPending}
              onClick={() =>
                issue.mutate(ref.id, {
                  onSuccess: (view) => {
                    if (view?.number) toast.success(`Issued ${documentLabel(view.number, view.revision)}`);
                  },
                  onError: toastRefusal,
                })
              }
            >
              <StampIcon /> Issue
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open ${refLabel(type, ref, issued)}`}
            render={<Link {...page} />}
            nativeButton={false}
          >
            <span className="hidden sm:inline">Open</span> <ArrowRightIcon />
          </Button>
        </>
      }
    />
  );
}
