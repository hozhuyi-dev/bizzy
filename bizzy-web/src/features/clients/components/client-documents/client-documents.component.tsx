import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { CopyIcon, MergeIcon, MessageCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { ClientDocumentCard, createClientDocumentColumns } from "../../client-documents.columns";
import type { RowSelectionState } from "@tanstack/react-table";
import type { ClientView } from "../../clients.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import type { DocumentSummary } from "~/features/documents/documents.types";
import { DocumentsMutation } from "~/features/documents/documents.mutation";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLink } from "~/features/documents/documents.columns";
import { useSendDocuments } from "~/features/whatsapp/whatsapp.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { QUIPS } from "~/core/constants/quips.constant";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

const COLUMNS = createClientDocumentColumns();

/**
 * The client's documents section: every invoice and receipt, newest first,
 * drafts last. She ticks issued ones to send in one WhatsApp message (or
 * copy it), or drafts of one type to put on one document; the section's
 * actions do either. A new client has none.
 */
export function useClientDocumentsSection(client: ClientView | undefined): PageSection | undefined {
  const docs = DocumentsQuery.useByClient(client?.id ?? "");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const { send, copy, busy } = useSendDocuments();
  const combine = DocumentsMutation.useCombine();

  const data = useMemo(() => docs.data ?? [], [docs.data]);
  const table = useTable({
    features: dataTableFeatures,
    columns: COLUMNS,
    data,
    getRowId: (doc) => doc.id,
    // Ticked to send, or to put together: what its `can` allows.
    enableRowSelection: (row) => row.original.can.send.ok || row.original.can.moveLines.ok,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });

  if (!client) return undefined;
  const chosen = data.filter((doc) => selection[doc.id]);
  const to = { name: client.name, phone: client.contact?.phone };
  const together = combinable(chosen);
  const sendable = chosen.length > 0 && chosen.every((doc) => doc.can.send.ok);

  const actions: Array<Action> = [
    {
      type: "button",
      label: together ? `Put on one ${DOCUMENT_TYPES[together].title.toLowerCase()}` : "Put together",
      icon: MergeIcon,
      disabled: !together || combine.isPending,
      onClick: () =>
        combine.mutate(
          chosen.map((doc) => doc.id),
          {
            onSuccess: () => {
              toast.success(`Put ${chosen.length} on one ${together ? DOCUMENT_TYPES[together].title.toLowerCase() : "document"}`);
              setSelection({});
            },
            onError: toastRefusal,
          },
        ),
    },
    {
      type: "button",
      label: "Copy message",
      icon: CopyIcon,
      disabled: !sendable || busy,
      onClick: () => copy(to, chosen),
    },
    {
      type: "button",
      label: "Send on WhatsApp",
      icon: MessageCircleIcon,
      disabled: !sendable || busy,
      onClick: () => send(to, chosen),
    },
  ];

  return {
    id: "documents",
    title: "Documents",
    description:
      chosen.length > 0
        ? `${chosen.length} ticked. Send issued ones; put drafts of one kind on one document.`
        : "Tick issued ones to send, or drafts to put on one document.",
    more: data.length > 0 ? actions : undefined,
    bare: true,
    content: docs.isPending ? (
      <LoadingState />
    ) : docs.error ? (
      <ErrorMessage>{docs.error.message}</ErrorMessage>
    ) : (
      <DataTable
        table={table}
        rowLink={(doc) => documentLink(doc)}
        empty={<EmptyState quips={QUIPS.timeline}>No invoices or receipts yet. They're drafted with each session.</EmptyState>}
        renderCard={(row) => (
          <ClientDocumentCard
            doc={row.original}
            selectable={row.getCanSelect()}
            selected={row.getIsSelected()}
            onSelectedChange={(on) => row.toggleSelected(on)}
          />
        )}
      />
    ),
  };
}

/** The type ticked drafts can be put together as: two or more, each whose lines can move, of one type. */
function combinable(docs: ReadonlyArray<DocumentSummary>) {
  const [first] = docs;
  if (!first || docs.length < 2) return undefined;
  return docs.every((doc) => doc.can.moveLines.ok && doc.type === first.type) ? first.type : undefined;
}
