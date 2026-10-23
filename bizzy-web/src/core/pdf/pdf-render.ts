// pdf.js, its worker and the text layer's CSS. Imported only on demand
// (a document's PDF shown, a PDF attached), so none of it is in the app's
// bundle until then.
import { AbortException, GlobalWorkerOptions, RenderingCancelledException, TextLayer, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFPageProxy } from "pdfjs-dist";
import "./pdf-text-layer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

/** A PDF's pages, read from its bytes; `close` frees the worker's copy. */
export async function openPdf(bytes: Uint8Array): Promise<{ pages: Array<PDFPageProxy>; close: () => void }> {
  const task = getDocument({ data: bytes });
  const close = () => void task.destroy();
  try {
    const pdf = await task.promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
    return { pages, close };
  } catch (error) {
    close();
    throw error;
  }
}

/** A PDF's first page drawn at most `maxSide` pixels on its longer side, for a thumbnail. */
export async function drawFirstPage(bytes: Uint8Array, maxSide: number): Promise<HTMLCanvasElement> {
  const task = getDocument({ data: bytes });
  try {
    const page = await (await task.promise).getPage(1);
    const { width, height } = pageSize(page);
    const viewport = page.getViewport({ scale: maxSide / Math.max(width, height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    void task.destroy();
  }
}

/** A page's size in PDF units, as its text layer is laid out. */
export function pageSize(page: PDFPageProxy): { width: number; height: number } {
  const { width, height } = page.getViewport({ scale: 1 });
  return { width, height };
}

/**
 * Draws a page `pixels` wide into the canvas, and its text (to select and
 * copy, and for screen readers) into the layer over it. The layer sizes
 * itself by --total-scale-factor, so it follows the page's width without
 * being drawn again. `cancel` stops both; `done` is then false.
 */
export function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement, textLayer: HTMLDivElement, pixels: number) {
  const viewport = page.getViewport({ scale: pixels / pageSize(page).width });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const render = page.render({ canvas, viewport });

  textLayer.replaceChildren();
  const text = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });

  return {
    done: Promise.all([render.promise, text.render()]).then(
      () => true,
      (error: unknown) => {
        if (error instanceof RenderingCancelledException || error instanceof AbortException) return false;
        throw error;
      },
    ),
    cancel: () => {
      render.cancel();
      text.cancel();
    },
  };
}
