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
  amountCents?: number;
  date?: string;
  clientId?: string;
}

export interface Session {
  eventId: string;
  title: string;
  start: string;
  end: string;
  colorId?: string;
  removed?: boolean;

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
  location?: "clinic" | "home";
  locationSource?: "colour" | "client";
  reason?: string;
  drift?: string;

  document?: DocumentRef;
}

/**
 * A session as she fills it in; mirrors calsync.Draft. The API writes the
 * calendar title from it, so it always parses and matches the client.
 */
export interface SessionDraft {
  clientId: string;
  start: string;
  minutes: number;
  /** What she was paid; unset leaves it to a package credit or the default fee. */
  feeCents?: number;
  /** A package bought in this session. */
  package?: { sessions: number; priceCents: number };
  homeVisit: boolean;
  tentative: boolean;
}

/** A stored session with the draft to start an edit from; mirrors calsync.Stored. */
export interface StoredSession {
  session: Session;
  draft: SessionDraft;
}
