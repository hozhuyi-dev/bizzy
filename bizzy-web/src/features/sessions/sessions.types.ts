import type { DocumentRef, DocumentSource } from "~/features/documents/documents.types";
import type { Paid } from "~/features/payments/payments.types";
import type { Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/sessions/api.go.

/** The user's own place, or a home visit at the client's: `(H)` and `(V)` in a title. */
export type SessionLocation = "own" | "visit";

/** Why a session is on the to-do list; mirrors sessions.Reason. */
export type SessionReason = "confirm" | "record" | "collect";

/** The package bought in a session, collected with it; mirrors sessions.BoughtView. */
export interface BoughtView {
  id: string;
  sessions: number;
  priceCents: number;
  paid: boolean;
}

/** What was recorded on a session; mirrors sessions.RecordView. */
export interface RecordView {
  summary: string;
  hasNotes: boolean;
  /** How many files are attached. */
  files: number;
}

/** What each action on a session would say now; mirrors sessions.Can. */
export interface SessionCan {
  /** Notes and files can be written or attached. */
  record: Verdict;
  pay: Verdict;
  undoPayment: Verdict;
  delete: Verdict;
}

/**
 * A session as the app shows it: the booking, what pays for it and was
 * paid, what was recorded, what is left to do, and what each action would
 * say now. Read these; never re-derive them here.
 */
export interface SessionView {
  id: string;
  clientId: string;
  clientName: string;
  start: string;
  end: string;
  tentative: boolean;
  confirmedAt?: string;
  location: SessionLocation;
  /** The package whose credit pays for it; otherwise its fee is on an invoice. */
  packageId?: string;
  /** What its invoice charges; 0 on a credit. */
  feeCents: number;
  /** The fee was entered for it, not the client's usual fee. */
  feeTyped: boolean;
  invoice?: DocumentRef;
  paid?: Paid;
  bought?: BoughtView;
  /** Still to collect with it: its fee unless received, plus the package bought in it unless paid. */
  owedCents: number;
  record: RecordView;
  todo: Array<SessionReason>;
  can: SessionCan;
}

/** A session with its notes, for its page; mirrors sessions.FullView. */
export interface SessionFullView extends SessionView {
  notes: string;
}

/** What would pay for a session with no fee entered; mirrors sessions.CoverView. */
export type CoverView =
  | { kind: "bought" }
  | { kind: "credit"; packageId: string }
  | { kind: "default"; feeCents: number }
  | { kind: "none" };

/** sessions.preview's request: a booking as the form has it, with no fee entered. */
export interface PreviewSessionRequest {
  clientId: string;
  start: string;
  /** The session being edited: what pays for it stays unless something else changes. */
  sessionId?: string | undefined;
  /** It buys a package, whose first credit it uses. */
  buysPackage: boolean;
}

/**
 * What sessions.create and sessions.update set; mirrors sessions.Fields. An
 * update is a patch: what isn't sent stays as it is.
 */
export interface SessionFields {
  clientId?: string;
  time?: { start: string; end: string };
  tentative?: boolean;
  location?: SessionLocation;
  /** `{cents}` is a fee typed for it; `{}` returns it to a credit or the usual fee. */
  fee?: { cents?: number };
  /** `{bought}` is the package bought in it; `{}` drops it. */
  package?: { bought?: { sessions: number; priceCents: number } };
  /** Move what was received to the new amounts, on receipts not issued yet. */
  updatePayment?: boolean;
}

/** A booking as the user fills it in: what the booking form edits. */
export interface SessionDraft {
  clientId: string;
  start: string;
  minutes: number;
  /** A fee typed for it; unset leaves it to a package credit or the client's fee. */
  feeCents?: number;
  /** A package bought in this session. */
  package?: { sessions: number; priceCents: number };
  homeVisit: boolean;
  tentative: boolean;
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

/** Something a session's invoice covers: its fee, or the package bought in it. */
export interface DocumentItem {
  source: DocumentSource;
  label: string;
  amountCents: number;
}
