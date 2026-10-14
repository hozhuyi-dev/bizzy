import type { DocumentRef, DocumentSource, DocumentType } from "~/features/documents/documents.types";
import type { Paid } from "~/features/payments/payments.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import type { EventLink } from "~/features/calendar/calendar.types";

// Mirrors bizzy-lambda/internal/features/sessions/model.go and view.go.

/** What she keeps after a session: the summary; the notes and files are apart. */
export interface SessionRecord {
  summary: string;
  hasNotes?: boolean;
  /** How many files are attached. */
  files?: number;
  updatedAt: string;
}

export type SessionLocation = "own" | "visit";

export interface Session {
  id: string;
  clientId: string;
  start: string;
  end: string;
  tentative?: boolean;
  confirmedAt?: string;
  /** Her own place, or a home visit at the client's: `(H)` and `(V)` in a title. */
  location: SessionLocation;
  /** The package whose credit covers it; otherwise its fee is on an invoice. */
  packageId?: string;
  /** The fee was entered for it (its title shows it), not the client's usual fee. */
  feeTyped?: boolean;
  /** The package bought in this session, collected with it. */
  boughtPackageId?: string;

  // Copied from its documents by the API: never set here.
  /** What its invoice charges; 0 on a credit. */
  feeCents: number;
  invoice?: DocumentRef;
  receipt?: DocumentRef;
  paid?: Paid;
  /** What is still owed for the package bought in it. */
  boughtOwedCents?: number;

  record?: SessionRecord;
  event: EventLink;
  createdAt: string;
  version: number;

  // What the API's rules (sessions/rules.go) and the book's guards make of
  // it as of the request. Read these; never re-derive them here.
  state: SessionState;
  /** The rules that hold, in priority order; empty when there is nothing to it. */
  rules: Array<string>;
  /** What is left to do on it now. */
  todo: Array<TodoReason>;
  /** The actions its to-do rules say resolve them: what its to-do item offers. */
  fixes: Array<string>;
  /** Still to collect with it: its fee unless received, plus the package bought in it unless paid. */
  owedCents: number;
  /** Nothing more is owed on it. */
  settled: boolean;
  can: SessionCan;
}

/** A session on its axes; mirrors sessions.State. */
export interface SessionState {
  confirmed: "tentative" | "confirmed";
  timing: "upcoming" | "happened";
  record: "none" | "notes-only" | "summary";
  cover: "fee" | "credit";
  fee: "nothing-due" | "charged";
  invoice: "empty" | "draft" | "issued";
  receipt: "empty" | "draft" | "issued";
  payment: "none" | "paid";
  bought: "none" | "due" | "settled";
}

/** What each action on a session would say now; mirrors sessions.Can. */
export interface SessionCan {
  record: Verdict;
  /** Files can be attached or removed. */
  attach: Verdict;
  pay: Verdict;
  undoPayment: Verdict;
  /** It can be deleted, its package kept: not while paid or on an issued document. */
  delete: Verdict;
}

/** Why a session is on her to-do list; mirrors sessions.Reason. */
export type TodoReason = "confirm" | "record" | "collect";

/** A session as she fills it in; mirrors book.Draft. */
export interface SessionDraft {
  clientId: string;
  start: string;
  minutes: number;
  /** What the session costs; unset leaves it to a package credit or the client's fee. */
  feeCents?: number;
  /** A package bought in this session. */
  package?: { sessions: number; priceCents: number };
  homeVisit: boolean;
  tentative: boolean;
}

/** A stored session with the draft to edit it from, and its notes; mirrors book.Stored. */
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

/** Something a session's documents cover: its fee, or the package bought in it. */
export interface DocumentItem {
  source: DocumentSource;
  label: string;
  amountCents: number;
}

export interface SessionDocument {
  type: DocumentType;
  ref: DocumentRef;
}
