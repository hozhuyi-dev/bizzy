import { useCallback, useState } from "react";
import { MergeIcon } from "lucide-react";
import { toast } from "sonner";
import { DocumentPdfService } from "./document-pdf.service";
import { DOCUMENT_TYPES } from "./documents.constant";
import { DocumentsMutation } from "./documents.mutation";
import { DocumentsService } from "./documents.service";
import type { DocumentFile, DocumentSummary, DocumentType } from "./documents.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/** A PDF to open or save: an issued revision's (undefined: the latest), or one already here (a share link's). */
export type PdfSource = { id: string; revision?: number | undefined } | { file: DocumentFile };

function load(source: PdfSource): () => Promise<DocumentFile> {
  return "file" in source ? () => Promise.resolve(source.file) : () => DocumentsService.pdf(source.id, source.revision);
}

/** Opens or downloads a document's PDF; busy while it comes, and a toast if it can't. */
export function useDocumentPdf({ errorMessage }: { errorMessage?: string } = {}) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    (action: (load: () => Promise<DocumentFile>) => Promise<void>, source: PdfSource) => {
      setBusy(true);
      action(load(source))
        .catch((error: unknown) =>
          toast.error(errorMessage ?? (error instanceof Error ? error.message : "Couldn't get the PDF")),
        )
        .finally(() => setBusy(false));
    },
    [errorMessage],
  );

  return {
    busy,
    /** Call straight from a click, so the new tab isn't blocked as a popup. */
    open: useCallback((source: PdfSource) => run(DocumentPdfService.open, source), [run]),
    download: useCallback((source: PdfSource) => run(DocumentPdfService.download, source), [run]),
  };
}

/** Who the ticked documents are for: one client, as every action on them is one chat or one document. */
export interface DocumentsFor {
  name: string;
  phone?: string | undefined;
}

/**
 * What can be done with a client's documents ticked together: put drafts
 * of one type on one document, and WhatsApp them (ask to pay for invoices,
 * send issued ones for their records), each as the ticked ones' `can`
 * says. For any list of one client's documents; `onDone` clears the ticks.
 */
export function useDocumentBulkActions(chosen: ReadonlyArray<DocumentSummary>, to: DocumentsFor, onDone: () => void): Array<Action> {
  const whatsappMenu = useWhatsAppMenu();
  const combine = DocumentsMutation.useCombine();
  const together = combinable(chosen);
  return [
    {
      type: "button",
      label: together ? `Put on one ${DOCUMENT_TYPES[together].title.toLowerCase()}` : "Put together",
      icon: MergeIcon,
      can: together ? { ok: true } : uncombinable(chosen),
      disabled: combine.isPending,
      onClick: () =>
        combine.mutate(
          chosen.map((doc) => doc.id),
          {
            onSuccess: () => {
              toast.success(`Put ${chosen.length} on one ${together ? DOCUMENT_TYPES[together].title.toLowerCase() : "document"}`);
              onDone();
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
}

/** Why the ticked can't be put together: none ticked, one that can't move its lines, else not two of one type. */
function uncombinable(chosen: ReadonlyArray<DocumentSummary>): Verdict {
  const moving = allOf(chosen, (doc) => doc.can.moveLines);
  return moving.ok ? { ok: false, why: "Tick two or more drafts of one type to put them on one document." } : moving;
}

/** Whether a document can be ticked: something can be done with it (ask to pay, send, put together). */
export function canTick(doc: DocumentSummary): boolean {
  return doc.can.askToPay.ok || doc.can.send.ok || doc.can.moveLines.ok;
}

/** What every ticked one's verdict allows: the first no, or no while none is ticked. */
function allOf(chosen: ReadonlyArray<DocumentSummary>, verdict: (doc: DocumentSummary) => Verdict): Verdict {
  if (chosen.length === 0) return { ok: false, why: "Tick the documents first." };
  return chosen.map(verdict).find((v) => !v.ok) ?? { ok: true };
}

/** The type ticked drafts can be put together as: two or more, each whose lines can move, of one type. */
function combinable(docs: ReadonlyArray<DocumentSummary>): DocumentType | undefined {
  const [first] = docs;
  if (!first || docs.length < 2) return undefined;
  return docs.every((doc) => doc.can.moveLines.ok && doc.type === first.type) ? first.type : undefined;
}
