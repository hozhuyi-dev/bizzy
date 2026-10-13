// Mirrors bizzy-lambda/internal/shared/money and features/payments.

export type PaymentStatus = "paid" | "waived";
export type PaymentMethod = "cash" | "tng" | "grab" | "bank_transfer";

/** The methods she takes, in the order she picks from; labels as a receipt prints them. */
export const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string; short: string }> = [
  { value: "cash", label: "Cash", short: "Cash" },
  { value: "tng", label: "Touch 'n Go eWallet", short: "TnG" },
  { value: "grab", label: "GrabPay", short: "Grab" },
  { value: "bank_transfer", label: "Bank transfer", short: "Bank" },
];

export function methodLabel(method: PaymentMethod | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? "";
}

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
