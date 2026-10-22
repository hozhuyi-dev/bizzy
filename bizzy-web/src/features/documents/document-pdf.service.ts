import { pdfBlob } from "./documents.util";
import type { DocumentFile } from "./documents.types";

/**
 * PDFs are printed by the API (an issued one is the file kept when it was
 * issued); the browser only opens or saves what it gets.
 */
export const DocumentPdfService = {
  /** Downloads the PDF under its name. */
  async download(load: () => Promise<DocumentFile>): Promise<void> {
    const file = await load();
    const url = URL.createObjectURL(pdfBlob(file));

    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();

    // Give the browser a moment to start the download before freeing it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /**
   * Shows the PDF in a new tab. Call it straight from a click: the tab is
   * opened before the PDF arrives so popup blockers allow it.
   */
  async open(load: () => Promise<DocumentFile>): Promise<void> {
    const tab = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(pdfBlob(await load()));
      // Not revoked: the tab's viewer may re-read it to save or print.
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (error) {
      tab?.close();
      throw error;
    }
  },
};
