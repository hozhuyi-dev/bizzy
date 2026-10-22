import { useEffect, useMemo } from "react";
import { EyeIcon } from "lucide-react";
import { pdfBlob } from "../../documents.util";
import type { DocumentFile } from "../../documents.types";
import { Button } from "~/components/ui/button";

interface DocumentPdfViewProps {
  /** Undefined while it comes. */
  file: DocumentFile | undefined;
  error?: Error | null | undefined;
}

/**
 * The document's PDF, as the API printed it, in the page. A browser that
 * can't show a PDF inline (Chrome on Android) gets a button that opens it
 * in its viewer instead.
 */
export function DocumentPdfView({ file, error }: DocumentPdfViewProps) {
  const url = useMemo(() => (file ? URL.createObjectURL(pdfBlob(file)) : undefined), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const frame = "flex h-[75dvh] min-h-96 w-full items-center justify-center rounded-xl bg-muted/40 ring-1 ring-foreground/10";
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    );
  }
  if (!url || !file) return <div className={frame} aria-busy="true" />;
  if (!navigator.pdfViewerEnabled) {
    return (
      <div className={`${frame} h-auto min-h-0 flex-col gap-3 p-6 text-center text-sm text-muted-foreground`}>
        <p>This browser opens PDFs in its own viewer.</p>
        <Button variant="outline" onClick={() => window.open(url, "_blank")}>
          <EyeIcon /> Open {file.name}
        </Button>
      </div>
    );
  }
  return <iframe title={file.name} src={url} className={frame} />;
}
