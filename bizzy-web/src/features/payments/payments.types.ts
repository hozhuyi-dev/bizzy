// Mirrors bizzy-lambda/internal/shared/money and features/payments.

export type PaymentStatus = "paid" | "waived";
export type PaymentMethod = "cash" | "tng" | "grab" | "bank_transfer";

/** How a session's fee or a package was settled, in full. */
export interface Payment {
  status: PaymentStatus;
  method?: PaymentMethod;
  amountCents: number;
  /** YYYY-MM-DD. */
  paidOn: string;
  updatedAt: string;
}

/** One thing paid for: a session's own fee, or a package. */
export interface PayItem {
  kind: "session" | "package";
  id: string;
  /** Defaults to what it costs. */
  amountCents?: number;
}

/** The payment for the items; the amount is each item's own. */
export interface PaymentInput {
  status: PaymentStatus;
  method?: PaymentMethod;
  /** YYYY-MM-DD; defaults to today. */
  paidOn?: string;
}

/** One thing to settle: a session's fee or a package. */
export interface Payable {
  item: PayItem;
  /** "Session fee", "Package of 10". */
  label: string;
  dueCents: number;
  payment?: Payment | undefined;
  /** A receipt covers it, so its payment can't change. */
  receipted?: boolean;
}
