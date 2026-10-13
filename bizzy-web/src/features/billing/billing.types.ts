// Mirrors bizzy-lambda/internal/features/billing/preview.go.

/** A booking as the form has it, with no amount typed. */
export interface PreviewInput {
  clientId: string;
  start: string;
  /** The session being edited: it keeps what it holds. */
  eventId?: string | undefined;
  /** Its title buys a package, whose first credit it uses. */
  buysPackage: boolean;
}

/** What pays for a session when no amount is written in its title, as the reconcile will price it. */
export type Cover =
  | { kind: "bought" }
  | { kind: "credit"; packageId: string }
  | { kind: "default"; feeCents: number }
  | { kind: "none" };
