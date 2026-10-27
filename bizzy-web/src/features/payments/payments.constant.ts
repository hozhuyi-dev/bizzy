import type { PaymentMethod } from "./payments.types";

/** The methods she takes, in the order she picks from; labels as the app shows them. */
export const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string; short: string }> = [
  { value: "cash", label: "Cash", short: "Cash" },
  { value: "tng", label: "Touch 'n Go eWallet", short: "TnG" },
  { value: "grab", label: "GrabPay", short: "Grab" },
  { value: "bank_transfer", label: "Bank transfer", short: "Bank" },
];

/** The methods as a ChoiceField offers them: short on the button, in full on hover. */
export const PAYMENT_CHOICES = PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.short, title: method.label }));

/** A new item's payment, as a ChoiceField offers it: not yet (left to collect), or how it was paid there and then. */
export const PAID_NOW_CHOICES = [{ value: "", label: "Not yet" }, ...PAYMENT_CHOICES];
