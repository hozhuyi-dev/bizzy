import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { DocumentPdfService } from "./document-pdf.service";
import { DocumentsMutation } from "./documents.mutation";
import { documentRoute } from "./documents.util";
import type { DocumentPdfProps, DocumentSource, DocumentType } from "./documents.types";

/** Starts a draft invoice or receipt for sessions and packages and opens it to edit. */
export function useCreateDocument() {
  const navigate = useNavigate();
  const { mutate, isPending } = DocumentsMutation.useCreateDraft();

  const create = useCallback(
    (type: DocumentType, sources: Array<DocumentSource>) =>
      mutate(
        { type, sources },
        {
          onSuccess: (doc) => {
            if (doc) void navigate({ to: documentRoute(type), params: { id: doc.id } });
          },
          onError: (error) => toast.error(error.message),
        },
      ),
    [mutate, navigate],
  );

  return { create, isPending };
}

/**
 * Opens or downloads a document's PDF, made in the browser; busy while it is
 * made, and a toast if it can't be.
 */
export function useDocumentPdf({ errorMessage }: { errorMessage?: string } = {}) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    (action: (props: DocumentPdfProps) => Promise<void>, props: DocumentPdfProps) => {
      setBusy(true);
      action(props)
        .catch((error: unknown) =>
          toast.error(errorMessage ?? (error instanceof Error ? error.message : "Couldn't make the PDF")),
        )
        .finally(() => setBusy(false));
    },
    [errorMessage],
  );

  return {
    busy,
    /** Call straight from a click, so the new tab isn't blocked as a popup. */
    open: useCallback((props: DocumentPdfProps) => run(DocumentPdfService.open, props), [run]),
    download: useCallback((props: DocumentPdfProps) => run(DocumentPdfService.download, props), [run]),
  };
}
