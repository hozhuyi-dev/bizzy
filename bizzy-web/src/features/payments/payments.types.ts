// Mirrors bizzy-lambda/internal/features/payments and documents/money.go.

export type PaymentMethod = "cash" | "tng" | "grab" | "bank_transfer";

/**
 * What a session's or package's receipt says was received for it: always in
 * full; mirrors documents.Paid. The receipt is where it lives.
 */
export interface Paid {
  amountCents: number;
  method: PaymentMethod;
  /** YYYY-MM-DD. */
  paidOn: string;
  receiptId: string;
  /** Its receipt is issued: the payment stays as it is. */
  issued: boolean;
}

/**
 * One thing paid for; mirrors payments.Item. A session is everything it
 * still owes: its fee and the package bought in it.
 */
export interface PayItem {
  kind: "session" | "package";
  id: string;
}

/** A payment for the items, each paid in full; mirrors documents.PaymentInput. */
export interface PaymentInput {
  method: PaymentMethod;
  /** YYYY-MM-DD; defaults to today. */
  paidOn?: string;
}

/** payments.set's request: a null payment undoes the items'. */
export interface SetPaymentRequest {
  items: Array<PayItem>;
  payment: PaymentInput | null;
}

/** One thing to pay for, as the payment panel shows it. */
export interface Payable {
  item: PayItem;
  /** "Session", "Package of 10". */
  label: string;
  /** What it costs while unpaid. */
  dueCents: number;
  paid?: Paid | undefined;
}
