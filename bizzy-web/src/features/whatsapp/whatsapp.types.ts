import type { DocumentSummary } from "~/features/documents/documents.types";

/**
 * Where a WhatsApp link opens: the app on her phone (a touch screen); on a
 * computer, WhatsApp Web in the browser or the desktop app, as chosen in
 * Settings for that computer.
 */
export type WhatsAppOn = "app" | "web" | "desktop";

/** Who a message goes to: the client's name, and the phone WhatsApp opens. */
export interface WhatsAppRecipient {
  name: string;
  phone?: string | undefined;
}

/** An issued document as sending needs it: a summary, or a whole document. */
export type SendableDocument = Pick<
  DocumentSummary,
  "id" | "type" | "number" | "revision" | "date" | "totalCents" | "shareToken"
>;

/** An issued document with its link, as a message lists it. */
export type SentDocument = Pick<DocumentSummary, "type" | "number" | "revision" | "date" | "totalCents"> & {
  shareToken: string;
};
