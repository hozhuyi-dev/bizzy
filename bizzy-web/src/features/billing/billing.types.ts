// Mirrors the book's billing.preview (bizzy-lambda/internal/features/book/handler.go).

/** A booking as the form has it, with no fee entered. */
export interface PreviewInput {
  clientId: string;
  start: string;
  /** The session being edited: what pays for it stays unless something else changes. */
  sessionId?: string | undefined;
  /** It buys a package, whose first credit it uses. */
  buysPackage: boolean;
}

/** What would pay for a session with no fee entered, as saving it would choose. */
export type Cover =
  | { kind: "bought" }
  | { kind: "credit"; packageId: string }
  | { kind: "default"; feeCents: number }
  | { kind: "none" };
