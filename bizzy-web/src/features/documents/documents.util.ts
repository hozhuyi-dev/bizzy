import type { DocumentType } from "./documents.types";

/** The route of one document's page. */
export function documentRoute(type: DocumentType) {
  return type === "invoice" ? ("/invoices/$id" as const) : ("/receipts/$id" as const);
}

/** "RCP260042-00": the number and its revision, from -00. A draft has no number yet. */
export function documentLabel(number: string | undefined, revision: number | undefined): string {
  if (!number) return "Draft";
  return `${number}-${String(revision ?? 0).padStart(2, "0")}`;
}

/** The link that opens a shared document, on whichever origin the app runs. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/d/${token}`;
}
