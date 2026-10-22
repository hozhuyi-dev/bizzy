import { useEffect } from "react";
import { BanIcon, DownloadIcon } from "lucide-react";
import { DocumentPdfView } from "./components/document-pdf-view/document-pdf-view.component";
import { DocumentsQuery } from "./documents.query";
import { DOCUMENT_TYPES } from "./documents.constant";
import { documentLabel } from "./documents.util";
import { useDocumentPdf } from "./documents.hook";
import type { SharedDocumentView } from "./documents.types";
import { Banner } from "~/components/shared/banner/banner.component";
import { Button } from "~/components/ui/button";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";

/**
 * A document as her client sees it from a share link: its PDF as issued, to
 * read and keep. Clients see this page, so it has none of the app around it
 * and no playful copy.
 */
export function SharedDocumentPage({ token }: { token: string }) {
  const shared = DocumentsQuery.useShared(token);

  // Personal details: keep the page out of search results.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.append(meta);
    return () => meta.remove();
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 py-6">
      {queryMatch(shared, {
        pending: () => <p className="text-sm text-muted-foreground">Loading…</p>,
        error: (error) => (
          <p role="alert" className="text-sm">
            {error.message}
          </p>
        ),
        success: (doc) => <SharedDocument doc={doc} />,
      })}
    </main>
  );
}

function SharedDocument({ doc }: { doc: SharedDocumentView }) {
  const { busy, download: downloadPdf } = useDocumentPdf({ errorMessage: "Couldn't save the PDF. Please try again." });
  const cancelled = doc.status === "cancelled";
  const title = DOCUMENT_TYPES[doc.type].title;

  useEffect(() => {
    document.title = `${title} ${documentLabel(doc.number, doc.revision)} · ${doc.content.issuer.name}`;
  }, [title, doc]);

  const download = () => downloadPdf({ file: doc.pdf });

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="truncate text-lg font-semibold">
          {title} {documentLabel(doc.number, doc.revision)}
        </h1>
        <Button onClick={download} disabled={busy}>
          <DownloadIcon /> {busy ? "Preparing…" : "Download PDF"}
        </Button>
      </header>
      {cancelled && (
        <Banner
          tone="neutral"
          icon={BanIcon}
          title={`This ${title.toLowerCase()} was cancelled${doc.cancelledAt ? ` on ${formatDate(doc.cancelledAt)}` : ""}.`}
        />
      )}
      <DocumentPdfView file={doc.pdf} />
    </>
  );
}
