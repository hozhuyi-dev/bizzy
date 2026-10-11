import { useState } from "react";
import { DownloadIcon, EyeIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DocumentEditorActions,
  DocumentEditorFields,
  useDocumentEditor,
} from "./components/document-editor/document-editor.component";
import { DocumentView } from "./components/document-view/document-view.component";
import { DocumentStatusBadge } from "./documents-page.component";
import { DocumentsMutation, DocumentsQuery } from "./documents.query";
import { DOCUMENT_TYPES, documentLabel } from "./documents.registry";
import { downloadDocumentPdf, openDocumentPdf } from "./pdf/download-pdf";
import type { ReactNode } from "react";
import type { DocumentPdfProps } from "./pdf/document-pdf.component";
import type { BizDocument, DocumentContent, DocumentRevision } from "./documents.types";
import { BackLink, PageHeader } from "~/components/shared/page-header/page-header.component";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";

const back = <BackLink to="/receipts">Receipts</BackLink>;

function documentTitle(doc: BizDocument): string {
  return `${DOCUMENT_TYPES[doc.type].title} ${documentLabel(doc.number, doc.revision)}`;
}

export function DocumentPage({ id }: { id: string }) {
  const detail = DocumentsQuery.useDetail(id);

  return queryMatch(detail, {
    pending: () => (
      <>
        <PageHeader back={back} title="Receipt" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    ),
    error: (error) => (
      <>
        <PageHeader back={back} title="Receipt" />
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      </>
    ),
    success: ({ document: doc, revisions }) => {
      const history = <Revisions doc={doc} revisions={revisions} />;
      if (doc.draft) {
        // Remount on every save so the form restarts from what was stored.
        return <DraftDocument key={doc.version} doc={doc} draft={doc.draft} history={history} />;
      }
      return doc.content ? <IssuedDocument doc={doc} content={doc.content} history={history} /> : null;
    },
  });
}

interface DraftDocumentProps {
  doc: BizDocument;
  draft: DocumentContent;
  history: ReactNode;
}

function DraftDocument({ doc, draft, history }: DraftDocumentProps) {
  const editor = useDocumentEditor(doc, draft);

  return (
    <>
      <PageHeader
        back={back}
        title={documentTitle(doc)}
        badges={<DocumentStatusBadge doc={doc} />}
        actions={<DocumentEditorActions editor={editor} />}
      />
      {doc.number && (
        <p className="mb-4 text-sm text-muted-foreground">
          Editing the next revision. {documentLabel(doc.number, doc.revision)} stays the valid one
          until you issue this.
        </p>
      )}
      <DocumentEditorFields editor={editor} />
      {history}
    </>
  );
}

interface IssuedDocumentProps {
  doc: BizDocument;
  content: DocumentContent;
  history: ReactNode;
}

function IssuedDocument({ doc, content, history }: IssuedDocumentProps) {
  const revise = DocumentsMutation.useRevise();
  const [cancelling, setCancelling] = useState(false);
  const cancelled = doc.status === "cancelled";
  const pdf: DocumentPdfProps = {
    type: doc.type,
    number: doc.number,
    revision: doc.revision,
    watermark: cancelled ? "CANCELLED" : undefined,
    content,
  };

  return (
    <>
      <PageHeader
        back={back}
        title={documentTitle(doc)}
        badges={<DocumentStatusBadge doc={doc} />}
        actions={
          <>
            <PdfButtons pdf={pdf} />
            {!cancelled && (
              <>
                <Button variant="ghost" onClick={() => setCancelling(true)}>
                  Cancel {DOCUMENT_TYPES[doc.type].title.toLowerCase()}
                </Button>
                <Button
                  disabled={revise.isPending}
                  onClick={() => revise.mutate(doc, { onError: (error) => toast.error(error.message) })}
                >
                  Revise
                </Button>
              </>
            )}
          </>
        }
      />
      {cancelled && (
        <p className="mb-4 text-sm text-muted-foreground">
          Cancelled {doc.cancelledAt ? formatDate(doc.cancelledAt) : ""}
          {doc.cancelReason ? `: ${doc.cancelReason}` : ""}. The number stays used.
        </p>
      )}
      <div className="max-w-3xl">
        <DocumentView type={doc.type} content={content} number={doc.number} revision={doc.revision} cancelled={cancelled} />
      </div>
      {history}
      <CancelDialog doc={doc} open={cancelling} onClose={() => setCancelling(false)} />
    </>
  );
}

function Revisions({ doc, revisions }: { doc: BizDocument; revisions: Array<DocumentRevision> }) {
  if (revisions.length === 0) return null;
  return (
    <section className="mt-8 flex max-w-3xl flex-col gap-2">
      <h2 className="text-sm font-semibold">Issued revisions</h2>
      <Card size="sm">
        <CardContent>
          <ul className="flex flex-col divide-y">
            {[...revisions].reverse().map((rev) => (
              <li key={rev.revision} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {documentLabel(rev.number, rev.revision)}
                  <span className="text-muted-foreground">
                    {" "}
                    · issued {formatDate(rev.issuedAt)} · {formatCents(rev.content.totalCents)}
                  </span>
                </span>
                <span className="flex gap-1">
                  <PdfButtons
                    size="sm"
                    pdf={{ type: doc.type, number: rev.number, revision: rev.revision, content: rev.content }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

/** View opens the real PDF in a new tab; Download saves it with a proper name. */
function PdfButtons({ pdf, size = "default" }: { pdf: DocumentPdfProps; size?: "default" | "sm" }) {
  const [busy, setBusy] = useState(false);
  const run = (action: (props: DocumentPdfProps) => Promise<void>) => {
    setBusy(true);
    action(pdf)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't make the PDF"))
      .finally(() => setBusy(false));
  };
  const variant = size === "sm" ? "ghost" : "outline";

  return (
    <>
      <Button variant={variant} size={size} disabled={busy} onClick={() => run(openDocumentPdf)}>
        <EyeIcon /> View PDF
      </Button>
      <Button variant={variant} size={size} disabled={busy} onClick={() => run(downloadDocumentPdf)}>
        <DownloadIcon /> Download
      </Button>
    </>
  );
}

function CancelDialog({ doc, open, onClose }: { doc: BizDocument; open: boolean; onClose: () => void }) {
  const cancel = DocumentsMutation.useCancel();
  const [reason, setReason] = useState("");
  const title = DOCUMENT_TYPES[doc.type].title.toLowerCase();

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel {doc.number}?</AlertDialogTitle>
          <AlertDialogDescription>
            The {title} is kept, marked cancelled, and its number is never reused. The session or
            package it covered is free for a new {title}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(
                { doc, reason },
                {
                  onSuccess: () => {
                    toast.success(`${doc.number ?? "Document"} cancelled`);
                    onClose();
                  },
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            Cancel {title}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
