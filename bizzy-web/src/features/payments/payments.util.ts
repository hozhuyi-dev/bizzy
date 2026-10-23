import { PAYMENT_METHODS } from "./payments.constant";
import type { Facet } from "~/core/list/filter.types";
import type { PaymentMethod } from "./payments.types";

/** "Touch 'n Go eWallet", as a receipt prints it. */
export function methodLabel(method: PaymentMethod | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? "";
}

/** "TnG", where space is short. */
export function methodShortLabel(method: PaymentMethod | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.short ?? "";
}

/** A payment chip's value for an item a package's credits pay for, beside the methods. Mirrors sessions.PaidByCredits. */
export const PAID_BY_CREDITS = "credits";

/** A list's chip for how its items were paid: a method, or a package's credits. */
export const PAYMENT_FACET: Facet = {
  key: "payment",
  label: "Paid by",
  options: [
    ...PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })),
    { value: PAID_BY_CREDITS, label: "Package credits", keywords: ["prepaid"] },
  ],
};
