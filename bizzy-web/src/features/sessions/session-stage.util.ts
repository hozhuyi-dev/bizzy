import { SESSION_PLACES } from "./sessions.constant";
import type { CoveringCredit, DocumentItem, RecordView, SessionReason, SessionView, StageBadge } from "./sessions.types";
import type { DocumentLink, DocumentType } from "~/features/documents/documents.types";
import type { PackageView } from "~/features/packages/packages.types";
import { coveringDocuments } from "~/features/documents/documents.util";
import { formatHours } from "~/core/utils/date.util";

/**
 * How a session reads in lists and on its page. What it is (what is left to
 * do, what each action would say) comes from the API: nothing here
 * re-derives a rule, it only says how each one shows.
 */

/** How each of the API's to-do reasons shows as a badge. */
export const REASON_BADGES: Record<SessionReason, StageBadge> = {
  confirm: { label: "Not confirmed", tone: "waiting" },
  record: { label: "To record", tone: "waiting" },
  collect: { label: "Unpaid", tone: "attention" },
};

export function hasHappened(session: SessionView, now = new Date()): boolean {
  return new Date(session.end) <= now;
}

export function sessionMinutes(session: Pick<SessionView, "start" | "end">): number {
  return Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60_000);
}

/** The badges a list shows for a session: what is left to do on it, or where it stands. */
export function stageBadges(session: SessionView, now = new Date()): Array<StageBadge> {
  if (session.todo.length > 0) return session.todo.map((reason) => REASON_BADGES[reason]);
  if (!hasHappened(session, now)) return [{ label: "Booked", tone: "info" }];
  return [{ label: "Done", tone: "done" }];
}

/** "1.5 h · Home visit": how long it is and where, under its time in a list. */
export function lengthAndPlace(session: SessionView): string {
  return `${formatHours(sessionMinutes(session) / 60)} · ${SESSION_PLACES[session.location]}`;
}

/** "Notes · 2 files": what was recorded besides the summary, if anything. */
export function recordText(record: RecordView): string | undefined {
  const parts = [record.hasNotes ? "Notes" : undefined, record.files > 0 ? `${record.files} ${record.files === 1 ? "file" : "files"}` : undefined];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/** "1 h on credits · + 10 h package": what pays for it besides its fee, and the package it buys. */
export function coverText(session: SessionView): string | undefined {
  const credited = session.credits.reduce((sum, credit) => sum + credit.hours, 0);
  const parts = [
    credited > 0 ? `${formatHours(credited)} on credits` : undefined,
    session.bought ? `+ ${formatHours(session.bought.hours)} package` : undefined,
  ];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/** What the session costs: its fee, or nothing of its own when package credits pay it all. */
export function sessionAmount(session: SessionView): number | undefined {
  return session.invoice ? session.feeCents : undefined;
}

/** The packages whose credits pay for the session, with the hours each pays, as far as they are loaded. */
export function coveringCredits(session: SessionView, packages: ReadonlyArray<PackageView> | undefined): Array<CoveringCredit> {
  return session.credits.flatMap(({ packageId, hours }) => {
    const pkg = packages?.find((p) => p.id === packageId);
    return pkg ? [{ pkg, hours }] : [];
  });
}

/**
 * What a session's invoice covers: the session's fee (none when credits
 * pay it all) and the package bought in it. Each is on a draft invoice
 * from the start.
 */
export function documentItems(session: SessionView): Array<DocumentItem> {
  const items: Array<DocumentItem> = [];
  if (session.invoice) {
    items.push({ source: { kind: "session", id: session.id }, label: "Session fee", amountCents: session.feeCents });
  }
  if (session.bought) {
    const { bought } = session;
    items.push({ source: { kind: "package", id: bought.id }, label: `Package of ${formatHours(bought.hours)}`, amountCents: bought.priceCents });
  }
  return items;
}

/** The documents of a type on the session or the package bought in it, each once. */
export function sessionDocuments(type: DocumentType, session: SessionView, bought: PackageView | undefined): Array<DocumentLink> {
  const docs = [...coveringDocuments(session), ...coveringDocuments(bought)].filter((doc) => doc.type === type);
  return docs.filter((doc, i) => docs.findIndex((d) => d.ref.id === doc.ref.id) === i);
}

/** Every document on the session or the package bought in it. */
export function allSessionDocuments(session: SessionView, bought: PackageView | undefined): Array<DocumentLink> {
  return [...sessionDocuments("invoice", session, bought), ...sessionDocuments("receipt", session, bought)];
}

/** The package bought in a session, among packages. */
export function boughtIn(session: SessionView, packages: ReadonlyArray<PackageView> | undefined): PackageView | undefined {
  return session.bought ? packages?.find((p) => p.id === session.bought?.id) : undefined;
}
