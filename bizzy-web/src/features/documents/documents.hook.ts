import { useCallback, useState } from "react";
import { toast } from "sonner";
import { DocumentPdfService } from "./document-pdf.service";
import { DocumentsService } from "./documents.service";
import type { DocumentFile } from "./documents.types";

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
