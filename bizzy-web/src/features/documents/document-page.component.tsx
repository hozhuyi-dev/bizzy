import { useState } from "react";
import { BanIcon, CircleAlertIcon, DownloadIcon, EyeIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DocumentIssueButton,
  documentEditorActions,
  documentEditorSections,
  useDocumentEditor,
} from "./components/document-editor/document-editor.component";
import { DocumentView } from "./components/document-view/document-view.component";
import { DocumentStatusBadge } from "./documents-page.component";
import { DocumentsMutation, DocumentsQuery } from "./documents.query";
import { DOCUMENT_TYPES, documentLabel } from "./documents.registry";
import { downloadDocumentPdf, openDocumentPdf } from "./pdf/download-pdf";
import type { DocumentPdfProps } from "./pdf/document-pdf.component";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import type { BizDocument, DocumentContent, DocumentRevision } from "./documents.types";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { Loading } from "~/components/shared/quip/quip.component";
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
import { Input } from "~/components/ui/input";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";

// The breadcrumb already says what kind of document this is.
const parent = { to: "/receipts", label: "Receipts" } as const;

export function DocumentPage({ id }: { id: string }) {
  const detail = DocumentsQuery.useDetail(id);

  return queryMatch(detail, {
    pending: () => (
      <>
        <PageHeader parent={parent} title="…" />
        <Loading />
      </>
    ),
    error: (error) => (
      <>
        <PageHeader parent={parent} title="Not available" />
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      </>
    ),
    success: ({ document: doc, revisions }) => {
      if (doc.draft) {
        // Remount on every save so the form restarts from what was stored.
        return <DraftDocument key={doc.version} doc={doc} draft={doc.draft} revisions={revisions} />;
      }
      return doc.content ? <IssuedDocument doc={doc} content={doc.content} revisions={revisions} /> : null;
    },
  });
}

interface DraftDocumentProps {
  doc: BizDocument;
  draft: DocumentContent;
  revisions: Array<DocumentRevision>;
}

function DraftDocument({ doc, draft, revisions }: DraftDocumentProps) {
  const editor = useDocumentEditor(doc, draft);
  const history = revisionsSection(doc, revisions);

  return (
    <>
      <PageHeader
        parent={parent}
        title={documentLabel(doc.number, doc.revision)}
        badges={<DocumentStatusBadge status={doc.status} revising={doc.status === "issued" && Boolean(doc.draft)} />}
        actions={<DocumentIssueButton editor={editor} />}
        moreActions={documentEditorActions(editor)}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void editor.save();
        }}
      >
        <SectionLayout
          banner={
            editor.invalid && (
              <Banner tone="attention" icon={CircleAlertIcon} title={editor.invalid} role="alert" />
            )
          }
          sections={[...documentEditorSections(editor), ...(history ? [history] : [])]}
        />
      </form>
    </>
  );
}

interface IssuedDocumentProps {
  doc: BizDocument;
  content: DocumentContent;
  revisions: Array<DocumentRevision>;
}

function IssuedDocument({ doc, content, revisions }: IssuedDocumentProps) {
  const history = revisionsSection(doc, revisions);
  const revise = DocumentsMutation.useRevise();
  const [cancelling, setCancelling] = useState(false);
  const cancelled = doc.status === "cancelled";
  const pdfActions = usePdfActions({
    type: doc.type,
    number: doc.number,
    revision: doc.revision,
    watermark: cancelled ? "CANCELLED" : undefined,
    content,
  });

  return (
    <>
      <PageHeader
        parent={parent}
        title={documentLabel(doc.number, doc.revision)}
        badges={<DocumentStatusBadge status={doc.status} revising={doc.status === "issued" && Boolean(doc.draft)} />}
        // An issued receipt is mostly viewed; revising is rare, so nothing
        // claims the always-visible slot and the title keeps the room on a phone.
        moreActions={
          cancelled
            ? pdfActions
            : [
                ...pdfActions,
                {
                  label: "Revise",
                  icon: PencilIcon,
                  disabled: revise.isPending,
                  onClick: () => revise.mutate(doc, { onError: (error) => toast.error(error.message) }),
                },
                {
                  label: `Cancel ${DOCUMENT_TYPES[doc.type].title.toLowerCase()}`,
                  icon: BanIcon,
                  destructive: true,
                  onClick: () => setCancelling(true),
                },
              ]
        }
      />
      <SectionLayout
        banner={
          cancelled && (
            <Banner
              tone="neutral"
              icon={BanIcon}
              title={`Cancelled${doc.cancelledAt ? ` ${formatDate(doc.cancelledAt)}` : ""}.`}
            >
              Number stays used.
            </Banner>
          )
        }
        sections={[
          {
            id: "document",
            title: DOCUMENT_TYPES[doc.type].title,
            description: cancelled && doc.cancelReason ? `Cancelled: ${doc.cancelReason}` : undefined,
            bare: true,
            content: (
              <DocumentView
                type={doc.type}
                content={content}
                number={doc.number}
                revision={doc.revision}
                cancelled={cancelled}
              />
            ),
          },
          ...(history ? [history] : []),
        ]}
      />
      <CancelDialog doc={doc} open={cancelling} onClose={() => setCancelling(false)} />
    </>
  );
}

/** Earlier issued versions, each still viewable as the PDF it was. */
function revisionsSection(doc: BizDocument, revisions: Array<DocumentRevision>): PageSection | undefined {
  if (revisions.length === 0) return undefined;
  return {
    id: "revisions",
    title: "Issued revisions",
    content: (
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
            <PdfButtons pdf={{ type: doc.type, number: rev.number, revision: rev.revision, content: rev.content }} />
          </li>
        ))}
      </ul>
    ),
  };
}

/** View opens the real PDF in a new tab; Download saves it with a proper name. */
function usePdfActions(pdf: DocumentPdfProps): Array<RowAction> {
  const [busy, setBusy] = useState(false);
  const run = (action: (props: DocumentPdfProps) => Promise<void>) => {
    setBusy(true);
    action(pdf)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't make the PDF"))
      .finally(() => setBusy(false));
  };
  return [
    { label: "View PDF", icon: EyeIcon, disabled: busy, onClick: () => run(openDocumentPdf) },
    { label: "Download", icon: DownloadIcon, disabled: busy, onClick: () => run(downloadDocumentPdf) },
  ];
}

function PdfButtons({ pdf }: { pdf: DocumentPdfProps }) {
  return <RowActionButtons actions={usePdfActions(pdf)} />;
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
