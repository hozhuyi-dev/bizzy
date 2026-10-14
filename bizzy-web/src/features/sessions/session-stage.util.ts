import type { DocumentItem, Session, SessionDocument, StageBadge } from "./sessions.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";

/**
 * How a session reads in lists and on its page. What it is (its rules, what
 * is left to do, what each action would say) comes from the API, worked
 * out by sessions/rules.go and the book's guards: nothing here re-derives a
 * rule, it only says how each one shows.
 */

/** How each of the API's session rules shows as a badge, by rule id. */
const RULE_BADGES: Record<string, StageBadge> = {
  unconfirmed: { label: "Not confirmed", tone: "waiting" },
  unrecorded: { label: "To record", tone: "waiting" },
  unpaid: { label: "Unpaid", tone: "attention" },
};

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
  return [{ label: "Done", tone: "done" }];
}

/** What the session costs: its fee, or nothing of its own on a package credit. */
export function sessionAmount(session: Session): number | undefined {
  return session.packageId ? undefined : session.feeCents;
}

/**
 * What a session's documents cover: the session's fee (none on a credit)
 * and the package bought in it. Each is on a draft invoice from the start,
 * and on a receipt once paid.
 */
export function documentItems(session: Session, bought: Package | undefined): Array<DocumentItem> {
  const items: Array<DocumentItem> = [];
  if (!session.packageId) {
    items.push({ source: { kind: "session", id: session.id }, label: "Session fee", amountCents: session.feeCents });
  }
  if (bought) {
    items.push({ source: { kind: "package", id: bought.id }, label: `Package of ${bought.sessions}`, amountCents: bought.priceCents });
  }
  return items;
}

/** The documents of a type on the session or the package bought in it, each once. */
export function sessionDocuments(type: DocumentType, session: Session, bought: Package | undefined): Array<SessionDocument> {
  const refs = [session[type], bought?.[type]].filter((ref) => ref !== undefined);
  return refs
    .filter((ref, i) => refs.findIndex((r) => r.documentId === ref.documentId) === i)
    .map((ref) => ({ type, ref }));
}

/** Every document on the session or the package bought in it. */
export function allSessionDocuments(session: Session, bought: Package | undefined): Array<SessionDocument> {
  return [...sessionDocuments("invoice", session, bought), ...sessionDocuments("receipt", session, bought)];
}

/** The package bought in a session, among packages. */
export function boughtIn(session: Session, packages: ReadonlyArray<Package> | undefined): Package | undefined {
  return session.boughtPackageId ? packages?.find((p) => p.id === session.boughtPackageId) : undefined;
}
