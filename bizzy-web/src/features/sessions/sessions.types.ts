import type { DocumentRef, DocumentSource, DocumentType } from "~/features/documents/documents.types";
import type { Payment } from "~/features/payments/payments.types";
import type { Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/sessions/model.go and view.go.
export type SessionStatus =
  | "tentative"
  | "parse_error"
  | "unmatched"
  | "missing_fee"
  | "priced"
  | "package"
  | "removed";

/** What she writes after a session: the summary; the notes are apart. */
export interface SessionRecord {
  summary: string;
  hasNotes?: boolean;
  updatedAt: string;
}

export interface Session {
  eventId: string;
  title: string;
  start: string;
  end: string;
  colorId?: string;
  /** Deleted from the calendar, kept for what she recorded on it. */
  removedAt?: string;

  status: SessionStatus;
  /** The name as written in the title. */
  name?: string;
  clientId?: string;
  /** A near-miss match: "did you mean …". */
  suggestedClientId?: string;
  feeCents?: number;
  feeSource?: "title" | "default" | "package";
  packageId?: string;
  valueCents?: number;
  /** The price of the package bought in this session, collected with it. */
  boughtCents?: number;
  /** Whether that package is paid (or waived); it is paid on the package. */
  boughtSettled?: boolean;
  location?: "clinic" | "home";
  locationSource?: "colour" | "client";
  reason?: string;
  drift?: string;
  /** Still ahead at the last sync. */
  upcoming?: boolean;
  confirmedAt?: string;

  record?: SessionRecord;
  /** Settles the session's own fee; the package bought in it is paid on the package. */
  payment?: Payment;
  invoice?: DocumentRef;
  receipt?: DocumentRef;

  version: number;

  // What the API's rules (sessions/rules.go) and guards (guards.go) make of
  // it as of the request. Read these; never re-derive them here.
  state: SessionState;
  /** The rules that hold, in priority order; empty when there is nothing to it. */
  rules: Array<string>;
  /** What is left to do on it now. */
  todo: Array<TodoReason>;
  /** The first thing to fix, explained. */
  problem?: string;
  /** Its own fee, when one applies. */
  dueCents: number;
  /** Still to collect with it: the fee unless settled, plus the package bought in it unless paid. */
  owedCents: number;
  /** The part of owedCents that is the package bought in it. */
  boughtOwedCents: number;
  /** Counts as having happened with a client, fee known or not. */
  delivered: boolean;
  /** Nothing more is owed on it. */
  paid: boolean;
  can: SessionCan;
}

/** A session on its axes; mirrors sessions.State. */
export interface SessionState {
  presence: "in-calendar" | "removed";
  status: SessionStatus;
  client: "matched" | "none";
  timing: "upcoming" | "happened";
  record: "none" | "notes-only" | "summary";
  fee: "nothing-due" | "owed";
  payment: "none" | "paid" | "waived";
  paidFor: "current" | "outdated";
  bought: "none" | "due" | "settled";
  invoice: "empty" | "draft" | "issued";
  receipt: "empty" | "draft" | "issued";
  drift: "none" | "drifted";
}

/** What each action on a session would say now; mirrors sessions.Can. */
export interface SessionCan {
  /** Money is settled on it at all: in the calendar, confirmed and read. */
  settle: Verdict;
  pay: Verdict;
  undoPayment: Verdict;
  invoice: Verdict;
  receipt: Verdict;
  record: Verdict;
  editBooking: Verdict;
  restore: Verdict;
  discard: Verdict;
}

/** Why a session is on her to-do list; mirrors sessions.Reason. */
export type TodoReason = "deleted" | "fix" | "confirm" | "record" | "collect";

/**
 * A session as she fills it in; mirrors googlesync.Draft. The API writes the
 * calendar title from it, so it always parses and matches the client.
 */
export interface SessionDraft {
  clientId: string;
  start: string;
  minutes: number;
  /** What the session costs; unset leaves it to a package credit or the default fee. */
  feeCents?: number;
  /** A package bought in this session. */
  package?: { sessions: number; priceCents: number };
  homeVisit: boolean;
  tentative: boolean;
}

/** A stored session with the draft to edit it from, and its notes; mirrors googlesync.Stored. */
export interface StoredSession {
  session: Session;
  draft: SessionDraft;
  notes: string;
}

/** Where a session was opened from, to go back there. */
export type SessionReturnTo = "home";

export interface SessionSearch {
  /** Where to go back to once saved. */
  from?: SessionReturnTo | undefined;
}

export type StageTone = "neutral" | "done" | "info" | "waiting" | "attention";

export interface StageBadge {
  label: string;
  tone: StageTone;
}

/** Something a session's document can cover: its fee, or the package its title bought. */
export interface DocumentItem {
  source: DocumentSource;
  label: string;
  amountCents: number;
  /** Why it can't go on a new document of the type now; unset when it can. */
  unavailable?: string | undefined;
}

export interface SessionDocument {
  type: DocumentType;
  ref: DocumentRef;
}

