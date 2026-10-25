import type { Paperwork } from "~/features/documents/documents.util";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { DocumentRef, DocumentSource } from "~/features/documents/documents.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { Paid } from "~/features/payments/payments.types";
import type { SESSION_FACETS } from "./sessions.constant";
import type { FilterSearch, ListRequest } from "~/core/list/filter.types";
import type { Locks, Verdict } from "~/core/lambda/lambda.types";

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
  /** Its booking can change: not once cancelled. */
  update: Verdict;
  /** Notes and files can be written or attached. */
  record: Verdict;
  pay: Verdict;
  undoPayment: Verdict;
  /** Asking the client to pay for it on WhatsApp: something of it is owed. */
  askToPay: Verdict;
  /** Sending its documents for the client's records: one is issued. */
  sendRecords: Verdict;
  /** Calling it off, keeping it and its record. */
  cancel: Verdict;
  /** Deleting it, booked by mistake, keeping the package bought in it. */
  delete: Verdict;
  /** Deleting it with the package bought in it. */
  deleteWithPackage: Verdict;
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
  /** What its invoice and receipt lines cover (it, and the package bought in it): what asking to pay and sending its documents go by. */
  sources: Array<DocumentSource>;
  record: RecordView;
  todo: Array<SessionReason>;
  /** When it was called off, and why; a cancelled session stays as it was. */
  cancelledAt?: string;
  cancelReason?: string;
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
  /** The cancelled ones too, at the stages asked for. */
  cancelled: boolean;
  invoices: Array<Paperwork>;
  receipts: Array<Paperwork>;
  /** Methods it was paid by, or "credits" (PAID_BY_CREDITS). */
  payments: Array<string>;
}

/** A session with its notes, and what its update can't change, for its page; mirrors sessions.FullView. */
export interface SessionFullView extends SessionView {
  notes: string;
  locked: Locks;
}

/** A session's page in one call: it, the calendar edits waiting on it, the follow-ups made from it; mirrors app.SessionPageView. */
export interface SessionPageView {
  session: SessionFullView;
  conflicts: Array<ConflictView>;
  followUps: Array<FollowUpView>;
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

/**
 * Where on Home a session was opened from, the list its page steps
 * through: the to-do list, or today's sessions.
 */
export type SessionReturnTo = "home" | "today";

/** The sessions list's filter, as its URL keeps it. */
export type SessionsSearch = FilterSearch<(typeof SESSION_FACETS)[number]>;

/** A session page's search: the list it steps through, and where it was opened from. */
export interface SessionSearch extends SessionsSearch {
  /** Opened from Home: the list there it steps through instead. */
  from?: SessionReturnTo | undefined;
  /** Opened from a client's timeline (their id): its sessions instead. */
  timeline?: string | undefined;
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
