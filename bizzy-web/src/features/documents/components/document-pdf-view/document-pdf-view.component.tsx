import { useEffect, useMemo } from "react";
import { EyeIcon } from "lucide-react";
import { cn } from "cn";
import { pdfBlob } from "../../documents.util";
import type { DocumentFile } from "../../documents.types";
import { Button } from "~/components/ui/button";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

interface DocumentPdfViewProps {
  /** Undefined while it comes. */
  file: DocumentFile | undefined;
  error?: Error | null | undefined;
  /** Takes the height its column leaves (a flex column), not a set share of the screen. */
  fill?: boolean | undefined;
}

/**
 * The document's PDF, as the API printed it, in the page. A browser that
 * can't show a PDF inline (Chrome on Android) gets a button that opens it
 * in its viewer instead.
 */
export function DocumentPdfView({ file, error, fill = false }: DocumentPdfViewProps) {
  const url = useMemo(() => (file ? URL.createObjectURL(pdfBlob(file)) : undefined), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const frame = cn(
    "flex w-full items-center justify-center rounded-xl bg-muted/40 ring-1 ring-foreground/10",
    fill ? "min-h-0 flex-1" : "h-[75dvh] min-h-96",
  );
  if (error) {
    return (
      <ErrorMessage>{error.message}</ErrorMessage>
    );
  }
  if (!url || !file) return <div className={frame} aria-busy="true" />;
  if (!navigator.pdfViewerEnabled) {
    return (
      <div className={cn(frame, "h-auto min-h-0 flex-none flex-col gap-3 p-6 text-center text-sm text-muted-foreground")}>
        <p>This browser opens PDFs in its own viewer.</p>
        <Button variant="outline" onClick={() => window.open(url, "_blank")}>
          <EyeIcon /> Open {file.name}
        </Button>
      </div>
    );
  }
  return <iframe title={file.name} src={url} className={frame} />;
}
