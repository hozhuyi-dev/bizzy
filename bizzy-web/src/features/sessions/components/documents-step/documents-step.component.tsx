import { allSessionDocuments, documentItems, sessionDocuments } from "../../session-stage.util";
import type { PageStep } from "~/components/shared/layout/page-steps/page-steps.component";
import type { SessionView } from "../../sessions.types";
import type { DocumentLink, DocumentType } from "~/features/documents/documents.types";
import type { PackageView } from "~/features/packages/packages.types";
import { DocumentRow } from "~/features/documents/components/document-row/document-row.component";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { refLabel } from "~/features/documents/documents.util";
import { methodLabel } from "~/features/payments/payments.util";
import { DataList, DataListItem } from "~/components/shared/list/data-list/data-list.component";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function documentsStep(session: SessionView, bought: PackageView | undefined): PageStep {
  const docs = allSessionDocuments(session, bought);
  // Package credits pay it all: nothing to invoice, so nothing to receipt.
  if (docs.length === 0 && session.feeCents === 0 && session.credits.length > 0) {
    return {
      id: "documents",
      title: "Documents",
      state: "none",
      meta: "Not needed: a package covers it",
      content: (
        <p className="text-sm text-muted-foreground">
          Nothing to invoice or receipt: package credits pay for this session. The package's own invoice and receipt
          are with it, on Packages.
        </p>
      ),
    };
  }
  return {
    id: "documents",
    title: "Documents",
    state: docs.some((doc) => doc.issued) ? "done" : "optional",
    meta: summary(docs),
    count: docs.length,
    content: <DocumentsStep session={session} bought={bought} />,
  };
}

/** Each one by its number once issued, or as a draft: "INV-0012 · receipt in draft". */
function summary(docs: ReadonlyArray<DocumentLink>): string {
  if (docs.length === 0) return "Invoice and receipt, if asked";
  const text = docs
    .map(({ type, ref, issued }) => (issued ? refLabel(type, ref, true) : `${DOCUMENT_TYPES[type].title.toLowerCase()} in draft`))
    .join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  const charged = items.reduce((sum, item) => sum + item.amountCents, 0);
  const charges = items.map((item) => `${item.label} ${formatCents(item.amountCents)}`).join(" · ");
  // Each steps through this session's documents, in this order.
  const within = { session: session.id };

  return (
    <DataList label="Documents">
      {(["invoice", "receipt"] as const).map((type) => {
        const docs = sessionDocuments(type, session, bought);
        if (docs.length === 0) {
          return (
            <DataListItem key={type}>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{DOCUMENT_TYPES[type].title}</span> · {EMPTY[type]}
              </p>
            </DataListItem>
          );
        }
        return docs.map((doc) => (
          <DataListItem key={doc.ref.id}>
            {type === "invoice" ? (
              <DocumentRow doc={doc} search={within} meta={`Invoice · ${formatCents(charged)}`} detail={charges || undefined} />
            ) : (
              <DocumentRow doc={doc} search={within} meta={receiptMeta(doc, session, bought)} />
            )}
          </DataListItem>
        ));
      })}
    </DataList>
  );
}

/** What the receipt records: "Receipt · $80 · PayNow · 12 Oct". */
function receiptMeta(doc: DocumentLink, session: SessionView, bought: PackageView | undefined): string {
  const paid = [session.paid, bought?.paid].find((p) => p?.receiptId === doc.ref.id);
  if (!paid) return "Receipt";
  return `Receipt · ${formatCents(paid.amountCents)} · ${methodLabel(paid.method)} · ${formatDate(paid.paidOn)}`;
}
