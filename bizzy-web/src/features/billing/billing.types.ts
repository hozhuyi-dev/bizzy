import type { FeeRate } from "~/features/clients/clients.types";

// Mirrors bizzy-lambda/internal/features/billing/preview.go, fees.go and
// impact.go.

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

/** A client's fees as the form has them, before saving. */
export interface FeeImpactInput {
  clientId: string;
  feeRates: Array<FeeRate>;
}

/** One session whose fee the new rates would change. */
export interface FeeChange {
  eventId: string;
  start: string;
  /** Its fee now and with the new rates; absent when it has none. */
  beforeCents?: number;
  afterCents?: number;
  /** Money was received for it, at the fee it has now. */
  paid: boolean;
  /** Invoices and receipts covering it, e.g. "INV260012" or "draft invoice". */
  documents: Array<string>;
}

export interface FeeImpact {
  changes: Array<FeeChange>;
  /** A change touches a session already paid or on a document, or brings on something to fix. */
  needsConfirm: boolean;
  /** What saving the rates would bring on. */
  impact: Impact;
}

/** Something a change would leave needing a fix, on a session or package that needs none now; mirrors billing.Brought. */
export interface Brought {
  kind: "session" | "package";
  id: string;
  start: string;
  /** The rule that would hold, e.g. "fee-missing". */
  rule: string;
  /** What she would have to fix. */
  problem: string;
}

/**
 * What a form's save would bring on, from its preview (sessions.impact,
 * sessions.deleteImpact, packages.impact, clients.impact); mirrors
 * billing.Impact. The save refuses what is brought on unless confirmed.
 */
export interface Impact {
  brings: Array<Brought>;
  /** Saving brings something on: it needs her confirmation. */
  needsConfirm: boolean;
  /** Why saving is refused anyway, confirmed or not. */
  refused?: string;
  /** A booking needs its fee entered (see refused). */
  needsFee?: boolean;
  /** The client with no usual fee whose sessions it would leave without one: giving them one settles it. */
  needsClientFee?: string;
}
