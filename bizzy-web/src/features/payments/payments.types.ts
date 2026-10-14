import type { DocumentRef } from "~/features/documents/documents.types";

// Mirrors bizzy-lambda/internal/shared/money and the book's payments.set.

export type PaymentMethod = "cash" | "tng" | "grab" | "bank_transfer";

/**
 * What a session's or package's receipt says was received for it: always in
 * full. Copied onto the item by the API; the receipt is where it lives.
 */
export interface Paid {
  amountCents: number;
  method: PaymentMethod;
  /** YYYY-MM-DD. */
  paidOn: string;
}

/** One thing paid for: a session's own fee, or a package. */
export interface PayItem {
  kind: "session" | "package";
  id: string;
}

/** A payment for the items, each paid what it owes. */
export interface PaymentInput {
  method: PaymentMethod;
  /** YYYY-MM-DD; defaults to today. */
  paidOn?: string;
}

/** One thing to pay for: a session's fee or a package. */
export interface Payable {
  item: PayItem;
  /** "Session fee", "Package of 10". */
  label: string;
  /** What it costs: what its invoice charges. */
  dueCents: number;
  paid?: Paid | undefined;
  /** The receipt recording its payment; once issued, the payment can't change. */
  receipt?: DocumentRef | undefined;
}
