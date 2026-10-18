import { useState } from "react";
import {
  BanIcon,
  CircleAlertIcon,
  DownloadIcon,
  EyeIcon,
  LinkIcon,
  MessageCircleIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  documentEditorActions,
  documentEditorSections,
  documentIssueAction,
} from "./components/document-editor/document-editor.component";
import { useDocumentEditor } from "./components/document-editor/document-editor.hook";
import { DocumentSheet } from "./components/document-sheet/document-sheet.component";
import { DocumentStatusBadge } from "./documents.columns";
import { DocumentsMutation } from "./documents.mutation";
import { DocumentsQuery } from "./documents.query";
import { documentLabel, shareUrl  } from "./documents.util";
import { DOCUMENT_TYPES } from "./documents.constant";
import { useDocumentPdf } from "./documents.hook";
import type { DocumentContent, DocumentPdfProps, DocumentRevision, DocumentType, DocumentView } from "./documents.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
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
import { ClientsQuery } from "~/features/clients/clients.query";
import { useSendDocuments } from "~/features/whatsapp/whatsapp.hook";
import { clientOf } from "~/features/clients/clients.util";

/** The breadcrumb, which already says what kind of document this is. */
function parentOf(type: DocumentType) {
  const spec = DOCUMENT_TYPES[type];
  return { to: spec.path, label: spec.plural } as const;
}

export function DocumentPage({ id, type }: { id: string; type: DocumentType }) {
  const detail = DocumentsQuery.useDetail(id);
  const parent = parentOf(type);

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
    success: (doc) => {
      if (doc.draft) {
        // Remount on every save so the form restarts from what was stored.
        return <DraftDocument key={detail.dataUpdatedAt} doc={doc} draft={doc.draft} revisions={doc.revisions} />;
      }
      return doc.content ? <IssuedDocument doc={doc} content={doc.content} revisions={doc.revisions} /> : null;
    },
  });
}

interface DraftDocumentProps {
  doc: DocumentView;
  draft: DocumentContent;
  revisions: Array<DocumentRevision>;
}

function DraftDocument({ doc, draft, revisions }: DraftDocumentProps) {
  const editor = useDocumentEditor(doc, draft);
  const parent = parentOf(doc.type);
  const history = revisionsSection(doc, revisions);

  return (
    <>
      <PageHeader
        parent={parent}
        title={documentLabel(doc.number, doc.revision)}
        badges={<DocumentStatusBadge status={doc.status} revising={doc.status === "issued" && Boolean(doc.draft)} />}
        actions={[documentIssueAction(editor)]}
        moreActions={documentEditorActions(editor)}
        banners={
          editor.invalid && <Banner tone="attention" icon={CircleAlertIcon} title={editor.invalid} role="alert" />
        }
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void editor.save();
        }}
      >
        <SectionLayout sections={[...documentEditorSections(editor), ...(history ? [history] : [])]} />
      </form>
    </>
  );
}

interface IssuedDocumentProps {
  doc: DocumentView;
  content: DocumentContent;
  revisions: Array<DocumentRevision>;
}

function IssuedDocument({ doc, content, revisions }: IssuedDocumentProps) {
  const history = revisionsSection(doc, revisions);
  const parent = parentOf(doc.type);
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
  const [resettingLink, setResettingLink] = useState(false);
  const shareActions = useShareActions(doc, content, () => setResettingLink(true));

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
            ? [...pdfActions, ...shareActions]
            : [
                ...shareActions,
                ...pdfActions,
                {
                  type: "button",
                  label: "Revise",
                  icon: PencilIcon,
                  disabled: revise.isPending,
                  onClick: () => revise.mutate(doc.id, { onError: (error) => toast.error(error.message) }),
                },
                {
                  type: "button",
                  label: `Cancel ${DOCUMENT_TYPES[doc.type].title.toLowerCase()}`,
                  icon: BanIcon,
                  style: "destructive",
                  onClick: () => setCancelling(true),
                },
              ]
        }
        banners={
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
      />
      <SectionLayout
        sections={[
          {
            id: "document",
            title: DOCUMENT_TYPES[doc.type].title,
            description: cancelled && doc.cancelReason ? `Cancelled: ${doc.cancelReason}` : undefined,
            bare: true,
            content: (
              <DocumentSheet
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
      <ResetLinkDialog doc={doc} open={resettingLink} onClose={() => setResettingLink(false)} />
    </>
  );
}

/**
 * Sending the document's link: WhatsApp (the app on her phone, WhatsApp Web
 * on her computer), Copy link, and Reset link for one sent to the wrong person. A cancelled document's
 * link still opens (marked cancelled), so it can be reset but not sent.
 */
function useShareActions(doc: DocumentView, content: DocumentContent, onReset: () => void): Array<Action> {
  const clientsById = ClientsQuery.useById();
  const { send, busy } = useSendDocuments();
  const client = clientOf(clientsById, doc.clientId);
  const to = { name: client?.name ?? content.recipient.name, phone: client?.contact?.phone ?? content.recipient.phone };
  const token = doc.shareToken;

  const actions: Array<Action> = [];
  if (doc.status === "issued") {
    actions.push({ type: "button", label: "WhatsApp", icon: MessageCircleIcon, disabled: busy, onClick: () => send(to, [doc]) });
  }
  if (token) {
    actions.push(
      {
        type: "button",
        label: "Copy link",
        icon: LinkIcon,
        onClick: () =>
          void navigator.clipboard
            .writeText(shareUrl(token))
            .then(() => toast.success("Link copied"))
            .catch(() => toast.error("Couldn't copy the link")),
      },
      { type: "button", label: "Reset link", icon: RefreshCwIcon, onClick: onReset },
    );
  }
  return actions;
}

function ResetLinkDialog({ doc, open, onClose }: { doc: DocumentView; open: boolean; onClose: () => void }) {
  const reset = DocumentsMutation.useResetShare();

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset the link to {documentLabel(doc.number, doc.revision)}?</AlertDialogTitle>
          <AlertDialogDescription>
            Links already sent stop working, for example one sent to the wrong person. Send the new link to
            whoever should still have it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={reset.isPending}
            onClick={() =>
              reset.mutate(doc.id, {
                onSuccess: () => {
                  toast.success("New link made; the old one no longer works");
                  onClose();
                },
                onError: (error) => toast.error(error.message),
              })
            }
          >
            Reset link
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Earlier issued versions, each still viewable as the PDF it was. */
function revisionsSection(doc: DocumentView, revisions: Array<DocumentRevision>): PageSection | undefined {
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
function usePdfActions(pdf: DocumentPdfProps): Array<Action> {
  const { busy, open, download } = useDocumentPdf();
  return [
    { type: "button", label: "View PDF", icon: EyeIcon, disabled: busy, onClick: () => open(pdf) },
    { type: "button", label: "Download", icon: DownloadIcon, disabled: busy, onClick: () => download(pdf) },
  ];
}

function PdfButtons({ pdf }: { pdf: DocumentPdfProps }) {
  return <RowActionButtons actions={usePdfActions(pdf)} />;
}

function CancelDialog({ doc, open, onClose }: { doc: DocumentView; open: boolean; onClose: () => void }) {
  const cancel = DocumentsMutation.useCancel();
  const [reason, setReason] = useState("");
  const title = DOCUMENT_TYPES[doc.type].title.toLowerCase();

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel {documentLabel(doc.number, doc.revision)}?</AlertDialogTitle>
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
                { id: doc.id, reason },
                {
                  onSuccess: () => {
                    toast.success(`${documentLabel(doc.number, doc.revision)} cancelled`);
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
