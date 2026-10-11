import type { Session, SessionStatus } from "./sessions.types";
import type { DocumentSource } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";

type StatusTone = "neutral" | "done" | "info" | "waiting" | "attention";

export const SESSION_STATUS: Record<SessionStatus, { label: string; variant: StatusTone; hint?: string }> = {
  tentative: { label: "Not confirmed", variant: "waiting" },
  parse_error: { label: "Can't read", variant: "attention", hint: "Fix the title in the calendar, then sync." },
  unmatched: { label: "Unmatched", variant: "attention" },
  missing_fee: { label: "No fee", variant: "attention", hint: "Add an amount in the calendar or a default fee for the client." },
  priced: { label: "Paid", variant: "done" },
  package: { label: "Package", variant: "info" },
  ignored: { label: "Ignored", variant: "neutral" },
  removed: { label: "Removed", variant: "neutral" },
};

/** What the session is worth: its fee, or its share of a package. */
export function sessionAmount(session: Session): number | undefined {
  if (session.document?.amountCents !== undefined && session.document.number) {
    return session.document.amountCents;
  }
  return session.feeCents ?? (session.status === "package" ? session.valueCents : undefined);
}

/** A receipt can be made for a paid session not yet on one. */
export function canReceipt(session: Session): boolean {
  return session.status === "priced" && session.feeCents !== undefined && !session.document;
}

/**
 * What a receipt for this session would cover: the session if she was paid
 * for it, and the package its title bought (`bought`, keyed by the same
 * event ID) if it has no receipt yet. Both go on one receipt.
 */
export function receiptSources(session: Session, bought: Package | undefined): Array<DocumentSource> {
  const sources: Array<DocumentSource> = [];
  if (canReceipt(session)) sources.push({ kind: "session", id: session.eventId });
  if (bought && !bought.document && !bought.removed) sources.push({ kind: "package", id: bought.id });
  return sources;
}

/** The receipts already covering the session or the package it bought. */
export function sessionReceipts(session: Session, bought: Package | undefined) {
  const refs = [session.document, bought?.document].filter((ref) => ref !== undefined);
  return refs.filter((ref, i) => refs.findIndex((r) => r.documentId === ref.documentId) === i);
}
