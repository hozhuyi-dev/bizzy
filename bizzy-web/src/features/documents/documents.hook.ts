import { useCallback, useState } from "react";
import { toast } from "sonner";
import { DocumentPdfService } from "./document-pdf.service";
import type { DocumentPdfProps } from "./documents.types";

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
