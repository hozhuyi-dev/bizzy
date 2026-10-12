import type { DocumentRef, Session, TodoReason } from "./sessions.types";
import type { DocumentSource, DocumentType } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";

/**
 * Where a session is in its life, read from what is stored. These mirror the
 * API's rules (bizzy-lambda/internal/features/sessions/model.go), so tables
 * and the session's page say what the to-do list says.
 */

type Tone = "neutral" | "done" | "info" | "waiting" | "attention";

export interface StageBadge {
  label: string;
  tone: Tone;
}

/** The calendar entry's own problem, for a session that needs fixing. */
const FIX_LABELS: Partial<Record<Session["status"], string>> = {
  parse_error: "Can't read",
  unmatched: "Unmatched",
  missing_fee: "No fee",
};

export function needsFix(session: Session): boolean {
  return session.status in FIX_LABELS || Boolean(session.drift);
}

export function hasHappened(session: Session, now = new Date()): boolean {
  return new Date(session.end) <= now;
}

export function isRecorded(session: Session): boolean {
  return Boolean(session.record?.summary);
}

function delivered(session: Session): boolean {
  return session.status === "priced" || session.status === "package" || session.status === "missing_fee";
}

/** What the client owes for it: the fee when one applies, plus a package bought in it. */
export function dueCents(session: Session): number {
  const fee = session.status === "priced" ? (session.feeCents ?? 0) : 0;
  return fee + (delivered(session) ? (session.boughtCents ?? 0) : 0);
}

/** Settled: paid, waived, or nothing owed (a package credit). */
export function isPaid(session: Session): boolean {
  return session.payment !== undefined || dueCents(session) === 0;
}

/** What she has left to do on it now; mirrors Session.Todo. */
export function todoReasons(session: Session, now = new Date()): Array<TodoReason> {
  if (session.removedAt) return ["deleted"];
  if (session.status === "tentative") return ["confirm"];
  if (needsFix(session)) return ["fix"];
  if (session.untracked || !hasHappened(session, now)) return [];
  const reasons: Array<TodoReason> = [];
  if (!isRecorded(session)) reasons.push("record");
  if (!isPaid(session)) reasons.push("collect");
  return reasons;
}

/** The badges a list shows for a session: what is left, or where it stands. */
export function stageBadges(session: Session, now = new Date()): Array<StageBadge> {
  if (session.removedAt) return [{ label: "Deleted", tone: "neutral" }];
  if (session.status === "tentative") return [{ label: "Not confirmed", tone: "waiting" }];
  const fix = FIX_LABELS[session.status];
  if (fix) return [{ label: fix, tone: "attention" }];
  if (session.drift) return [{ label: "Changed after document", tone: "attention" }];
  if (!hasHappened(session, now)) return [{ label: "Booked", tone: "info" }];
  if (session.untracked) return [{ label: "Before tracking", tone: "neutral" }];

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
  const paid = session.payment?.status === "paid" || (session.untracked && !session.payment);
  return !session.removedAt && session.status === "priced" && session.feeCents !== undefined && !session.receipt && Boolean(paid);
}

/**
 * What a new document of the type would cover: the session's fee if it can
 * have one, and the package its title bought (keyed by the same event ID)
 * if that has none of the type yet. Both go on one document.
 */
export function documentSources(type: DocumentType, session: Session, bought: Package | undefined): Array<DocumentSource> {
  const sources: Array<DocumentSource> = [];
  if (type === "invoice" ? canInvoice(session) : canReceipt(session)) {
    sources.push({ kind: "session", id: session.eventId });
  }
  const paidFor = type === "invoice" || session.payment?.status === "paid" || session.untracked;
  if (bought && !bought.removed && !bought[type] && paidFor) sources.push({ kind: "package", id: bought.id });
  return sources;
}

export interface SessionDocument {
  type: DocumentType;
  ref: DocumentRef;
}

/** The documents of a type on the session or the package it bought, each once. */
export function sessionDocuments(type: DocumentType, session: Session, bought: Package | undefined): Array<SessionDocument> {
  const refs = [session[type], bought?.[type]].filter((ref) => ref !== undefined);
  return refs
    .filter((ref, i) => refs.findIndex((r) => r.documentId === ref.documentId) === i)
    .map((ref) => ({ type, ref }));
}

/** Every document on the session or its package; any of them locks the booking. */
export function allSessionDocuments(session: Session, bought: Package | undefined): Array<SessionDocument> {
  return [...sessionDocuments("invoice", session, bought), ...sessionDocuments("receipt", session, bought)];
}
