import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { pdfBytes } from "../../documents.util";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type * as PdfRenderModule from "~/core/pdf/pdf-render";
import type { DocumentFile } from "../../documents.types";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";

type PdfRender = typeof PdfRenderModule;

/** A4, the shape a page waits in before its PDF says its own. */
const A4: CSSProperties = { aspectRatio: "210 / 297" };

/**
 * The most pixels a page is drawn across: a phone's room to pinch-zoom,
 * within the canvas area iOS allows (16.7M pixels).
 */
const MAX_PIXELS = 2560;

interface DocumentPdfViewProps {
  /** Undefined while it comes. */
  file: DocumentFile | undefined;
  error?: Error | null | undefined;
  /** Reads it again after an error. */
  retry?: (() => unknown) | undefined;
}

/**
 * The document's PDF, as the API printed it, drawn in the page as sheets
 * of paper (pdf.js, loaded only here), the same in every browser: none of
 * a browser viewer's own buttons beside the page's, and shown on phones
 * whose browser has no viewer. Its text can be selected and copied.
 */
export function DocumentPdfView({ file, error, retry }: DocumentPdfViewProps) {
  if (!file) {
    return (
      <Frame className="h-[75dvh] min-h-96 items-center justify-center">
        {error ? <ErrorState error={error} retry={retry} /> : <LoadingState />}
      </Frame>
    );
  }
  // Another PDF starts afresh, rather than showing the last one's pages.
  return (
    <Frame>
      <PdfPages key={file.data} data={file.data} />
    </Frame>
  );
}

function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex w-full rounded-xl bg-muted/40 p-2 ring-1 ring-foreground/10 sm:p-6", className)}>
      {children}
    </div>
  );
}

type Pdf = { state: "loading" } | { state: "failed" } | { state: "ready"; lib: PdfRender; pages: Array<PDFPageProxy> };

/** `data` is the PDF, base64: the same PDF read again keeps its pages. */
function PdfPages({ data }: { data: string }) {
  const [pdf, setPdf] = useState<Pdf>({ state: "loading" });
  const fail = useCallback(() => setPdf({ state: "failed" }), []);
  useEffect(() => {
    let close: (() => void) | undefined;
    let gone = false;
    import("~/core/pdf/pdf-render")
      .then(async (lib) => {
        const opened = await lib.openPdf(pdfBytes(data));
        if (gone) return opened.close();
        close = opened.close;
        setPdf({ state: "ready", lib, pages: opened.pages });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!gone) fail();
      });
    return () => {
      gone = true;
      close?.();
    };
  }, [data, fail]);

  const column = useRef<HTMLDivElement>(null);
  const size = useDrawWidth(column);

  return (
    <div ref={column} className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:gap-6">
      {pdf.state === "ready" ? (
        pdf.pages.map((page) => (
          <PdfPage
            key={page.pageNumber}
            lib={pdf.lib}
            page={page}
            width={size.width}
            pixels={size.drawn}
            onFail={fail}
          />
        ))
      ) : pdf.state === "failed" ? (
        <p role="alert" className="py-16 text-center text-sm text-muted-foreground">
          This PDF can't be shown here. Download it to see it.
        </p>
      ) : (
        <div aria-busy="true" className="w-full appear-after-wait rounded-sm bg-white shadow-sm motion-safe:animate-pulse" style={A4} />
      )}
    </div>
  );
}

/**
 * The column's width, and the pixels to draw a page across: its width at
 * the screen's density (twice that on a touch screen, to zoom into),
 * redrawn only when the column grows by a tenth; narrower, the browser
 * shrinks what is drawn.
 */
function useDrawWidth(column: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, drawn: 0 });
  useEffect(() => {
    const element = column.current;
    if (!element) return;
    const zoom = window.matchMedia("(pointer: coarse)").matches ? 2 : 1;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      const pixels = Math.min(Math.ceil(width * window.devicePixelRatio * zoom), MAX_PIXELS);
      setSize((prev) => ({ width, drawn: pixels > prev.drawn * 1.1 ? pixels : prev.drawn }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [column]);
  return size;
}

interface PdfPageProps {
  lib: PdfRender;
  page: PDFPageProxy;
  /** CSS pixels it shows across. */
  width: number;
  /** Pixels it is drawn across. */
  pixels: number;
  onFail: () => void;
}

/** A sheet: the page drawn, and its text over it to select. */
function PdfPage({ lib, page, width, pixels, onFail }: PdfPageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const { width: pageWidth, height: pageHeight } = lib.pageSize(page);

  useEffect(() => {
    if (!pixels || !canvas.current || !text.current) return;
    const draw = lib.drawPage(page, canvas.current, text.current, pixels);
    draw.done.then(
      (done) => done && setDrawn(true),
      (error: unknown) => {
        console.error(error);
        onFail();
      },
    );
    return draw.cancel;
  }, [lib, page, pixels, onFail]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-sm bg-white shadow-sm"
      style={{ aspectRatio: `${pageWidth} / ${pageHeight}`, "--total-scale-factor": width / pageWidth } as CSSProperties}
    >
      <canvas
        ref={canvas}
        aria-hidden
        className={cn("absolute inset-0 size-full transition-opacity", drawn ? "opacity-100" : "opacity-0")}
      />
      <div ref={text} className="textLayer" />
    </div>
  );
}
