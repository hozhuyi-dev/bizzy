import type { Payment } from "~/features/payments/payments.types";

// Mirrors bizzy-lambda/internal/features/sessions/model.go.
export type SessionStatus =
  | "tentative"
  | "parse_error"
  | "unmatched"
  | "missing_fee"
  | "priced"
  | "package"
  | "removed";

export interface DocumentRef {
  documentId: string;
  /** Set once the document is issued; a draft only reserves. */
  number?: string;
  revision?: number;
  amountCents?: number;
  date?: string;
  clientId?: string;
}

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

/** One page of a list; mirrors dynamo.Page. */
export interface Page<T> {
  items: Array<T>;
  /** Reads the next page; absent on the last. */
  next?: string;
}
