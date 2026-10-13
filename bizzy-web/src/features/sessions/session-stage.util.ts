import type { DocumentItem, Session, SessionDocument, StageBadge, TodoReason } from "./sessions.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import { boughtIn } from "~/features/packages/packages.util";

/**
 * How a session reads in lists and on its page. What it is (its rules, what
 * is left to do, what each action would say) comes from the API, worked
 * out by sessions/rules.go and guards.go: nothing here re-derives a rule,
 * it only says how each one shows.
 */

/** How each of the API's session rules shows as a badge, by rule id. */
const RULE_BADGES: Record<string, StageBadge> = {
  deleted: { label: "Deleted", tone: "neutral" },
  "title-unreadable": { label: "Can't read", tone: "attention" },
  "client-unmatched": { label: "Unmatched", tone: "attention" },
  "tentative-unknown-client": { label: "Unmatched", tone: "attention" },
  "fee-missing": { label: "No fee", tone: "attention" },
  "contradicts-document": { label: "Changed after document", tone: "attention" },
  "fee-changed-after-payment": { label: "Fee changed", tone: "attention" },
  unconfirmed: { label: "Not confirmed", tone: "waiting" },
  unrecorded: { label: "To record", tone: "waiting" },
  unpaid: { label: "Unpaid", tone: "attention" },
};

/** No client has its name: linking one fixes it. */
export function isUnmatched(session: Session): boolean {
  return session.rules.includes("client-unmatched") || session.rules.includes("tentative-unknown-client");
}

/** Something about the calendar entry or a document must be fixed first. */
export function needsFix(session: Session): boolean {
  return session.todo.includes("fix");
}

export function hasHappened(session: Session): boolean {
  return session.state.timing === "happened";
}

/** The badges a list shows for a session: what its rules say, or where it stands. */
export function stageBadges(session: Session): Array<StageBadge> {
  const badges: Array<StageBadge> = [];
  for (const rule of session.rules) {
    const badge = RULE_BADGES[rule];
    if (badge && !badges.some((b) => b.label === badge.label)) badges.push(badge);
  }
  if (badges.length > 0) return badges;
  if (!hasHappened(session)) return [{ label: "Booked", tone: "info" }];
  return [session.payment?.status === "waived" ? { label: "Waived", tone: "done" } : { label: "Done", tone: "done" }];
}

/** What the session is worth: its fee, or its share of a package. */
export function sessionAmount(session: Session): number | undefined {
  return session.feeCents ?? (session.status === "package" ? session.valueCents : undefined);
}

/** Why an item can't go on a new document of the type, from what the API says. */
function unavailable(type: DocumentType, onOne: boolean, verdict: Verdict): string | undefined {
  if (verdict.ok) return undefined;
  if (onOne) return `On ${type === "invoice" ? "an invoice" : "a receipt"} already`;
  return type === "receipt" ? "Not paid yet" : verdict.why;
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

  // A fee of its own is set only on a priced session.
  if (session.feeCents !== undefined) {
    items.push({
      source: { kind: "session", id: session.eventId },
      label: "Session fee",
      amountCents: session.feeCents,
      unavailable: unavailable(type, Boolean(session[type]), session.can[type]),
    });
  }

  const bought = boughtIn(session.eventId, pkg);
  if (bought) {
    items.push({
      source: { kind: "package", id: bought.id },
      label: `Package of ${bought.sessions}`,
      amountCents: bought.priceCents,
      unavailable: unavailable(type, Boolean(bought[type]), bought.can[type]),
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
