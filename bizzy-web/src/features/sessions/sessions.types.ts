import type { DocumentRef, DocumentSource } from "~/features/documents/documents.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { Paid } from "~/features/payments/payments.types";
import type { ListRequest } from "~/core/filter/filter.types";
import type { Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/sessions/api.go.

/** The user's own place, or a home visit at the client's: `(H)` and `(V)` in a title. */
export type SessionLocation = "own" | "visit";

/** Why a session is on the to-do list; mirrors sessions.Reason. */
export type SessionReason = "confirm" | "record" | "collect";

/** The package bought in a session, collected with it; mirrors sessions.BoughtView. */
export interface BoughtView {
  id: string;
  hours: number;
  priceCents: number;
  paid: boolean;
}

/** The hours of a session a package's credits pay for; mirrors sessions.CreditView. */
export interface CreditView {
  packageId: string;
  hours: number;
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
  /** How long it is charged for: its length rounded down to the half hour, at least a half hour. */
  hours: number;
  /** What package credits pay of it, oldest package first; its fee on an invoice pays the rest. */
  credits: Array<CreditView>;
  /** What its invoice charges; 0 when credits pay it all. */
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

/** A session a search found; mirrors sessions.Hit. */
export interface SessionHit extends SessionView {
  /** The part of its notes with the words, when they were found there. */
  excerpt?: string;
}

/** sessions.search's request: an empty filter takes every value. */
export interface SearchSessionsRequest extends ListRequest {
  clientIds: Array<string>;
  locations: Array<SessionLocation>;
  todo: Array<SessionReason>;
}

/** A session with its notes, for its page; mirrors sessions.FullView. */
export interface SessionFullView extends SessionView {
  notes: string;
}

/**
 * What pays for the hours package credits leave: the package bought in it,
 * nothing (they leave none), the client's usual fee, or nothing at all (a
 * fee must be entered); mirrors sessions.CoverKind.
 */
export type CoverKind = "bought" | "credit" | "default" | "none";

/** What would pay for a session with no fee entered; mirrors sessions.CoverView. */
export interface CoverView {
  kind: CoverKind;
  /** How long it is charged for. */
  hours: number;
  /** What packages bought before it pay, oldest first. */
  credits: Array<CreditView>;
  /** What they leave, which feeCents charges when kind is "default". */
  feeHours: number;
  feeCents?: number;
}

/** sessions.preview's request: a booking as the form has it, with no fee entered. */
export interface PreviewSessionRequest {
  clientId: string;
  time: { start: string; end: string };
  /** The session being edited: what pays for it stays unless something else changes. */
  sessionId?: string | undefined;
  /** It buys a package, whose credits pay what older ones leave. */
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
  /** `{cents}` is its whole fee, typed for it; `{}` returns it to credits and the usual fee. */
  fee?: { cents?: number };
  /** `{bought}` is the package bought in it; `{}` drops it. */
  package?: { bought?: { hours: number; priceCents: number } };
  /** Move what was received to the new amounts, on receipts not issued yet. */
  updatePayment?: boolean;
}

/** A booking as the user fills it in: what the booking form edits. */
export interface SessionDraft {
  clientId: string;
  start: string;
  minutes: number;
  /** Its whole fee, typed for it; unset leaves it to package credits and the client's hourly fee. */
  feeCents?: number;
  /** A package of hours bought in this session. */
  package?: { hours: number; priceCents: number };
  homeVisit: boolean;
  tentative: boolean;
}

/** Where a session was opened from, to go back there. */
export type SessionReturnTo = "home";

export interface SessionSearch {
  /** Where to go back to once saved. */
  from?: SessionReturnTo | undefined;
  /** The calendar edit it was opened to settle: once its booking is saved, back to the to-do list. */
  settle?: string | undefined;
}

export type StageTone = "neutral" | "done" | "info" | "waiting" | "attention";

export interface StageBadge {
  label: string;
  tone: StageTone;
}

/** A package whose credits pay hours of a session. */
export interface CoveringCredit {
  pkg: PackageView;
  hours: number;
}

/** Something a session's invoice covers: its fee, or the package bought in it. */
export interface DocumentItem {
  source: DocumentSource;
  label: string;
  amountCents: number;
}
