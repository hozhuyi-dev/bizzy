import type { PaymentMethod } from "./payments.types";

/** The methods she takes, in the order she picks from; labels as a receipt prints them. */
export const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string; short: string }> = [
  { value: "cash", label: "Cash", short: "Cash" },
  { value: "tng", label: "Touch 'n Go eWallet", short: "TnG" },
  { value: "grab", label: "GrabPay", short: "Grab" },
  { value: "bank_transfer", label: "Bank transfer", short: "Bank" },
];
