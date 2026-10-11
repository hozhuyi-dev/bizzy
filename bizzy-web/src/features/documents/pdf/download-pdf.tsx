import { documentLabel } from "../documents.registry";
import type { DocumentPdfProps } from "./document-pdf.component";

/**
 * PDFs are rendered in the browser. The renderer and the layout load on
 * first use, so they stay out of the app's main bundle.
 */
async function renderPdf(props: DocumentPdfProps): Promise<Blob> {
  const [{ pdf }, { DocumentPdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./document-pdf.component"),
  ]);
  return pdf(<DocumentPdf {...props} />).toBlob();
}

export function pdfFileName(props: DocumentPdfProps): string {
  return `${documentLabel(props.number, props.revision)} ${props.content.recipient.name}.pdf`;
}

/** Downloads the PDF. */
export async function downloadDocumentPdf(props: DocumentPdfProps): Promise<void> {
  const url = URL.createObjectURL(await renderPdf(props));

  const link = document.createElement("a");
  link.href = url;
  link.download = pdfFileName(props);
  link.click();

  // Give the browser a moment to start the download before freeing it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Shows the PDF exactly as it will print, in a new tab. Call it straight from
 * a click: the tab is opened before rendering so popup blockers allow it.
 */
export async function openDocumentPdf(props: DocumentPdfProps): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = URL.createObjectURL(await renderPdf(props));
    // Not revoked: the tab's viewer may re-read it to save or print.
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    tab?.close();
    throw error;
  }
}
