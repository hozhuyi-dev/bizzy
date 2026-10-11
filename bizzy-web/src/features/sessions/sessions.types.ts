// Mirrors bizzy-lambda/internal/features/sessions/model.go.
export type SessionStatus =
  | "tentative"
  | "parse_error"
  | "unmatched"
  | "missing_fee"
  | "priced"
  | "package"
  | "ignored"
  | "removed";

export interface DocumentRef {
  documentId: string;
  /** Set once the document is issued; a draft only reserves. */
  number?: string;
  amountCents?: number;
  date?: string;
  clientId?: string;
}

export interface ContactSuggestion {
  resourceName: string;
  displayName: string;
  /** Set when a client already links this contact. */
  clientId?: string;
}

export interface Session {
  eventId: string;
  title: string;
  start: string;
  end: string;
  colorId?: string;
  removed?: boolean;
  /** Her contacts the name may refer to, while it matches no client. */
  suggestedContacts?: Array<ContactSuggestion>;

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

  ignored?: boolean;
  document?: DocumentRef;
}
