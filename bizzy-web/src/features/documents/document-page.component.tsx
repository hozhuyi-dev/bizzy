import { useState } from "react";
import {
  BanIcon,
  DownloadIcon,
  EyeIcon,
  FileCheckIcon,
  LinkIcon,
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
import { DocumentPdfView } from "./components/document-pdf-view/document-pdf-view.component";
import { DocumentStatusBadge, documentLink } from "./documents.columns";
import { DocumentsMutation } from "./documents.mutation";
import { DocumentsQuery } from "./documents.query";
import { documentLabel, documentPlace, documentsUrl, shareUrl } from "./documents.util";
import { DOCUMENT_LISTS } from "./documents.list";
import { DOCUMENT_TYPES } from "./documents.constant";
import { useDocumentPdf } from "./documents.hook";
import type { PdfSource } from "./documents.hook";
import type { ReactNode } from "react";
import type { DocumentContent, DocumentRevision, DocumentType, DocumentView, Recipient } from "./documents.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { ListFilter } from "~/core/list/filter.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { Timeline, TimelineItem, TimelineNow } from "~/components/shared/list/timeline/timeline.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";
import { ClientsQuery } from "~/features/clients/clients.query";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { clientOf } from "~/features/clients/clients.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

/** The breadcrumb, which already says what kind of document this is: its list, with the filter it was left at. */
function parentOf(type: DocumentType, filter: ListFilter) {
  const spec = DOCUMENT_TYPES[type];
  return { to: spec.path, label: spec.plural, search: documentsUrl.toSearch(filter) } as const;
}

interface DocumentPageProps {
  id: string;
  type: DocumentType;
  /** The list it steps through. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

export function DocumentPage({ id, type, filter, onFilterChange }: DocumentPageProps) {
  const detail = DocumentsQuery.useDetail(id);
  const parent = parentOf(type, filter);
  const header = {
    parent,
    pager: (
      <ListPager
        list={DOCUMENT_LISTS[type]}
        filter={filter}
        current={{ id, place: detail.data && documentPlace(detail.data) }}
        itemLink={(next) => documentLink({ id: next, type }, documentsUrl.toSearch(filter))}
        panel={{
          onApply: onFilterChange,
          listLink: (next) => ({ to: DOCUMENT_TYPES[type].path, search: documentsUrl.toSearch(next) }),
        }}
      />
    ),
  };

  return queryMatch(detail, {
    pending: () => (
      <>
        <PageHeader {...header} title="…" />
        <LoadingState />
      </>
    ),
    error: (error) => (
      <>
        <PageHeader {...header} title="Not available" />
        <ErrorMessage>{error.message}</ErrorMessage>
      </>
    ),
    success: (doc) => {
      if (doc.draft) {
        // Remount on every save so the form restarts from what was stored.
        return <DraftDocument key={detail.dataUpdatedAt} doc={doc} draft={doc.draft} revisions={doc.revisions} header={header} />;
      }
      return doc.content ? <IssuedDocument doc={doc} content={doc.content} revisions={doc.revisions} header={header} /> : null;
    },
  });
}

/** The header's way back and pager, the same while the document loads. */
interface DocumentHeader {
  parent: ReturnType<typeof parentOf>;
  pager: ReactNode;
}

interface DraftDocumentProps {
  doc: DocumentView;
  draft: DocumentContent;
  revisions: Array<DocumentRevision>;
  header: DocumentHeader;
}

function DraftDocument({ doc, draft, revisions, header }: DraftDocumentProps) {
  const editor = useDocumentEditor(doc, draft);
  const editorActions = documentEditorActions(editor);
  const whatsapp = useDocumentWhatsApp(doc, draft.recipient);
  const history = historySection(doc, revisions);

  return (
    <>
      <PageHeader
        {...header}
        title={documentLabel(doc.number, doc.revision)}
        badges={<DocumentStatusBadge status={doc.status} revising={doc.status === "issued" && Boolean(doc.draft)} />}
        actions={[documentIssueAction(editor)]}
        moreActions={[whatsapp, ...editorActions.more]}
        menuActions={editorActions.menu}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void editor.save();
        }}
      >
        <PageSections sections={[...documentEditorSections(editor), ...(history ? [history] : [])]} />
      </form>
      <UnsavedChangesDialog when={editor.hasChanges} />
    </>
  );
}

interface IssuedDocumentProps {
  doc: DocumentView;
  content: DocumentContent;
  revisions: Array<DocumentRevision>;
  header: DocumentHeader;
}

function IssuedDocument({ doc, content, revisions, header }: IssuedDocumentProps) {
  const history = historySection(doc, revisions, doc.revision);
  const revise = DocumentsMutation.useRevise();
  const [cancelling, setCancelling] = useState(false);
  const cancelled = doc.status === "cancelled";
  const pdf = DocumentsQuery.usePdf(doc.id, doc.revision, doc.status);
  const [viewPdf, downloadPdf] = usePdfActions(pdf.data ? { file: pdf.data } : { id: doc.id });
  const [resettingLink, setResettingLink] = useState(false);
  const whatsapp = useDocumentWhatsApp(doc, content.recipient);
  const links = useLinkActions(doc, () => setResettingLink(true));

  return (
    <>
      <PageHeader
        {...header}
        title={documentLabel(doc.number, doc.revision)}
        badges={<DocumentStatusBadge status={doc.status} revising={doc.status === "issued" && Boolean(doc.draft)} />}
        // An issued receipt is mostly sent and viewed; revising is rare, so
        // nothing claims the always-visible slot and the title keeps the room
        // on a phone, and the rest waits behind ⋯ on a wide screen too.
        moreActions={[whatsapp, viewPdf]}
        menuActions={[
          downloadPdf,
          ...links,
          {
            type: "button",
            label: "Revise",
            icon: PencilIcon,
            disabled: revise.isPending,
            can: doc.can.revise,
            onClick: () => revise.mutate(doc.id, { onError: toastRefusal }),
          },
          {
            type: "button",
            label: `Cancel ${DOCUMENT_TYPES[doc.type].title.toLowerCase()}`,
            icon: BanIcon,
            style: "destructive",
            can: doc.can.cancel,
            onClick: () => setCancelling(true),
          },
        ]}
        banners={
          cancelled && (
            <Banner
              tone="neutral"
              icon={BanIcon}
              title={`Cancelled${doc.cancelledAt ? ` ${formatDate(doc.cancelledAt)}` : ""}.`}
            >
              {doc.cancelReason ? `${doc.cancelReason}. ` : ""}Number stays used.
            </Banner>
          )
        }
      />
      <PageSections
        sections={[
          {
            id: "document",
            title: DOCUMENT_TYPES[doc.type].title,
            bare: true,
            content: <DocumentPdfView file={pdf.data} error={pdf.error} />,
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
 * The document's WhatsApp menu: asking to pay for an invoice (what is owed
 * on it), sending an issued one for the client's records, or the chat.
 */
function useDocumentWhatsApp(doc: DocumentView, recipient: Recipient): Action {
  const clientsById = ClientsQuery.useById();
  const whatsappMenu = useWhatsAppMenu();
  const client = clientOf(clientsById, doc.clientId);
  return whatsappMenu({
    to: { name: client?.name ?? recipient.name, phone: client?.contact?.phone ?? recipient.phone },
    askToPay: doc.type === "invoice" ? { request: { ids: [doc.id] }, can: doc.can.askToPay } : undefined,
    sendRecords: { docs: [doc], can: doc.can.send },
    openChat: true,
  });
}

/**
 * The document's link, to send some other way: Copy link, and Reset link
 * for one sent to the wrong person. A cancelled document's link still
 * opens (marked cancelled), so it can be reset.
 */
function useLinkActions(doc: DocumentView, onReset: () => void): Array<Action> {
  const token = doc.shareToken;
  if (!token) return [];
  return [
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
  ];
}

function ResetLinkDialog({ doc, open, onClose }: { doc: DocumentView; open: boolean; onClose: () => void }) {
  const reset = DocumentsMutation.useResetShare();

  return (
    <SheetAlertDialog open={open} onClose={onClose}>
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
              onError: toastRefusal,
            })
          }
        >
          Reset link
        </Button>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}

/**
 * What happened to it, newest first: the next revision being edited (above
 * Now), its cancelling, each revision issued (viewable as the PDF kept when
 * it was issued) and its drafting. Once something was issued only: before
 * that there is no story. `shown` is the revision the page already offers
 * the PDF of in its header, so its row doesn't offer it again.
 */
function historySection(doc: DocumentView, revisions: Array<DocumentRevision>, shown?: number): PageSection | undefined {
  if (revisions.length === 0) return undefined;
  return {
    id: "history",
    title: "History",
    content: (
      <Timeline label={`${documentLabel(doc.number, doc.revision)}'s history`}>
        {doc.draft && (
          <>
            <TimelineItem
              icon={PencilIcon}
              tone="waiting"
              upcoming
              when="Being edited"
              title="Next revision"
              meta={formatCents(doc.draft.totalCents)}
            />
            <TimelineNow />
          </>
        )}
        {doc.cancelledAt && (
          <TimelineItem icon={BanIcon} when={formatDate(doc.cancelledAt)} title="Cancelled" meta={doc.cancelReason} />
        )}
        {[...revisions].reverse().map((rev) => (
          <RevisionItem key={rev.revision} doc={doc} rev={rev} withPdf={rev.revision !== shown} />
        ))}
        <TimelineItem when={formatDate(doc.createdAt)} title="Drafted" />
      </Timeline>
    ),
  };
}

function RevisionItem({ doc, rev, withPdf }: { doc: DocumentView; rev: DocumentRevision; withPdf: boolean }) {
  const actions = usePdfActions({ id: doc.id, revision: rev.revision }).map((action) => ({ ...action, style: "quiet" as const }));
  return (
    <TimelineItem
      icon={FileCheckIcon}
      tone="done"
      when={formatDate(rev.issuedAt)}
      title={`${documentLabel(rev.number, rev.revision)} issued`}
      meta={formatCents(rev.content.totalCents)}
      actions={withPdf ? actions : undefined}
    />
  );
}

/** View opens the PDF in a new tab; Download saves it with a proper name. */
function usePdfActions(source: PdfSource): [view: Action, download: Action] {
  const { busy, open, download } = useDocumentPdf();
  return [
    { type: "button", label: "View PDF", icon: EyeIcon, disabled: busy, onClick: () => open(source) },
    { type: "button", label: "Download", icon: DownloadIcon, disabled: busy, onClick: () => download(source) },
  ];
}

function CancelDialog({ doc, open, onClose }: { doc: DocumentView; open: boolean; onClose: () => void }) {
  const cancel = DocumentsMutation.useCancel();
  const [reason, setReason] = useState("");
  const title = DOCUMENT_TYPES[doc.type].title.toLowerCase();

  return (
    <SheetAlertDialog open={open} onClose={onClose}>
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
                onError: toastRefusal,
              },
            )
          }
        >
          Cancel {title}
        </Button>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}
