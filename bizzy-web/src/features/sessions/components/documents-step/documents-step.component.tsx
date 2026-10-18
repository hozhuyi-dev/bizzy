import { FileTextIcon, ReceiptIcon, StampIcon } from "lucide-react";
import { toast } from "sonner";
import { allSessionDocuments, documentItems, sessionDocuments } from "../../session-stage.util";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { SessionView } from "../../sessions.types";
import type { DocumentLink, DocumentType } from "~/features/documents/documents.types";
import type { PackageView } from "~/features/packages/packages.types";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { DocumentsMutation } from "~/features/documents/documents.mutation";
import { documentLabel, documentRoute, refLabel } from "~/features/documents/documents.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { formatCents } from "~/core/utils/money.util";

export function documentsStep(session: SessionView, bought: PackageView | undefined): PipelineStep {
  const issued = allSessionDocuments(session, bought).filter((doc) => doc.issued);
  return {
    id: "documents",
    title: "Documents",
    state: issued.length > 0 ? "done" : "optional",
    meta:
      issued.length > 0 ? issued.map(({ type, ref }) => refLabel(type, ref, true)).join(", ") : "Invoice and receipt, if asked",
    content: <DocumentsStep session={session} bought={bought} />,
  };
}

const EMPTY: Record<DocumentType, string> = {
  invoice: "Nothing to invoice: a package credit covers it.",
  receipt: "A receipt is made when it is paid.",
};

/**
 * Its invoice and receipt. The invoice is drafted with the booking (its
 * fee is the invoice's line) and the receipt with the payment; issuing one
 * takes its number, when the client asks for it.
 */
function DocumentsStep({ session, bought }: { session: SessionView; bought: PackageView | undefined }) {
  const items = documentItems(session);
  return (
    <ul className="flex flex-col divide-y text-sm">
      {(["invoice", "receipt"] as const).map((type) => {
        const docs = sessionDocuments(type, session, bought);
        const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;
        return (
          <li key={type} className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{DOCUMENT_TYPES[type].title}</span>
              {docs.length === 0 && <span className="text-xs text-muted-foreground">{EMPTY[type]}</span>}
            </div>
            {docs.map((doc) => (
              <DocumentRow key={doc.ref.id} doc={doc} />
            ))}
            {type === "invoice" && items.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {items.map((item) => `${item.label} ${formatCents(item.amountCents)}`).join(" · ")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DocumentRow({ doc }: { doc: DocumentLink }) {
  const issue = DocumentsMutation.useIssue();
  const { type, ref, issued } = doc;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <TextLink to={documentRoute(type)} params={{ id: ref.id }}>
        {refLabel(type, ref, issued)}
      </TextLink>
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
    </div>
  );
}
