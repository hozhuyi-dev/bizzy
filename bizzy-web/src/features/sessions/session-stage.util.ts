import type { DocumentItem, Session, SessionDocument, StageBadge, TodoReason } from "./sessions.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";
import { boughtIn, canReceiptPackage } from "~/features/packages/packages.util";

/**
 * Where a session is in its life, read from what is stored. These mirror the
 * API's rules (bizzy-lambda/internal/features/sessions/model.go), so tables
 * and the session's page say what the to-do list says.
 */

/** The calendar entry's own problem, for a session that needs fixing. */
const FIX_LABELS: Partial<Record<Session["status"], string>> = {
  parse_error: "Can't read",
  unmatched: "Unmatched",
  missing_fee: "No fee",
};

/** No client has its name: unmatched, or tentative under an unknown name. Linking one fixes it. */
export function isUnmatched(session: Session): boolean {
  return session.status === "unmatched" || (session.status === "tentative" && !session.clientId);
}

/** Mirrors Session.NeedsFix: a tentative one under an unknown name is fixed before it is confirmed. */
export function needsFix(session: Session): boolean {
  return session.status in FIX_LABELS || Boolean(session.drift) || isUnmatched(session);
}

export function hasHappened(session: Session, now = new Date()): boolean {
  return new Date(session.end) <= now;
}

export function isRecorded(session: Session): boolean {
  return Boolean(session.record?.summary);
}

export function isDelivered(session: Session): boolean {
  return session.status === "priced" || session.status === "package" || session.status === "missing_fee";
}

/** The session's own fee, when one applies: a package credit costs nothing more. */
export function dueCents(session: Session): number {
  return session.status === "priced" ? (session.feeCents ?? 0) : 0;
}

/** The fee is paid, waived, or nothing (a package credit). */
export function isFeeSettled(session: Session): boolean {
  return session.payment !== undefined || dueCents(session) === 0;
}

/** The package bought in the session is still to be paid; it is paid on the package. */
export function isBoughtDue(session: Session): boolean {
  return isDelivered(session) && (session.boughtCents ?? 0) > 0 && !session.boughtSettled;
}

/** Nothing more is owed on it: its fee and the package bought in it. */
export function isPaid(session: Session): boolean {
  return isFeeSettled(session) && !isBoughtDue(session);
}

/** What is still to collect on it: the fee and the package bought in it, unless paid. */
export function owedCents(session: Session): number {
  return (isFeeSettled(session) ? 0 : dueCents(session)) + (isBoughtDue(session) ? (session.boughtCents ?? 0) : 0);
}

/** What she has left to do on it now; mirrors Session.Todo. */
export function todoReasons(session: Session, now = new Date()): Array<TodoReason> {
  if (session.removedAt) return ["deleted"];
  if (needsFix(session)) return ["fix"];
  if (session.status === "tentative") return ["confirm"];
  if (!hasHappened(session, now)) return [];
  const reasons: Array<TodoReason> = [];
  if (!isRecorded(session)) reasons.push("record");
  if (!isPaid(session)) reasons.push("collect");
  return reasons;
}

/** The badges a list shows for a session: what is left, or where it stands. */
export function stageBadges(session: Session, now = new Date()): Array<StageBadge> {
  if (session.removedAt) return [{ label: "Deleted", tone: "neutral" }];
  const fix = FIX_LABELS[session.status] ?? (isUnmatched(session) ? FIX_LABELS.unmatched : undefined);
  if (fix) return [{ label: fix, tone: "attention" }];
  if (session.drift) return [{ label: "Changed after document", tone: "attention" }];
  if (session.status === "tentative") return [{ label: "Not confirmed", tone: "waiting" }];
  if (!hasHappened(session, now)) return [{ label: "Booked", tone: "info" }];

  const badges: Array<StageBadge> = [];
  if (!isRecorded(session)) badges.push({ label: "To record", tone: "waiting" });
  if (!isPaid(session)) badges.push({ label: "Unpaid", tone: "attention" });
  if (badges.length === 0) {
    badges.push(session.payment?.status === "waived" ? { label: "Waived", tone: "done" } : { label: "Done", tone: "done" });
  }
  return badges;
}

/** What the session is worth: its fee, or its share of a package. */
export function sessionAmount(session: Session): number | undefined {
  return session.feeCents ?? (session.status === "package" ? session.valueCents : undefined);
}

export function canInvoice(session: Session): boolean {
  return !session.removedAt && session.status === "priced" && session.feeCents !== undefined && !session.invoice;
}

export function canReceipt(session: Session): boolean {
  return (
    !session.removedAt &&
    session.status === "priced" &&
    session.feeCents !== undefined &&
    !session.receipt &&
    session.payment?.status === "paid"
  );
}

/**
 * What a session's documents of the type can cover, each on its own: the
 * session's fee and the package its title bought. She picks any of them
 * for one document, and the rest can go on another. A receipt needs each
 * one paid.
 */
export function documentItems(type: DocumentType, session: Session, pkg: Package | undefined): Array<DocumentItem> {
  const items: Array<DocumentItem> = [];
  if (session.removedAt) return items;

  if (session.status === "priced" && session.feeCents !== undefined) {
    let unavailable: string | undefined;
    if (session[type]) unavailable = `On ${type === "invoice" ? "an invoice" : "a receipt"} already`;
    else if (type === "receipt" && !canReceipt(session)) unavailable = "Not paid yet";
    items.push({ source: { kind: "session", id: session.eventId }, label: "Session fee", amountCents: session.feeCents, unavailable });
  }

  const bought = boughtIn(session.eventId, pkg);
  if (bought) {
    let unavailable: string | undefined;
    if (bought[type]) unavailable = `On ${type === "invoice" ? "an invoice" : "a receipt"} already`;
    else if (type === "receipt" && !canReceiptPackage(bought)) unavailable = "Not paid yet";
    items.push({
      source: { kind: "package", id: bought.id },
      label: `Package of ${bought.sessions}`,
      amountCents: bought.priceCents,
      unavailable,
    });
  }
  return items;
}

/** The documents of a type on the session or the package it bought, each once. */
export function sessionDocuments(type: DocumentType, session: Session, pkg: Package | undefined): Array<SessionDocument> {
  const refs = [session[type], boughtIn(session.eventId, pkg)?.[type]].filter((ref) => ref !== undefined);
  return refs
    .filter((ref, i) => refs.findIndex((r) => r.documentId === ref.documentId) === i)
    .map((ref) => ({ type, ref }));
}

/** Every document on the session or its package; any of them locks the booking. */
export function allSessionDocuments(session: Session, bought: Package | undefined): Array<SessionDocument> {
  return [...sessionDocuments("invoice", session, bought), ...sessionDocuments("receipt", session, bought)];
}
