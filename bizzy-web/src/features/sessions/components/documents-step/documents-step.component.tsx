import { FileTextIcon, ReceiptIcon, StampIcon } from "lucide-react";
import { toast } from "sonner";
import { allSessionDocuments, documentItems, sessionDocuments } from "../../session-stage.util";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { Session } from "../../sessions.types";
import type { DocumentRef, DocumentType } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { DocumentsMutation } from "~/features/documents/documents.mutation";
import { DocumentsService } from "~/features/documents/documents.service";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { formatCents } from "~/core/utils/money.util";

export function documentsStep(session: Session, bought: Package | undefined): PipelineStep {
  const docs = allSessionDocuments(session, bought);
  const issued = docs.filter(({ ref }) => ref.number);
  return {
    id: "documents",
    title: "Documents",
    state: issued.length > 0 ? "done" : "optional",
    meta:
      issued.length > 0
        ? issued.map(({ ref }) => documentLabel(ref.number, ref.revision)).join(", ")
        : "Invoice and receipt, if asked",
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
function DocumentsStep({ session, bought }: { session: Session; bought: Package | undefined }) {
  const items = documentItems(session, bought);
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
            {docs.map(({ ref }) => (
              <DocumentRow key={ref.documentId} type={type} docRef={ref} />
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

function DocumentRow({ type, docRef }: { type: DocumentType; docRef: DocumentRef }) {
  const issue = DocumentsMutation.useIssue();
  const issueIt = async () => {
    const { document } = await DocumentsService.get(docRef.documentId);
    const issued = await issue.mutateAsync(document);
    if (issued?.number) toast.success(`Issued ${documentLabel(issued.number, issued.revision)}`);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <TextLink to={documentRoute(type)} params={{ id: docRef.documentId }}>
        {docRef.number ? documentLabel(docRef.number, docRef.revision) : `Draft ${DOCUMENT_TYPES[type].title.toLowerCase()}`}
      </TextLink>
      {!docRef.number && (
        <Button size="sm" variant="outline" disabled={issue.isPending} onClick={() => void issueIt().catch(toastRefusal)}>
          <StampIcon /> Issue
        </Button>
      )}
    </div>
  );
}
