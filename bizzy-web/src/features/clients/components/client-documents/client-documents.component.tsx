import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { MergeIcon } from "lucide-react";
import { toast } from "sonner";
import { ClientDocumentCard, createClientDocumentColumns } from "../../client-documents.columns";
import type { RowSelectionState } from "@tanstack/react-table";
import type { ClientView } from "../../clients.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import type { DocumentSummary, DocumentType } from "~/features/documents/documents.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import { DocumentsMutation } from "~/features/documents/documents.mutation";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLink } from "~/features/documents/documents.columns";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { QUIPS } from "~/core/constants/quips.constant";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { Button } from "~/components/ui/button";

const COLUMNS = createClientDocumentColumns();

/**
 * The client's documents section: every invoice and receipt, newest first,
 * drafts last, narrowed to one type by its chips. The user ticks invoices
 * to ask to pay for in one WhatsApp message (what drafts list, issued ones
 * as a whole with their links), issued ones to send for the client's
 * records, or drafts of one type to put on one document. A new client has
 * none.
 */
export function useClientDocumentsSection(client: ClientView | undefined): PageSection | undefined {
  const docs = DocumentsQuery.useByClient(client?.id ?? "");
  const [type, setType] = useState<DocumentType>();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const whatsappMenu = useWhatsAppMenu();
  const combine = DocumentsMutation.useCombine();

  const all = useMemo(() => docs.data ?? [], [docs.data]);
  const data = useMemo(() => (type ? all.filter((doc) => doc.type === type) : all), [all, type]);
  const table = useTable({
    features: dataTableFeatures,
    columns: COLUMNS,
    data,
    getRowId: (doc) => doc.id,
    // Ticked to ask to pay, send, or put together: what its `can` allows.
    enableRowSelection: (row) => row.original.can.askToPay.ok || row.original.can.send.ok || row.original.can.moveLines.ok,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });

  if (!client) return undefined;
  const chosen = data.filter((doc) => selection[doc.id]);
  const to = { name: client.name, phone: client.contact?.phone };
  const together = combinable(chosen);

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
    whatsappMenu({
      to,
      askToPay: { request: { ids: chosen.map((doc) => doc.id) }, can: allOf(chosen, (doc) => doc.can.askToPay) },
      sendRecords: { docs: chosen, can: allOf(chosen, (doc) => doc.can.send) },
    }),
  ];

  return {
    id: "documents",
    title: "Documents",
    description:
      chosen.length > 0
        ? `${chosen.length} ticked. Ask to pay for invoices, send issued ones, or put drafts of one kind on one document.`
        : "Tick invoices to ask to pay for, issued ones to send, or drafts to put on one document.",
    more: all.length > 0 ? actions : undefined,
    bare: true,
    content: docs.isPending ? (
      <LoadingState />
    ) : docs.error ? (
      <ErrorMessage>{docs.error.message}</ErrorMessage>
    ) : (
      <div className="flex flex-col gap-3">
        {all.length > 0 && (
          <TypeChips
            docs={all}
            type={type}
            onChange={(next) => {
              // What is ticked out of sight would be sent unseen.
              setSelection({});
              setType(next);
            }}
          />
        )}
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
      </div>
    ),
  };
}

/** What every ticked one's verdict allows: the first no, or no while none is ticked. */
function allOf(chosen: ReadonlyArray<DocumentSummary>, verdict: (doc: DocumentSummary) => Verdict): Verdict {
  if (chosen.length === 0) return { ok: false, why: "Tick the documents first." };
  return chosen.map(verdict).find((v) => !v.ok) ?? { ok: true };
}

const TYPES = Object.keys(DOCUMENT_TYPES) as Array<DocumentType>;

interface TypeChipsProps {
  docs: ReadonlyArray<DocumentSummary>;
  type: DocumentType | undefined;
  onChange: (type: DocumentType | undefined) => void;
}

/** All, or one type, each with its count; a type the client has none of isn't offered. */
function TypeChips({ docs, type, onChange }: TypeChipsProps) {
  const count = (t: DocumentType) => docs.filter((doc) => doc.type === t).length;
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
      <Button size="xs" variant={type ? "outline" : "default"} aria-pressed={!type} onClick={() => onChange(undefined)}>
        All {docs.length}
      </Button>
      {TYPES.filter((t) => count(t) > 0).map((t) => (
        <Button
          key={t}
          size="xs"
          variant={type === t ? "default" : "outline"}
          aria-pressed={type === t}
          onClick={() => onChange(type === t ? undefined : t)}
        >
          {DOCUMENT_TYPES[t].plural} {count(t)}
        </Button>
      ))}
    </div>
  );
}

/** The type ticked drafts can be put together as: two or more, each whose lines can move, of one type. */
function combinable(docs: ReadonlyArray<DocumentSummary>) {
  const [first] = docs;
  if (!first || docs.length < 2) return undefined;
  return docs.every((doc) => doc.can.moveLines.ok && doc.type === first.type) ? first.type : undefined;
}
