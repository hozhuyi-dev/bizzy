import { useEffect, useState } from "react";
import { BanIcon, DownloadIcon, FileXIcon, RotateCwIcon } from "lucide-react";
import { DocumentPdfView } from "./components/document-pdf-view/document-pdf-view.component";
import { DocumentsQuery } from "./documents.query";
import { DOCUMENT_TYPES } from "./documents.constant";
import { documentLabel } from "./documents.util";
import { useDocumentPdf } from "./documents.hook";
import type { SharedDocumentView } from "./documents.types";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { Button } from "~/components/ui/button";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { isApiError } from "~/core/utils/api-error.util";
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

  // As wide as the app; the page scrolls, its header stays.
  return (
    <main className="mx-auto flex min-h-dvh max-w-(--content-width) flex-col gap-3 px-(--page-gutter) pb-(--page-bottom) sm:gap-4">
      {queryMatch(shared, {
        pending: () => <SharedDocumentLoading />,
        error: (error) => <SharedDocumentError error={error} retry={() => shared.refetch()} />,
        success: (doc) => <SharedDocument doc={doc} />,
      })}
    </main>
  );
}

function SharedDocument({ doc }: { doc: SharedDocumentView }) {
  const { busy, download: downloadPdf } = useDocumentPdf({ errorMessage: "Couldn't save the PDF. Please try again." });
  const cancelled = doc.status === "cancelled";
  const title = DOCUMENT_TYPES[doc.type].title;
  const { issuer, date, totalCents } = doc.content;

  useEffect(() => {
    document.title = `${title} ${documentLabel(doc.number, doc.revision)} · ${issuer.name}`;
  }, [title, doc, issuer.name]);

  return (
    <>
      {/* Who sent it and for how much, before the PDF: a link from a chat says neither. */}
      <header className="sticky top-0 z-(--z-header) -mx-(--page-gutter) flex items-center justify-between gap-3 border-b bg-background px-(--page-gutter) py-3">
        <div className="min-w-0">
          <h1 className="truncate type-page-title">
            {title} {documentLabel(doc.number, doc.revision)}
          </h1>
          {/* Wraps between its parts on a phone, so the total is never cut off. */}
          <p className="text-sm text-muted-foreground [&>span]:whitespace-nowrap">
            From {issuer.name} · <span>{formatDate(date)}</span> · <span>{formatCents(totalCents)}</span>
          </p>
        </div>
        <Button onClick={() => downloadPdf({ file: doc.pdf })} disabled={busy}>
          <DownloadIcon /> {busy ? "Saving…" : "Download"}
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

/** The header and a sheet, quietly, in the shape of what comes. */
function SharedDocumentLoading() {
  return (
    <div aria-busy="true" className="flex appear-after-wait flex-col gap-3 motion-safe:animate-pulse sm:gap-4">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2 py-3">
        <div className="h-5 w-48 rounded bg-muted" />
        <div className="h-4 w-64 max-w-full rounded bg-muted" />
      </div>
      <div className="rounded-xl bg-muted/40 p-2 ring-1 ring-foreground/10 sm:p-6">
        <div className="mx-auto aspect-210/297 w-full max-w-3xl rounded-sm bg-muted" />
      </div>
    </div>
  );
}

/**
 * A link that opens nothing (reset, or mistyped) says so as the API words
 * it, to ask the sender for a new one; anything else can be tried again.
 */
function SharedDocumentError({ error, retry }: { error: Error; retry: () => Promise<unknown> }) {
  const [trying, setTrying] = useState(false);
  const gone = isApiError(error, "not_found");
  return (
    <div role="alert" className="m-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
      <FileXIcon className="size-10 text-muted-foreground" aria-hidden />
      <p className="type-section-title">{gone ? error.message : "This document didn't load."}</p>
      {!gone && (
        <>
          <p className="text-sm text-muted-foreground">Check your connection, then try again.</p>
          <Button
            variant="outline"
            disabled={trying}
            onClick={() => {
              setTrying(true);
              void retry().finally(() => setTrying(false));
            }}
          >
            <RotateCwIcon className={trying ? "motion-safe:animate-spin" : undefined} />
            {trying ? "Trying…" : "Try again"}
          </Button>
        </>
      )}
    </div>
  );
}
